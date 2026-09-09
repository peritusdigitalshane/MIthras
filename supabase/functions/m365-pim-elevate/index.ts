// POST /functions/v1/m365-pim-elevate
//
// Operator-triggered, time-boxed admin role elevation. Mithras PIM-lite
// substitutes the user-facing flow of Entra ID P2 PIM by calling
// /roleManagement/directory/roleAssignments via Graph with the elevated
// remediation scopes (Directory.ReadWrite.All already consented as part of
// the m365_tenants remediation flow).
//
// Flow:
//   1. Authorise caller: user JWT, must be org admin (is_admin_of_org) or
//      super-admin of the target org.
//   2. Validate body: target_user_id, role_template_id, role_display_name,
//      duration_minutes, reason (required, non-empty).
//   3. Confirm m365_shield_enabled on org. Confirm tenant consent_state=active
//      AND remediation_enabled=true (we cannot add role assignments without
//      the elevated scopes).
//   4. Insert pim_elevations row with status='pending', expires_at computed.
//   5. POST to Graph /roleManagement/directory/roleAssignments. On success,
//      patch row to status='active' + graph_role_assignment_id.
//   6. On Graph failure, patch row to status='failed' + error_message.
//
// Auto-revoke is handled by a separate cron-triggered function
// (m365-pim-auto-revoke) so a missed revoke caps exposure at one cron
// interval past expiry.
//
// Spec: docs/superpowers/specs/2026-06-18-mithras-m365-shield.md

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { READ_ONLY_SCOPES, REMEDIATION_SCOPES, refreshAccessToken } from "../_shared/m365-graph.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

interface ElevateBody {
    organization_id:   string;
    target_user_id:    string;   // Graph user id (UUID-ish)
    target_user_upn:   string;
    role_template_id:  string;   // Graph directoryRole template id
    role_display_name: string;
    duration_minutes:  number;
    reason:            string;
}

