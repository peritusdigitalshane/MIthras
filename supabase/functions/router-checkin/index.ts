import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  // Reject non-POST early so health probes (GETs) don't trip the JSON.parse
  // below and surface as a misleading 500 on the System Health dashboard.
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "method_not_allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json", "Allow": "POST, OPTIONS" } }
    );
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const body = await req.json();

    // Two flows: enroll (new router) or heartbeat (existing router)
    const { action } = body;

    if (action === "enroll") {
      return await handleEnroll(supabase, body);
    } else if (action === "heartbeat") {
      return await handleHeartbeat(supabase, body);
    } else {
      return new Response(
        JSON.stringify({ error: "Invalid action. Use 'enroll' or 'heartbeat'." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (err: any) {
    console.error("Router checkin error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function handleEnroll(supabase: any, body: any) {
  const { enrollment_token, hostname, vendor, model, management_ip, wan_ip, lan_subnets, firmware_version, serial_number, site_name, location } = body;

  if (!enrollment_token || !hostname || !vendor) {
    return new Response(
      JSON.stringify({ error: "enrollment_token, hostname, and vendor are required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Validate enrollment token
  const { data: token, error: tokenErr } = await supabase
    .from("router_enrollment_tokens")
    .select("*")
    .eq("token", enrollment_token)
    .eq("is_active", true)
    .single();

  if (tokenErr || !token) {
    return new Response(
      JSON.stringify({ error: "Invalid or expired enrollment token" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Check expiry
  if (token.expires_at && new Date(token.expires_at) < new Date()) {
    return new Response(
      JSON.stringify({ error: "Enrollment token has expired" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Check max uses
  if (token.max_uses && token.use_count >= token.max_uses) {
    return new Response(
      JSON.stringify({ error: "Enrollment token has reached maximum uses" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Generate agent token for this router
  const agentToken = crypto.randomUUID() + "-" + crypto.randomUUID();

  // Create router
  const { data: router, error: routerErr } = await supabase
    .from("routers")
    .insert({
      organization_id: token.organization_id,
      hostname,
      vendor,
      model: model || null,
      management_ip: management_ip || null,
      wan_ip: wan_ip || null,
      lan_subnets: lan_subnets || null,
      firmware_version: firmware_version || null,
      serial_number: serial_number || null,
      site_name: site_name || null,
      location: location || null,
      is_online: true,
      last_seen_at: new Date().toISOString(),
      agent_token: agentToken,
      config_profile: {},
    })
    .select()
    .single();

  if (routerErr) {
    return new Response(
      JSON.stringify({ error: routerErr.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Increment use count
  await supabase
    .from("router_enrollment_tokens")
    .update({ use_count: token.use_count + 1 })
    .eq("id", token.id);

  return new Response(
    JSON.stringify({
      success: true,
      router_id: router.id,
      agent_token: agentToken,
      message: "Router enrolled successfully. Use agent_token for future heartbeats.",
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function handleHeartbeat(supabase: any, body: any) {
  const { agent_token, wan_ip, firmware_version, is_online } = body;

  if (!agent_token) {
    return new Response(
      JSON.stringify({ error: "agent_token is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const updates: Record<string, any> = {
    last_seen_at: new Date().toISOString(),
    is_online: is_online !== false,
  };
  if (wan_ip) updates.wan_ip = wan_ip;
  if (firmware_version) updates.firmware_version = firmware_version;

  const { data, error } = await supabase
    .from("routers")
    .update(updates)
    .eq("agent_token", agent_token)
    .select("id, hostname")
    .single();

  if (error || !data) {
    return new Response(
      JSON.stringify({ error: "Invalid agent token" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ success: true, router_id: data.id, hostname: data.hostname }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
