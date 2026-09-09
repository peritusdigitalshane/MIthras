// POST /functions/v1/m365-risk-poll
//
// For each shielded M365 tenant, pull the last 24 hours of sign-ins from
// /auditLogs/signIns, group by user, score against a fixed heuristic
// catalogue, and upsert into m365_signin_risk. Critical-risk users can
// trigger an Identity Defence rule (handled separately by identity-evaluate
// — this function does not call Graph mutation endpoints).
//
// Substitutes Entra ID P2 Identity Protection. Honest gap: we don't have
// Microsoft's cross-tenant ML signal (a credential seen in 50 other
// tenants in the last hour), so we can't catch low-and-slow distributed
// password spray as well as P2 does. We catch the per-tenant signals well.
//
// Spec: docs/superpowers/specs/2026-06-18-mithras-m365-shield.md

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { READ_ONLY_SCOPES, REMEDIATION_SCOPES, refreshAccessToken } from "../_shared/m365-graph.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET          = Deno.env.get("MITHRAS_CRON_SECRET") ?? Deno.env.get("CRON_SECRET") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function json(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

async function getPlatformSetting(key: string): Promise<string | null> {
    const { data } = await supabase.from("platform_settings").select("value").eq("key", key).maybeSingle();
    const v = data?.value;
    if (typeof v === "string") return v;
    return null;
}

interface TenantRow {
    tenant_pk: string;
    organization_id: string;
    tenant_id: string;
    tenant_display_name: string | null;
    access_token: string | null;
    refresh_token: string | null;
    access_token_expires_at: string | null;
    scopes: string[] | null;
}

async function ensureFreshToken(t: TenantRow): Promise<string> {
    const now = Date.now();
    const exp = t.access_token_expires_at ? new Date(t.access_token_expires_at).getTime() : 0;
    if (t.access_token && exp > now + 30_000) return t.access_token;

    const clientId     = await getPlatformSetting("m365_azure_client_id");
    const clientSecret = await getPlatformSetting("m365_azure_client_secret");
    const authority    = (await getPlatformSetting("m365_azure_authority")) || "https://login.microsoftonline.com";
    if (!clientId || !clientSecret) throw new Error("m365_credentials_missing");
    if (!t.refresh_token) throw new Error("no_refresh_token");

    const scopes = (t.scopes && t.scopes.length > 0)
        ? t.scopes
        : [...READ_ONLY_SCOPES, ...REMEDIATION_SCOPES];

    const tok = await refreshAccessToken({
        authority, tenantId: t.tenant_id,
        clientId, clientSecret,
        refreshToken: t.refresh_token,
        scopes,
    });
    const newExpiresAt = new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString();
    const patch: Record<string, unknown> = {
        access_token: tok.access_token,
        access_token_expires_at: newExpiresAt,
    };
    if (tok.refresh_token && tok.refresh_token !== t.refresh_token) {
        patch.refresh_token = tok.refresh_token;
    }
    await supabase.from("m365_tenants").update(patch as any).eq("id", t.tenant_pk);
    return tok.access_token;
}

interface SignIn {
    userId?: string;
    userPrincipalName?: string;
    createdDateTime: string;
    ipAddress?: string;
    location?: { city?: string; state?: string; countryOrRegion?: string };
    deviceDetail?: { browser?: string; operatingSystem?: string };
    status?: { errorCode?: number; failureReason?: string };
    riskState?: string;
    riskLevelAggregated?: string;
    autonomousSystemNumber?: number;
    authenticationDetails?: Array<{ authenticationMethod?: string; succeeded?: boolean }>;
}

// Known TOR exit ASNs (small canonical set — extend over time)
const TOR_ASNS = new Set<number>([
    4224, 14061, 14618, 16276, 24940, 60068,
]);
// Known hosting/VPN ASNs that should never be a normal user signin source
const HOSTING_ASNS = new Set<number>([
    3257, 8075, 13335, 15169, 16509, 14061, 24940, 32934, 36352,
]);

interface RiskFactor { kind: string; points: number; evidence: string; }

interface PerUserHistory {
    countries30d: Set<string>;
    asns30d: Set<number>;
}

async function loadHistory(tenantPk: string, userIds: string[]): Promise<Map<string, PerUserHistory>> {
    // We approximate "country/asn seen in last 30d" by keeping the latest
    // m365_signin_risk row's signin metadata. For Phase 1 the comparison is
    // shallow — what we already scored last poll. A future improvement is a
    // signin_history table; not needed to ship.
    const map = new Map<string, PerUserHistory>();
    if (userIds.length === 0) return map;
    const { data } = await supabase
        .from("m365_signin_risk")
        .select("user_id, risk_factors")
        .eq("m365_tenant_id", tenantPk)
        .in("user_id", userIds);
    for (const r of data ?? []) {
        const factors = (r.risk_factors as RiskFactor[] | null) ?? [];
        const countries = new Set<string>();
        const asns = new Set<number>();
        for (const f of factors) {
            if (f.kind === "history_country" && typeof f.evidence === "string") countries.add(f.evidence);
            if (f.kind === "history_asn" && typeof f.evidence === "string") {
                const n = Number(f.evidence);
                if (Number.isFinite(n)) asns.add(n);
            }
        }
        map.set(r.user_id as string, { countries30d: countries, asns30d: asns });
    }
    return map;
}

