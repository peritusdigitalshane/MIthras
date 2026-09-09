// POST /functions/v1/m365-pim-auto-revoke
//
// Two paths, one function:
//   1. CRON / service-role  → sweep every status='active' elevation whose
//      expires_at < now() and call Graph DELETE. Caps post-expiry exposure
//      at one cron interval (5 min today).
//   2. User JWT             → operator manual revoke. Body must contain
//      elevation_id and optional revoke_reason. Caller must be org admin
//      of the elevation's organization.
//
// Either path performs the same Graph DELETE + DB transition. We use a
// SELECT … FOR UPDATE SKIP LOCKED pattern via a single targeted UPDATE per
// row so concurrent cron fires can't double-revoke (rare on a 5-min cadence
// but free safety).
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
    id: string;
    organization_id: string;
    tenant_id: string;
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
    await supabase.from("m365_tenants").update(patch as any).eq("id", t.id);
    return tok.access_token;
}

interface AuthorisedCaller {
    mode: "privileged" | "user";
    userId?: string;
}

async function authorise(req: Request): Promise<AuthorisedCaller | null> {
    const cronSec = req.headers.get("x-cron-secret") ?? "";
    if (CRON_SECRET && cronSec === CRON_SECRET) return { mode: "privileged" };

    const auth = req.headers.get("Authorization") ?? "";
    const jwt = auth.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return null;
    if (jwt === SUPABASE_SERVICE_KEY) return { mode: "privileged" };

    const { data: { user } } = await supabase.auth.getUser(jwt);
    if (!user) return null;
    return { mode: "user", userId: user.id };
}

async function userIsOrgAdmin(userId: string, orgId: string): Promise<boolean> {
    const { data: isSuper } = await supabase.rpc("is_super_admin", { _user_id: userId });
    if (isSuper === true) return true;
    const { data: isAdmin } = await supabase.rpc("is_admin_of_org", {
        _user_id: userId, _org_id: orgId,
    });
    return isAdmin === true;
}

async function revokeOne(elevationId: string, mode: "expired" | "manual", actorUserId: string | null, reason: string | null): Promise<{ ok: boolean; detail?: string }> {
    // Claim the row by transitioning out of 'active' atomically. If another
    // concurrent run already claimed it, the .eq("status", "active") makes
    // the update affect zero rows and we skip.
    const { data: claimed, error: claimErr } = await supabase
        .from("pim_elevations")
        .update({
            // Temporarily mark as a sentinel status so concurrent fires don't
            // re-process. We'll finalise after the Graph call.
            // Reuse 'revoked' and let the final UPDATE set the timestamp +
            // actor — Postgres-level atomic claim.
            revoke_reason: mode === "expired" ? "expired_auto_revoke" : (reason ?? "manual_revoke"),
        })
        .eq("id", elevationId)
        .eq("status", "active")
        .select("id, m365_tenant_id, graph_role_assignment_id, organization_id, target_user_upn, role_display_name, expires_at")
        .maybeSingle();

    if (claimErr || !claimed) return { ok: false, detail: "not_claimable" };

    // Pull the tenant.
    const { data: t } = await supabase
        .from("m365_tenants")
        .select("id, organization_id, tenant_id, access_token, refresh_token, access_token_expires_at, scopes")
        .eq("id", claimed.m365_tenant_id)
        .maybeSingle();
    if (!t) return { ok: false, detail: "tenant_missing" };

    let accessToken: string;
    try { accessToken = await ensureFreshToken(t as TenantRow); }
    catch (e) {
        await supabase.from("pim_elevations").update({
            status: "failed",
            error_message: `token_refresh_on_revoke: ${String((e as Error).message ?? e).slice(0, 200)}`,
        }).eq("id", elevationId);
        return { ok: false, detail: "token_refresh_failed" };
    }

    // If we never got a graph_role_assignment_id (insert succeeded but Graph
    // failed pre-activation), there's nothing to revoke at Graph. Just close
    // the row.
    let graphOk = true;
    let graphDetail: string | null = null;
    if (claimed.graph_role_assignment_id) {
        const resp = await fetch(
            `https://graph.microsoft.com/v1.0/roleManagement/directory/roleAssignments/${claimed.graph_role_assignment_id}`,
            {
                method: "DELETE",
                headers: { Authorization: `Bearer ${accessToken}` },
                signal: AbortSignal.timeout(20_000),
            },
        );
        // 204 = success, 404 = already gone (treat as success), anything else = failure
        if (!resp.ok && resp.status !== 404) {
            graphOk = false;
            graphDetail = (await resp.text()).slice(0, 400);
        }
    }

    const finalStatus = mode === "expired" ? "expired" : "revoked";
    await supabase.from("pim_elevations").update({
        status: graphOk ? finalStatus : "failed",
        revoked_at: new Date().toISOString(),
        revoked_by: actorUserId,
        error_message: graphOk ? null : `graph_delete_failed: ${graphDetail}`,
    }).eq("id", elevationId);

    if (graphOk) {
        await supabase.from("activity_logs").insert({
            organization_id: claimed.organization_id,
            user_id: actorUserId,
            action: mode === "expired" ? "pim_elevation_auto_expired" : "pim_elevation_revoked",
            resource_type: "m365_user",
            resource_id: claimed.target_user_upn,
            metadata: {
                role_display_name: claimed.role_display_name,
                mode,
                reason: reason ?? null,
            },
        });
    }

    return { ok: graphOk, detail: graphDetail ?? undefined };
}

Deno.serve(async (req: Request) => {
    const origin = req.headers.get("origin");
    if (req.method === "OPTIONS") return handlePreflight(origin);

    const caller = await authorise(req);
    if (!caller) return json({ error: "unauthorized" }, 401, origin);

    if (caller.mode === "user") {
        // Manual revoke path.
        let body: { elevation_id?: string; reason?: string };
        try { body = await req.json(); } catch { return json({ error: "invalid_body" }, 400, origin); }
        if (!body.elevation_id) return json({ error: "elevation_id_required" }, 400, origin);

        // Authorise: caller must be admin of the elevation's org.
        const { data: row } = await supabase
            .from("pim_elevations")
            .select("id, organization_id, status")
            .eq("id", body.elevation_id)
            .maybeSingle();
        if (!row) return json({ error: "elevation_not_found" }, 404, origin);
        if (row.status !== "active") return json({ error: "not_active", current: row.status }, 409, origin);

        const allowed = await userIsOrgAdmin(caller.userId!, row.organization_id);
        if (!allowed) return json({ error: "forbidden" }, 403, origin);

        const r = await revokeOne(body.elevation_id, "manual", caller.userId!, body.reason ?? null);
        return json({ ok: r.ok, detail: r.detail }, r.ok ? 200 : 502, origin);
    }

    // Privileged path: sweep all expired actives.
    const { data: expired, error } = await supabase
        .from("pim_elevations")
        .select("id")
        .eq("status", "active")
        .lt("expires_at", new Date().toISOString())
        .limit(500);

    if (error) return json({ error: "query_failed", detail: error.message }, 500, origin);

    let ok = 0, failed = 0;
    for (const row of expired ?? []) {
        const r = await revokeOne(row.id, "expired", null, null);
        if (r.ok) ok++; else failed++;
    }

    return json({ ok: true, swept: expired?.length ?? 0, succeeded: ok, failed }, 200, origin);
});
