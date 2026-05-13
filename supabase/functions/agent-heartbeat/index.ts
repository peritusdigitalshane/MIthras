// POST /functions/v1/agent-heartbeat
// Headers: X-Agent-Id, X-Timestamp, X-Signature
// Body: { os_version?, os_build?, defender_version?, agent_version?, status: { realtime_protection_enabled, ... } }
// Response 200: { commands: [], next_check_in: number }   // commands populated in phase 3
// Response 401 on HMAC failure / inactive endpoint
//
// This is the NEW heartbeat endpoint. Legacy agent-api keeps running untouched.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { extractHmacRequest, verifyHmacRequest } from "../_shared/hmac.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const NEXT_CHECK_IN_SECONDS = 60;

type HeartbeatBody = {
    os_version?: string;
    os_build?: string;
    defender_version?: string;
    agent_version?: string;
};

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

    if (request.method !== "POST") {
        return jsonResponse({ error: "method_not_allowed" }, 405, origin);
    }

    const hmacReq = await extractHmacRequest(request);
    if (!hmacReq) {
        return jsonResponse({ error: "missing_hmac_headers" }, 401, origin);
    }

    const { data: endpoint, error: lookupErr } = await supabase
        .from("endpoints")
        .select("id, agent_secret, is_active")
        .eq("id", hmacReq.agentId)
        .maybeSingle();

    if (lookupErr) {
        console.error("endpoint lookup failed", lookupErr);
        return jsonResponse({ error: "internal" }, 500, origin);
    }
    if (!endpoint || !endpoint.agent_secret || !endpoint.is_active) {
        return jsonResponse({ error: "agent_unknown_or_inactive" }, 401, origin);
    }

    const verification = await verifyHmacRequest(hmacReq, endpoint.agent_secret);
    if (!verification.ok) {
        return jsonResponse({ error: "hmac_invalid", reason: verification.reason }, 401, origin);
    }

    let body: HeartbeatBody = {};
    if (hmacReq.rawBody) {
        try {
            body = JSON.parse(hmacReq.rawBody);
        } catch {
            return jsonResponse({ error: "invalid_json" }, 400, origin);
        }
    }

    const updates: Record<string, unknown> = {
        last_seen_at: new Date().toISOString(),
        is_online: true,
        updated_at: new Date().toISOString(),
    };
    if (body.os_version) updates.os_version = body.os_version;
    if (body.os_build) updates.os_build = body.os_build;
    if (body.defender_version) updates.defender_version = body.defender_version;
    if (body.agent_version) updates.agent_version = body.agent_version;

    const { error: updateErr } = await supabase
        .from("endpoints")
        .update(updates)
        .eq("id", endpoint.id);

    if (updateErr) {
        console.error("heartbeat update failed", updateErr);
        return jsonResponse({ error: "update_failed" }, 500, origin);
    }

    // Phase 3 will populate commands here from agent_commands table.
    return jsonResponse({ commands: [], next_check_in: NEXT_CHECK_IN_SECONDS }, 200, origin);
});
