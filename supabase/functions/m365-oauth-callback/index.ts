// GET /functions/v1/m365-oauth-callback
//
// Microsoft consent redirect target. Receives ?code=...&state=...&session_state=...
// or ?error=...&error_description=...
//
// On success:
//   - verifies state signature + freshness
//   - exchanges code for access + refresh tokens
//   - extracts tid (M365 tenant ID) from the id_token
//   - upserts m365_tenants row with consent_state='active'
//   - 302s the operator back to /m365?connected=<tenant_id>
//
// On failure:
//   - 302s back to /m365?error=<code>&error_description=...
//
// This function is unauthenticated by user JWT (Microsoft can't carry one)
// — the state HMAC IS the auth. We verify it before touching the database.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
    READ_ONLY_SCOPES, REMEDIATION_SCOPES, exchangeAuthCode, graphGetJson,
} from "../_shared/m365-graph.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Same fail-closed rationale as m365-oauth-start — the callback verifies
// state tokens, so a known-constant fallback here would let an attacker
// pass verification with a forged state.
const STATE_SECRET = Deno.env.get("M365_STATE_SECRET");
if (!STATE_SECRET || STATE_SECRET.length < 32) {
    throw new Error("M365_STATE_SECRET must be set to a random value of at least 32 characters");
}
const APP_BASE_URL         = Deno.env.get("APP_BASE_URL") ?? "https://www.mithras.com.au";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function b64urlDecode(s: string): Uint8Array {
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

async function hmacB64Url(input: string, secret: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        "raw", new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input));
    const bytes = new Uint8Array(sig);
    let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface StatePayload {
    org_id: string;
    user_id: string;
    mode: "read_only" | "remediation";
    nonce: string;
    iat: number;
    // Set by m365-oauth-start when the operator clicked a specific tenant
    // row (e.g. "Enable remediation" upgrade). The Azure tid Microsoft
    // returns MUST match this value or we refuse to upsert. Stops
    // cross-tenant consent mis-assignment when an MSP admin has multiple
    // Azure accounts linked to one Mithras org.
    expected_tid?: string;
}

async function verifyState(state: string): Promise<StatePayload | null> {
    const dot = state.lastIndexOf(".");
    if (dot < 0) return null;
    const body = state.slice(0, dot);
    const sig  = state.slice(dot + 1);
    const expected = await hmacB64Url(body, STATE_SECRET);
    if (sig !== expected) return null;
    try {
        const json = new TextDecoder().decode(b64urlDecode(body));
        const payload = JSON.parse(json) as StatePayload;
        // Reject states older than 15 minutes — the consent UX should
        // complete well inside that.
        if (Date.now() / 1000 - payload.iat > 900) return null;
        return payload;
    } catch {
        return null;
    }
}

// Match the start function exactly — cookie's Domain attribute must match
// for the browser to overwrite/clear it. Override via env if Mithras moves
// to a different parent domain.
const NONCE_COOKIE_DOMAIN = Deno.env.get("M365_NONCE_COOKIE_DOMAIN") ?? "mithras.com.au";
const NONCE_COOKIE_NAME   = "m365_oauth_nonce";

// Clear the nonce cookie unconditionally on every callback exit. Even
// when verification fails, we don't want a stale cookie sitting in the
// browser ready to be replayed.
const NONCE_CLEAR_COOKIE =
    `${NONCE_COOKIE_NAME}=` +
    `; Domain=${NONCE_COOKIE_DOMAIN}` +
    `; Path=/` +
    `; Max-Age=0` +
    `; Secure; HttpOnly; SameSite=Lax`;

function redirect(to: string, extraHeaders: Record<string, string> = {}): Response {
    return new Response(null, {
        status: 302,
        headers: {
            location: to,
            "Set-Cookie": NONCE_CLEAR_COOKIE,
            ...extraHeaders,
        },
    });
}

function redirectWithError(code: string, description?: string): Response {
    const params = new URLSearchParams({ m365_error: code });
    if (description) params.set("m365_error_description", description.slice(0, 240));
    return redirect(`${APP_BASE_URL}/m365?${params.toString()}`);
}

/**
 * Parse the Cookie header for our nonce. Returns null if absent or
 * malformed. We don't trust the value beyond comparing it to the state's
 * nonce in a timing-safe manner below.
 */
