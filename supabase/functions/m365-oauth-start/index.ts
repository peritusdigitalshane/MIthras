// POST /functions/v1/m365-oauth-start
//
// Mints the Microsoft consent URL for connecting an M365 tenant. The caller
// (a customer org admin) clicks the returned URL; Microsoft handles the
// consent UX; on consent Microsoft redirects to m365-oauth-callback with
// an auth code that completes the flow.
//
// Body:
//   { organization_id: uuid, mode?: "read_only" | "remediation" }
//
// Returns:
//   { ok: true, consent_url: string, state: string }
//
// The state field is a signed payload binding the consent flow to (this
// user, this organization, this Mithras instance) so an attacker cannot
// stitch their own consent into another tenant's m365_tenants row.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { READ_ONLY_SCOPES, REMEDIATION_SCOPES } from "../_shared/m365-graph.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Fail closed: a forgeable state token lets an attacker complete OAuth
// against another Mithras org. No "rotate me later" fallback — refuse to
// start unless a real secret is configured.
const STATE_SECRET = Deno.env.get("M365_STATE_SECRET");
if (!STATE_SECRET || STATE_SECRET.length < 32) {
    throw new Error("M365_STATE_SECRET must be set to a random value of at least 32 characters");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function jsonResponse(
    body: unknown,
    status: number,
    origin: string | null,
    extraHeaders: Record<string, string> = {},
): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "content-type": "application/json",
            ...(buildCorsHeaders(origin) as Record<string, string>),
            ...extraHeaders,
        },
    });
}

// Cookie scope. The OAuth callback lives at api.mithras.com.au; the start
// is hit from www.mithras.com.au. The nonce cookie must be readable on
// both subdomains so we set Domain to the registered parent. Override via
// env if Mithras is ever served under a different parent.
const NONCE_COOKIE_DOMAIN = Deno.env.get("M365_NONCE_COOKIE_DOMAIN") ?? "mithras.com.au";
const NONCE_COOKIE_NAME   = "m365_oauth_nonce";
const NONCE_COOKIE_MAX_AGE_SECONDS = 900;       // 15 min — matches state freshness

function b64url(bytes: Uint8Array): string {
    let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(input: string, secret: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        "raw", new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input));
    return b64url(new Uint8Array(sig));
}

interface StatePayload {
    org_id: string;
    user_id: string;
    mode: "read_only" | "remediation";
    nonce: string;
    iat: number;            // seconds since epoch
    // Azure tenant id (the `tid` claim) the caller expects this consent
    // to land on. Set when the operator clicked a specific m365_tenants
    // row (e.g. "Enable remediation" upgrade). The callback compares this
    // to the actual `tid` Microsoft returns and refuses the consent on
    // mismatch - blocks cross-tenant consent mis-assignment when an
    // operator with multiple linked accounts picks the wrong one in
    // Microsoft's account picker.
    expected_tid?: string;
}

async function signState(payload: StatePayload): Promise<string> {
    const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
    const sig = await hmac(body, STATE_SECRET);
    return `${body}.${sig}`;
}

async function getPlatformSetting(key: string): Promise<string> {
    const { data } = await supabase.from("platform_settings")
        .select("value").eq("key", key).maybeSingle();
    return (data?.value ?? "") as string;
}

