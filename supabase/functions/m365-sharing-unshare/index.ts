// POST /functions/v1/m365-sharing-unshare
// Body: { shared_item_id: UUID, reason?: string }
//
// Operator-triggered unshare. Caller must be org admin + tenant must have
// remediation consent. Calls Graph DELETE
// /drives/{drive_id}/items/{item_id}/permissions/{permission_id}.

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
    return typeof v === "string" ? v : null;
}

interface TenantRow {
    id: string;
    organization_id: string;
    tenant_id: string;
    access_token: string | null;
    refresh_token: string | null;
    access_token_expires_at: string | null;
    scopes: string[] | null;
    remediation_enabled: boolean;
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
    const scopes = (t.scopes && t.scopes.length > 0) ? t.scopes : [...READ_ONLY_SCOPES, ...REMEDIATION_SCOPES];
    const tok = await refreshAccessToken({
        authority, tenantId: t.tenant_id, clientId, clientSecret,
        refreshToken: t.refresh_token, scopes,
    });
    const newExpiresAt = new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString();
    const patch: Record<string, unknown> = { access_token: tok.access_token, access_token_expires_at: newExpiresAt };
    if (tok.refresh_token && tok.refresh_token !== t.refresh_token) patch.refresh_token = tok.refresh_token;
    await supabase.from("m365_tenants").update(patch as any).eq("id", t.id);
    return tok.access_token;
}

async function authoriseUser(req: Request): Promise<{ userId: string } | null> {
    const auth = req.headers.get("Authorization") ?? "";
    const jwt = auth.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return null;
    if (jwt === SUPABASE_SERVICE_KEY) return null;
    const { data: { user } } = await supabase.auth.getUser(jwt);
    if (!user) return null;
    return { userId: user.id };
}

async function userIsOrgAdmin(userId: string, orgId: string): Promise<boolean> {
    const { data: isSuper } = await supabase.rpc("is_super_admin", { _user_id: userId });
    if (isSuper === true) return true;
    const { data: isAdmin } = await supabase.rpc("is_admin_of_org", { _user_id: userId, _org_id: orgId });
    return isAdmin === true;
}

Deno.serve(async (req: Request) => {
    const origin = req.headers.get("origin");
    if (req.method === "OPTIONS") return handlePreflight(origin);

    const caller = await authoriseUser(req);
    if (!caller) return json({ error: "unauthorized" }, 401, origin);

    let body: { shared_item_id?: string; reason?: string };
    try { body = await req.json(); } catch { return json({ error: "invalid_body" }, 400, origin); }
    if (!body.shared_item_id) return json({ error: "shared_item_id_required" }, 400, origin);

    const { data: row } = await supabase
        .from("m365_shared_items")
        .select("id, organization_id, m365_tenant_id, drive_id, item_id, permission_id, item_name, removed_at")
        .eq("id", body.shared_item_id)
        .maybeSingle();
    if (!row) return json({ error: "share_not_found" }, 404, origin);
    if (row.removed_at) return json({ error: "already_removed" }, 409, origin);

    if (!(await userIsOrgAdmin(caller.userId, row.organization_id))) return json({ error: "forbidden" }, 403, origin);

    const { data: t } = await supabase
        .from("m365_tenants")
        .select("id, organization_id, tenant_id, access_token, refresh_token, access_token_expires_at, scopes, remediation_enabled")
        .eq("id", row.m365_tenant_id)
        .maybeSingle();
    if (!t) return json({ error: "tenant_missing" }, 404, origin);
    if (!t.remediation_enabled) {
        return json({ error: "remediation_not_enabled", detail: "Tenant needs Files.ReadWrite.All / Sites.FullControl.All — re-consent the M365 connection." }, 409, origin);
    }

    let token: string;
    try { token = await ensureFreshToken(t as TenantRow); }
    catch (e) { return json({ error: "token_refresh_failed", detail: String((e as Error).message ?? e).slice(0, 200) }, 502, origin); }

    const url = `https://graph.microsoft.com/v1.0/drives/${row.drive_id}/items/${row.item_id}/permissions/${row.permission_id}`;
    const resp = await fetch(url, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok && resp.status !== 404) {
        return json({ error: "graph_delete_failed", status: resp.status, detail: (await resp.text()).slice(0, 400) }, 502, origin);
    }

    await supabase.from("m365_shared_items").update({
        removed_at: new Date().toISOString(),
        removed_by: caller.userId,
        remove_reason: body.reason ?? null,
    }).eq("id", row.id);

    await supabase.from("activity_logs").insert({
        organization_id: row.organization_id,
        user_id: caller.userId,
        action: "m365_share_revoked",
        resource_type: "m365_shared_item",
        resource_id: row.id,
        metadata: { item_name: row.item_name, reason: body.reason ?? null },
    });

    return json({ ok: true }, 200, origin);
});