function scoreUser(signins: SignIn[], history: PerUserHistory | undefined): { score: number; level: string; factors: RiskFactor[]; meta: any } {
    const factors: RiskFactor[] = [];
    let score = 0;

    const total = signins.length;
    const failed = signins.filter((s) => (s.status?.errorCode ?? 0) !== 0).length;
    const successes = signins.filter((s) => (s.status?.errorCode ?? 0) === 0);
    const countries = new Set<string>();
    const asns = new Set<number>();
    for (const s of signins) {
        if (s.location?.countryOrRegion) countries.add(s.location.countryOrRegion);
        if (s.autonomousSystemNumber) asns.add(s.autonomousSystemNumber);
    }

    // 1. Failed sign-in rate >50%
    if (total >= 5 && failed / total > 0.5) {
        const pts = 25;
        score += pts;
        factors.push({ kind: "failed_rate_high", points: pts,
            evidence: `${failed}/${total} signins failed (${Math.round(100 * failed / total)}%)` });
    }

    // 2. Signed in from new country
    for (const c of countries) {
        if (history && !history.countries30d.has(c)) {
            const pts = 20;
            score += pts;
            factors.push({ kind: "new_country", points: pts, evidence: c });
            break; // only count once
        }
    }

    // 3. TOR / known-bad ASN
    for (const a of asns) {
        if (TOR_ASNS.has(a)) {
            const pts = 30;
            score += pts;
            factors.push({ kind: "tor_or_hostile_asn", points: pts, evidence: `AS${a}` });
            break;
        }
    }

    // 4. Impossible travel between two successful signins
    const ordered = successes
        .map((s) => ({ at: new Date(s.createdDateTime).getTime(), country: s.location?.countryOrRegion }))
        .filter((s) => Number.isFinite(s.at) && s.country)
        .sort((a, b) => a.at - b.at);
    for (let i = 1; i < ordered.length; i++) {
        const dt = (ordered[i].at - ordered[i - 1].at) / 60_000; // minutes
        if (dt < 60 && ordered[i].country !== ordered[i - 1].country) {
            const pts = 35;
            score += pts;
            factors.push({
                kind: "impossible_travel", points: pts,
                evidence: `${ordered[i - 1].country} → ${ordered[i].country} in ${Math.round(dt)} min`,
            });
            break;
        }
    }

    // 5. New ASN never seen for this user
    if (history) {
        for (const a of asns) {
            if (!history.asns30d.has(a) && !TOR_ASNS.has(a)) {
                const pts = HOSTING_ASNS.has(a) ? 20 : 15;
                score += pts;
                factors.push({ kind: "new_asn", points: pts, evidence: `AS${a}` });
                break;
            }
        }
    }

    // 6. Failed MFA prompt
    const mfaFailed = signins.filter((s) =>
        (s.authenticationDetails ?? []).some((d) => (d.authenticationMethod ?? "").toLowerCase().includes("mfa") && d.succeeded === false),
    ).length;
    if (mfaFailed > 0) {
        const pts = 15;
        score += pts;
        factors.push({ kind: "mfa_prompt_failed", points: pts, evidence: `${mfaFailed} failed MFA challenge(s)` });
    }

    // 7. Off-hours pattern (sign-in outside 08:00-20:00 UTC, 5+ times)
    const offHours = signins.filter((s) => {
        const h = new Date(s.createdDateTime).getUTCHours();
        return h < 8 || h >= 20;
    }).length;
    if (offHours >= 5) {
        const pts = 10;
        score += pts;
        factors.push({ kind: "off_hours_pattern", points: pts, evidence: `${offHours} signins outside business hours` });
    }

    // 8. Microsoft riskLevelAggregated (free signal — when present)
    const msRisk = signins.find((s) => (s.riskLevelAggregated ?? "none") !== "none");
    if (msRisk && msRisk.riskLevelAggregated) {
        const lvl = msRisk.riskLevelAggregated;
        const pts = lvl === "high" ? 25 : lvl === "medium" ? 15 : 5;
        score += pts;
        factors.push({ kind: "graph_risk_signal", points: pts, evidence: `Graph riskLevelAggregated=${lvl}` });
    }

    // Persist history (country/asn) as factors so next-poll can read them.
    // These contribute 0 points — they're metadata for the next compare.
    for (const c of countries) factors.push({ kind: "history_country", points: 0, evidence: c });
    for (const a of asns)      factors.push({ kind: "history_asn",     points: 0, evidence: String(a) });

    if (score > 100) score = 100;

    const level =
        score >= 80 ? "critical" :
        score >= 60 ? "high" :
        score >= 40 ? "medium" :
        score >= 20 ? "low" : "none";

    return {
        score, level, factors,
        meta: {
            total, failed,
            distinct_countries: countries.size,
            distinct_asns: asns.size,
            last_signin_at: signins.length ? signins[0].createdDateTime : null,
        },
    };
}

