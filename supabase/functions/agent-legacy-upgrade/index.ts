// agent-legacy-upgrade -- one-shot HMAC bootstrap for legacy bearer-token agents.
//
// Called by install-agent.ps1 when migrating an old v2.x monolith install
// (config.dat missing, agent.json with bearer token present). Returns the
// existing endpoint's agent_id plus a freshly-generated agent_secret so the
// new modular agent can heartbeat via HMAC without creating a duplicate
// endpoint.
//
// Auth: the legacy x-agent-token IS the authorization. Anyone with the
// token already has full agent-API access via /agent-api/* so this RPC
// doesn't widen the blast radius. Idempotent.
//
// POST /functions/v1/agent-legacy-upgrade
//   Headers: x-agent-token: <legacy token>
//   Body:    {} (empty -- the token is all we need)
//   Response 200: { agent_id, agent_secret, api_base_url, already_upgraded }
//   Response 401 on missing/unknown token
//   Response 410 if the endpoint has been soft-deleted

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-agent-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PUBLIC_API_BASE_URL = Deno.env.get("PUBLIC_API_BASE_URL") ?? "https://api.mithras.com.au";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const legacyToken = req.headers.get("x-agent-token");
  if (!legacyToken || legacyToken.trim().length === 0) {
    return new Response(JSON.stringify({ error: "missing_agent_token" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { data, error } = await supabase.rpc("agent_legacy_upgrade", {
      p_legacy_token: legacyToken,
      p_api_base_url: PUBLIC_API_BASE_URL,
    });

    if (error) {
      const msg = String(error.message ?? "");
      if (msg.includes("token_not_found")) {
        return new Response(JSON.stringify({ error: "token_not_found" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (msg.includes("endpoint_soft_deleted")) {
        return new Response(JSON.stringify({ error: "endpoint_soft_deleted" }), {
          status: 410,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.error("[agent-legacy-upgrade] RPC error:", error);
      return new Response(JSON.stringify({ error: "rpc_failed", detail: msg }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.out_agent_id || !row?.out_agent_secret) {
      console.error("[agent-legacy-upgrade] RPC returned no row");
      return new Response(JSON.stringify({ error: "rpc_empty" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        agent_id:         row.out_agent_id,
        agent_secret:     row.out_agent_secret,
        api_base_url:     row.out_api_base_url,
        already_upgraded: row.out_already_upgraded === true,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    console.error("[agent-legacy-upgrade] unexpected:", e);
    return new Response(
      JSON.stringify({ error: "unexpected", detail: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
