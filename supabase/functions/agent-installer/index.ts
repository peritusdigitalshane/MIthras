// GET /functions/v1/agent-installer?token=<enrollment_token>&runtime=powershell
// Returns: { token: string, download_url, sha256, ed25519_sig, latest_version, api_base_url }
// Used by the platform Agent Download page to build the one-liner install command.
//
// Auth: the enrolment token itself is the credential. Validated against public.enrollment_tokens
// (must exist, not expired, not used). The token is returned in the response so the install
// script can pass it to agent-enroll. (The token is single-use — it's consumed during the
// actual agent-enroll call, not here.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PUBLIC_API_BASE = Deno.env.get("PUBLIC_API_BASE_URL") ?? "https://api.mithras.com.au";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "content-type": "application/json",
            ...(buildCorsHeaders(origin) as Record<string, string>),
        },
    });
}

Deno.serve(async (request) => {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;

    const origin = request.headers.get("origin");

    if (request.method !== "GET") {
        return jsonResponse({ error: "method_not_allowed" }, 405, origin);
    }

    const url = new URL(request.url);
    const token = url.searchParams.get("token")?.trim() ?? "";
    const runtime = url.searchParams.get("runtime") ?? "powershell";

    if (!token) {
        return jsonResponse({ error: "missing_token" }, 400, origin);
    }
    if (runtime !== "powershell" && runtime !== "dotnet") {
        return jsonResponse({ error: "invalid_runtime" }, 400, origin);
    }

    // Validate the token (existence, expiry, not used)
    const { data: tokenRow, error: tokenErr } = await supabase
        .from("enrollment_tokens")
        .select("token, expires_at, used_at, channel")
        .eq("token", token)
        .maybeSingle();

    if (tokenErr) {
        console.error("enrollment_tokens select failed", tokenErr);
        return jsonResponse({ error: "internal" }, 500, origin);
    }
    if (!tokenRow) {
        return jsonResponse({ error: "token_invalid" }, 401, origin);
    }
    if (tokenRow.used_at) {
        return jsonResponse({ error: "token_already_used" }, 410, origin);
    }
    if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
        return jsonResponse({ error: "token_expired" }, 410, origin);
    }

    // Look up the latest agent for this runtime + channel
    const { data: latest, error: vErr } = await supabase
        .from("agent_versions")
        .select("version, download_url, sha256, ed25519_sig")
        .eq("runtime", runtime)
        .eq("channel", tokenRow.channel)
        .eq("is_active", true)
        .order("published_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (vErr) {
        console.error("agent_versions select failed", vErr);
        return jsonResponse({ error: "internal" }, 500, origin);
    }
    if (!latest) {
        return jsonResponse({ error: "no_release_published", runtime, channel: tokenRow.channel }, 503, origin);
    }

    return jsonResponse({
        token,
        runtime,
        latest_version: latest.version,
        download_url: latest.download_url,
        sha256: latest.sha256,
        ed25519_sig: latest.ed25519_sig,
        api_base_url: PUBLIC_API_BASE,
    }, 200, origin);
});
