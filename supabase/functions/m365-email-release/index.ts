// =============================================================================
// /functions/v1/m365-email-release
//
// Public self-service release endpoint. The recipient clicks the link in the
// warning email; the frontend page hits this function with the token.
// Token-only auth — no session required.
//
//   POST { token: <uuid> }     -> moves the message Junk -> Inbox via Graph
//   GET  ?token=<uuid>         -> same, for the magic-link click flow
//
// Refuses to act if the row was already released or has been operator-actioned
// since the warning went out.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { READ_ONLY_SCOPES, REMEDIATION_SCOPES, refreshAccessToken } from "../_shared/m365-graph.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL             = Deno.env.get("SITE_URL") ?? "https://www.mithras.com.au";
const RELEASE_TTL_DAYS     = 14;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function json(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

async function getPlatformSetting(key: string): Promise<string | null> {
    const { data } = await supabase.from("platform_settings").select("value").eq("key", key).maybeSingle();
    return (data?.value as string) ?? null;
}

interface TenantRow {
    id: string; tenant_id: string;
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
    const scopes = (t.scopes && t.scopes.length > 0) ? t.scopes : [...READ_ONLY_SCOPES, ...REMEDIATION_SCOPES];
    const tok = await refreshAccessToken({ authority, tenantId: t.tenant_id, clientId, clientSecret, refreshToken: t.refresh_token, scopes });
    const newExpiresAt = new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString();
    const patch: Record<string, unknown> = { access_token: tok.access_token, access_token_expires_at: newExpiresAt };
    if (tok.refresh_token && tok.refresh_token !== t.refresh_token) patch.refresh_token = tok.refresh_token;
    await supabase.from("m365_tenants").update(patch as any).eq("id", t.id);
    return tok.access_token;
}

async function moveToInbox(token: string, userId: string, messageId: string): Promise<{ ok: true } | { ok: false; error: string }> {
    // Look up the well-known Inbox folder id once.
    const fr = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/mailFolders?$select=id,displayName&$top=50`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!fr.ok) return { ok: false, error: `folders_${fr.status}` };
    const folders = await fr.json();
    const inbox = (folders.value as Array<{ id: string; displayName: string }>).find(f => f.displayName?.toLowerCase() === "inbox");
    if (!inbox) return { ok: false, error: "inbox_not_found" };

    const resp = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}/move`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ destinationId: inbox.id }),
    });
    if (!resp.ok) return { ok: false, error: `move_${resp.status}` };
    return { ok: true };
}

async function processRelease(token: string, origin: string | null): Promise<Response> {
    if (!/^[0-9a-f-]{32,40}$/i.test(token)) return json({ error: "invalid_token" }, 400, origin);

    const { data: threat } = await supabase
        .from("email_threats")
        .select("id, organization_id, m365_tenant_id, graph_message_id, recipient_user_id, recipient_email, action_taken, warning_sent_at, released_at")
        .eq("release_token", token)
        .maybeSingle();
    if (!threat) return json({ error: "token_not_found" }, 404, origin);

    if (threat.released_at) return json({ ok: true, already_released: true }, 200, origin);
    if (threat.action_taken === "released") return json({ ok: true, already_released: true }, 200, origin);
    if (threat.warning_sent_at) {
        const warned = new Date(threat.warning_sent_at).getTime();
        if (Date.now() - warned > RELEASE_TTL_DAYS * 86_400_000) {
            return json({ error: "token_expired" }, 410, origin);
        }
    }

    const { data: tenant } = await supabase
        .from("m365_tenants")
        .select("id, tenant_id, access_token, refresh_token, access_token_expires_at, scopes")
        .eq("id", threat.m365_tenant_id)
        .maybeSingle();
    if (!tenant) return json({ error: "tenant_not_connected" }, 412, origin);
    if (!(tenant.scopes ?? []).includes("Mail.ReadWrite")) return json({ error: "missing_scope" }, 412, origin);

    const access = await ensureFreshToken(tenant as TenantRow);
    const res = await moveToInbox(access, threat.recipient_user_id ?? "", threat.graph_message_id);
    if (!res.ok) return json({ error: ("error" in res ? res.error : "move_failed") }, 502, origin);

    await supabase.from("email_threats").update({
        action_taken: "released",
        action_taken_at: new Date().toISOString(),
        released_at: new Date().toISOString(),
        reviewer_verdict: "user_self_release",
    } as any).eq("id", threat.id);

    return json({ ok: true, released: true, recipient: threat.recipient_email }, 200, origin);
}

Deno.serve(async (req) => {
    const origin = req.headers.get("origin");
    const pre = handlePreflight(req); if (pre) return pre;

    if (req.method === "GET") {
        const url = new URL(req.url);
        const token = url.searchParams.get("token") ?? "";
        return await processRelease(token, origin);
    }
    if (req.method === "POST") {
        let body: { token?: string };
        try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400, origin); }
        return await processRelease(body.token ?? "", origin);
    }
    return json({ error: "method_not_allowed" }, 405, origin);
});
