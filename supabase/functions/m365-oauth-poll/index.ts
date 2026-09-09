// POST /functions/v1/m365-oauth-poll
//
// For each shielded M365 tenant, inventory delegated OAuth grants
// (/oauth2PermissionGrants) and score each against HIGH_RISK_OAUTH_SCOPES.
// Upserts into m365_oauth_grants. Substitutes the OAuth surface of
// Defender for Cloud Apps.
//
// Phase 1 = read-only inventory. Revoke is a separate edge fn (m365-oauth-
// revoke) so the path is operator-gated.
//
// Spec: docs/superpowers/specs/2026-06-18-mithras-m365-shield.md

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import {
    READ_ONLY_SCOPES, REMEDIATION_SCOPES,
    refreshAccessToken, HIGH_RISK_OAUTH_SCOPES, highRiskScopesIn,
} from "../_shared/m365-graph.ts";

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

interface OAuthGrant {
    id: string;
    clientId: string;       // service principal objectId of the consumer app
    consentType: "AllPrincipals" | "Principal";
    principalId?: string | null;
    resourceId: string;     // service principal objectId of the resource (Graph, EXO, etc.)
    scope?: string;
}

interface ServicePrincipal {
    id: string;
    appDisplayName?: string;
    displayName?: string;
    publisherName?: string;
    appId?: string;
}

interface UserBrief {
    id: string;
    userPrincipalName?: string;
}

function scoreGrant(highRiskScopeCount: number, scopeCount: number, isAllPrincipals: boolean, hasUnknownPublisher: boolean): { score: number; level: string } {
    let score = 0;
    score += highRiskScopeCount * 25;          // each high-risk scope is 25
    score += Math.min(scopeCount, 10) * 2;     // breadth penalty (capped)
    if (isAllPrincipals) score += 10;          // wider blast radius
    if (hasUnknownPublisher) score += 15;      // unverified publisher
    if (score > 100) score = 100;

    const level =
        score >= 75 ? "critical" :
        score >= 50 ? "high" :
        score >= 25 ? "medium" : "low";

    return { score, level };
}

async function pollTenant(t: TenantRow): Promise<{ ok: boolean; grants: number; high_risk: number; error?: string }> {
    let accessToken: string;
    try { accessToken = await ensureFreshToken(t); }
    catch (e) { return { ok: false, grants: 0, high_risk: 0, error: `token: ${String((e as Error).message ?? e).slice(0, 200)}` }; }

    // 1. Pull all grants (delegated).
    const allGrants: OAuthGrant[] = [];
    let next: string | null = "https://graph.microsoft.com/v1.0/oauth2PermissionGrants?$top=200";
    let pages = 0;
    while (next && pages < 20) {
        const resp = await fetch(next, {
            headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
            signal: AbortSignal.timeout(30_000),
        });
        if (!resp.ok) {
            return { ok: false, grants: 0, high_risk: 0, error: `graph_grants_${resp.status}: ${(await resp.text()).slice(0, 200)}` };
        }
        const body = await resp.json() as { value?: OAuthGrant[]; "@odata.nextLink"?: string };
        if (body.value) allGrants.push(...body.value);
        next = body["@odata.nextLink"] ?? null;
        pages++;
    }

    // 2. Resolve service-principal names (batch by distinct clientIds).
    const clientIds = [...new Set(allGrants.map((g) => g.clientId))];
    const spById = new Map<string, ServicePrincipal>();
    for (const cid of clientIds) {
        try {
            const r = await fetch(
                `https://graph.microsoft.com/v1.0/servicePrincipals/${cid}?$select=id,displayName,appDisplayName,publisherName,appId`,
                { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) },
            );
            if (r.ok) spById.set(cid, await r.json() as ServicePrincipal);
        } catch { /* tolerate per-SP failure */ }
    }

    // 3. Resolve principal UPNs for user-scoped grants.
    const userIds = [...new Set(allGrants.filter((g) => g.consentType === "Principal" && g.principalId).map((g) => g.principalId as string))];
    const userById = new Map<string, UserBrief>();
    for (const uid of userIds) {
        try {
            const r = await fetch(
                `https://graph.microsoft.com/v1.0/users/${uid}?$select=id,userPrincipalName`,
                { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) },
            );
            if (r.ok) userById.set(uid, await r.json() as UserBrief);
        } catch { /* tolerate per-user failure */ }
    }

    // 4. Upsert.
    const seenIds = new Set<string>();
    let highRiskCount = 0;
    for (const g of allGrants) {
        seenIds.add(g.id);
        const scopeArr = (g.scope ?? "").split(/\s+/).filter(Boolean);
        const high = highRiskScopesIn(g.scope ?? "");
        const sp = spById.get(g.clientId);
        const user = g.principalId ? userById.get(g.principalId) : undefined;
        const isAll = g.consentType === "AllPrincipals";
        const unknownPublisher = !sp?.publisherName || sp.publisherName === "";
        const s = scoreGrant(high.length, scopeArr.length, isAll, unknownPublisher);
        if (s.level === "high" || s.level === "critical") highRiskCount++;

        await supabase.from("m365_oauth_grants").upsert({
            organization_id:          t.organization_id,
            m365_tenant_id:           t.tenant_pk,
            grant_id:                 g.id,
            client_id:                sp?.appId ?? g.clientId,
            client_display_name:      sp?.displayName ?? sp?.appDisplayName ?? null,
            publisher:                sp?.publisherName ?? null,
            consent_type:             g.consentType,
            principal_user_id:        g.principalId ?? null,
            principal_upn:            user?.userPrincipalName ?? null,
            scope:                    g.scope ?? "",
            high_risk_scopes_matched: high,
            has_high_risk_scope:      high.length > 0,
            risk_score:               s.score,
            risk_level:               s.level,
            is_active:                true,
            last_seen_at:             new Date().toISOString(),
            deleted_at:               null,
        }, { onConflict: "m365_tenant_id,grant_id" });
    }

    // 5. Soft-delete grants no longer present.
    const { data: known } = await supabase
        .from("m365_oauth_grants")
        .select("grant_id")
        .eq("m365_tenant_id", t.tenant_pk)
        .is("deleted_at", null);
    const missing = (known ?? [])
        .map((r: any) => r.grant_id as string)
        .filter((id) => !seenIds.has(id));
    if (missing.length > 0) {
        await supabase
            .from("m365_oauth_grants")
            .update({ deleted_at: new Date().toISOString(), is_active: false })
            .eq("m365_tenant_id", t.tenant_pk)
            .in("grant_id", missing);
    }

    return { ok: true, grants: allGrants.length, high_risk: highRiskCount };
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

    const results: Array<{ tenant: string; ok: boolean; grants: number; high_risk: number; error?: string }> = [];
    for (const t of (tenants ?? []) as TenantRow[]) {
        try {
            const r = await pollTenant(t);
            results.push({ tenant: t.tenant_display_name ?? t.tenant_id, ok: r.ok, grants: r.grants, high_risk: r.high_risk, error: r.error });
        } catch (e) {
            results.push({ tenant: t.tenant_display_name ?? t.tenant_id, ok: false, grants: 0, high_risk: 0,
                error: String((e as Error).message ?? e).slice(0, 200) });
        }
    }

    return json({ ok: true, tenants: results.length, results }, 200, origin);
});
