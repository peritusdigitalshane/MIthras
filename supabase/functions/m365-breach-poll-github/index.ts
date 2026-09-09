// POST /functions/v1/m365-breach-poll-github
//
// FREE credential-leak detection via GitHub Code Search API. Sweeps public
// repos for tenant domains appearing alongside common secret patterns —
// catches developers who accidentally committed credentials with @yourdomain
// in .env / config / source files.
//
// Uses a Mithras-owned GitHub Personal Access Token from
// platform_settings.github_search_pat. Free tier: 5000 requests/hour with
// auth, plenty for daily polling across many customer domains.
//
// Cron: daily 02:58 UTC.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET          = Deno.env.get("MITHRAS_CRON_SECRET") ?? Deno.env.get("CRON_SECRET") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const GH_BASE = "https://api.github.com";
const USER_AGENT = "Mithras-CredentialLeakScanner/1.0";

// Search queries combine the tenant domain with high-signal secret indicators.
// Each query returns up to 100 results, so we'll see most matches.
function buildQueries(domain: string): Array<{ pattern: string; q: string; risk: number }> {
    return [
        // Email + password patterns
        { pattern: "email_password",   q: `"@${domain}" password`,        risk: 60 },
        { pattern: "email_pwd",        q: `"@${domain}" pwd`,             risk: 50 },
        { pattern: "email_secret",     q: `"@${domain}" secret`,          risk: 55 },
        // Common secret files containing tenant addresses
        { pattern: "env_file",         q: `"@${domain}" filename:.env`,   risk: 80 },
        { pattern: "credentials_file", q: `"@${domain}" filename:credentials`, risk: 80 },
        { pattern: "config_yml",       q: `"@${domain}" filename:config.yml`, risk: 65 },
        // SMTP / mail server config
        { pattern: "smtp_config",      q: `"@${domain}" SMTP_PASSWORD`,   risk: 70 },
        // Private key patterns near tenant address
        { pattern: "private_key",      q: `"@${domain}" "BEGIN PRIVATE KEY"`, risk: 90 },
        // Plain tenant domain hits (lower signal; we'll filter)
        { pattern: "auth_token",       q: `"@${domain}" auth_token`,      risk: 60 },
    ];
}

interface SubscriptionRow {
    id: string;
    organization_id: string;
    m365_tenant_id: string;
    domain: string;
    github_enabled: boolean;
}

interface GhCodeItem {
    name: string;
    path: string;
    sha: string;
    url: string;
    html_url: string;
    repository: { full_name: string; html_url: string; private: boolean; description: string | null };
}

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

