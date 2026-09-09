// POST /functions/v1/m365-breach-poll
//
// For each verified (tenant, domain) subscription with an API key:
//   1. GET /api/v3/breacheddomain/{domain}   -> { "user@domain.com": ["Adobe","LinkedIn"], ... }
//   2. For any breach name we haven't cached yet, GET /api/v3/breach/{name}
//   3. Diff against existing m365_breach_findings — upsert + create alerts for NEW exposures
//
// Cron: daily 03:53 UTC.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET          = Deno.env.get("MITHRAS_CRON_SECRET") ?? Deno.env.get("CRON_SECRET") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const HIBP_BASE = "https://haveibeenpwned.com/api/v3";
const USER_AGENT = "Mithras-DarkWebMonitor/1.0";

function json(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

interface SubscriptionRow {
    id: string;
    organization_id: string;
    m365_tenant_id: string;
    domain: string;
    hibp_api_key: string | null;
    is_enabled: boolean;
}

interface BreachDetail {
    Name: string;
    Title: string;
    Domain: string;
    BreachDate: string;
    AddedDate: string;
    PwnCount: number;
    Description: string;
    DataClasses: string[];
    IsVerified: boolean;
    IsSensitive: boolean;
    IsFabricated: boolean;
    IsRetired: boolean;
    IsSpamList: boolean;
    LogoPath: string;
}

// In-process breach detail cache so we don't hammer HIBP for breaches that
// every customer has people in.
const breachDetailCache = new Map<string, BreachDetail>();

async function fetchBreachDetail(name: string, apiKey: string): Promise<BreachDetail | null> {
    if (breachDetailCache.has(name)) return breachDetailCache.get(name)!;
    try {
        const r = await fetch(`${HIBP_BASE}/breach/${encodeURIComponent(name)}`, {
            // Public endpoint but adding the key doesn't hurt and helps with rate limit
            headers: { "hibp-api-key": apiKey, "User-Agent": USER_AGENT },
            signal: AbortSignal.timeout(15_000),
        });
        if (!r.ok) return null;
        const body = await r.json() as BreachDetail;
        breachDetailCache.set(name, body);
        return body;
    } catch { return null; }
}

async function pollSubscription(sub: SubscriptionRow): Promise<{ ok: boolean; findings_count: number; new_count: number; status: string; error?: string }> {
    if (!sub.hibp_api_key) return { ok: false, findings_count: 0, new_count: 0, status: "no_key" };

    // 1. Fetch the domain breach map
    let domainData: Record<string, string[]>;
    try {
        const r = await fetch(`${HIBP_BASE}/breacheddomain/${encodeURIComponent(sub.domain)}`, {
            headers: { "hibp-api-key": sub.hibp_api_key, "User-Agent": USER_AGENT },
            signal: AbortSignal.timeout(30_000),
        });
        if (r.status === 401) return { ok: false, findings_count: 0, new_count: 0, status: "invalid_key", error: "API key rejected" };
        if (r.status === 403) return { ok: false, findings_count: 0, new_count: 0, status: "unverified_domain", error: `${sub.domain} not verified on this HIBP account` };
        if (r.status === 429) return { ok: false, findings_count: 0, new_count: 0, status: "rate_limited", error: "HIBP rate limit" };
        if (!r.ok) return { ok: false, findings_count: 0, new_count: 0, status: `http_${r.status}`, error: (await r.text()).slice(0, 200) };
        domainData = await r.json() as Record<string, string[]>;
    } catch (e) {
        return { ok: false, findings_count: 0, new_count: 0, status: "fetch_failed", error: String((e as Error).message ?? e).slice(0, 200) };
    }

    // 2. Build rows
    let findings_count = 0;
    let new_count = 0;
    for (const [emailRaw, breaches] of Object.entries(domainData)) {
        const email = (emailRaw + "@" + sub.domain).toLowerCase();
        for (const breachName of breaches) {
            findings_count++;
            const detail = await fetchBreachDetail(breachName, sub.hibp_api_key);

            // Check if exists (per-source uniqueness)
            const { data: existing } = await supabase
                .from("m365_breach_findings")
                .select("id")
                .eq("organization_id", sub.organization_id)
                .eq("user_upn", email)
                .eq("breach_name", breachName)
                .eq("source", "hibp")
                .maybeSingle();

            if (!existing) new_count++;

            const row = {
                organization_id:  sub.organization_id,
                m365_tenant_id:   sub.m365_tenant_id,
                user_upn:         email,
                breach_name:      breachName,
                breach_title:     detail?.Title ?? breachName,
                breach_date:      detail?.BreachDate ?? null,
                pwn_count:        detail?.PwnCount ?? null,
                breach_domain:    detail?.Domain ?? null,
                description:      detail?.Description ?? null,
                data_classes:     detail?.DataClasses ?? [],
                is_verified:      detail?.IsVerified ?? null,
                is_sensitive:     detail?.IsSensitive ?? null,
                is_fabricated:    detail?.IsFabricated ?? null,
                is_retired:       detail?.IsRetired ?? null,
                logo_path:        detail?.LogoPath ?? null,
                source:           "hibp",
                last_seen_at:     new Date().toISOString(),
            };

            await supabase.from("m365_breach_findings").upsert(row, { onConflict: "organization_id,user_upn,breach_name,source" });

            // Alert SOC for new findings
            if (!existing) {
                await supabase.from("alerts").insert({
                    organization_id: sub.organization_id,
                    alert_type: "dark_web_breach",
                    severity: detail?.IsSensitive ? "high" : "medium",
                    title: `${email} exposed in ${detail?.Title ?? breachName}`,
                    description: `User credentials/data exposed in ${detail?.Title ?? breachName} (${detail?.BreachDate ?? "unknown date"}). Data classes: ${(detail?.DataClasses ?? []).join(", ")}.`,
                    source: "dark_web_monitor",
                    metadata: {
                        user_upn: email,
                        breach_name: breachName,
                        data_classes: detail?.DataClasses ?? [],
                        pwn_count: detail?.PwnCount,
                    },
                }).then(() => null).catch(() => null);
            }
        }
    }

    return { ok: true, findings_count, new_count, status: "ok" };
}

async function authorise(req: Request): Promise<boolean> {
    const cronSec = req.headers.get("x-cron-secret") ?? "";
    if (CRON_SECRET && cronSec === CRON_SECRET) return true;
    const auth = req.headers.get("Authorization") ?? "";
    const jwt = auth.replace(/^Bearer\s+/i, "").trim();
    if (jwt && jwt === SUPABASE_SERVICE_KEY) return true;
    return false;
}

Deno.serve(async (req: Request) => {
    const origin = req.headers.get("origin");
    if (req.method === "OPTIONS") return handlePreflight(origin);
    if (!(await authorise(req))) return json({ error: "unauthorized" }, 401, origin);

    const { data: subs, error } = await supabase
        .from("m365_breach_monitoring")
        .select("id, organization_id, m365_tenant_id, domain, hibp_api_key, is_enabled")
        .eq("is_enabled", true)
        .not("hibp_api_key", "is", null);

    if (error) return json({ error: "query_failed", detail: error.message }, 500, origin);

    const results: Array<{ domain: string; ok: boolean; findings: number; new: number; status: string; error?: string }> = [];
    for (const sub of (subs ?? []) as SubscriptionRow[]) {
        try {
            const r = await pollSubscription(sub);
            await supabase
                .from("m365_breach_monitoring")
                .update({
                    last_polled_at: new Date().toISOString(),
                    last_poll_status: r.status,
                    last_poll_error: r.error ?? null,
                    last_poll_findings_count: r.findings_count,
                })
                .eq("id", sub.id);
            results.push({ domain: sub.domain, ok: r.ok, findings: r.findings_count, new: r.new_count, status: r.status, error: r.error });
        } catch (e) {
            const err = String((e as Error).message ?? e).slice(0, 200);
            await supabase.from("m365_breach_monitoring").update({
                last_polled_at: new Date().toISOString(),
                last_poll_status: "exception",
                last_poll_error: err,
            }).eq("id", sub.id);
            results.push({ domain: sub.domain, ok: false, findings: 0, new: 0, status: "exception", error: err });
        }
    }

    return json({ ok: true, polled: results.length, results }, 200, origin);
});
