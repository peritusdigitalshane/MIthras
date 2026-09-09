// =============================================================================
// /functions/v1/event-ingest
//
// Generic events endpoint for non-agent sources (firewalls, routers, Linux
// hosts, custom apps). Authenticated with a customer-issued API key (the
// same `mit_live_<…>` token that backs the public REST API).
//
// Supported wire formats:
//
//   1. Single CEF/LEEF line — Content-Type: text/plain
//   2. RFC 5424 syslog over JSON: {messages: ["<msg>", ...]}
//   3. Native JSON: {events: [{source_kind,source_label,severity,...}, ...]}
//
// Required scope:   events:write
//
// Returns: 200 {accepted: N} on success
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveApiKey, requireScope } from "../_shared/api-auth.ts";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_EVENTS_PER_REQUEST = 500;
const MAX_RAW_BYTES          = 1_000_000; // 1 MB body cap

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface ExternalEventInput {
    source_kind?:  string;
    source_label?: string;
    severity?:     string;
    vendor?:       string;
    product?:      string;
    event_name?:   string;
    raw_message?:  string;
    event_time?:   string;
    parsed?:       Record<string, unknown>;
}

const ALLOWED_SOURCE_KINDS = new Set([
    "firewall", "router", "linux_host", "mac_host",
    "custom_app", "cloud_workload", "iot", "other",
]);

const ALLOWED_SEVERITIES = new Set(["low", "medium", "high", "critical"]);

function jsonResp(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

// ------------------------------------------------------------
// CEF parsing
// CEF header: CEF:Version|Vendor|Product|DevVer|SigID|Name|Sev|Ext
// Extensions are key=value pairs separated by spaces; keys cannot contain
// spaces; values can (continue until the next unescaped key=).
// ------------------------------------------------------------
function parseCef(line: string): ExternalEventInput | null {
    if (!line.startsWith("CEF:")) return null;
    // Split header on unescaped pipes.
    const parts: string[] = [];
    let buf = "";
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === "\\" && line[i + 1] === "|") { buf += "|"; i++; continue; }
        if (c === "|") { parts.push(buf); buf = ""; if (parts.length === 7) { buf = line.slice(i + 1); break; } continue; }
        buf += c;
    }
    if (parts.length < 7) return null;
    const [_v, vendor, product, _dv, sigId, name, sevStr] = parts;
    const ext = buf;
    const parsed: Record<string, unknown> = {};
    // Walk ext as key=value pairs; values terminate at the next " key="
    const kvRe = /(\w+)=((?:[^=]|\\=)*?)(?=\s\w+=|$)/g;
    for (const m of ext.matchAll(kvRe)) {
        parsed[m[1]] = m[2].replace(/\\=/g, "=").replace(/\\n/g, "\n");
    }
    const sevNum = parseInt(sevStr, 10);
    const severity = sevNum >= 9 ? "critical" : sevNum >= 7 ? "high" : sevNum >= 4 ? "medium" : "low";
    return {
        source_kind: "custom_app",
        vendor, product,
        event_name: sigId,
        severity,
        raw_message: line,
        parsed: { name, ...parsed },
    };
}

// ------------------------------------------------------------
// LEEF parsing
// LEEF:2.0|Vendor|Product|Version|EventID|key1=val1 \t key2=val2 ...
// ------------------------------------------------------------
function parseLeef(line: string): ExternalEventInput | null {
    if (!line.startsWith("LEEF:")) return null;
    const parts = line.split("|");
    if (parts.length < 6) return null;
    const [, vendor, product, , eventId] = parts;
    const ext = parts.slice(5).join("|");
    const parsed: Record<string, unknown> = {};
    for (const kv of ext.split(/\t|\s{2,}/)) {
        const eq = kv.indexOf("=");
        if (eq > 0) parsed[kv.slice(0, eq).trim()] = kv.slice(eq + 1).trim();
    }
    return {
        source_kind: "custom_app",
        vendor, product,
        event_name: eventId,
        severity: typeof parsed.sev === "string" && ALLOWED_SEVERITIES.has(parsed.sev as string) ? parsed.sev as string : "medium",
        raw_message: line,
        parsed,
    };
}

// ------------------------------------------------------------
// RFC 5424 syslog (very loose parse — we just bucket the priority + msg)
// <pri>1 timestamp host app procid msgid SD message
// ------------------------------------------------------------
function parseRfc5424(line: string): ExternalEventInput | null {
    const m = line.match(/^<(\d+)>1\s+(\S+)\s+(\S+)\s+(\S+)\s+\S+\s+\S+\s+(?:\S+\s+)?(.*)$/);
    if (!m) return null;
    const pri = parseInt(m[1], 10);
    const sevNum = pri % 8;
    const severity = sevNum <= 2 ? "critical" : sevNum <= 4 ? "high" : sevNum <= 5 ? "medium" : "low";
    return {
        source_kind: "other",
        source_label: m[3],
        product: m[4],
        severity,
        raw_message: line,
        event_time: new Date(m[2]).toISOString(),
        parsed: { message: m[5] },
    };
}