async function pollDomain(sub: SubscriptionRow, pat: string): Promise<{ ok: boolean; findings: number; new_count: number; status: string; error?: string }> {
    const queries = buildQueries(sub.domain);
    let findings = 0;
    let new_count = 0;

    for (const q of queries) {
        let r: Response;
        try {
            r = await fetch(`${GH_BASE}/search/code?q=${encodeURIComponent(q.q)}&per_page=30`, {
                headers: {
                    Authorization:        `Bearer ${pat}`,
                    Accept:               "application/vnd.github.text-match+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                    "User-Agent":         USER_AGENT,
                },
                signal: AbortSignal.timeout(20_000),
            });
        } catch (e) {
            continue;
        }
        if (r.status === 401) return { ok: false, findings: 0, new_count: 0, status: "invalid_pat", error: "GitHub PAT rejected" };
        if (r.status === 403) {
            // Secondary rate limit or abuse detection. Wait until next run.
            const retryAfter = r.headers.get("retry-after");
            return { ok: false, findings: 0, new_count: 0, status: "rate_limited", error: `GitHub rate limit (retry-after: ${retryAfter ?? "unknown"})` };
        }
        if (r.status === 422) {
            // Bad query syntax — common when domain has unusual characters. Skip.
            continue;
        }
        if (!r.ok) continue;

        const body = await r.json() as { total_count?: number; items?: GhCodeItem[] };
        for (const it of body.items ?? []) {
            findings++;
            // Use the file SHA + repo as a stable identifier so re-runs don't dup
            const breachName = `GitHubLeak/${it.repository.full_name}/${it.sha.slice(0, 10)}/${q.pattern}`;
            const breachTitle = `Credential leak in GitHub: ${it.repository.full_name}/${it.path}`;
            // The "user_upn" is the canonical placeholder — we don't know which
            // specific user's creds leaked, just that something matching the
            // domain showed up. Use a synthetic UPN per-domain.
            const userUpn = `(domain-wide)@${sub.domain}`;

            const { data: existing } = await supabase
                .from("m365_breach_findings")
                .select("id")
                .eq("organization_id", sub.organization_id)
                .eq("user_upn", userUpn)
                .eq("breach_name", breachName)
                .eq("source", "github_leak")
                .maybeSingle();
            if (!existing) new_count++;

            await supabase.from("m365_breach_findings").upsert({
                organization_id: sub.organization_id,
                m365_tenant_id:  sub.m365_tenant_id,
                user_upn:        userUpn,
                breach_name:     breachName,
                breach_title:    breachTitle,
                breach_date:     null,
                pwn_count:       null,
                breach_domain:   it.repository.full_name,
                description:     `A GitHub code search found "${sub.domain}" appearing alongside the "${q.pattern}" pattern in ${it.repository.full_name}/${it.path}. This often indicates accidental credential commit. Review the file: ${it.html_url}`,
                data_classes:    ["Potential plaintext credentials","Configuration secrets"],
                is_verified:     false,   // requires operator review
                is_sensitive:    true,
                logo_path:       null,
                source:          "github_leak",
                source_detail: {
                    repository:  it.repository.full_name,
                    path:        it.path,
                    sha:         it.sha,
                    file_url:    it.html_url,
                    repo_url:    it.repository.html_url,
                    private:     it.repository.private,
                    pattern:     q.pattern,
                    query:       q.q,
                    pattern_risk: q.risk,
                },
                last_seen_at:    new Date().toISOString(),
            }, { onConflict: "organization_id,user_upn,breach_name,source" });

            if (!existing) {
                await supabase.from("alerts").insert({
                    organization_id: sub.organization_id,
                    alert_type:      "github_credential_leak",
                    severity:        q.risk >= 80 ? "high" : "medium",
                    title:           `Possible credential leak: ${it.repository.full_name}/${it.path}`,
                    description:     `Tenant domain ${sub.domain} appears in a public GitHub repo alongside the "${q.pattern}" pattern. Manual review required. File: ${it.html_url}`,
                    source:          "github_leak",
                    metadata: {
                        repository: it.repository.full_name,
                        path:       it.path,
                        pattern:    q.pattern,
                        file_url:   it.html_url,
                    },
                }).then(() => null).catch(() => null);
            }
        }
        // Be a polite citizen — pause briefly between queries
        await new Promise((r) => setTimeout(r, 500));
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

    const pat = await getPlatformSetting("github_search_pat");
    if (!pat) return json({ error: "github_pat_not_configured", detail: "Super-admin: set platform_settings.github_search_pat (free GitHub PAT with public_repo scope)" }, 500, origin);

    const { data: subs, error } = await supabase
        .from("m365_breach_monitoring")
        .select("id, organization_id, m365_tenant_id, domain, github_enabled")
        .eq("is_enabled", true)
        .eq("github_enabled", true);

    if (error) return json({ error: "query_failed", detail: error.message }, 500, origin);

    const results: Array<{ domain: string; ok: boolean; findings: number; new: number; status: string; error?: string }> = [];
    for (const sub of (subs ?? []) as SubscriptionRow[]) {
        try {
            const r = await pollDomain(sub, pat);
            await supabase.from("m365_breach_monitoring").update({
                github_last_polled_at: new Date().toISOString(),
                github_last_findings_count: r.findings,
            }).eq("id", sub.id);
            results.push({ domain: sub.domain, ok: r.ok, findings: r.findings, new: r.new_count, status: r.status, error: r.error });
        } catch (e) {
            results.push({ domain: sub.domain, ok: false, findings: 0, new: 0, status: "exception", error: String((e as Error).message ?? e).slice(0, 200) });
        }
    }

    return json({ ok: true, polled: results.length, results }, 200, origin);
});
