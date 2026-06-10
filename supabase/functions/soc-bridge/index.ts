// POST /functions/v1/soc-bridge
//
// SSO bridge: Mithras super-admins reach the Grafana SOC dashboard at
// https://soc.mithras.com.au without ever seeing the Grafana login screen.
//
// Flow:
//   1. Frontend calls this function with the user's Supabase JWT.
//   2. We verify the JWT, look up super-admin status.
//   3. If they pass, mint a short-lived JWT (HS256, signed with the bridge
//      secret) carrying { sub, email, iss: 'mithras-bridge', aud: 'grafana' }.
//   4. Return the SOC URL with ?auth_token=<jwt> appended. The frontend opens
//      it. Grafana validates the JWT, creates/maps the user, and immediately
//      issues a long-lived session cookie for soc.mithras.com.au. The JWT in
//      the URL is one-shot: Grafana strips it from the next navigation.
//
// Why URL token rather than cookie: Grafana 13's cookie JWT path was returning
// 401 in testing while the URL/header paths worked. URL token is also simpler
// — no cross-subdomain cookie scope, no HttpOnly/SameSite gymnastics.
//
// Non-super-admins get HTTP 403 and never receive a JWT.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BRIDGE_HMAC_B64URL   = Deno.env.get("GRAFANA_BRIDGE_HMAC_B64URL") ?? "";
const SOC_URL              = Deno.env.get("SOC_URL") ?? "https://soc.mithras.com.au";
// 8 hours: long enough that a typical SOC operator's workday stays
// signed in. The JWT travels in a cross-subdomain cookie that Grafana
// reads on every request (GF_AUTH_JWT_COOKIE_NAME=mithras_grafana_token).
// Operators re-mint by clicking the SOC Dashboard link again — typical
// shift length covers it, and the rate-limit cap of 30/min/IP makes
// constant remints harmless.
const TTL_SECONDS          = 8 * 60 * 60;
// Parent domain the cookie is scoped to. Must be a domain the SOC frontend
// shares with both api.mithras.com.au and soc.mithras.com.au so the browser
// will both accept the Set-Cookie response AND send it on the next request.
const COOKIE_DOMAIN        = Deno.env.get("BRIDGE_COOKIE_DOMAIN") ?? "mithras.com.au";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function jsonResponse(body: unknown, status: number, origin: string | null, extraHeaders: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "content-type": "application/json",
            ...(buildCorsHeaders(origin) as Record<string, string>),
            ...extraHeaders,
        },
    });
}

function b64urlToBytes(s: string): Uint8Array {
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function bytesToB64url(bytes: Uint8Array): string {
    let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signHs256(payload: Record<string, unknown>, b64urlSecret: string): Promise<string> {
    const header = { alg: "HS256", typ: "JWT", kid: "mithras-grafana-bridge" };
    const enc = (o: Record<string, unknown>) =>
        bytesToB64url(new TextEncoder().encode(JSON.stringify(o)));
    const headerB64  = enc(header);
    const payloadB64 = enc(payload);
    const signingInput = `${headerB64}.${payloadB64}`;

    const keyBytes = b64urlToBytes(b64urlSecret);
    const key = await crypto.subtle.importKey(
        "raw", keyBytes,
        { name: "HMAC", hash: "SHA-256" },
        false, ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
    return `${signingInput}.${bytesToB64url(new Uint8Array(sig))}`;
}

Deno.serve(async (req) => {
    const preflight = handlePreflight(req); if (preflight) return preflight;
    const origin = req.headers.get("origin");
    if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, origin);
    if (!BRIDGE_HMAC_B64URL) return jsonResponse({ error: "bridge_secret_unconfigured" }, 500, origin);

    // Per-IP rate limit. A super-admin loading the SOC frame shouldn't hit
    // this more than once per nav — 30/min covers refresh + multi-tab.
    const rl = checkRateLimit(req, "soc-bridge", { max: 30, windowMs: 60_000 });
    if (!rl.ok) return rateLimitResponse(rl, buildCorsHeaders(origin) as Record<string, string>);

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return jsonResponse({ error: "missing_token" }, 401, origin);

    // Verify the Supabase session.
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return jsonResponse({ error: "invalid_token" }, 401, origin);

    // Super-admin gate.
    const { data: saRow } = await supabase
        .from("super_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!saRow) {
        return jsonResponse({ error: "super_admin_required", hint: "SOC dashboard access is super-admin only." }, 403, origin);
    }

    const email = user.email ?? `${user.id}@mithras.local`;
    const name  = (user.user_metadata?.name as string | undefined) ?? email;

    const now = Math.floor(Date.now() / 1000);
    const grafanaJwt = await signHs256({
        iss:   "mithras-bridge",
        aud:   "grafana",
        sub:   user.id,
        email,
        name,
        iat:   now,
        nbf:   now,
        exp:   now + TTL_SECONDS,
    }, BRIDGE_HMAC_B64URL);

    // Set a cookie on the parent (.mithras.com.au) so every request to
    // soc.mithras.com.au carries it. The Caddy SSO proxy sitting in front
    // of Grafana reads this cookie and injects it as X-JWT-Assertion on
    // every proxied request — Grafana sees a valid JWT on every page load,
    // every panel fetch, every dashboard navigation.
    //
    // Cookie-only — DO NOT put the JWT in the URL. URL-borne tokens leak
    // via access logs (NPM, Caddy, Grafana), browser history, and Referer
    // headers if Grafana ever links externally. fetch() with
    // credentials:'include' commits the Set-Cookie to the browser jar
    // before the promise resolves, so the subsequent window.open() of
    // soc_url carries the cookie reliably.
    //
    // SameSite=Lax works here because:
    //   - www.mithras.com.au and soc.mithras.com.au are same-registrable-site
    //   - The new-tab open is a top-level GET navigation (Lax allows that)
    const cookieValue =
        `mithras_grafana_token=${grafanaJwt}` +
        `; Domain=${COOKIE_DOMAIN}` +
        `; Path=/` +
        `; Max-Age=${TTL_SECONDS}` +
        `; Secure; HttpOnly; SameSite=Lax`;

    return jsonResponse(
        { ok: true, soc_url: SOC_URL, expires_in: TTL_SECONDS },
        200,
        origin,
        { "Set-Cookie": cookieValue },
    );
});
