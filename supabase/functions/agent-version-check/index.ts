// GET /functions/v1/agent-version-check?current=1.2.3&runtime=powershell
// Headers: X-Agent-Id, X-Timestamp, X-Signature
// Response 200: { latest: string, download_url: string, sha256: string, ed25519_sig: string, update_available: boolean }
// Response 204 if no active version exists for this runtime/channel
//
// Agent verifies sha256 + ed25519_sig against baked-in public key BEFORE executing the downloaded binary.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { extractHmacRequest, verifyHmacRequest } from "../_shared/hmac.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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

    const hmacReq = await extractHmacRequest(request);
    if (!hmacReq) {
        return jsonResponse({ error: "missing_hmac_headers" }, 401, origin);
    }

    const { data: endpoint, error: lookupErr } = await supabase
        .from("endpoints")
        .select("id, agent_secret, is_active, update_channel, runtime")
        .eq("id", hmacReq.agentId)
        .maybeSingle();

    if (lookupErr) {
        return jsonResponse({ error: "internal" }, 500, origin);
    }
    if (!endpoint || !endpoint.agent_secret || !endpoint.is_active) {
        return jsonResponse({ error: "agent_unknown_or_inactive" }, 401, origin);
    }

    const verification = await verifyHmacRequest(hmacReq, endpoint.agent_secret);
    if (!verification.ok) {
        return jsonResponse({ error: "hmac_invalid", reason: verification.reason }, 401, origin);
    }

    const url = new URL(request.url);
    const current = url.searchParams.get("current") ?? "";
    const runtime = url.searchParams.get("runtime") ?? endpoint.runtime ?? "powershell";

    const { data: latest } = await supabase
        .from("agent_versions")
        .select("version, download_url, sha256, ed25519_sig")
        .eq("runtime", runtime)
        .eq("channel", endpoint.update_channel)
        .eq("is_active", true)
        .order("published_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!latest) {
        return new Response(null, {
            status: 204,
            headers: buildCorsHeaders(origin) as Record<string, string>,
        });
    }

    return jsonResponse({
        latest: latest.version,
        download_url: latest.download_url,
        sha256: latest.sha256,
        ed25519_sig: latest.ed25519_sig,
        update_available: current !== latest.version,
    }, 200, origin);
});