function normaliseSeverity(sev: unknown): string {
    if (typeof sev !== "string") return "medium";
    const lower = sev.toLowerCase();
    if (ALLOWED_SEVERITIES.has(lower)) return lower;
    // Map common synonyms.
    if (["severe", "fatal", "emergency", "alert"].includes(lower)) return "critical";
    if (["warn", "warning", "moderate"].includes(lower)) return "medium";
    if (["info", "debug", "notice"].includes(lower)) return "low";
    return "medium";
}

function normaliseSourceKind(kind: unknown): string {
    if (typeof kind === "string" && ALLOWED_SOURCE_KINDS.has(kind.toLowerCase())) return kind.toLowerCase();
    return "other";
}

function clamp(s: unknown, max: number): string | null {
    if (s === null || s === undefined) return null;
    return String(s).slice(0, max);
}

// ------------------------------------------------------------
// Body parsing: detect format, return an array of events.
// ------------------------------------------------------------
async function parseBody(req: Request): Promise<{ events: ExternalEventInput[]; wireFormat: string } | { error: string }> {
    const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
    const text = await req.text();
    if (text.length > MAX_RAW_BYTES) return { error: "body_too_large" };

    // plain CEF/LEEF/RFC5424 — one per line
    if (contentType.startsWith("text/plain") || contentType.startsWith("application/x-cef")) {
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const events: ExternalEventInput[] = [];
        let wire = "json";
        for (const line of lines) {
            let parsed: ExternalEventInput | null = null;
            if (line.startsWith("CEF:"))      { parsed = parseCef(line); wire = "cef"; }
            else if (line.startsWith("LEEF:")) { parsed = parseLeef(line); wire = "leef"; }
            else if (line.startsWith("<"))     { parsed = parseRfc5424(line); wire = "rfc5424"; }
            if (parsed) events.push(parsed);
        }
        if (events.length === 0) return { error: "no_events_parsed_from_plaintext" };
        return { events, wireFormat: wire };
    }

    // JSON
    let body: any;
    try { body = JSON.parse(text); } catch { return { error: "invalid_json" }; }

    // Syslog-over-JSON envelope
    if (Array.isArray(body?.messages)) {
        const events: ExternalEventInput[] = [];
        let wire = "rfc5424";
        for (const m of body.messages as unknown[]) {
            if (typeof m !== "string") continue;
            let parsed: ExternalEventInput | null = null;
            if (m.startsWith("CEF:"))      { parsed = parseCef(m); wire = "cef"; }
            else if (m.startsWith("LEEF:")) { parsed = parseLeef(m); wire = "leef"; }
            else                            { parsed = parseRfc5424(m); }
            if (parsed) events.push(parsed);
        }
        return { events, wireFormat: wire };
    }

    // Native JSON
    if (Array.isArray(body?.events)) {
        return { events: body.events as ExternalEventInput[], wireFormat: "json" };
    }

    return { error: "expected_events_or_messages_array" };
}

// ------------------------------------------------------------
// Entry
// ------------------------------------------------------------
Deno.serve(async (req) => {
    const origin = req.headers.get("origin");
    const pre = handlePreflight(req);
    if (pre) return pre;
    if (req.method !== "POST") return jsonResp({ error: "method_not_allowed" }, 405, origin);

    const auth = await resolveApiKey(req, supabase);
    if (!auth.ok) return jsonResp({ error: auth.error }, auth.status, origin);

    const scopeFail = requireScope(auth, "events:write");
    if (scopeFail) return scopeFail;

    const parsed = await parseBody(req);
    if ("error" in parsed) return jsonResp({ error: parsed.error }, 400, origin);
    if (parsed.events.length === 0) return jsonResp({ accepted: 0 }, 200, origin);
    if (parsed.events.length > MAX_EVENTS_PER_REQUEST) {
        return jsonResp({ error: "too_many_events", max: MAX_EVENTS_PER_REQUEST }, 413, origin);
    }

    const rows = parsed.events.map(e => ({
        organization_id: auth.organizationId,
        source_kind:     normaliseSourceKind(e.source_kind),
        source_label:    clamp(e.source_label, 200),
        severity:        normaliseSeverity(e.severity),
        wire_format:     parsed.wireFormat,
        vendor:          clamp(e.vendor, 100),
        product:         clamp(e.product, 100),
        event_name:      clamp(e.event_name, 200),
        raw_message:     clamp(e.raw_message, 4000),
        parsed:          (e.parsed && typeof e.parsed === "object") ? e.parsed : {},
        event_time:      e.event_time && !isNaN(Date.parse(e.event_time))
                          ? new Date(e.event_time).toISOString()
                          : new Date().toISOString(),
    }));

    const { error: insErr } = await supabase.from("external_events").insert(rows as any);
    if (insErr) return jsonResp({ error: "insert_failed", details: insErr.message }, 500, origin);

    return jsonResp({ accepted: rows.length }, 200, origin);
});
