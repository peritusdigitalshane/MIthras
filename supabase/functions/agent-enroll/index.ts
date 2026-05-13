// POST /functions/v1/agent-enroll
// Body: { enrollment_token: string, hostname: string, os_version?: string, os_build?: string, runtime?: 'powershell'|'dotnet' }
// Response 200: { agent_id: string, agent_secret: string, api_base_url: string, update_channel: string }
// Response 400/401/410 on bad / used / expired token
//
// One-way: agent_secret is returned exactly once, never retrievable again.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PUBLIC_API_BASE = Deno.env.get("PUBLIC_API_BASE_URL") ?? "https://apidev.peritusdigital.com.au";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

type EnrollBody = {
    enrollment_token?: string;
    hostname?: string;
    os_version?: string;
    os_build?: string;
    runtime?: "powershell" | "dotnet";
};

function base64UrlEncode(bytes: Uint8Array): string {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateSecret(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return base64UrlEncode(bytes);
}

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

    let body: EnrollBody;
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: "invalid_json" }, 400, origin);
    }

    const token = body.enrollment_token?.trim();
    const hostname = body.hostname?.trim();
    if (!token || !hostname) {
        return jsonResponse({ error: "missing_fields", required: ["enrollment_token", "hostname"] }, 400, origin);
    }
    if (body.runtime && body.runtime !== "powershell" && body.runtime !== "dotnet") {
        return jsonResponse({ error: "invalid_runtime" }, 400, origin);
    }

    // Look up the token.
    const { data: tokenRow, error: tokenErr } = await supabase
        .from("enrollment_tokens")
        .select("token, organization_id, expires_at, used_at, runtime_hint, channel")
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

    const runtime = body.runtime ?? tokenRow.runtime_hint ?? "powershell";
    const agentSecret = generateSecret();
    // Legacy agent_token kept populated so logs / existing UI keep working.
    const legacyAgentToken = base64UrlEncode(crypto.getRandomValues(new Uint8Array(24)));

    // Insert endpoint row first so we have its id to update the token row.
    const { data: endpoint, error: insertErr } = await supabase
        .from("endpoints")
        .insert({
            organization_id: tokenRow.organization_id,
            agent_token: legacyAgentToken,
            agent_secret: agentSecret,
            enrolled_via: token,
            enrolled_at: new Date().toISOString(),
            hostname,
            os_version: body.os_version ?? null,
            os_build: body.os_build ?? null,
            runtime,
            update_channel: tokenRow.channel,
            is_active: true,
        })
        .select("id")
        .single();

    if (insertErr || !endpoint) {
        console.error("endpoint insert failed", insertErr);
        return jsonResponse({ error: "enroll_failed" }, 500, origin);
    }

    // Mark token used. If this fails the agent is already enrolled — the token row will be cleaned
    // up by an admin if needed; we still return success to the agent.
    const { error: updateErr } = await supabase
        .from("enrollment_tokens")
        .update({ used_at: new Date().toISOString(), used_by_endpoint: endpoint.id })
        .eq("token", token)
        .is("used_at", null);   // double-checked locking — if another concurrent enroll won, this updates 0 rows

    if (updateErr) {
        console.error("enrollment_tokens update failed (non-fatal)", updateErr);
    }

    return jsonResponse({
        agent_id: endpoint.id,
        agent_secret: agentSecret,
        api_base_url: PUBLIC_API_BASE,
        update_channel: tokenRow.channel,
    }, 200, origin);
});