function getNonceFromCookieHeader(req: Request): string | null {
    const raw = req.headers.get("cookie") ?? "";
    for (const part of raw.split(";")) {
        const eq = part.indexOf("=");
        if (eq < 0) continue;
        const name = part.slice(0, eq).trim();
        if (name !== NONCE_COOKIE_NAME) continue;
        const value = part.slice(eq + 1).trim();
        // The nonce we set is plain b64url, no encoding needed; reject any
        // value with characters outside the b64url alphabet so a forged
        // cookie can't smuggle weird bytes into our timing-safe compare.
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) return null;
        return value;
    }
    return null;
}

/**
 * Timing-safe equality. Returns false on length mismatch or any byte
 * difference, in constant time relative to the input length, so an
 * attacker can't learn how many bytes of the nonce they got right by
 * timing the response.
 */
function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

async function getPlatformSetting(key: string): Promise<string> {
    const { data } = await supabase.from("platform_settings")
        .select("value").eq("key", key).maybeSingle();
    return (data?.value ?? "") as string;
}

// Decode the unverified JWT body — we only need `tid`. The token itself was
// minted by Microsoft and delivered over TLS via the token endpoint, so we
// trust its contents without verifying the signature. (Verifying would
// require pulling the JWKS for login.microsoftonline.com; not worth the
// extra round-trip for a value we're going to confirm via Graph anyway.)
function decodeJwtBody(jwt: string): Record<string, unknown> | null {
    try {
        const parts = jwt.split(".");
        if (parts.length < 2) return null;
        const json = new TextDecoder().decode(b64urlDecode(parts[1]));
        return JSON.parse(json) as Record<string, unknown>;
    } catch {
        return null;
    }
}