Deno.serve(async (req) => {
    const preflight = handlePreflight(req); if (preflight) return preflight;
    const origin = req.headers.get("origin");
    if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, origin);

    const rl = checkRateLimit(req, "m365-oauth-start", { max: 20, windowMs: 60_000 });
    if (!rl.ok) return rateLimitResponse(rl, buildCorsHeaders(origin) as Record<string, string>);

    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return jsonResponse({ error: "missing_token" }, 401, origin);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return jsonResponse({ error: "invalid_token" }, 401, origin);

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch {}
    const orgId = String(body.organization_id ?? "");
    const mode = (body.mode === "remediation" ? "remediation" : "read_only") as "read_only" | "remediation";
    if (!orgId) return jsonResponse({ error: "organization_id_required" }, 400, origin);
    const m365TenantPk: string | null = body.m365_tenant_id ? String(body.m365_tenant_id) : null;

    // Caller must be an admin of the target org (or a super-admin).
    const { data: isAdmin } = await supabase.rpc("is_admin_of_org", {
        _user_id: user.id, _org_id: orgId,
    });
    const { data: isSuper } = await supabase
        .from("super_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!isAdmin && !isSuper) {
        return jsonResponse({ error: "forbidden_admin_required" }, 403, origin);
    }

    const clientId    = await getPlatformSetting("m365_azure_client_id");
    const redirectUri = await getPlatformSetting("m365_azure_redirect_uri");
    const authority   = (await getPlatformSetting("m365_azure_authority")) || "https://login.microsoftonline.com";
    if (!clientId || !redirectUri) {
        return jsonResponse({ error: "m365_integration_not_configured" }, 503, origin);
    }

    // Build state token. The nonce is BOTH signed into the state AND set
    // as an HttpOnly cookie on the parent domain. The callback verifies
    // the cookie nonce matches the state nonce — that binding proves the
    // browser completing the consent is the same browser that started
    // the flow. Closes the login-CSRF "victim's tenant bound to attacker's
    // org" attack: an attacker who phishes a victim into hitting Microsoft's
    // consent URL with the attacker's state can no longer have the
    // callback succeed, because the victim's browser has no matching
    // nonce cookie.
    const nonceBytes = new Uint8Array(16); crypto.getRandomValues(nonceBytes);
    const nonce = b64url(nonceBytes);

    // If the caller pointed us at a specific m365_tenants row, look up the
    // Azure tid bound to it AND verify the row belongs to the same org the
    // caller's already authorised against. Then sign the expected tid into
    // state so the callback can reject mismatches. Refuses the start
    // entirely on unknown / cross-org row IDs — fail closed.
    let expectedTid: string | undefined;
    if (m365TenantPk) {
        const { data: tenantRow } = await supabase
            .from("m365_tenants")
            .select("tenant_id, organization_id")
            .eq("id", m365TenantPk)
            .maybeSingle();
        if (!tenantRow) return jsonResponse({ error: "m365_tenant_not_found" }, 404, origin);
        if (tenantRow.organization_id !== orgId) {
            return jsonResponse({ error: "m365_tenant_org_mismatch" }, 403, origin);
        }
        if (typeof tenantRow.tenant_id === "string" && tenantRow.tenant_id.length > 0) {
            expectedTid = tenantRow.tenant_id;
        }
    }

    const state = await signState({
        org_id:  orgId,
        user_id: user.id,
        mode,
        nonce,
        iat:     Math.floor(Date.now() / 1000),
        ...(expectedTid ? { expected_tid: expectedTid } : {}),
    });

    const scopes = mode === "remediation"
        ? [...READ_ONLY_SCOPES, ...REMEDIATION_SCOPES]
        : READ_ONLY_SCOPES;

    const params = new URLSearchParams({
        client_id:     clientId,
        response_type: "code",
        redirect_uri:  redirectUri,
        response_mode: "query",
        scope:         scopes.join(" "),
        state,
        // 'select_account' makes Microsoft show the tenant picker even if
        // the admin's already signed in to one — they should always be
        // intentional about which tenant they're connecting.
        prompt:        "select_account",
    });

    // When we know the expected Azure tid (operator clicked a specific
    // tenant row for a remediation upgrade), use the tenant-scoped
    // authority URL so Microsoft only accepts accounts from that tenant.
    // Falls back to /common for the initial read_only connect where the
    // operator picks the tenant for the first time.
    const tenantSegment = expectedTid ?? "common";
    const consentUrl = `${authority}/${tenantSegment}/oauth2/v2.0/authorize?${params.toString()}`;

    // SameSite=Lax: the callback navigation is a top-level GET from
    // login.microsoftonline.com to api.mithras.com.au — Lax allows the
    // cookie. HttpOnly stops any JS from reading it.
    const cookieValue =
        `${NONCE_COOKIE_NAME}=${nonce}` +
        `; Domain=${NONCE_COOKIE_DOMAIN}` +
        `; Path=/` +
        `; Max-Age=${NONCE_COOKIE_MAX_AGE_SECONDS}` +
        `; Secure; HttpOnly; SameSite=Lax`;

    return jsonResponse(
        { ok: true, consent_url: consentUrl, state },
        200, origin,
        { "Set-Cookie": cookieValue },
    );
});
