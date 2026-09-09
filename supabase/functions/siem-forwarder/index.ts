// =============================================================================
// /functions/v1/siem-forwarder
//
// Cron-triggered drain of public.event_outbox. For each enabled destination
// with pending rows we:
//   1. Take up to MAX_BATCH rows whose next_attempt_at <= now()
//   2. Format each payload per destination.format (json / cef / leef)
//   3. POST to destination.endpoint_url with the right headers
//   4. Mark rows sent OR bump attempts + schedule a retry (exponential backoff,
//      capped). After MAX_ATTEMPTS we mark failed_permanent and stop retrying.
//
// Authentication: caller must present the service-role JWT (the pg_cron
// kick uses this). No customer JWTs.
//
// Per-destination kinds:
//   webhook       → raw JSON POST. Optional auth_token used as Bearer.
//   syslog_https  → POST JSON {messages: [<rfc5424 string>...]}.
//   splunk_hec    → POST {event: <payload>} array per HEC convention.
//   sentinel_la   → Sentinel Log Analytics HTTP Data Collector (HMAC-SHA256).
//   elastic_http  → POST single doc to elastic _doc endpoint.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_BATCH_PER_DEST = 50;
const MAX_DESTS_PER_TICK = 100;
const MAX_ATTEMPTS = 8;
const HTTP_TIMEOUT_MS = 8000;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface Destination {
    id: string;
    organization_id: string;
    name: string;
    kind: "webhook" | "syslog_https" | "splunk_hec" | "sentinel_la" | "elastic_http";
    format: "json" | "cef" | "leef";
    endpoint_url: string;
    auth_token: string | null;
    extra: Record<string, unknown>;
    event_categories: string[];
    enabled: boolean;
}

interface OutboxRow {
    id: string;
    organization_id: string;
    destination_id: string;
    category: string;
    source_table: string;
    source_id: string | null;
    severity: string | null;
    payload: Record<string, unknown>;
    attempts: number;
}