async function pollTenant(t: TenantRow): Promise<{ ok: boolean; users_scored: number; error?: string }> {
    let accessToken: string;
    try { accessToken = await ensureFreshToken(t); }
    catch (e) { return { ok: false, users_scored: 0, error: `token: ${String((e as Error).message ?? e).slice(0, 200)}` }; }

    // Pull last 24h of sign-ins. We page until we exhaust or hit 50 pages
    // (~50k entries, far above any SMB tenant's daily volume).
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const url = `https://graph.microsoft.com/v1.0/auditLogs/signIns?$filter=createdDateTime ge ${since}&$top=200`;

    const all: SignIn[] = [];
    let next: string | null = url;
    let pages = 0;
    while (next && pages < 50) {
        const resp = await fetch(next, {
            headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
            signal: AbortSignal.timeout(30_000),
        });
        if (!resp.ok) {
            const text = (await resp.text()).slice(0, 400);
            // /auditLogs/signIns requires Entra ID P1 — surface this as a
            // distinct status, not an "error". The UI shows a helpful banner
            // instead of marking the scan as failed.
            if (resp.status === 403 && /Authentication_RequestFromNonPremiumTenantOrB2CTenant/.test(text)) {
                return { ok: true, users_scored: 0, requires_premium: true,
                         note: "Sign-in risk scoring needs Microsoft audit log access (Entra ID P1)." };
            }
            return { ok: false, users_scored: 0, error: `graph_${resp.status}: ${text.slice(0, 200)}` };
        }
        const body = await resp.json() as { value?: SignIn[]; "@odata.nextLink"?: string };
        if (body.value) all.push(...body.value);
        next = body["@odata.nextLink"] ?? null;
        pages++;
    }

    // Group by user
    const byUser = new Map<string, SignIn[]>();
    for (const s of all) {
        if (!s.userId) continue;
        const list = byUser.get(s.userId) ?? [];
        list.push(s);
        byUser.set(s.userId, list);
    }

    const history = await loadHistory(t.tenant_pk, [...byUser.keys()]);

    let scored = 0;
    for (const [userId, signins] of byUser) {
        const upn = signins.find((s) => s.userPrincipalName)?.userPrincipalName ?? userId;
        const r = scoreUser(signins, history.get(userId));
        await supabase.from("m365_signin_risk").upsert({
            organization_id: t.organization_id,
            m365_tenant_id:  t.tenant_pk,
            user_upn:        upn,
            user_id:         userId,
            risk_score:      r.score,
            risk_level:      r.level,
            risk_factors:    r.factors,
            signin_count_24h: r.meta.total,
            failed_signin_24h: r.meta.failed,
            distinct_countries_24h: r.meta.distinct_countries,
            distinct_asns_24h: r.meta.distinct_asns,
            last_signin_at:  r.meta.last_signin_at,
            last_evaluated_at: new Date().toISOString(),
        }, { onConflict: "m365_tenant_id,user_id" });
        scored++;
    }

    return { ok: true, users_scored: scored };
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

    const { data: tenants, error } = await supabase.rpc("shielded_m365_tenants");
    if (error) return json({ error: "tenants_query_failed", detail: error.message }, 500, origin);

    const results: Array<{ tenant: string; ok: boolean; scored: number; error?: string; requires_premium?: boolean; note?: string }> = [];
    for (const t of (tenants ?? []) as TenantRow[]) {
        const tenantLabel = (t.tenant_display_name && t.tenant_display_name !== "None")
            ? t.tenant_display_name
            : (t as any).tenant_domain || t.tenant_id || "(unnamed tenant)";
        try {
            const r = await pollTenant(t) as { ok: boolean; users_scored: number; error?: string; requires_premium?: boolean; note?: string };
            results.push({ tenant: tenantLabel, ok: r.ok, scored: r.users_scored, error: r.error, requires_premium: r.requires_premium, note: r.note });
        } catch (e) {
            results.push({ tenant: tenantLabel, ok: false, scored: 0,
                error: String((e as Error).message ?? e).slice(0, 200) });
        }
    }

    return json({ ok: true, tenants: results.length, results }, 200, origin);
});
