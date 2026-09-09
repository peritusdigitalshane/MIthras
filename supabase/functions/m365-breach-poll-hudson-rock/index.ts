// POST /functions/v1/m365-breach-poll-hudson-rock
//
// FREE infostealer-log monitoring via Hudson Rock's Cavalier API.
// Catches credentials stolen by Redline / Raccoon / Vidar / LummaC2 / Atomic
// off infected machines — a category HIBP misses entirely.
//
// Uses a Mithras-owned API key from platform_settings.hudson_rock_api_key.
// Free tier covers our use case (50 req/10s, 20 stealers max per call).
//
// Cron: daily 02:43 UTC.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET          = Deno.env.get("MITHRAS_CRON_SECRET") ?? Deno.env.get("CRON_SECRET") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const HR_URL = "https://api.hudsonrock.com/json/v3/search-by-domain";
const USER_AGENT = "Mithras-DarkWebMonitor/1.0";

function json(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

async function getPlatformSetting(key: string): Promise<string | null> {
    const { data } = await supabase.from("platform_settings").select("value").eq("key", key).maybeSingle();
    const v = data?.value;
    return typeof v === "string" ? v : null;
}

interface SubscriptionRow {
    id: string;
    organization_id: string;
    m365_tenant_id: string;
    domain: string;
    hudson_rock_enabled: boolean;
}

interface Credential {
    url?: string;
    domain?: string;
    username?: string;
    password?: string;
    type?: "employee" | "user" | "third_party";
}

interface Stealer {
    stealer?: string;
    employeeAt?: string;
    clientAt?: string;
    date_compromised?: string;
    date_uploaded?: string;
    stealer_family?: string;
    ip?: string;
    computer_name?: string;
    operating_system?: string;
    malware_path?: string;
    credentials?: Credential[];
}

interface HRResponse {
    data?: Stealer[];
    nextCursor?: string | null;
}

async function pollDomain(sub: SubscriptionRow, apiKey: string): Promise<{ ok: boolean; findings: number; new_count: number; status: string; error?: string }> {
    const allStealers: Stealer[] = [];
    let cursor: string | undefined;
    let pages = 0;
    while (pages < 10) {
        try {
            const resp = await fetch(HR_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "api-key":      apiKey,
                    "User-Agent":   USER_AGENT,
                },
                body: JSON.stringify({
                    domains: [sub.domain],
                    sort_by: "date_compromised",
                    sort_direction: "desc",
                    types: ["employees"],
                    filter_credentials: true,
                    ...(cursor ? { cursor } : {}),
                }),
                signal: AbortSignal.timeout(30_000),
            });
            if (resp.status === 401) return { ok: false, findings: 0, new_count: 0, status: "invalid_key", error: "Hudson Rock key rejected" };
            if (resp.status === 429) return { ok: false, findings: 0, new_count: 0, status: "rate_limited", error: "Hudson Rock rate limit" };
            if (!resp.ok) return { ok: false, findings: 0, new_count: 0, status: `http_${resp.status}`, error: (await resp.text()).slice(0, 200) };
            const body = await resp.json() as HRResponse;
            if (body.data) allStealers.push(...body.data);
            if (!body.nextCursor) break;
            cursor = body.nextCursor;
            pages++;
        } catch (e) {
            return { ok: false, findings: 0, new_count: 0, status: "fetch_failed", error: String((e as Error).message ?? e).slice(0, 200) };
        }
    }

    // Each stealer record represents one infected machine. For our finding
    // model we want one (user_upn × breach_name) row, where breach_name is
    // unique per infection event. We use "InfostealerLog/<stealer_family>/<date>"
    // as the breach_name so a user infected by Redline AND Raccoon counts as
    // two separate findings.
    let findings = 0, new_count = 0;
    for (const s of allStealers) {
        // employeeAt = the company domain context. For our tenant-domain search
        // every record's "users" are employees of the searched domain.
        const compromiseDate = s.date_compromised ? s.date_compromised.slice(0, 10) : "unknown";
        const family = s.stealer_family ?? s.stealer ?? "Unknown";
        const breachName = `InfostealerLog/${family}/${compromiseDate}`;
        const breachTitle = `${family} infostealer infection — ${compromiseDate}`;

        // Try to identify the employee email from the credentials.
        // Hudson Rock's "search-by-domain employees" mode returns the user
        // whose machine was infected, but the explicit email isn't in the
        // top-level Stealer object; we infer from the credentials array.
        const empCred = (s.credentials ?? []).find((c) => c.type === "employee");
        // Fall back: any credential with our domain
        const fallbackCred = (s.credentials ?? []).find((c) => (c.username ?? "").toLowerCase().endsWith("@" + sub.domain));
        const userUpn = (empCred?.username ?? fallbackCred?.username ?? "").toLowerCase();
        if (!userUpn || !userUpn.endsWith("@" + sub.domain)) {
            // Hudson Rock returned a stealer log but we can't pin it to a user
            // on this domain (could be a partner / third party). Skip.
            continue;
        }

        // Cap the data we expose — passwords are NEVER stored in the DB.
        const safeCredCount = (s.credentials ?? []).length;
        const safeCorpDomains = Array.from(new Set(
            (s.credentials ?? [])
                .filter((c) => c.type === "employee" || c.type === "user")
                .map((c) => c.domain ?? "")
                .filter(Boolean)
        )).slice(0, 25);

        // Check existence
        const { data: existing } = await supabase
            .from("m365_breach_findings")
            .select("id")
            .eq("organization_id", sub.organization_id)
            .eq("user_upn", userUpn)
            .eq("breach_name", breachName)
            .eq("source", "hudson_rock")
            .maybeSingle();
        if (!existing) new_count++;

        findings++;
        await supabase.from("m365_breach_findings").upsert({
            organization_id: sub.organization_id,
            m365_tenant_id:  sub.m365_tenant_id,
            user_upn:        userUpn,
            breach_name:     breachName,
            breach_title:    breachTitle,
            breach_date:     compromiseDate !== "unknown" ? compromiseDate : null,
            pwn_count:       null,
            breach_domain:   sub.domain,
            description:     `${family} infostealer malware harvested credentials from this user's machine on ${compromiseDate}. Operating system: ${s.operating_system ?? "unknown"}. Source: Hudson Rock Cavalier free tier.`,
            data_classes:    ["Passwords","Browser-stored credentials","Session cookies","Saved logins"],
            is_verified:     true,
            is_sensitive:    true,
            logo_path:       null,
            source:          "hudson_rock",
            source_detail:   {
                stealer_family:  family,
                date_compromised: s.date_compromised,
                date_uploaded:   s.date_uploaded,
                computer_name:   s.computer_name,
                operating_system: s.operating_system,
                ip_country_or_ip: s.ip,
                credentials_count: safeCredCount,
                corporate_services_compromised: safeCorpDomains,
            },
            last_seen_at:    new Date().toISOString(),
        }, { onConflict: "organization_id,user_upn,breach_name,source" });

        if (!existing) {
            await supabase.from("alerts").insert({
                organization_id: sub.organization_id,
                alert_type:      "infostealer_infection",
                severity:        "critical",   // infostealers are fresh, active threats
                title:           `${userUpn} compromised by ${family} infostealer`,
                description:     `Hudson Rock detected ${userUpn}'s credentials in ${family} infostealer logs (${safeCredCount} credentials harvested on ${compromiseDate}). The user's machine was actively infected. Force password reset + revoke all sessions immediately.`,
                source:          "hudson_rock",
                metadata: {
                    user_upn: userUpn,
                    stealer_family: family,
                    date_compromised: s.date_compromised,
                    credentials_count: safeCredCount,
                    corporate_services_count: safeCorpDomains.length,
                },
            }).then(() => null).catch(() => null);
        }
    }

    return { ok: true, findings, new_count, status: "ok" };
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

    const apiKey = await getPlatformSetting("hudson_rock_api_key");
    if (!apiKey) return json({ error: "hudson_rock_api_key_not_configured", detail: "Super-admin: set platform_settings.hudson_rock_api_key (free at hudsonrock.com)" }, 500, origin);

    const { data: subs, error } = await supabase
        .from("m365_breach_monitoring")
        .select("id, organization_id, m365_tenant_id, domain, hudson_rock_enabled")
        .eq("is_enabled", true)
        .eq("hudson_rock_enabled", true);

    if (error) return json({ error: "query_failed", detail: error.message }, 500, origin);

    const results: Array<{ domain: string; ok: boolean; findings: number; new: number; status: string; error?: string }> = [];
    for (const sub of (subs ?? []) as SubscriptionRow[]) {
        try {
            const r = await pollDomain(sub, apiKey);
            await supabase
                .from("m365_breach_monitoring")
                .update({
                    hudson_rock_last_polled_at: new Date().toISOString(),
                    hudson_rock_last_findings_count: r.findings,
                })
                .eq("id", sub.id);
            results.push({ domain: sub.domain, ok: r.ok, findings: r.findings, new: r.new_count, status: r.status, error: r.error });
        } catch (e) {
            results.push({ domain: sub.domain, ok: false, findings: 0, new: 0, status: "exception", error: String((e as Error).message ?? e).slice(0, 200) });
        }
    }

    return json({ ok: true, polled: results.length, results }, 200, origin);
});