function jsonResp(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

// ------------------------------------------------------------
// Format helpers
// ------------------------------------------------------------

function escapeCefValue(v: unknown): string {
    if (v === null || v === undefined) return "";
    return String(v).replace(/\\/g, "\\\\").replace(/=/g, "\\=").replace(/\r?\n/g, "\\n");
}

function escapeCefHeader(v: string): string {
    return v.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function severityToCef(sev: string | null): number {
    switch ((sev ?? "").toLowerCase()) {
        case "severe": case "critical": return 10;
        case "high":                    return 8;
        case "moderate": case "medium": return 5;
        case "low":                     return 2;
        default:                        return 5;
    }
}

function toCef(row: OutboxRow): string {
    const p = row.payload as Record<string, unknown>;
    const sig = `${row.source_table}.${row.category}`;
    const name = String(p.threat_name ?? p.name ?? p.event_name ?? row.category);
    const sev = severityToCef(row.severity);
    const exts: string[] = [];
    for (const [k, v] of Object.entries(p)) {
        if (v === null || v === undefined) continue;
        exts.push(`${k}=${escapeCefValue(v)}`);
    }
    return `CEF:0|Mithras|ThreatDefence|1.0|${escapeCefHeader(sig)}|${escapeCefHeader(name)}|${sev}|${exts.join(" ")}`;
}

function toLeef(row: OutboxRow): string {
    const p = row.payload as Record<string, unknown>;
    const ext = Object.entries(p)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => `${k}=${String(v).replace(/\t/g, " ")}`)
        .join("\t");
    return `LEEF:2.0|Mithras|ThreatDefence|1.0|${row.category}|${ext}`;
}

function toRfc5424(row: OutboxRow): string {
    const p = row.payload as Record<string, unknown>;
    const pri = 14; // local0 + info — simple default
    const ts = new Date().toISOString();
    const host = "mithras.com.au";
    const app = "mithras";
    const msg = JSON.stringify({ category: row.category, source: row.source_table, ...p });
    return `<${pri}>1 ${ts} ${host} ${app} - ${row.category} - ${msg}`;
}

function toJson(row: OutboxRow): Record<string, unknown> {
    return {
        category: row.category,
        source_table: row.source_table,
        source_id: row.source_id,
        severity: row.severity,
        organization_id: row.organization_id,
        emitted_at: new Date().toISOString(),
        ...row.payload,
    };
}

function formatPayload(dest: Destination, row: OutboxRow): string | Record<string, unknown> {
    switch (dest.format) {
        case "cef":  return toCef(row);
        case "leef": return toLeef(row);
        case "json":
        default:     return toJson(row);
    }
}

// ------------------------------------------------------------
// Per-kind delivery
// ------------------------------------------------------------

async function deliverWebhook(dest: Destination, rows: OutboxRow[]): Promise<{ ok: boolean; status: number; error?: string }> {
    const body = JSON.stringify({ events: rows.map(r => formatPayload(dest, r)) });
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (dest.auth_token) headers["authorization"] = `Bearer ${dest.auth_token}`;
    return await postWithTimeout(dest.endpoint_url, body, headers);
}

async function deliverSyslog(dest: Destination, rows: OutboxRow[]): Promise<{ ok: boolean; status: number; error?: string }> {
    const messages = rows.map(r => {
        const f = formatPayload(dest, r);
        return typeof f === "string" ? f : toRfc5424(r);
    });
    const body = JSON.stringify({ messages });
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (dest.auth_token) headers["authorization"] = `Bearer ${dest.auth_token}`;
    return await postWithTimeout(dest.endpoint_url, body, headers);
}

async function deliverSplunkHec(dest: Destination, rows: OutboxRow[]): Promise<{ ok: boolean; status: number; error?: string }> {
    // Splunk HEC accepts newline-delimited JSON of {event: ...} objects.
    const body = rows.map(r => JSON.stringify({ event: formatPayload(dest, r) })).join("\n");
    const headers: Record<string, string> = {
        "content-type": "application/json",
        "authorization": `Splunk ${dest.auth_token ?? ""}`,
    };
    return await postWithTimeout(dest.endpoint_url, body, headers);
}

async function deliverSentinelLa(dest: Destination, rows: OutboxRow[]): Promise<{ ok: boolean; status: number; error?: string }> {
    // Microsoft Sentinel Log Analytics HTTP Data Collector. Requires:
    //   - extra.workspace_id
    //   - auth_token = workspace primary/secondary key (base64)
    //   - extra.log_type (custom log table name, no underscores)
    const workspaceId = (dest.extra?.workspace_id as string) ?? "";
    const sharedKey   = dest.auth_token ?? "";
    const logType     = (dest.extra?.log_type as string) ?? "MithrasEvents";
    if (!workspaceId || !sharedKey) {
        return { ok: false, status: 0, error: "sentinel_la missing workspace_id or auth_token" };
    }
    const body = JSON.stringify(rows.map(r => formatPayload(dest, r)));
    const rfcDate = new Date().toUTCString();
    const contentLength = new TextEncoder().encode(body).length;
    const stringToSign = `POST\n${contentLength}\napplication/json\nx-ms-date:${rfcDate}\n/api/logs`;
    const keyBytes = Uint8Array.from(atob(sharedKey), c => c.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(stringToSign));
    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
    const auth = `SharedKey ${workspaceId}:${sigB64}`;
    const url = `https://${workspaceId}.ods.opinsights.azure.com/api/logs?api-version=2016-04-01`;
    const headers: Record<string, string> = {
        "content-type": "application/json",
        "authorization": auth,
        "x-ms-date": rfcDate,
        "log-type": logType,
        "time-generated-field": "emitted_at",
    };
    return await postWithTimeout(url, body, headers);
}

async function deliverElastic(dest: Destination, rows: OutboxRow[]): Promise<{ ok: boolean; status: number; error?: string }> {
    // Two modes:
    //   single _doc per event (default) — POSTed individually
    //   bulk via _bulk (when extra.bulk = true)
    const useBulk = !!dest.extra?.bulk;
    if (useBulk) {
        const lines: string[] = [];
        for (const r of rows) {
            lines.push(JSON.stringify({ index: {} }));
            lines.push(JSON.stringify(formatPayload(dest, r)));
        }
        const body = lines.join("\n") + "\n";
        const headers: Record<string, string> = {
            "content-type": "application/x-ndjson",
        };
        if (dest.auth_token) headers["authorization"] = `ApiKey ${dest.auth_token}`;
        return await postWithTimeout(dest.endpoint_url, body, headers);
    }
    // Non-bulk: POST each event sequentially and aggregate the result.
    for (const r of rows) {
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (dest.auth_token) headers["authorization"] = `ApiKey ${dest.auth_token}`;
        const res = await postWithTimeout(dest.endpoint_url, JSON.stringify(formatPayload(dest, r)), headers);
        if (!res.ok) return res;
    }
    return { ok: true, status: 200 };
}

async function postWithTimeout(url: string, body: string, headers: Record<string, string>): Promise<{ ok: boolean; status: number; error?: string }> {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
    try {
        const resp = await fetch(url, { method: "POST", headers, body, signal: ctrl.signal });
        if (resp.ok) return { ok: true, status: resp.status };
        const text = (await resp.text().catch(() => "")).slice(0, 400);
        return { ok: false, status: resp.status, error: `http_${resp.status}: ${text}` };
    } catch (e: any) {
        return { ok: false, status: 0, error: e?.message ?? "fetch_failed" };
    } finally {
        clearTimeout(tid);
    }
}

async function deliver(dest: Destination, rows: OutboxRow[]): Promise<{ ok: boolean; status: number; error?: string }> {
    switch (dest.kind) {
        case "webhook":      return await deliverWebhook(dest, rows);
        case "syslog_https": return await deliverSyslog(dest, rows);
        case "splunk_hec":   return await deliverSplunkHec(dest, rows);
        case "sentinel_la":  return await deliverSentinelLa(dest, rows);
        case "elastic_http": return await deliverElastic(dest, rows);
        default:             return { ok: false, status: 0, error: `unsupported_kind:${dest.kind}` };
    }
}

// ------------------------------------------------------------
// Backoff schedule. seconds: 30, 60, 120, 240, 480, 960, 1800, 3600.
// After MAX_ATTEMPTS rows are marked failed_permanent.
// ------------------------------------------------------------
function nextDelaySeconds(attempts: number): number {
    const base = 30;
    return Math.min(3600, base * Math.pow(2, attempts));
}

// ------------------------------------------------------------
// Main drain
// ------------------------------------------------------------
async function drain(): Promise<{ destinations_processed: number; sent: number; failed: number; permanent_failures: number }> {
    const stats = { destinations_processed: 0, sent: 0, failed: 0, permanent_failures: 0 };

    // Find destinations with pending work, oldest-first by next_attempt_at.
    const { data: workQueue } = await supabase
        .from("event_outbox")
        .select("destination_id")
        .eq("status", "pending")
        .lte("next_attempt_at", new Date().toISOString())
        .limit(MAX_DESTS_PER_TICK * 5);
    const destIds = Array.from(new Set((workQueue ?? []).map(r => r.destination_id as string))).slice(0, MAX_DESTS_PER_TICK);
    if (destIds.length === 0) return stats;

    const { data: dests } = await supabase
        .from("siem_destinations")
        .select("*")
        .in("id", destIds)
        .eq("enabled", true);

    for (const dest of (dests ?? []) as unknown as Destination[]) {
        stats.destinations_processed++;
        const { data: rowsRaw } = await supabase
            .from("event_outbox")
            .select("id, organization_id, destination_id, category, source_table, source_id, severity, payload, attempts")
            .eq("destination_id", dest.id)
            .eq("status", "pending")
            .lte("next_attempt_at", new Date().toISOString())
            .order("created_at", { ascending: true })
            .limit(MAX_BATCH_PER_DEST);
        const rows = (rowsRaw ?? []) as unknown as OutboxRow[];
        if (rows.length === 0) continue;

        const result = await deliver(dest, rows);
        const now = new Date().toISOString();
        if (result.ok) {
            stats.sent += rows.length;
            await supabase
                .from("event_outbox")
                .update({ status: "sent", delivered_at: now } as any)
                .in("id", rows.map(r => r.id));
            await supabase
                .from("siem_destinations")
                .update({ last_success_at: now, last_failure_reason: null } as any)
                .eq("id", dest.id);
        } else {
            stats.failed += rows.length;
            for (const r of rows) {
                const newAttempts = r.attempts + 1;
                if (newAttempts >= MAX_ATTEMPTS) {
                    stats.permanent_failures++;
                    await supabase
                        .from("event_outbox")
                        .update({
                            status: "failed_permanent",
                            attempts: newAttempts,
                            last_error: (result.error ?? "unknown").slice(0, 1000),
                        } as any)
                        .eq("id", r.id);
                } else {
                    const next = new Date(Date.now() + nextDelaySeconds(newAttempts) * 1000).toISOString();
                    await supabase
                        .from("event_outbox")
                        .update({
                            attempts: newAttempts,
                            next_attempt_at: next,
                            last_error: (result.error ?? "unknown").slice(0, 1000),
                        } as any)
                        .eq("id", r.id);
                }
            }
            await supabase
                .from("siem_destinations")
                .update({
                    last_failure_at: now,
                    last_failure_reason: (result.error ?? `http_${result.status}`).slice(0, 500),
                } as any)
                .eq("id", dest.id);
        }
    }
    return stats;
}

// ------------------------------------------------------------
// Entry
// ------------------------------------------------------------
Deno.serve(async (req) => {
    // Service-role-only.
    const auth = req.headers.get("authorization") ?? "";
    const tok = auth.replace(/^Bearer\s+/i, "").trim();
    if (tok !== SUPABASE_SERVICE_KEY) return jsonResp({ error: "unauthorized" }, 401);

    try {
        const stats = await drain();
        return jsonResp({ ok: true, ...stats });
    } catch (e: any) {
        return jsonResp({ ok: false, error: e?.message ?? "drain_failed" }, 500);
    }
});