Deno.serve(async (req) => {
    const url = new URL(req.url);
    const code  = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const err   = url.searchParams.get("error");
    const errDesc = url.searchParams.get("error_description") ?? undefined;

    if (err) return redirectWithError(err, errDesc);
    if (!code || !state) {
        return redirectWithError("missing_code_or_state");
    }

    const payload = await verifyState(state);
    if (!payload) return redirectWithError("invalid_state");

    // Session-binding check: the nonce embedded in the signed state MUST
    // match the nonce cookie we set in m365-oauth-start. The HMAC alone
    // proves the state was minted by Mithras; the cookie proves it was
    // minted FOR THIS BROWSER. Without this check an attacker can mint a
    // state for their org and trick a victim's browser into completing
    // it, binding the victim's M365 tenant to the attacker's Mithras org.
    const cookieNonce = getNonceFromCookieHeader(req);
    if (!cookieNonce || !timingSafeEqual(cookieNonce, payload.nonce)) {
        console.warn("nonce_mismatch", {
            cookie_present: !!cookieNonce,
            org_id: payload.org_id,
        });
        return redirectWithError("session_mismatch");
    }

    const clientId     = await getPlatformSetting("m365_azure_client_id");
    const clientSecret = await getPlatformSetting("m365_azure_client_secret");
    const redirectUri  = await getPlatformSetting("m365_azure_redirect_uri");
    const authority    = (await getPlatformSetting("m365_azure_authority")) || "https://login.microsoftonline.com";
    if (!clientId || !clientSecret || !redirectUri) {
        return redirectWithError("m365_integration_not_configured");
    }

    const scopes = payload.mode === "remediation"
        ? [...READ_ONLY_SCOPES, ...REMEDIATION_SCOPES]
        : READ_ONLY_SCOPES;

    let tok;
    try {
        tok = await exchangeAuthCode({
            authority, tenantId: "common",
            clientId, clientSecret,
            code, redirectUri, scopes,
        });
    } catch (e) {
        // Log full error server-side; surface only the opaque code to the
        // browser. Microsoft error bodies sometimes include partial code
        // material or correlation IDs that aid phishing.
        console.error("token_exchange_failed", {
            org_id: payload.org_id,
            error: e instanceof Error ? e.message : String(e),
        });
        return redirectWithError("token_exchange_failed");
    }
    if (!tok.access_token || !tok.refresh_token) {
        return redirectWithError("missing_tokens_in_response");
    }

    // tid = the M365 tenant ID the user just consented from. Try the
    // id_token first; fall back to decoding the Graph access_token, which
    // is also a JWT and carries tid. This is a belt-and-braces guard in
    // case the OIDC scopes (openid/profile/email) somehow drop out of the
    // request and the response arrives without an id_token.
    const idBody  = tok.id_token       ? decodeJwtBody(tok.id_token)       : null;
    const accBody = tok.access_token   ? decodeJwtBody(tok.access_token)   : null;
    const m365TenantId =
        (idBody?.tid as string | undefined) ??
        (accBody?.tid as string | undefined) ??
        null;
    const tenantDisplayName =
        (idBody?.tenant_display_name as string | undefined) ??
        (accBody?.tenant_display_name as string | undefined) ??
        null;

    if (!m365TenantId) {
        console.error("missing_tenant_id_diagnostic", {
            has_id_token: !!tok.id_token,
            id_token_claims: idBody ? Object.keys(idBody) : null,
            access_token_claims: accBody ? Object.keys(accBody) : null,
            granted_scope: (tok as { scope?: string }).scope ?? null,
        });
        return redirectWithError("missing_tenant_id");
    }

    // Tenant-binding check. If m365-oauth-start pinned an expected_tid into
    // the signed state (operator clicked a specific tenant row), the tid
    // Microsoft just returned MUST match. Defeats the cross-tenant consent
    // mis-assignment risk where an admin with multiple linked Azure
    // accounts picks the wrong one in Microsoft's account picker and we
    // silently write the upgraded scopes onto a different tenant row.
    if (payload.expected_tid && payload.expected_tid !== m365TenantId) {
        console.warn("tenant_mismatch_on_consent", {
            org_id: payload.org_id,
            expected_tid: payload.expected_tid,
            actual_tid: m365TenantId,
            mode: payload.mode,
        });
        return redirectWithError("tenant_mismatch");
    }

    const expiresAt = new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString();

    // Persist the tenant row IMMEDIATELY — we have everything we need to
    // mark the consent active. The verified-domain lookup runs after, on a
    // best-effort timeout, and patches the row in place. This protects
    // against the edge-runtime wall-clock killing the worker mid-Graph
    // call (the original failure mode that broke the consent flow).
    const updates: Record<string, unknown> = {
        organization_id:           payload.org_id,
        tenant_id:                 m365TenantId,
        tenant_display_name:       tenantDisplayName,
        tenant_domain:             null,             // patched below if reachable
        access_token:              tok.access_token,
        access_token_expires_at:   expiresAt,
        refresh_token:             tok.refresh_token,
        scopes:                    scopes,
        consent_state:             "active",
        connected_by:              payload.user_id,
        last_poll_error:           null,
    };
    if (payload.mode === "remediation") {
        updates.remediation_enabled = true;
        updates.remediation_scopes = REMEDIATION_SCOPES;
    }

    const { error: upsertErr } = await supabase
        .from("m365_tenants")
        .upsert(updates, { onConflict: "organization_id,tenant_id" });

    // Best-effort: resolve the verified primary domain AND the human-friendly
    // tenant name via Graph /organization, with a hard 5s ceiling, then patch
    // the tenant row. (tenant_display_name isn't a JWT claim — Azure only
    // exposes `tid` there, so the up-front extraction always returned null.)
    // The poller refreshes both on every cycle so a transient failure here
    // is recoverable.
    try {
        const org = await Promise.race([
            graphGetJson<{ value: Array<{ displayName?: string; verifiedDomains?: Array<{ name: string; isDefault?: boolean; isInitial?: boolean }> }> }>(
                tok.access_token, "/organization?$select=displayName,verifiedDomains",
            ),
            new Promise<never>((_r, rej) => setTimeout(() => rej(new Error("org_lookup_timeout")), 5000)),
        ]);
        const row = (org.value ?? [])[0];
        const domains = row?.verifiedDomains ?? [];
        const def = domains.find(d => d.isDefault) ?? domains.find(d => d.isInitial) ?? domains[0];
        const patch: Record<string, unknown> = {};
        if (row?.displayName) patch.tenant_display_name = row.displayName;
        if (def?.name)        patch.tenant_domain       = def.name;
        if (Object.keys(patch).length > 0) {
            await supabase.from("m365_tenants")
                .update(patch)
                .eq("organization_id", payload.org_id)
                .eq("tenant_id", m365TenantId);
        }
    } catch (e) {
        console.warn("org_resolve_deferred_to_poller", {
            tenant_id: m365TenantId,
            error: e instanceof Error ? e.message : String(e),
        });
    }

    if (upsertErr) {
        return redirectWithError("tenant_persist_failed", upsertErr.message);
    }

    return redirect(`${APP_BASE_URL}/m365?connected=${m365TenantId}&mode=${payload.mode}`);
});
