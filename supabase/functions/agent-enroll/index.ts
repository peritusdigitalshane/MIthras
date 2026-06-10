// POST /functions/v1/agent-enroll
// Body: { enrollment_token: string, hostname: string, os_version?: string, os_build?: string, runtime?: 'powershell'|'dotnet'|'linux'|'macos' }
// Response 200: { agent_id: string, agent_secret: string, api_base_url: string, update_channel: string }
// Response 400/401/410 on bad / used / expired token
//
// One-way: agent_secret is returned exactly once, never retrievable again.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Default to the public HTTPS hostname. apidev.peritusdigital.com.au only has HTTP:80
// in Caddy so it isn't usable as an agent base URL — using that as a default previously
// persisted broken URLs into freshly-enrolled agent configs.
const PUBLIC_API_BASE = Deno.env.get("PUBLIC_API_BASE_URL") ?? "https://api.mithras.com.au";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

type EnrollBody = {
    enrollment_token?: string;
    hostname?: string;
    os_version?: string;
    os_build?: string;
    runtime?: "powershell" | "dotnet" | "linux" | "macos";
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
    if (body.runtime && !["powershell", "dotnet", "linux", "macos"].includes(body.runtime)) {
        return jsonResponse({ error: "invalid_runtime" }, 400, origin);
    }

    // Atomically reserve a slot on the token. Returns the row's metadata if a
    // slot was available, or an empty array if the token is exhausted/expired.
    // This is race-free: the DB-side UPDATE has WHERE use_count < max_uses.
    const { data: reservedRows, error: reserveErr } = await supabase
        .rpc("reserve_enrollment_slot", { p_token: token });

    if (reserveErr) {
        console.error("reserve_enrollment_slot failed", reserveErr);
        return jsonResponse({ error: "internal" }, 500, origin);
    }
    if (!reservedRows || reservedRows.length === 0) {
        // Either token doesn't exist, has expired, or is out of slots — distinguish
        // for a better client error message.
        const { data: probe } = await supabase
            .from("enrollment_tokens")
            .select("expires_at, use_count, max_uses")
            .eq("token", token)
            .maybeSingle();
        if (!probe) return jsonResponse({ error: "token_invalid" }, 401, origin);
        if (new Date(probe.expires_at).getTime() < Date.now()) {
            return jsonResponse({ error: "token_expired" }, 410, origin);
        }
        return jsonResponse({ error: "token_exhausted", max_uses: probe.max_uses, use_count: probe.use_count }, 410, origin);
    }

    const reserved = reservedRows[0];

    // B1 fix: enforce per-org device quota (plan_features.max_devices) before
    // we mint a new endpoint row. can_add_device returns true for partner-child
    // orgs (they inherit business-plan quota), null max_devices (unlimited
    // plans), or when current_count < max_allowed.
    {
        const { data: allowed, error: quotaErr } = await supabase
            .rpc("can_add_device", { _org_id: reserved.organization_id });
        if (quotaErr) {
            console.error("can_add_device check failed", quotaErr);
            return jsonResponse({ error: "internal" }, 500, origin);
        }
        if (allowed === false) {
            return jsonResponse({
                error: "device_quota_exhausted",
                hint: "Org has hit its plan's max_devices limit. Upgrade plan or remove an existing endpoint.",
            }, 402, origin);
        }
    }

    const runtime = body.runtime ?? reserved.runtime_hint ?? "powershell";
    const agentSecret = generateSecret();
    const legacyAgentToken = base64UrlEncode(crypto.getRandomValues(new Uint8Array(24)));

    const { data: endpoint, error: insertErr } = await supabase
        .from("endpoints")
        .insert({
            organization_id: reserved.organization_id,
            agent_token: legacyAgentToken,
            agent_secret: agentSecret,
            enrolled_via: token,
            enrolled_at: new Date().toISOString(),
            hostname,
            os_version: body.os_version ?? null,
            os_build: body.os_build ?? null,
            runtime,
            update_channel: reserved.channel,
            is_active: true,
        })
        .select("id")
        .single();

    if (insertErr || !endpoint) {
        console.error("endpoint insert failed after slot reservation", insertErr);
        // The slot is already consumed; we accept it as a wasted slot rather than
        // attempting a non-atomic rollback that could race with concurrent enrols.
        return jsonResponse({ error: "enroll_failed" }, 500, origin);
    }

    // Record the most-recent enroller for audit. used_at was set by the reserve
    // helper when the final slot was taken.
    const { error: tagErr } = await supabase
        .from("enrollment_tokens")
        .update({ used_by_endpoint: endpoint.id })
        .eq("token", token);
    if (tagErr) {
        console.error("enrollment_tokens used_by_endpoint update failed (non-fatal)", tagErr);
    }

    // Credit consumption: charge 1 credit to the parent reseller (if this
    // endpoint belongs to a reseller-owned customer org). RPC short-circuits
    // for home-user / direct customers — they don't draw from a reseller pool.
    // Non-fatal: enrolment succeeds even if the credit charge fails; the
    // monthly cron will reconcile on the 1st.
    const { error: creditErr } = await supabase.rpc("consume_credit_for_endpoint_enrolment", {
        _endpoint_id: endpoint.id,
    });
    if (creditErr) {
        console.error("credit consume failed (non-fatal — monthly cron will reconcile)", creditErr);
    }

    return jsonResponse({
        agent_id: endpoint.id,
        agent_secret: agentSecret,
        api_base_url: PUBLIC_API_BASE,
        update_channel: reserved.channel,
        slot_used: reserved.use_count,
        max_uses: reserved.max_uses,
    }, 200, origin);
});