interface TenantRow {
    id: string;
    organization_id: string;
    tenant_id: string;
    tenant_display_name: string | null;
    access_token: string | null;
    refresh_token: string | null;
    access_token_expires_at: string | null;
    scopes: string[] | null;
    remediation_enabled: boolean;
    consent_state: string;
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

async function authoriseUser(req: Request): Promise<{ userId: string } | null> {
    const auth = req.headers.get("Authorization") ?? "";
    const jwt = auth.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return null;
    if (jwt === SUPABASE_SERVICE_KEY) return null; // PIM is operator-only; not a cron path
    const { data: { user } } = await supabase.auth.getUser(jwt);
    if (!user) return null;
    return { userId: user.id };
}

async function userIsOrgAdmin(userId: string, orgId: string): Promise<boolean> {
    const { data: isSuper } = await supabase.rpc("is_super_admin", { _user_id: userId });
    if (isSuper === true) return true;
    const { data: isAdmin } = await supabase.rpc("is_admin_of_org", {
        _user_id: userId, _org_id: orgId,
    });
    return isAdmin === true;
}

Deno.serve(async (req: Request) => {
    const origin = req.headers.get("origin");
    if (req.method === "OPTIONS") return handlePreflight(origin);

    const caller = await authoriseUser(req);
    if (!caller) return json({ error: "unauthorized" }, 401, origin);

    let body: ElevateBody;
    try { body = await req.json(); }
    catch { return json({ error: "invalid_body" }, 400, origin); }

    // Validate required fields.
    if (!body.organization_id)                    return json({ error: "organization_id_required" }, 400, origin);
    if (!body.target_user_id || !body.target_user_upn) return json({ error: "target_user_required" }, 400, origin);
    if (!body.role_template_id || !body.role_display_name) return json({ error: "role_required" }, 400, origin);
    if (!Number.isFinite(body.duration_minutes) || body.duration_minutes < 15 || body.duration_minutes > 480) {
        return json({ error: "duration_out_of_range", detail: "15-480 minutes" }, 400, origin);
    }
    if (!body.reason || body.reason.trim().length < 5) {
        return json({ error: "reason_required", detail: "reason must be at least 5 characters" }, 400, origin);
    }

    // Authorise per-org.
    const allowed = await userIsOrgAdmin(caller.userId, body.organization_id);
    if (!allowed) return json({ error: "forbidden" }, 403, origin);

    // Gate on shield enabled.
    const { data: org } = await supabase
        .from("organizations")
        .select("id, m365_shield_enabled")
        .eq("id", body.organization_id)
        .maybeSingle();
    if (!org) return json({ error: "organization_not_found" }, 404, origin);
    if (!org.m365_shield_enabled) return json({ error: "m365_shield_not_enabled" }, 409, origin);

    // Find a tenant for this org with remediation consent.
    const { data: tenants } = await supabase
        .from("m365_tenants")
        .select("id, organization_id, tenant_id, tenant_display_name, access_token, refresh_token, access_token_expires_at, scopes, remediation_enabled, consent_state")
        .eq("organization_id", body.organization_id)
        .eq("consent_state", "active");

    const t = (tenants ?? []).find((x: any) => x.remediation_enabled === true) as TenantRow | undefined;
    if (!t) return json({
        error: "no_remediation_tenant",
        detail: "M365 tenant must have remediation consent for Mithras to add a role assignment. Run the elevated consent flow first.",
    }, 409, origin);

    // Pre-create row in pending state so we have an audit trail even if Graph fails.
    const expires_at = new Date(Date.now() + body.duration_minutes * 60_000).toISOString();

    const { data: row, error: insertErr } = await supabase
        .from("pim_elevations")
        .insert({
            organization_id:   body.organization_id,
            m365_tenant_id:    t.id,
            target_user_upn:   body.target_user_upn,
            target_user_id:    body.target_user_id,
            role_template_id:  body.role_template_id,
            role_display_name: body.role_display_name,
            reason:            body.reason.trim(),
            requested_by:      caller.userId,
            duration_minutes:  body.duration_minutes,
            expires_at,
            status:            "pending",
        })
        .select("id")
        .single();

    if (insertErr || !row) {
        return json({ error: "insert_failed", detail: insertErr?.message }, 500, origin);
    }

    // Refresh token, then call Graph.
    let accessToken: string;
    try { accessToken = await ensureFreshToken(t); }
    catch (e) {
        await supabase.from("pim_elevations").update({
            status: "failed",
            error_message: `token_refresh: ${String((e as Error).message ?? e).slice(0, 200)}`,
        }).eq("id", row.id);
        return json({ error: "token_refresh_failed", elevation_id: row.id }, 502, origin);
    }

    // POST /roleManagement/directory/roleAssignments
    //   body: { principalId, roleDefinitionId, directoryScopeId: "/" }
    const graphResp = await fetch("https://graph.microsoft.com/v1.0/roleManagement/directory/roleAssignments", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            principalId:      body.target_user_id,
            roleDefinitionId: body.role_template_id,
            directoryScopeId: "/",
        }),
        signal: AbortSignal.timeout(20_000),
    });

    if (!graphResp.ok) {
        const errText = (await graphResp.text()).slice(0, 500);
        await supabase.from("pim_elevations").update({
            status: "failed",
            error_message: `graph_${graphResp.status}: ${errText}`,
        }).eq("id", row.id);
        return json({
            error: "graph_assignment_failed",
            status: graphResp.status,
            detail: errText,
            elevation_id: row.id,
        }, 502, origin);
    }

    const grant = await graphResp.json() as { id?: string };
    if (!grant.id) {
        await supabase.from("pim_elevations").update({
            status: "failed",
            error_message: "graph_response_missing_id",
        }).eq("id", row.id);
        return json({ error: "graph_response_invalid", elevation_id: row.id }, 502, origin);
    }

    await supabase.from("pim_elevations").update({
        status: "active",
        graph_role_assignment_id: grant.id,
        activated_at: new Date().toISOString(),
    }).eq("id", row.id);

    // Audit log
    await supabase.from("activity_logs").insert({
        organization_id: body.organization_id,
        user_id: caller.userId,
        action: "pim_elevation_started",
        resource_type: "m365_user",
        resource_id: body.target_user_id,
        metadata: {
            target_user_upn:   body.target_user_upn,
            role_display_name: body.role_display_name,
            duration_minutes:  body.duration_minutes,
            expires_at,
            reason:            body.reason.trim(),
        },
    });

    return json({
        ok: true,
        elevation_id: row.id,
        status: "active",
        expires_at,
        graph_role_assignment_id: grant.id,
    }, 200, origin);
});
