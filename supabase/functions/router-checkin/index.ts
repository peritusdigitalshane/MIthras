// =============================================================================
// /functions/v1/router-checkin
//
// Two flows for network devices:
//   action=enroll     — redeem an enrolment token, receive a bearer agent token
//   action=heartbeat  — report liveness with that bearer token
//
// v0.7.21 hardening:
//   * Both credentials are now hashed at rest. The enrolment token and the
//     router agent token used to be stored and compared in PLAINTEXT, so any
//     read of the database -- a dump, a backup, the BYPASSRLS grafana_reader
//     role, a SQL-injection anywhere -- yielded working router credentials.
//     Lookups go through SECURITY DEFINER RPCs that hash the presented value.
//     See 20260909030000_hash_router_tokens_at_rest.sql.
//   * Enrolment slot reservation is atomic. The previous read-then-write
//     (`use_count: token.use_count + 1`) let concurrent enrolments exceed
//     max_uses.
//   * Internal error text is no longer returned to callers. `routerErr.message`
//     and `err.message` were being echoed straight into the response body.
//   * CORS uses the shared allow-list helper instead of "*".
//
// Note the agent token is generated with crypto.getRandomValues (256 bits)
// rather than two concatenated UUIDs -- UUIDv4 carries 122 bits of entropy in
// 36 characters and reads like an identifier rather than a secret.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";

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

function generateAgentToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  const origin = req.headers.get("origin");

  // Reject non-POST early so health probes (GETs) don't trip the JSON.parse
  // below and surface as a misleading 500 on the System Health dashboard.
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: {
        "content-type": "application/json",
        Allow: "POST, OPTIONS",
        ...(buildCorsHeaders(origin) as Record<string, string>),
      },
    });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400, origin);
  }

  try {
    const action = String(body.action ?? "");
    if (action === "enroll") return await handleEnroll(body, origin);
    if (action === "heartbeat") return await handleHeartbeat(body, origin);
    return jsonResponse({ error: "invalid_action", expected: ["enroll", "heartbeat"] }, 400, origin);
  } catch (err) {
    // Log the detail; return a generic message. The previous version echoed
    // err.message to the caller, leaking Postgres error text and column names
    // to an unauthenticated endpoint.
    console.error("router-checkin unhandled error:", err instanceof Error ? err.message : String(err));
    return jsonResponse({ error: "internal" }, 500, origin);
  }
});

async function handleEnroll(body: Record<string, unknown>, origin: string | null): Promise<Response> {
  const enrollmentToken = String(body.enrollment_token ?? "").trim();
  const hostname = String(body.hostname ?? "").trim();
  const vendor = String(body.vendor ?? "").trim();

  if (!enrollmentToken || !hostname || !vendor) {
    return jsonResponse(
      { error: "missing_required_fields", required: ["enrollment_token", "hostname", "vendor"] },
      400,
      origin,
    );
  }

  // Atomic: hashes the presented token, checks active/expiry/max_uses, and
  // takes the slot in one locked UPDATE. Zero rows back means unknown,
  // inactive, expired or exhausted -- deliberately indistinguishable.
  const { data: reserved, error: reserveErr } = await supabase.rpc("reserve_router_enrollment_slot", {
    p_token: enrollmentToken,
  });
  if (reserveErr) {
    console.error("reserve_router_enrollment_slot failed:", reserveErr.message);
    return jsonResponse({ error: "internal" }, 500, origin);
  }
  const slot = Array.isArray(reserved) ? reserved[0] : reserved;
  if (!slot) {
    return jsonResponse({ error: "invalid_or_expired_enrollment_token" }, 401, origin);
  }

  const agentToken = generateAgentToken();
  const agentTokenHash = await sha256Hex(agentToken);

  const optionalText = (k: string): string | null => {
    const v = body[k];
    if (v === undefined || v === null || v === "") return null;
    return String(v);
  };

  const { data: router, error: routerErr } = await supabase
    .from("routers")
    .insert({
      organization_id: slot.organization_id,
      hostname,
      vendor,
      model: optionalText("model"),
      management_ip: optionalText("management_ip"),
      wan_ip: optionalText("wan_ip"),
      lan_subnets: body.lan_subnets ?? null,
      firmware_version: optionalText("firmware_version"),
      serial_number: optionalText("serial_number"),
      site_name: optionalText("site_name"),
      location: optionalText("location"),
      is_online: true,
      last_seen_at: new Date().toISOString(),
      agent_token_hash: agentTokenHash,
      config_profile: {},
    })
    .select("id, hostname")
    .single();

  if (routerErr || !router) {
    console.error("router insert failed:", routerErr?.message);
    return jsonResponse({ error: "enrollment_failed" }, 500, origin);
  }

  // The plaintext agent token exists here and nowhere else. It is returned
  // once and only the hash is retained.
  return jsonResponse(
    {
      success: true,
      router_id: router.id,
      agent_token: agentToken,
      message: "Router enrolled. Store agent_token now — it cannot be retrieved again.",
    },
    200,
    origin,
  );
}

async function handleHeartbeat(body: Record<string, unknown>, origin: string | null): Promise<Response> {
  const agentToken = String(body.agent_token ?? "").trim();
  if (!agentToken) {
    return jsonResponse({ error: "agent_token_required" }, 400, origin);
  }

  const isOnline = body.is_online !== false;

  // Hashes the presented token, matches, and stamps last_seen_at in one
  // statement. Returns zero rows for an unknown token.
  const { data, error } = await supabase.rpc("router_heartbeat_by_token", {
    p_token: agentToken,
    p_wan_ip: body.wan_ip ? String(body.wan_ip) : null,
    p_firmware_version: body.firmware_version ? String(body.firmware_version) : null,
    p_is_online: isOnline,
  });

  if (error) {
    console.error("router_heartbeat_by_token failed:", error.message);
    return jsonResponse({ error: "internal" }, 500, origin);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return jsonResponse({ error: "invalid_agent_token" }, 401, origin);
  }

  return jsonResponse({ success: true, router_id: row.id, hostname: row.hostname }, 200, origin);
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
