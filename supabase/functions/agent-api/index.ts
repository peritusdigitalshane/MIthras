import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Version for deployment verification - bump to trigger agent updates
const VERSION = "v2.19.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-agent-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Rate limiting for chatty endpoints - prevents duplicate submissions within window
const rateLimitMap = new Map<string, number>();
const RATE_LIMIT_MS = 10000; // 10 seconds minimum between heartbeats per endpoint

// C1 fix: partition rate-limit keys by organization_id so a compromised
// endpoint from Org A cannot evict the rate-limit slots of Org B endpoints
// whose UUIDs it has observed.
function checkRateLimit(orgId: string, endpointId: string, action: string): boolean {
  const key = `${orgId}:${endpointId}:${action}`;
  const now = Date.now();
  const lastRequest = rateLimitMap.get(key) || 0;
  if (now - lastRequest < RATE_LIMIT_MS) {
    return false; // Rate limited
  }
  rateLimitMap.set(key, now);
  // Clean up old entries periodically (keep map from growing indefinitely)
  if (rateLimitMap.size > 1000) {
    const cutoff = now - RATE_LIMIT_MS * 2;
    for (const [k, v] of rateLimitMap.entries()) {
      if (v < cutoff) rateLimitMap.delete(k);
    }
  }
  return true;
}

type ParsedThreatFromEventLog = {
  threat_id: string;
  threat_name: string;
  severity: string;
  category: string | null;
  status: string;
  initial_detection_time: string | null;
  last_threat_status_change_time: string | null;
  resources: unknown | null;
  raw_data: unknown;
};

// Map Windows Defender severity IDs to human-readable values
// https://learn.microsoft.com/en-us/windows/client-management/mdm/defender-csp
function mapSeverityFromMessage(msg: string, threatName: string): string {
  // Try to extract severity from message first
  const severityMatch = msg.match(/^\s*Severity:\s*(.+)$/mi)?.[1]?.trim();
  if (severityMatch && severityMatch.toLowerCase() !== "unknown") {
    return severityMatch;
  }
  
  // Map severity ID if present (Defender uses 1=Low, 2=Moderate, 4=High, 5=Severe)
  const severityIdMatch = msg.match(/severityid[=:]?\s*(\d+)/i)?.[1];
  if (severityIdMatch) {
    const id = parseInt(severityIdMatch, 10);
    switch (id) {
      case 1: return "Low";
      case 2: return "Moderate";
      case 4: return "High";
      case 5: return "Severe";
      default: return "Unknown";
    }
  }
  
  // Infer severity from well-known threat patterns
  const nameLower = threatName.toLowerCase();
  
  // Test files and PUAs are typically Low severity
  if (nameLower.includes("eicar") || nameLower.includes("test_file")) return "Low";
  if (nameLower.includes("pua:") || nameLower.includes("potentially unwanted")) return "Low";
  
  // Ransomware, exploits, and trojans are typically Severe
  if (nameLower.includes("ransom") || nameLower.includes("exploit") || 
      nameLower.includes("trojan") || nameLower.includes("backdoor")) return "Severe";
  
  // Viruses are typically High
  if (nameLower.includes("virus:")) return "High";
  
  // Worms and password stealers are High
  if (nameLower.includes("worm:") || nameLower.includes("pwstealer")) return "High";
  
  return "Unknown";
}

function parseDefenderThreatFromEventMessage(params: {
  event_id: number;
  event_time: string;
  message: string;
  raw_data: unknown;
}): ParsedThreatFromEventLog | null {
  const { event_id, event_time, message, raw_data } = params;
  const msg = String(message || "");
  if (!msg) return null;

  // These event IDs commonly carry threat detection/action details.
  // (1116/1117 are frequently seen for EICAR.)
  const isThreatLikeEvent = [1005, 1006, 1007, 1008, 1009, 1116, 1117, 1118, 1119].includes(event_id);
  if (!isThreatLikeEvent) return null;

  // Extract fields from the message body (best-effort; Defender formats vary by build).
  const threatName = (msg.match(/^\s*Name:\s*(.+)$/mi)?.[1] ||
    msg.match(/&name=([^&\s]+)/i)?.[1] ||
    "Unknown").trim();

  const threatId = (
    msg.match(/threatid=(\d+)/i)?.[1] ||
    msg.match(/^\s*ID:\s*(\d+)\s*$/mi)?.[1] ||
    null
  );

  if (!threatId) return null;

  const severity = mapSeverityFromMessage(msg, threatName);
  const category = (msg.match(/^\s*Category:\s*(.+)$/mi)?.[1] || "").trim() || null;
  const path = (msg.match(/^\s*Path:\s*(.+)$/mi)?.[1] || "").trim();

  // Derive a normalized status. (Threats UI treats Blocked/Removed/Resolved as healthy.)
  let status = "Active";
  if (event_id === 1009) status = "Quarantined";
  if ([1006, 1117].includes(event_id)) status = "Blocked";
  if ([1007, 1118, 1119].includes(event_id)) status = "Active";
  if (/quarantin/i.test(msg)) status = "Quarantined";
  if (/removed/i.test(msg)) status = "Removed";
  if (/blocked/i.test(msg) || /has taken action/i.test(msg)) status = "Blocked";

  return {
    threat_id: String(threatId),
    threat_name: threatName,
    severity,
    category,
    status,
    initial_detection_time: event_time || null,
    last_threat_status_change_time: event_time || null,
    resources: path ? [path] : null,
    raw_data: {
      source: "defender_event_log",
      event_id,
      event_time,
      message,
      raw_data,
    },
  };
}

// Coerce agent numeric fields to Postgres int4 safely.
// Some Windows APIs use UINT32 max (4294967295) as a sentinel for "unknown".
function toInt32OrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;

  // Common "unknown" sentinel values
  if (n === 4294967295 || n === -1) return null;

  // int4 range
  if (n > 2147483647 || n < -2147483648) return null;

  return Math.trunc(n);
}

function toTimestampOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Allow ISO strings; DB will validate.
  return trimmed;
}

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    // Decode the path to handle agents that URL-encode the '?' (e.g. v2.17.0 sends
    // /agent-update%3Fversion=2.17.0 instead of /agent-update?version=2.17.0).
    const rawPath = decodeURIComponent(url.pathname).replace("/agent-api", "");
    // If the decoded path contains '?', split it out and merge into url.searchParams
    const qIdx = rawPath.indexOf("?");
    const path = qIdx >= 0 ? rawPath.substring(0, qIdx) : rawPath;
    if (qIdx >= 0) {
      const extraParams = new URLSearchParams(rawPath.substring(qIdx + 1));
      for (const [k, v] of extraParams) {
        if (!url.searchParams.has(k)) url.searchParams.set(k, v);
      }
    }

    // Route: POST /register - Register a new endpoint
    if (path === "/register" && req.method === "POST") {
      return await handleRegister(req);
    }

    // Route: POST /heartbeat - Send status update
    if (path === "/heartbeat" && req.method === "POST") {
      return await handleHeartbeat(req);
    }

    // Route: POST /threats - Report threats
    if (path === "/threats" && req.method === "POST") {
      return await handleThreats(req);
    }

    // Route: POST /logs - Report event logs
    if (path === "/logs" && req.method === "POST") {
      return await handleLogs(req);
    }

    // Route: POST /apps - Report discovered applications
    if (path === "/apps" && req.method === "POST") {
      return await handleApps(req);
    }

    // Route: POST /software-inventory - Report installed software
    if (path === "/software-inventory" && req.method === "POST") {
      return await handleSoftwareInventory(req);
    }

    // Route: POST /firewall-logs - Report firewall audit logs
    if (path === "/firewall-logs" && req.method === "POST") {
      return await handleFirewallLogs(req);
    }

    // Route: POST /sysmon-events - Report Sysmon process/network/file events
    if (path === "/sysmon-events" && req.method === "POST") {
      return await handleSysmonEvents(req);
    }

    // Route: GET /mesh-config - MeshCentral group config for install_mesh_agent
    if (path === "/mesh-config" && req.method === "GET") {
      return await handleGetMeshConfig(req);
    }

    // Route: GET /dns-policy - Fetch the DNS policy assigned to this endpoint
    if (path === "/dns-policy" && req.method === "GET") {
      return await handleGetDnsPolicy(req);
    }

    // Route: GET /firewall-policy - Get assigned firewall policy and rules
    if (path === "/firewall-policy" && req.method === "GET") {
      return await handleGetFirewallPolicy(req);
    }

    // Route: GET /policy - Get assigned policy
    if (path === "/policy" && req.method === "GET") {
      return await handleGetPolicy(req);
    }

    // Route: GET /wdac-policy - Get assigned WDAC policy with rules
    if (path === "/wdac-policy" && req.method === "GET") {
      return await handleGetWdacPolicy(req);
    }

    // Route: GET /rule-sets - Get all rule sets and rules for this endpoint (new system)
    if (path === "/rule-sets" && req.method === "GET") {
      return await handleGetRuleSets(req);
    }

    // Route: GET /uac-policy - Get assigned UAC policy
    if (path === "/uac-policy" && req.method === "GET") {
      return await handleGetUacPolicy(req);
    }

    // Route: GET /windows-update-policy - Get assigned Windows Update policy
    if (path === "/windows-update-policy" && req.method === "GET") {
      return await handleGetWindowsUpdatePolicy(req);
    }

    // Route: GET /update-ring - Effective patch deployment ring for this endpoint
    if (path === "/update-ring" && req.method === "GET") {
      return await handleGetUpdateRing(req);
    }

    // Route: GET /gpo-policy - Get assigned GPO policy
    if (path === "/gpo-policy" && req.method === "GET") {
      return await handleGetGpoPolicy(req);
    }

    // Route: GET /status - Get full endpoint status for tray application
    if (path === "/status" && req.method === "GET") {
      return await handleGetStatus(req);
    }

    // Route: POST /command-result - Report command execution result
    if (path === "/command-result" && req.method === "POST") {
      return await handleCommandResult(req);
    }

    // Route: POST /health - Report agent health/errors
    if (path === "/health" && req.method === "POST") {
      return await handleHealthReport(req);
    }

    // Route: GET /agent-update - Check for agent updates and get new script
    if (path === "/agent-update" && req.method === "GET") {
      return await handleAgentUpdate(req);
    }

    // Route: GET /app-whitelist-policy - mode + rules for app whitelisting
    if (path === "/app-whitelist-policy" && req.method === "GET") {
      return await handleGetAppWhitelistPolicy(req);
    }

    // Route: POST /app-audit-logs - process-launch events (observed/allowed/blocked)
    if (path === "/app-audit-logs" && req.method === "POST") {
      return await handleAppAuditLogs(req);
    }

    // Route: POST /wdac-applied - agent reports CI policy apply result
    if (path === "/wdac-applied" && req.method === "POST") {
      return await handleWdacApplied(req);
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Agent API error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Generate a secure token for the agent
function generateAgentToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Validate agent token and return endpoint
async function validateAgentToken(req: Request) {
  const token = req.headers.get("x-agent-token");
  if (!token) {
    // Log only header NAMES. The previous version dumped every header value
    // except authorization, which put x-agent-token itself -- a live bearer
    // credential -- into the function logs on any malformed request.
    console.error(
      `[${VERSION}] validateAgentToken: no x-agent-token header. Headers present: ` +
      [...new Headers(req.headers).keys()].join(","),
    );
    throw new Error("Missing agent token");
  }

  const trimmedToken = token.trim();
  const { data: endpoint, error } = await supabase
    .from("endpoints")
    .select("*")
    .eq("agent_token", trimmedToken)
    .maybeSingle();

  if (error || !endpoint) {
    // No token prefix. 8 hex characters is 32 bits of a live credential and
    // logs are retained, exportable, and read by more people than the DB is.
    console.error(
      `[${VERSION}] validateAgentToken: lookup failed. tokenLength=${trimmedToken.length}, ` +
      `dbError=${error?.message || "none"}, found=${!!endpoint}`,
    );
    throw new Error("Invalid agent token");
  }

  // Reject deactivated endpoints. Previously this check was missing,
  // so a deactivated endpoint's bearer token kept fetching policies,
  // shipping firewall logs, and pulling WDAC rules indefinitely (the
  // HMAC path at agent-heartbeat already enforces this; legacy bearer
  // didn't, defeating revocation).
  if (endpoint.is_active === false) {
    console.error(`[${VERSION}] validateAgentToken: endpoint ${endpoint.id} is deactivated; rejecting`);
    throw new Error("Endpoint deactivated");
  }

  // A3 fix: gate on parent org's is_active / stripe_status. Cancelled
  // subscriptions previously kept phoning home indefinitely because the
  // legacy bearer path never joined organizations.
  const { data: org } = await supabase
    .from("organizations")
    .select("is_active, stripe_status, organization_type")
    .eq("id", endpoint.organization_id)
    .maybeSingle();
  if (!org || org.is_active === false) {
    throw new Error("Organization suspended");
  }
  if (org.organization_type === "home_user" && org.stripe_status && !["active","trialing","past_due"].includes(org.stripe_status)) {
    throw new Error(`Subscription ${org.stripe_status}`);
  }

  return endpoint;
}

// POST /register - Register a new endpoint
async function handleRegister(_req: Request): Promise<Response> {
  // disabled-legacy-register-410
  // Legacy UUID-as-token registration is permanently disabled. Use
  // /functions/v1/agent-enroll with a one-time enrollment token instead.
  return new Response(
    JSON.stringify({ error: "registration_disabled", hint: "Use /functions/v1/agent-enroll with an enrollment token" }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}


// POST /heartbeat - Receive status update from agent
async function handleHeartbeat(req: Request) {
  const endpoint = await validateAgentToken(req);
  const body = await req.json();

  // Rate limit heartbeats to reduce write pressure
  if (!checkRateLimit(endpoint.organization_id as string, endpoint.id, "heartbeat")) {
    return new Response(
      JSON.stringify({ success: true, message: "Heartbeat rate limited", rate_limited: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Detect agent version transitions BEFORE we overwrite the cached value.
  // Writes a row to agent_update_log per (old -> new) transition; tolerant
  // of the "no version reported" case so we don't double-log on null.
  if (body.agent_version && body.agent_version !== endpoint.agent_version) {
    try {
      await supabase.from("agent_update_log").insert({
        endpoint_id:     endpoint.id,
        organization_id: endpoint.organization_id,
        from_version:    endpoint.agent_version,
        to_version:      String(body.agent_version),
        trigger:         "heartbeat_detected",
        status:          "completed",
        completed_at:    new Date().toISOString(),
      });
      console.log(`[${VERSION}] agent_update_log: ${endpoint.id} ${endpoint.agent_version} -> ${body.agent_version}`);
    } catch (e) {
      console.error(`[${VERSION}] agent_update_log insert failed:`, e);
    }

  }

  // v0.7.20: continuous upgrade_agent auto-ack. Independent of the version
  // flip — runs on every heartbeat where the endpoint reports a version.
  //
  // The agent-side "save pending results to disk, recover on startup" dance
  // is fragile across service swaps; if the file write or read races the
  // SCM stop/start, the command sits in `dispatched` until the 45-minute
  // expiry cron buries it as a false "agent never reported back". Operators
  // then see successful upgrades reported as failures.
  //
  // Resilient fix: if the endpoint's reported version equals the command's
  // target_version, the upgrade clearly succeeded — ack it. Idempotent via
  // the .in(status, [queued, dispatched]) filter.
  if (body.agent_version) {
    try {
      const reportedVersion = String(body.agent_version);
      const { data: pending } = await supabase
        .from("agent_commands")
        .select("id, params, issued_at")
        .eq("endpoint_id",  endpoint.id)
        .eq("command_type", "upgrade_agent")
        .in("status",       ["queued", "dispatched"]);
      for (const cmd of (pending ?? []) as Array<{ id: string; params: { target_version?: string } | null; issued_at: string }>) {
        const target = cmd.params?.target_version;
        if (target && target === reportedVersion) {
          await supabase
            .from("agent_commands")
            .update({
              status:       "succeeded",
              completed_at: new Date().toISOString(),
              result:       { inferred_from: "agent_version_matches_target", reported_version: reportedVersion, target_version: target },
              error_message: null,
            })
            .eq("id",     cmd.id)
            .in("status", ["queued", "dispatched"]);
          console.log(`[${VERSION}] upgrade_agent ${cmd.id}: auto-ack — endpoint now at target ${target}`);
        }
      }
    } catch (e) {
      console.error(`[${VERSION}] upgrade_agent auto-ack failed:`, e);
    }
  }

  // Update endpoint last seen
  await supabase
    .from("endpoints")
    .update({
      last_seen_at: new Date().toISOString(),
      is_online: true,
      defender_version: body.defender_version || endpoint.defender_version,
      agent_version: body.agent_version || endpoint.agent_version,
    })
    .eq("id", endpoint.id);

  // Build status data for upsert
  const statusData = {
    endpoint_id: endpoint.id,
    collected_at: new Date().toISOString(),
    realtime_protection_enabled: body.realtime_protection_enabled,
    antivirus_enabled: body.antivirus_enabled,
    antispyware_enabled: body.antispyware_enabled,
    behavior_monitor_enabled: body.behavior_monitor_enabled,
    ioav_protection_enabled: body.ioav_protection_enabled,
    on_access_protection_enabled: body.on_access_protection_enabled,
    full_scan_age: toInt32OrNull(body.full_scan_age),
    quick_scan_age: toInt32OrNull(body.quick_scan_age),
    full_scan_end_time: toTimestampOrNull(body.full_scan_end_time),
    quick_scan_end_time: toTimestampOrNull(body.quick_scan_end_time),
    antivirus_signature_age: toInt32OrNull(body.antivirus_signature_age),
    antispyware_signature_age: toInt32OrNull(body.antispyware_signature_age),
    antivirus_signature_version: body.antivirus_signature_version,
    nis_signature_version: body.nis_signature_version,
    nis_enabled: body.nis_enabled,
    tamper_protection_source: body.tamper_protection_source,
    computer_state: toInt32OrNull(body.computer_state),
    am_running_mode: body.am_running_mode,
    raw_status: body.raw_status,
    // UAC status fields
    uac_enabled: body.uac_enabled ?? null,
    uac_consent_prompt_admin: toInt32OrNull(body.uac_consent_prompt_admin),
    uac_consent_prompt_user: toInt32OrNull(body.uac_consent_prompt_user),
    uac_prompt_on_secure_desktop: body.uac_prompt_on_secure_desktop ?? null,
    uac_detect_installations: body.uac_detect_installations ?? null,
    uac_validate_admin_signatures: body.uac_validate_admin_signatures ?? null,
    uac_filter_administrator_token: body.uac_filter_administrator_token ?? null,
    // Windows Update status fields
    wu_auto_update_mode: toInt32OrNull(body.wu_auto_update_mode),
    wu_active_hours_start: toInt32OrNull(body.wu_active_hours_start),
    wu_active_hours_end: toInt32OrNull(body.wu_active_hours_end),
    wu_feature_update_deferral: toInt32OrNull(body.wu_feature_update_deferral),
    wu_quality_update_deferral: toInt32OrNull(body.wu_quality_update_deferral),
    wu_pause_feature_updates: body.wu_pause_feature_updates ?? null,
    wu_pause_quality_updates: body.wu_pause_quality_updates ?? null,
    wu_pending_updates_count: toInt32OrNull(body.wu_pending_updates_count),
    wu_last_install_date: toTimestampOrNull(body.wu_last_install_date),
    wu_restart_pending: body.wu_restart_pending ?? null,
  };

  // Insert status record (we still insert new records for historical tracking,
  // but rate limiting above prevents excessive writes)
  const { error: statusError } = await supabase.from("endpoint_status").insert(statusData);

  if (statusError) {
    console.error("Error inserting status:", statusError);
  }

  // Fetch organization settings to inform the agent about enabled modules
  const { data: org } = await supabase
    .from("organizations")
    .select("network_module_enabled")
    .eq("id", endpoint.organization_id)
    .single();

  // Record incoming command results — the agent batches them and ships in
  // the next heartbeat after execution. Idempotent: we accept whatever the
  // agent says, scoped to this endpoint, and short-circuit if the row is
  // already in a terminal state.
  if (Array.isArray(body.command_results) && body.command_results.length > 0) {
    for (const r of body.command_results as any[]) {
      if (!r || !r.id) continue;
      const status = r.status === "succeeded" ? "succeeded"
                   : r.status === "failed"    ? "failed"
                   : null;
      if (!status) continue;
      const errorMessage = typeof r.error === "string" ? r.error : null;
      const result = r.result ?? null;
      const { error: resErr } = await supabase
        .from("agent_commands")
        .update({
          status,
          completed_at: new Date().toISOString(),
          result,
          error_message: errorMessage,
        })
        .eq("id", r.id)
        .eq("endpoint_id", endpoint.id)
        .in("status", ["queued", "dispatched"]);
      if (resErr) console.error(`[heartbeat] command-result update ${r.id}:`, resErr);
    }
  }

  // PoC rec #10: the agent ships Defender threats inside the heartbeat
  // payload but the previous code silently dropped them -- /threats was a
  // dead route. Process them here so endpoint_threats actually reflects
  // current Defender state.
  if (Array.isArray(body.threats) && body.threats.length > 0) {
    try {
      const n = await ingestThreats(endpoint.id, body.threats);
      if (n > 0) console.log(`[${VERSION}] heartbeat ingested ${n} threats for endpoint ${endpoint.id}`);
    } catch (e) {
      console.error(`[${VERSION}] threat ingest failed in heartbeat:`, e);
    }
  }

  // v0.6.5: tamper-protection events. SCM events 7034/7036/7040/7045 on the
  // MithrasAgent service. Each lands in alerts as alert_type='tamper_attempt'.
  if (Array.isArray(body.tamper_events) && body.tamper_events.length > 0) {
    try {
      const n = await ingestTamperEvents(endpoint.id, endpoint.organization_id, body.tamper_events);
      if (n > 0) console.log(`[${VERSION}] heartbeat ingested ${n} tamper_events for endpoint ${endpoint.id}`);
    } catch (e) {
      console.error(`[${VERSION}] tamper_events ingest failed in heartbeat:`, e);
    }
  }

  // v0.6.6: ransomware canary trips. Each canary file the agent monitored
  // that was modified or deleted lands as a critical alert.
  if (Array.isArray(body.canary_events) && body.canary_events.length > 0) {
    try {
      const n = await ingestCanaryEvents(endpoint.id, endpoint.organization_id, body.canary_events);
      if (n > 0) console.log(`[${VERSION}] heartbeat ingested ${n} canary_events for endpoint ${endpoint.id}`);
    } catch (e) {
      console.error(`[${VERSION}] canary_events ingest failed in heartbeat:`, e);
    }
  }

  // v0.6.6: Defender state snapshot. Latest-wins -- stamps endpoints row.
  if (body.defender_state && typeof body.defender_state === 'object') {
    try {
      await supabase.from('endpoints').update({
        defender_state:            body.defender_state,
        defender_state_updated_at: new Date().toISOString(),
      }).eq('id', endpoint.id);
    } catch (e) {
      console.error(`[${VERSION}] defender_state update failed:`, e);
    }
  }

  // v0.6.6: REMOVED auto-queue of upgrade_agent. Upgrades are now operator-
  // driven via the Upgrade button on the endpoint detail page in the SOC
  // console. Server only stamps `latest_version` in the response so the UI
  // can show "upgrade available" -- it does NOT enqueue an upgrade command
  // automatically. This prevents a bad release from cascading across the
  // fleet without operator review. See `maybeQueueAgentUpgrade` below --
  // function retained so we can re-enable per-org auto-update opt-in later,
  // but it's no longer called from the heartbeat path.

  // Fetch queued commands for this endpoint, then atomically flip them to
  // dispatched. The previous code targeted a stale `endpoint_commands` table
  // with the wrong column names — agent_commands is the real table created
  // by the Phase 1 migration. Respect expires_at so stuck queue rows can't
  // be replayed indefinitely.
  const { data: pendingCommands } = await supabase
    .from("agent_commands")
    .select("id, command_type, params")
    .eq("endpoint_id", endpoint.id)
    .eq("status", "queued")
    .or("expires_at.is.null,expires_at.gt." + new Date().toISOString())
    .order("issued_at", { ascending: true })
    .limit(10);

  if (pendingCommands && pendingCommands.length > 0) {
    const commandIds = pendingCommands.map((c: any) => c.id);
    await supabase
      .from("agent_commands")
      .update({ status: "dispatched", dispatched_at: new Date().toISOString() })
      .in("id", commandIds);
  }

  // Embed the current latest stable version in every heartbeat response so
  // legacy bearer-token agents can see what they should be running. Modern
  // (>=0.5.0) agents have their own /agent-version-check HMAC path, but
  // exposing it here too means a single source of truth and lets the UI
  // surface "upgrade available" without an extra round trip.
  const reportedVersion = body.agent_version || endpoint.agent_version || null;
  let latestVersionPayload: Record<string, unknown> | null = null;
  try {
    const { data: latest } = await supabase
      .from("agent_versions")
      .select("version, download_url, sha256")
      .eq("runtime", "powershell")
      .eq("channel", "stable")
      .eq("is_active", true)
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest) {
      latestVersionPayload = {
        version:      latest.version,
        download_url: latest.download_url,
        sha256:       latest.sha256,
        upgrade_available: reportedVersion ? cmpSemver(reportedVersion, latest.version) < 0 : false,
      };
    }
  } catch (e) {
    console.error(`[${VERSION}] heartbeat latest-version lookup failed:`, e);
  }

  return new Response(
    JSON.stringify({
      success: true,
      message: "Heartbeat received",
      network_module_enabled: org?.network_module_enabled ?? false,
      commands: pendingCommands || [],
      latest_version: latestVersionPayload,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// POST /command-result - Agent reports result of executed command
// (Legacy path. Modern agents batch results via the heartbeat payload
// instead, but this endpoint is kept so older agents keep working.)
async function handleCommandResult(req: Request) {
  const endpoint = await validateAgentToken(req);
  const body = await req.json();
  const { command_id, success, result, error } = body;

  if (!command_id) {
    return new Response(
      JSON.stringify({ error: "command_id is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { error: updateErr } = await supabase
    .from("agent_commands")
    .update({
      status: success ? "succeeded" : "failed",
      completed_at: new Date().toISOString(),
      result: result || null,
      error_message: typeof error === "string" ? error : null,
    })
    .eq("id", command_id)
    .eq("endpoint_id", endpoint.id)
    .in("status", ["queued", "dispatched"]);

  if (updateErr) console.error("Error updating command result:", updateErr);

  return new Response(
    JSON.stringify({ success: true }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// POST /threats - Report threats from agent
async function handleThreats(req: Request) {
  const endpoint = await validateAgentToken(req);
  const body = await req.json();
  // Be permissive: some clients may accidentally send a single object (not an array)
  // or send the array as the top-level JSON value.
  const threatsRaw = (body && typeof body === "object" && "threats" in body) ? (body as any).threats : body;
  const threats: any[] = Array.isArray(threatsRaw)
    ? threatsRaw
    : threatsRaw && typeof threatsRaw === "object"
      ? [threatsRaw]
      : [];

  if (threats.length === 0) {
    return new Response(
      JSON.stringify({ success: true, message: "No threats to process" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  for (const threat of threats) {
    if (!threat?.threat_id) continue;
    // Check if threat already exists
    const { data: existing } = await supabase
      .from("endpoint_threats")
      .select("id, manual_resolution_active, manual_resolved_at")
      .eq("endpoint_id", endpoint.id)
      .eq("threat_id", threat.threat_id)
      .maybeSingle();

    const incomingStatus = String(threat.status || "Active");
    const incomingStatusLc = incomingStatus.toLowerCase();
    const incomingIndicatesNewActivity = [
      "active",
      "allowed",
      "executing",
      "quarantined",
      "blocked",
    ].includes(incomingStatusLc);

    if (existing) {
      const incomingTimeStr =
        threat.last_threat_status_change_time || threat.initial_detection_time || null;
      const incomingTime = incomingTimeStr ? new Date(incomingTimeStr) : null;
      const manualResolvedAt = existing.manual_resolved_at ? new Date(existing.manual_resolved_at) : null;

      const shouldClearManualResolution =
        !!existing.manual_resolution_active &&
        incomingIndicatesNewActivity &&
        !!incomingTime &&
        (!manualResolvedAt || incomingTime > manualResolvedAt);

      // If the threat is manually resolved, don't let repeated delivery of the same/older agent state
      // overwrite it. Only un-resolve when we see activity AFTER manual_resolved_at.
      if (existing.manual_resolution_active && !shouldClearManualResolution) {
        await supabase
          .from("endpoint_threats")
          .update({
            // Keep status=Resolved; but allow raw_data to refresh.
            raw_data: threat.raw_data,
          })
          .eq("id", existing.id);
      } else {
        await supabase
          .from("endpoint_threats")
          .update({
            status: threat.status,
            // Bump initial_detection_time on re-detection so the UI's freshness
            // sort surfaces the row. If the agent didn't send one, fall back to
            // last_threat_status_change_time, which Defender always sets.
            initial_detection_time: threat.initial_detection_time || threat.last_threat_status_change_time || new Date().toISOString(),
            last_threat_status_change_time: threat.last_threat_status_change_time,
            raw_data: threat.raw_data,
            ...(shouldClearManualResolution
              ? {
                  manual_resolution_active: false,
                  manual_resolved_at: null,
                  manual_resolved_by: null,
                }
              : {}),
          })
          .eq("id", existing.id);
      }
    } else {
      // Insert new threat using upsert to handle race conditions with the unique constraint
      const { error: upsertError } = await supabase.from("endpoint_threats").upsert({
        endpoint_id: endpoint.id,
        threat_id: threat.threat_id,
        threat_name: threat.threat_name,
        severity: threat.severity || "Unknown",
        category: threat.category,
        status: threat.status || "Active",
        initial_detection_time: threat.initial_detection_time,
        last_threat_status_change_time: threat.last_threat_status_change_time,
        resources: threat.resources,
        raw_data: threat.raw_data,
        manual_resolution_active: false,
        manual_resolved_at: null,
        manual_resolved_by: null,
      }, { onConflict: "endpoint_id,threat_id" });

      if (!upsertError) {
        // Log the new threat
        await supabase.from("endpoint_logs").insert({
          endpoint_id: endpoint.id,
          log_type: "threat",
          message: `Threat detected: ${threat.threat_name}`,
          details: { threat_id: threat.threat_id, severity: threat.severity },
        });
      }
    }
  }

  return new Response(
    JSON.stringify({ success: true, message: `Processed ${threats.length} threats` }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// Process an array of threats for an endpoint. Mirrors handleThreats body but
// callable from /heartbeat too -- the agent ships threats inside the heartbeat
// payload, which was being silently dropped (PoC rec #10 found 0 fresh threats
// in 30 days across the fleet; this closes that hole).
async function ingestThreats(endpointId: string, threats: any[]) {
  if (!Array.isArray(threats) || threats.length === 0) return 0;
  let touched = 0;
  for (const threat of threats) {
    if (!threat?.threat_id) continue;
    const { data: existing } = await supabase
      .from("endpoint_threats")
      .select("id, manual_resolution_active, manual_resolved_at")
      .eq("endpoint_id", endpointId)
      .eq("threat_id", threat.threat_id)
      .maybeSingle();

    const incomingStatus = String(threat.status || "Active");
    const incomingStatusLc = incomingStatus.toLowerCase();
    const incomingIndicatesNewActivity = ["active","allowed","executing","quarantined","blocked"].includes(incomingStatusLc);

    if (existing) {
      const incomingTimeStr = threat.last_threat_status_change_time || threat.initial_detection_time || null;
      const incomingTime = incomingTimeStr ? new Date(incomingTimeStr) : null;
      const manualResolvedAt = existing.manual_resolved_at ? new Date(existing.manual_resolved_at) : null;
      const shouldClearManualResolution =
        !!existing.manual_resolution_active && incomingIndicatesNewActivity && !!incomingTime &&
        (!manualResolvedAt || incomingTime > manualResolvedAt);
      if (existing.manual_resolution_active && !shouldClearManualResolution) {
        await supabase.from("endpoint_threats").update({ raw_data: threat.raw_data }).eq("id", existing.id);
      } else {
        await supabase.from("endpoint_threats").update({
          status: threat.status,
          // Bump initial_detection_time on re-detection so the UI's freshness
          // sort surfaces the row. Falls back to status-change time then now().
          initial_detection_time: threat.initial_detection_time || threat.last_threat_status_change_time || new Date().toISOString(),
          last_threat_status_change_time: threat.last_threat_status_change_time,
          // Also refresh resources -- the latest detection's file path matters operationally.
          resources: threat.resources,
          raw_data: threat.raw_data,
          ...(shouldClearManualResolution ? {
            manual_resolution_active: false,
            manual_resolved_at: null,
            manual_resolved_by: null,
          } : {}),
        }).eq("id", existing.id);
      }
      touched++;
    } else {
      const { error: upsertError } = await supabase.from("endpoint_threats").upsert({
        endpoint_id: endpointId,
        threat_id: threat.threat_id,
        threat_name: threat.threat_name,
        severity: threat.severity || "Unknown",
        category: threat.category,
        status: threat.status || "Active",
        initial_detection_time: threat.initial_detection_time,
        last_threat_status_change_time: threat.last_threat_status_change_time,
        resources: threat.resources,
        raw_data: threat.raw_data,
        manual_resolution_active: false,
        manual_resolved_at: null,
        manual_resolved_by: null,
      }, { onConflict: "endpoint_id,threat_id" });
      if (!upsertError) {
        await supabase.from("endpoint_logs").insert({
          endpoint_id: endpointId,
          log_type: "threat",
          message: `Threat detected: ${threat.threat_name}`,
          details: { threat_id: threat.threat_id, severity: threat.severity },
        });
        touched++;
      }
    }
  }
  return touched;
}

// v0.6.5: tamper-protection event ingest. Mirrors the HMAC heartbeat path
// (agent-heartbeat block 7b) so legacy bearer-token agents that get upgraded
// in-place to v0.6.5 still land alerts even before they swing over to HMAC.
async function ingestTamperEvents(endpointId: string, organizationId: string, events: any[]) {
  if (!Array.isArray(events) || events.length === 0) return 0;
  const sevMap: Record<string, string> = {
    Severe:   'critical',
    High:     'high',
    Moderate: 'medium',
    Low:      'low',
  };
  const titleFor = (t: string): string => {
    switch (t) {
      case 'service_stopped':      return 'Tamper attempt: MithrasAgent service stopped';
      case 'service_stopping':     return 'Tamper attempt: MithrasAgent service stop initiated';
      case 'crashed_unexpectedly': return 'Tamper attempt: MithrasAgent crashed unexpectedly';
      case 'start_type_changed':   return 'Tamper attempt: MithrasAgent start type changed';
      case 'service_installed':    return 'Tamper notice: MithrasAgent service installed';
      default:                     return `Tamper event: ${t}`;
    }
  };

  let inserted = 0;
  for (const e of events) {
    if (!e?.event_type || e.record_id === undefined) continue;
    // record_id is supposed to be a Windows Event Log RecordId (integer).
    // Reject anything non-numeric so a compromised agent can't send
    // record_id="%" and have ilike match every existing tamper_attempt
    // row, suppressing future tamper alerts for the 6h idempotency window.
    const recIdNum = Number(e.record_id);
    if (!Number.isFinite(recIdNum)) continue;
    const recId = String(Math.trunc(recIdNum));

    // 6-hour idempotency window — if we already logged this RecordId on this
    // endpoint, skip. Cheap, and the agent's state file already prevents the
    // common case of double-shipping.
    const { data: existing } = await supabase
      .from('alerts')
      .select('id')
      .eq('endpoint_id', endpointId)
      .eq('alert_type', 'tamper_attempt')
      .ilike('message', `%record ${recId}%`)
      .gte('created_at', new Date(Date.now() - 6 * 3600_000).toISOString())
      .limit(1);
    if (existing && existing.length > 0) continue;

    const row = {
      organization_id: organizationId,
      endpoint_id:     endpointId,
      alert_type:      'tamper_attempt',
      severity:        sevMap[String(e.severity)] ?? 'medium',
      title:           titleFor(String(e.event_type)),
      message:         `Event ${e.event_id} (record ${recId}) at ${e.event_time}: ${String(e.message ?? '').slice(0, 400)}`,
      created_at:      (typeof e.event_time === 'string' ? e.event_time : new Date().toISOString()),
    };
    const { error: iErr } = await supabase.from('alerts').insert(row);
    if (!iErr) inserted++;
    else console.error('tamper_events insert', iErr);
  }
  return inserted;
}

// v0.6.6: ransomware canary trips. Each modified or deleted decoy ships as
// a critical alert with full hash/size delta in the message.
async function ingestCanaryEvents(endpointId: string, organizationId: string, events: any[]) {
  if (!Array.isArray(events) || events.length === 0) return 0;
  let inserted = 0;
  for (const e of events) {
    if (!e?.path || !e?.event_type) continue;
    // Escape LIKE metacharacters so a compromised agent can't send path="%"
    // to match all canary alert rows and suppress future canary alerts
    // for the 6h idempotency window.
    const canaryPath = String(e.path).replace(/[\\%_]/g, (c) => "\\" + c);

    const { data: existing } = await supabase
      .from('alerts')
      .select('id')
      .eq('endpoint_id', endpointId)
      .eq('alert_type', 'ransomware_canary_tripped')
      .ilike('message', `%${canaryPath}%`)
      .gte('created_at', new Date(Date.now() - 6 * 3600_000).toISOString())
      .limit(1);
    if (existing && existing.length > 0) continue;

    const name = canaryPath.split(/[\\/]/).pop() || canaryPath;
    const titleVerb = e.event_type === 'modified' ? 'modified' : (e.event_type === 'deleted' ? 'deleted' : `tripped (${e.event_type})`);

    const row = {
      organization_id: organizationId,
      endpoint_id:     endpointId,
      alert_type:      'ransomware_canary_tripped',
      severity:        'critical',
      title:           `Ransomware suspected: canary file "${name}" was ${titleVerb}`,
      message:         `Canary at ${canaryPath} (${e.event_type}). ` +
                       `expected_sha256=${e.expected_sha256 ?? 'n/a'} ` +
                       `observed_sha256=${e.observed_sha256 ?? 'n/a'} ` +
                       `expected_size=${e.expected_size ?? 'n/a'} ` +
                       `observed_size=${e.observed_size ?? 'n/a'}. ` +
                       `This is a strong signal of active ransomware. Isolate this endpoint immediately.`,
      created_at:      (typeof e.event_time === 'string' ? e.event_time : new Date().toISOString()),
    };
    const { error: iErr } = await supabase.from('alerts').insert(row);
    if (!iErr) inserted++;
    else console.error('canary_events insert', iErr);
  }
  return inserted;
}

// POST /logs - Receive event logs from agent
async function handleLogs(req: Request) {
  const endpoint = await validateAgentToken(req);
  const body = await req.json();
  // Be permissive: allow { logs: [...] } or a top-level array.
  const logsRaw = (body && typeof body === "object" && "logs" in body) ? (body as any).logs : body;

  // Server-side filtering: keep only relevant event IDs.
  // Defender Operational events for threats and protection status.
  const relevantDefenderOperationalEventIds = new Set<number>([
    1000, 1001, 1002, 1005, 1006, 1007, 1008, 1009, 1010, 1011, 1013, 1015, 1016,
    1116, 1117, 1118, 1119,
    1121, 1122, 1123, 1124, 1125, 1126, 1127, 1128, 1129,
    2000, 2001, 2002, 2003, 2004, 2005,
    2010, 2011, 2012,
    3002,
    5000, 5001, 5004, 5007, 5008, 5010, 5012,
  ]);

  // Security event IDs for process creation (IOC hunting).
  const relevantSecurityEventIds = new Set<number>([
    4688, // Process creation with command line
    4689, // Process termination (optional context)
  ]);

  const logs: any[] = Array.isArray(logsRaw)
    ? logsRaw.filter((l: any) => {
        const n = typeof l?.event_id === "number" ? l.event_id : Number(l?.event_id);
        if (!Number.isFinite(n)) return false;
        const logSource = String(l?.event_source || "").toLowerCase();
        // Accept Defender Operational events
        if (logSource.includes("defender") && relevantDefenderOperationalEventIds.has(n)) return true;
        // Accept Security audit events for process creation
        if (logSource.includes("security") && relevantSecurityEventIds.has(n)) return true;
        return false;
      })
    : [];

  console.log("/logs", {
    endpoint_id: endpoint.id,
    hostname: endpoint.hostname,
    count: logs.length,
  });

  if (logs.length === 0) {
    return new Response(
      JSON.stringify({ success: true, message: "No logs to process" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Insert logs in batch - map to actual table schema
  const logsToInsert = logs
    .map((log: {
    event_id: number;
    event_source: string;
    level: string;
    message: string;
    event_time: string;
    details?: {
      provider?: string;
      task?: string;
      keywords?: string;
      computer?: string;
      user?: string;
      record_id?: number;
    };
    }) => {
      const eventId = toInt32OrNull(log.event_id);
      if (eventId === null) return null;

      return {
        endpoint_id: endpoint.id,
        event_id: eventId,
        log_source: log.event_source,
        level: log.level,
        message: log.message,
        event_time: toTimestampOrNull(log.event_time) ?? new Date().toISOString(),
        provider_name: log.details?.provider || null,
        task_category: log.details?.task || null,
        raw_data: log.details || null,
      };
    })
    .filter(Boolean);

  if (logsToInsert.length === 0) {
    return new Response(
      JSON.stringify({ success: true, message: "No valid logs to process" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { error: insertError } = await supabase
    .from("endpoint_event_logs")
    .upsert(logsToInsert, { onConflict: "endpoint_id,event_id,event_time", ignoreDuplicates: true });

  if (insertError) {
    console.error("Error inserting logs:", insertError);
    return new Response(
      JSON.stringify({ success: false, error: "Failed to store logs" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Best-effort: derive endpoint_threats rows from Defender Operational threat events.
  // This provides reliable Threats UI even when Get-MpThreatDetection returns empty.
  try {
    const candidateThreats: ParsedThreatFromEventLog[] = logsToInsert
      .map((l: any) => {
        const eventId = typeof l?.event_id === "number" ? l.event_id : Number(l?.event_id);
        return parseDefenderThreatFromEventMessage({
          event_id: eventId,
          event_time: l?.event_time,
          message: l?.message,
          raw_data: l?.raw_data,
        });
      })
      .filter(Boolean) as ParsedThreatFromEventLog[];

    for (const threat of candidateThreats) {
      const { data: existing } = await supabase
        .from("endpoint_threats")
        .select("id, manual_resolution_active, manual_resolved_at")
        .eq("endpoint_id", endpoint.id)
        .eq("threat_id", threat.threat_id)
        .maybeSingle();

      if (existing?.id) {
        const incomingTime = threat.last_threat_status_change_time
          ? new Date(threat.last_threat_status_change_time)
          : threat.initial_detection_time
            ? new Date(threat.initial_detection_time)
            : null;
        const manualResolvedAt = existing.manual_resolved_at ? new Date(existing.manual_resolved_at) : null;
        const shouldClearManualResolution =
          !!existing.manual_resolution_active &&
          !!incomingTime &&
          (!manualResolvedAt || incomingTime > manualResolvedAt);

        if (existing.manual_resolution_active && !shouldClearManualResolution) {
          // Keep status=Resolved; just refresh metadata.
          await supabase
            .from("endpoint_threats")
            .update({
              threat_name: threat.threat_name,
              severity: threat.severity,
              category: threat.category,
              resources: threat.resources as any,
              raw_data: threat.raw_data as any,
            })
            .eq("id", existing.id);
          continue;
        }

        await supabase
          .from("endpoint_threats")
          .update({
            threat_name: threat.threat_name,
            severity: threat.severity,
            category: threat.category,
            status: threat.status,
            // Bump initial_detection_time on re-detection so the UI's
            // freshness sort surfaces the row. Falls back to status-change
            // time then now().
            initial_detection_time: threat.initial_detection_time || threat.last_threat_status_change_time || new Date().toISOString(),
            last_threat_status_change_time: threat.last_threat_status_change_time,
            resources: threat.resources as any,
            raw_data: threat.raw_data as any,
            // Any new Defender threat event AFTER manual_resolved_at clears manual resolution override.
            ...(shouldClearManualResolution
              ? {
                  manual_resolution_active: false,
                  manual_resolved_at: null,
                  manual_resolved_by: null,
                }
              : {}),
          })
          .eq("id", existing.id);
      } else {
        // Insert new threat using upsert to handle race conditions with the unique constraint
        await supabase.from("endpoint_threats").upsert({
          endpoint_id: endpoint.id,
          threat_id: threat.threat_id,
          threat_name: threat.threat_name,
          severity: threat.severity || "Unknown",
          category: threat.category,
          status: threat.status || "Active",
          initial_detection_time: threat.initial_detection_time,
          last_threat_status_change_time: threat.last_threat_status_change_time,
          resources: threat.resources as any,
          raw_data: threat.raw_data as any,
          manual_resolution_active: false,
          manual_resolved_at: null,
          manual_resolved_by: null,
        }, { onConflict: "endpoint_id,threat_id" });
      }
    }
  } catch (e) {
    console.warn("Threat derivation from logs failed (non-fatal):", e);
  }

  return new Response(
    JSON.stringify({ success: true, message: `Processed ${logs.length} logs` }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// POST /apps - Receive discovered applications from agent
async function handleApps(req: Request) {
  const endpoint = await validateAgentToken(req);
  const body = await req.json();
  const { apps, source } = body;

  if (!Array.isArray(apps)) {
    return new Response(JSON.stringify({ error: "Invalid apps format" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let processedCount = 0;

  for (const app of apps) {
    if (!app.file_name || !app.file_path) continue;

    // Check if app already exists for this endpoint
    const { data: existing } = await supabase
      .from("wdac_discovered_apps")
      .select("id, execution_count, discovery_source")
      .eq("endpoint_id", endpoint.id)
      .eq("file_path", app.file_path)
      .eq("file_hash", app.file_hash || "")
      .maybeSingle();

    const discoverySource = source || "agent_inventory";

    if (existing) {
      // Update existing app
      let newSource = existing.discovery_source;
      if (existing.discovery_source !== discoverySource && existing.discovery_source !== "both") {
        newSource = "both";
      }

      await supabase
        .from("wdac_discovered_apps")
        .update({
          last_seen_at: new Date().toISOString(),
          execution_count: existing.execution_count + (app.execution_count || 1),
          discovery_source: newSource,
          publisher: app.publisher || undefined,
          product_name: app.product_name || undefined,
          file_version: app.file_version || undefined,
        })
        .eq("id", existing.id);
    } else {
      // Insert new app
      await supabase.from("wdac_discovered_apps").insert({
        organization_id: endpoint.organization_id,
        endpoint_id: endpoint.id,
        file_name: app.file_name,
        file_path: app.file_path,
        file_hash: app.file_hash || null,
        publisher: app.publisher || null,
        product_name: app.product_name || null,
        file_version: app.file_version || null,
        discovery_source: discoverySource,
        execution_count: app.execution_count || 1,
        raw_data: app.raw_data || null,
      });
    }
    processedCount++;
  }

  return new Response(
    JSON.stringify({ success: true, message: `Processed ${processedCount} applications` }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// GET /policy - Get assigned policy for endpoint
async function handleGetPolicy(req: Request) {
  const endpoint = await validateAgentToken(req);

  if (!endpoint.policy_id) {
    return new Response(
      JSON.stringify({ success: true, policy: null, message: "No policy assigned" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: policy, error } = await supabase
    .from("defender_policies")
    .select("*")
    .eq("id", endpoint.policy_id)
    .single();

  if (error) throw error;

  return new Response(
    JSON.stringify({ success: true, policy }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// GET /wdac-policy - Get assigned WDAC policy with rules (legacy + rule sets)
async function handleGetWdacPolicy(req: Request) {
  const endpoint = await validateAgentToken(req);
  
  // Collect all rules from various sources
  const allRules: Array<{
    id: string;
    rule_type: string;
    action: string;
    value: string;
    publisher_name?: string;
    product_name?: string;
    file_version_min?: string;
    description?: string;
    source: string;
    source_id: string;
    mode: string;
  }> = [];

  // 1. Legacy WDAC policy rules (if assigned)
  let legacyPolicy = null;
  if (endpoint.wdac_policy_id) {
    const { data: policy } = await supabase
      .from("wdac_policies")
      .select("*")
      .eq("id", endpoint.wdac_policy_id)
      .single();
    
    legacyPolicy = policy;

    const { data: legacyRules } = await supabase
      .from("wdac_rules")
      .select("*")
      .eq("policy_id", endpoint.wdac_policy_id);

    if (legacyRules) {
      for (const rule of legacyRules) {
        allRules.push({
          id: rule.id,
          rule_type: rule.rule_type,
          action: rule.action,
          value: rule.value,
          publisher_name: rule.publisher_name,
          product_name: rule.product_name,
          file_version_min: rule.file_version_min,
          description: rule.description,
          source: "wdac_policy",
          source_id: endpoint.wdac_policy_id,
          mode: legacyPolicy?.mode || "audit",
        });
      }
    }
  }

  // 2. Rules from directly assigned rule sets
  const { data: directAssignments } = await supabase
    .from("endpoint_rule_set_assignments")
    .select("rule_set_id, priority")
    .eq("endpoint_id", endpoint.id);

  const directRuleSetIds = directAssignments?.map(a => a.rule_set_id) || [];

  // 3. Rules from group-inherited rule sets
  const { data: groupMemberships } = await supabase
    .from("endpoint_group_memberships")
    .select("group_id")
    .eq("endpoint_id", endpoint.id);

  const groupIds = groupMemberships?.map(m => m.group_id) || [];
  
  let groupRuleSetIds: string[] = [];
  if (groupIds.length > 0) {
    const { data: groupAssignments } = await supabase
      .from("group_rule_set_assignments")
      .select("rule_set_id, priority")
      .in("group_id", groupIds);
    
    groupRuleSetIds = groupAssignments?.map(a => a.rule_set_id) || [];
  }

  // Combine all rule set IDs (dedupe)
  const allRuleSetIds = [...new Set([...directRuleSetIds, ...groupRuleSetIds])];

  // Fetch rules from all rule sets
  if (allRuleSetIds.length > 0) {
    const { data: ruleSetRules } = await supabase
      .from("wdac_rule_set_rules")
      .select("*, wdac_rule_sets!inner(name, mode)")
      .in("rule_set_id", allRuleSetIds);

    if (ruleSetRules) {
      for (const rule of ruleSetRules) {
        const ruleSet = rule.wdac_rule_sets as unknown as { name: string; mode: string };
        allRules.push({
          id: rule.id,
          rule_type: rule.rule_type,
          action: rule.action,
          value: rule.value,
          publisher_name: rule.publisher_name,
          product_name: rule.product_name,
          file_version_min: rule.file_version_min,
          description: rule.description,
          source: directRuleSetIds.includes(rule.rule_set_id) ? "endpoint_rule_set" : "group_rule_set",
          source_id: rule.rule_set_id,
          mode: ruleSet?.mode || "audit",
        });
      }
    }
  }

  // Generate a hash of all rule IDs for change detection
  const ruleIds = allRules.map(r => r.id).sort().join(",");
  const rulesHash = await generateHash(ruleIds);

  return new Response(
    JSON.stringify({
      success: true,
      wdac_policy: legacyPolicy,
      rules: allRules,
      rules_hash: rulesHash,
      rules_count: allRules.length,
      sources: {
        legacy_policy: legacyPolicy ? 1 : 0,
        direct_rule_sets: directRuleSetIds.length,
        group_rule_sets: groupRuleSetIds.length,
      },
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// GET /rule-sets - Get detailed rule set information for this endpoint
async function handleGetRuleSets(req: Request) {
  const endpoint = await validateAgentToken(req);

  // Get direct assignments
  const { data: directAssignments } = await supabase
    .from("endpoint_rule_set_assignments")
    .select(`
      rule_set_id,
      priority,
      wdac_rule_sets (
        id,
        name,
        description,
        mode,
        updated_at
      )
    `)
    .eq("endpoint_id", endpoint.id)
    .order("priority", { ascending: false });

  // Get group memberships
  const { data: groupMemberships } = await supabase
    .from("endpoint_group_memberships")
    .select("group_id, endpoint_groups(id, name)")
    .eq("endpoint_id", endpoint.id);

  const groupIds = groupMemberships?.map(m => m.group_id) || [];

  // Get group rule set assignments
  let groupAssignments: Array<{
    group_id: string;
    group_name: string;
    rule_set_id: string;
    rule_set_name: string;
    priority: number;
  }> = [];

  if (groupIds.length > 0) {
    const { data: gAssignments } = await supabase
      .from("group_rule_set_assignments")
      .select(`
        group_id,
        rule_set_id,
        priority,
        endpoint_groups (name),
        wdac_rule_sets (id, name, mode)
      `)
      .in("group_id", groupIds)
      .order("priority", { ascending: false });

    if (gAssignments) {
      groupAssignments = gAssignments.map(a => {
        const endpointGroup = a.endpoint_groups as unknown as { name: string } | null;
        const ruleSet = a.wdac_rule_sets as unknown as { id: string; name: string; mode: string } | null;
        return {
          group_id: a.group_id,
          group_name: endpointGroup?.name || "",
          rule_set_id: a.rule_set_id,
          rule_set_name: ruleSet?.name || "",
          rule_set_mode: ruleSet?.mode || "audit",
          priority: a.priority,
        };
      });
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      direct_assignments: directAssignments?.map(a => ({
        rule_set_id: a.rule_set_id,
        priority: a.priority,
        rule_set: a.wdac_rule_sets,
      })) || [],
      group_memberships: groupMemberships?.map(m => ({
        group_id: m.group_id,
        group: m.endpoint_groups,
      })) || [],
      inherited_assignments: groupAssignments,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// GET /uac-policy - Get assigned UAC policy for an endpoint
async function handleGetUacPolicy(req: Request) {
  const endpoint = await validateAgentToken(req);

  // Check if endpoint has a direct UAC policy assignment
  if (endpoint.uac_policy_id) {
    const { data: policy, error } = await supabase
      .from("uac_policies")
      .select("*")
      .eq("id", endpoint.uac_policy_id)
      .maybeSingle();

    if (error) {
      console.error("Error fetching UAC policy:", error);
    }

    if (policy) {
      return new Response(
        JSON.stringify({
          has_policy: true,
          policy: {
            id: policy.id,
            name: policy.name,
            enable_lua: policy.enable_lua,
            consent_prompt_admin: policy.consent_prompt_admin,
            consent_prompt_user: policy.consent_prompt_user,
            prompt_on_secure_desktop: policy.prompt_on_secure_desktop,
            detect_installations: policy.detect_installations,
            validate_admin_signatures: policy.validate_admin_signatures,
            filter_administrator_token: policy.filter_administrator_token,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  // Check if endpoint is in a group with a UAC policy
  const { data: groupMemberships } = await supabase
    .from("endpoint_group_memberships")
    .select(`
      group_id,
      endpoint_groups(uac_policy_id)
    `)
    .eq("endpoint_id", endpoint.id);

  for (const membership of groupMemberships || []) {
    const group = membership.endpoint_groups as unknown as { uac_policy_id: string | null } | null;
    if (group?.uac_policy_id) {
      const { data: policy } = await supabase
        .from("uac_policies")
        .select("*")
        .eq("id", group.uac_policy_id)
        .maybeSingle();

      if (policy) {
        return new Response(
          JSON.stringify({
            has_policy: true,
            source: "group",
            policy: {
              id: policy.id,
              name: policy.name,
              enable_lua: policy.enable_lua,
              consent_prompt_admin: policy.consent_prompt_admin,
              consent_prompt_user: policy.consent_prompt_user,
              prompt_on_secure_desktop: policy.prompt_on_secure_desktop,
              detect_installations: policy.detect_installations,
              validate_admin_signatures: policy.validate_admin_signatures,
              filter_administrator_token: policy.filter_administrator_token,
            },
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
  }

  // No UAC policy assigned
  return new Response(
    JSON.stringify({ has_policy: false }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// GET /windows-update-policy - Get assigned Windows Update policy for an endpoint
async function handleGetWindowsUpdatePolicy(req: Request) {
  const endpoint = await validateAgentToken(req);

  // Check if endpoint has a direct Windows Update policy assignment
  if (endpoint.windows_update_policy_id) {
    const { data: policy, error } = await supabase
      .from("windows_update_policies")
      .select("*")
      .eq("id", endpoint.windows_update_policy_id)
      .maybeSingle();

    if (error) {
      console.error("Error fetching Windows Update policy:", error);
    }

    if (policy) {
      return new Response(
        JSON.stringify({
          has_policy: true,
          policy: {
            id: policy.id,
            name: policy.name,
            auto_update_mode: policy.auto_update_mode,
            active_hours_start: policy.active_hours_start,
            active_hours_end: policy.active_hours_end,
            feature_update_deferral: policy.feature_update_deferral,
            quality_update_deferral: policy.quality_update_deferral,
            pause_feature_updates: policy.pause_feature_updates,
            pause_quality_updates: policy.pause_quality_updates,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  // Check if endpoint is in a group with a Windows Update policy
  const { data: groupMemberships } = await supabase
    .from("endpoint_group_memberships")
    .select(`
      group_id,
      endpoint_groups(windows_update_policy_id)
    `)
    .eq("endpoint_id", endpoint.id);

  for (const membership of groupMemberships || []) {
    const group = membership.endpoint_groups as unknown as { windows_update_policy_id: string | null } | null;
    if (group?.windows_update_policy_id) {
      const { data: policy } = await supabase
        .from("windows_update_policies")
        .select("*")
        .eq("id", group.windows_update_policy_id)
        .maybeSingle();

      if (policy) {
        return new Response(
          JSON.stringify({
            has_policy: true,
            source: "group",
            policy: {
              id: policy.id,
              name: policy.name,
              auto_update_mode: policy.auto_update_mode,
              active_hours_start: policy.active_hours_start,
              active_hours_end: policy.active_hours_end,
              feature_update_deferral: policy.feature_update_deferral,
              quality_update_deferral: policy.quality_update_deferral,
              pause_feature_updates: policy.pause_feature_updates,
              pause_quality_updates: policy.pause_quality_updates,
            },
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
  }

  // No Windows Update policy assigned
  return new Response(
    JSON.stringify({ has_policy: false }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// GET /update-ring - Effective patch deployment ring for this endpoint.
//
// Walks endpoint -> group -> update_rings. Returns the ring's defer-days,
// install window, critical-only flag, and concurrency cap so the agent
// can write matching WUfB registry keys and gate scheduled installs.
//
// Response shape:
//   { has_ring: false }
//   { has_ring: true, ring: { name, quality_update_defer_days, ... } }
async function handleGetUpdateRing(req: Request) {
    const endpoint = await validateAgentToken(req);

    // Membership search. If the endpoint is in multiple groups, prefer
    // groups that have a non-null update_ring_id, preferring is_default
    // groups (stable, predictable choice).
    const { data: memberships } = await supabase
        .from("endpoint_group_memberships")
        .select(`
            group_id,
            endpoint_groups (
                id, name, is_default, update_ring_id
            )
        `)
        .eq("endpoint_id", endpoint.id);

    let chosenRingId: string | null = null;
    for (const m of (memberships ?? [])) {
        const g = (m as any).endpoint_groups as { id: string; name: string; is_default: boolean; update_ring_id: string | null } | null;
        if (!g?.update_ring_id) continue;
        if (g.is_default) { chosenRingId = g.update_ring_id; break; }
        if (!chosenRingId) chosenRingId = g.update_ring_id;
    }

    if (!chosenRingId) {
        return new Response(JSON.stringify({ has_ring: false }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    const { data: ring, error } = await supabase
        .from("update_rings")
        .select("id, name, description, quality_update_defer_days, feature_update_defer_days, install_window_start_local, install_window_end_local, critical_only, max_concurrent_installs, updated_at")
        .eq("id", chosenRingId)
        .maybeSingle();
    if (error || !ring) {
        return new Response(JSON.stringify({ has_ring: false }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
    return new Response(JSON.stringify({ has_ring: true, ring }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

// GET /gpo-policy - Get assigned GPO policy for an endpoint (via group, with priority)
async function handleGetGpoPolicy(req: Request) {
  const endpoint = await validateAgentToken(req);

  // GPO policies are assigned via groups - fetch ALL memberships with group details
  const { data: groupMemberships } = await supabase
    .from("endpoint_group_memberships")
    .select(`
      group_id,
      endpoint_groups(id, gpo_policy_id, name, created_at)
    `)
    .eq("endpoint_id", endpoint.id);

  // Collect all groups that have a GPO policy, sorted by created_at (earliest wins)
  const groupsWithGpo = (groupMemberships || [])
    .map((m) => m.endpoint_groups as unknown as { id: string; gpo_policy_id: string | null; name: string; created_at: string } | null)
    .filter((g): g is { id: string; gpo_policy_id: string; name: string; created_at: string } => !!g?.gpo_policy_id)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  if (groupsWithGpo.length === 0) {
    return new Response(
      JSON.stringify({ has_policy: false }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Use the first (oldest/highest priority) group's GPO policy
  const winningGroup = groupsWithGpo[0];
  const { data: policy } = await supabase
    .from("gpo_policies")
    .select("*")
    .eq("id", winningGroup.gpo_policy_id)
    .maybeSingle();

  if (!policy) {
    return new Response(
      JSON.stringify({ has_policy: false }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({
      has_policy: true,
      source: "group",
      source_group: winningGroup.name,
      conflicts: groupsWithGpo.length > 1 ? groupsWithGpo.length : 0,
      policy,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// Helper to generate a simple hash for change detection
async function generateHash(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.slice(0, 8).map(b => b.toString(16).padStart(2, "0")).join("");
}

// GET /status - Get full endpoint status for tray application (no auth required beyond token)
async function handleGetStatus(req: Request) {
  const endpoint = await validateAgentToken(req);

  // Get latest status record
  const { data: latestStatus } = await supabase
    .from("endpoint_status")
    .select("*")
    .eq("endpoint_id", endpoint.id)
    .order("collected_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Get Defender policy
  let defenderPolicy = null;
  let defenderSource = null;
  if (endpoint.policy_id) {
    const { data: policy } = await supabase
      .from("defender_policies")
      .select("id, name")
      .eq("id", endpoint.policy_id)
      .maybeSingle();
    if (policy) {
      defenderPolicy = policy;
      defenderSource = "direct";
    }
  }
  // Check group inheritance for defender policy
  if (!defenderPolicy) {
    const { data: groupMemberships } = await supabase
      .from("endpoint_group_memberships")
      .select("endpoint_groups(policy_id)")
      .eq("endpoint_id", endpoint.id);
    for (const m of groupMemberships || []) {
      const g = m.endpoint_groups as unknown as { policy_id: string | null } | null;
      if (g?.policy_id) {
        const { data: policy } = await supabase
          .from("defender_policies")
          .select("id, name")
          .eq("id", g.policy_id)
          .maybeSingle();
        if (policy) {
          defenderPolicy = policy;
          defenderSource = "group";
          break;
        }
      }
    }
  }

  // Get UAC policy
  let uacPolicy = null;
  let uacSource = null;
  if (endpoint.uac_policy_id) {
    const { data: policy } = await supabase
      .from("uac_policies")
      .select("id, name")
      .eq("id", endpoint.uac_policy_id)
      .maybeSingle();
    if (policy) {
      uacPolicy = policy;
      uacSource = "direct";
    }
  }
  if (!uacPolicy) {
    const { data: groupMemberships } = await supabase
      .from("endpoint_group_memberships")
      .select("endpoint_groups(uac_policy_id)")
      .eq("endpoint_id", endpoint.id);
    for (const m of groupMemberships || []) {
      const g = m.endpoint_groups as unknown as { uac_policy_id: string | null } | null;
      if (g?.uac_policy_id) {
        const { data: policy } = await supabase
          .from("uac_policies")
          .select("id, name")
          .eq("id", g.uac_policy_id)
          .maybeSingle();
        if (policy) {
          uacPolicy = policy;
          uacSource = "group";
          break;
        }
      }
    }
  }

  // Get Windows Update policy
  let wuPolicy = null;
  let wuSource = null;
  if (endpoint.windows_update_policy_id) {
    const { data: policy } = await supabase
      .from("windows_update_policies")
      .select("id, name")
      .eq("id", endpoint.windows_update_policy_id)
      .maybeSingle();
    if (policy) {
      wuPolicy = policy;
      wuSource = "direct";
    }
  }
  if (!wuPolicy) {
    const { data: groupMemberships } = await supabase
      .from("endpoint_group_memberships")
      .select("endpoint_groups(windows_update_policy_id)")
      .eq("endpoint_id", endpoint.id);
    for (const m of groupMemberships || []) {
      const g = m.endpoint_groups as unknown as { windows_update_policy_id: string | null } | null;
      if (g?.windows_update_policy_id) {
        const { data: policy } = await supabase
          .from("windows_update_policies")
          .select("id, name")
          .eq("id", g.windows_update_policy_id)
          .maybeSingle();
        if (policy) {
          wuPolicy = policy;
          wuSource = "group";
          break;
        }
      }
    }
  }

  // Get GPO policy (via groups only)
  let gpoPolicy = null;
  let gpoSource = null;
  {
    const { data: gpoGroupMemberships } = await supabase
      .from("endpoint_group_memberships")
      .select("endpoint_groups(gpo_policy_id)")
      .eq("endpoint_id", endpoint.id);
    for (const m of gpoGroupMemberships || []) {
      const g = m.endpoint_groups as unknown as { gpo_policy_id: string | null } | null;
      if (g?.gpo_policy_id) {
        const { data: policy } = await supabase
          .from("gpo_policies")
          .select("id, name")
          .eq("id", g.gpo_policy_id)
          .maybeSingle();
        if (policy) {
          gpoPolicy = policy;
          gpoSource = "group";
          break;
        }
      }
    }
  }

  // Get WDAC rule sets count
  const { data: directAssignments } = await supabase
    .from("endpoint_rule_set_assignments")
    .select("rule_set_id")
    .eq("endpoint_id", endpoint.id);
  const directRuleSets = directAssignments?.length || 0;

  // Count group-inherited rule sets
  const { data: groupMemberships } = await supabase
    .from("endpoint_group_memberships")
    .select("group_id")
    .eq("endpoint_id", endpoint.id);
  const groupIds = groupMemberships?.map(m => m.group_id) || [];
  let groupRuleSets = 0;
  if (groupIds.length > 0) {
    const { data: groupAssignments } = await supabase
      .from("group_rule_set_assignments")
      .select("rule_set_id")
      .in("group_id", groupIds);
    groupRuleSets = groupAssignments?.length || 0;
  }

  // Get threat count (active threats only)
  const { count: activeThreats } = await supabase
    .from("endpoint_threats")
    .select("*", { count: "exact", head: true })
    .eq("endpoint_id", endpoint.id)
    .not("status", "in", '("Resolved","Removed","Blocked")');

  return new Response(
    JSON.stringify({
      success: true,
      endpoint: {
        id: endpoint.id,
        hostname: endpoint.hostname,
        os_version: endpoint.os_version,
        defender_version: endpoint.defender_version,
        last_seen_at: endpoint.last_seen_at,
        is_online: endpoint.is_online,
      },
      status: latestStatus ? {
        realtime_protection: latestStatus.realtime_protection_enabled,
        antivirus_enabled: latestStatus.antivirus_enabled,
        signature_age: latestStatus.antivirus_signature_age,
        collected_at: latestStatus.collected_at,
      } : null,
      policies: {
        defender: defenderPolicy ? { ...defenderPolicy, source: defenderSource } : null,
        uac: uacPolicy ? { ...uacPolicy, source: uacSource } : null,
        windows_update: wuPolicy ? { ...wuPolicy, source: wuSource } : null,
        wdac_rule_sets: directRuleSets + groupRuleSets,
        gpo: gpoPolicy ? { ...gpoPolicy, source: gpoSource } : null,
      },
      threats: {
        active_count: activeThreats || 0,
      },
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// Current agent version - increment when agent script changes
const AGENT_VERSION = "2.19.0";

// GET /agent-update - Check for updates and return new script if needed
async function handleAgentUpdate(req: Request) {
  const url = new URL(req.url);
  const currentVersion = url.searchParams.get("version");

  console.log(`[${VERSION}] handleAgentUpdate called, currentVersion=${currentVersion}`);

  // Compare versions - simple semantic version comparison
  const needsUpdate = !currentVersion || compareVersions(AGENT_VERSION, currentVersion) > 0;

  if (!needsUpdate) {
    return new Response(
      JSON.stringify({
        success: true,
        update_available: false,
        current_version: AGENT_VERSION,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Require a valid agent token. Previously this swallowed auth failures
  // and returned the script_endpoint URL to any unauthenticated internet
  // caller - that's a reconnaissance leak of the installer entry point.
  let endpoint: { organization_id: string };
  try {
    endpoint = await validateAgentToken(req);
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: "unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({
      success: true,
      update_available: true,
      current_version: AGENT_VERSION,
      organization_id: endpoint.organization_id,
      // Agent will download from the agent-script edge function using its token
      script_endpoint: `${Deno.env.get("PUBLIC_API_BASE_URL") ?? SUPABASE_URL}/functions/v1/agent-script`,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// Compare semantic versions: returns 1 if a > b, -1 if a < b, 0 if equal
function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }
  return 0;
}

// POST /firewall-logs - Report firewall audit logs from agent
async function handleFirewallLogs(req: Request) {
  console.log(`[${VERSION}] handleFirewallLogs called`);
  const endpoint = await validateAgentToken(req);
  
  // Check if network module is enabled for this organization
  const { data: org } = await supabase
    .from("organizations")
    .select("network_module_enabled")
    .eq("id", endpoint.organization_id)
    .single();
  
  if (!org?.network_module_enabled) {
    console.log(`[${VERSION}] Network module disabled for org ${endpoint.organization_id}, rejecting firewall logs`);
    return new Response(
      JSON.stringify({ success: false, message: "Network module not enabled for this organization", count: 0, _version: VERSION }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
  
  const body = await req.json();
  
  const logsRaw = (body && typeof body === "object" && "logs" in body) ? (body as any).logs : body;
  const logs: any[] = Array.isArray(logsRaw) ? logsRaw : logsRaw && typeof logsRaw === "object" ? [logsRaw] : [];

  console.log(`[${VERSION}] Firewall logs received: ${logs.length} items for endpoint ${endpoint.hostname}`);

  if (logs.length === 0) {
    return new Response(
      JSON.stringify({ success: true, message: "No firewall logs to process", count: 0, _version: VERSION }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Fetch firewall_service_rules visible to this endpoint so we can stamp
  // rule_id on logs that arrived without one (legacy v2.19.0 agents). The
  // dashboard RPC get_microseg_rule_stats filters WHERE rule_id IS NOT NULL,
  // so unstamped logs silently disappear from the learn-phase UI.
  type RuleMatch = {
    id: string;
    service_name: string;
    ports: Set<number>;
    ranges: [number, number][];
    protocol: string;
  };
  const parsePortField = (port: string): { ports: Set<number>; ranges: [number, number][] } => {
    const ports = new Set<number>();
    const ranges: [number, number][] = [];
    for (const raw of (port || "").split(",")) {
      const tok = raw.trim();
      if (!tok) continue;
      const range = tok.match(/^(\d+)\s*-\s*(\d+)$/);
      if (range) {
        const lo = parseInt(range[1], 10);
        const hi = parseInt(range[2], 10);
        if (Number.isFinite(lo) && Number.isFinite(hi) && hi >= lo) {
          if (hi - lo <= 1024) {
            for (let p = lo; p <= hi; p++) ports.add(p);
          } else {
            ranges.push([lo, hi]);
          }
        }
        continue;
      }
      const n = parseInt(tok, 10);
      if (Number.isFinite(n)) ports.add(n);
    }
    return { ports, ranges };
  };

  let endpointRules: (RuleMatch & { direction: string })[] = [];
  try {
    const { data: memberships } = await supabase
      .from("endpoint_group_memberships")
      .select("group_id")
      .eq("endpoint_id", endpoint.id);
    const groupIds = (memberships ?? []).map((m: any) => m.group_id);
    if (groupIds.length > 0) {
      const { data: ruleRows } = await supabase
        .from("firewall_service_rules")
        .select("id, service_name, port, protocol, direction, firewall_policies!inner(organization_id)")
        .eq("firewall_policies.organization_id", endpoint.organization_id)
        .in("endpoint_group_id", groupIds)
        .eq("enabled", true);
      endpointRules = (ruleRows ?? []).map((r: any) => {
        const { ports, ranges } = parsePortField(r.port);
        return {
          id: r.id,
          service_name: r.service_name,
          ports,
          ranges,
          protocol: (r.protocol || "tcp").toLowerCase(),
          direction: ((r.direction as string) || "inbound").toLowerCase(),
        };
      });
    }
  } catch (e) {
    console.error(`[${VERSION}] rule-prefetch failed (non-fatal):`, e);
  }

  // v0.5.7: matcher now considers direction so the same port can have separate
  // inbound + outbound rules.
  const matchRule = (localPort: number, protocol: string, direction: string): RuleMatch | null => {
    const proto = (protocol || "tcp").toLowerCase();
    const dir   = (direction || "inbound").toLowerCase();
    for (const r of endpointRules) {
      if (r.protocol !== proto) continue;
      if (r.direction !== dir) continue;
      if (r.ports.has(localPort)) return r;
      for (const [lo, hi] of r.ranges) {
        if (localPort >= lo && localPort <= hi) return r;
      }
    }
    return null;
  };

  // Build batch of valid logs, stamping rule_id server-side if absent
  let stampedCount = 0;
  const logsToInsert = logs
    .filter((log: any) => log?.service_name && log?.remote_address)
    .map((log: any) => {
      let ruleId: string | null = log.rule_id || null;
      let serviceName: string = log.service_name;
      const dir = (log.direction || "inbound").toLowerCase();
      if (!ruleId && (dir === "inbound" || dir === "outbound") && endpointRules.length > 0) {
        const matched = matchRule(Number(log.local_port) || 0, log.protocol || "tcp", dir);
        if (matched) {
          ruleId = matched.id;
          if (matched.service_name) serviceName = matched.service_name;
          stampedCount++;
        }
      }
      return {
        organization_id: endpoint.organization_id,
        endpoint_id: endpoint.id,
        rule_id: ruleId,
        service_name: serviceName,
        local_port: log.local_port || 0,
        remote_address: log.remote_address,
        remote_port: log.remote_port || null,
        protocol: log.protocol || "tcp",
        direction: log.direction || "inbound",
        event_time: log.event_time || new Date().toISOString(),
      };
    });
  if (stampedCount > 0) {
    console.log(`[${VERSION}] Server-side rule_id stamped on ${stampedCount}/${logsToInsert.length} logs`);
  }

  let insertedCount = 0;

  // Insert in batches of 200 instead of one-by-one
  const fwBatchSize = 200;
  for (let i = 0; i < logsToInsert.length; i += fwBatchSize) {
    const batch = logsToInsert.slice(i, i + fwBatchSize);
    const { error } = await supabase.from("firewall_audit_logs").insert(batch);
    if (!error) insertedCount += batch.length;
    else console.error("Firewall log batch insert error:", error);
  }

  console.log(`[${VERSION}] Firewall logs inserted: ${insertedCount} of ${logs.length}`);

  return new Response(
    JSON.stringify({ success: true, message: "Firewall logs received", count: insertedCount, _version: VERSION }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
// POST /sysmon-events - Receive Sysmon telemetry from agent (events 1/3/11)
async function handleSysmonEvents(req: Request) {
  console.log(`[${VERSION}] handleSysmonEvents called`);
  const endpoint = await validateAgentToken(req);

  const body = await req.json();
  const eventsRaw = (body && typeof body === "object" && "events" in body) ? (body as any).events : body;
  const events: any[] = Array.isArray(eventsRaw) ? eventsRaw : eventsRaw && typeof eventsRaw === "object" ? [eventsRaw] : [];

  console.log(`[${VERSION}] Sysmon events received: ${events.length} from ${endpoint.hostname}`);

  if (events.length === 0) {
    return new Response(
      JSON.stringify({ success: true, message: "No events", count: 0, _version: VERSION }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Whitelist of columns the agent is allowed to set. We pass everything else
  // through into the `raw` jsonb so we don't lose forensic context, but the
  // typed columns are explicit to avoid Postgres rejecting an unknown field.
  const ALLOWED_FIELDS = new Set([
    "event_time", "event_id", "record_id", "user_name",
    "process_guid", "process_id", "parent_process_guid", "parent_process_id",
    "image", "parent_image", "command_line", "parent_command_line",
    "current_directory", "hashes", "integrity_level",
    "protocol", "initiated", "source_ip", "source_port", "source_hostname",
    "destination_ip", "destination_port", "destination_hostname",
    "target_filename",
  ]);

  const eventsToInsert = events
    .filter((e: any) => e && typeof e === "object" && (e.event_id === 1 || e.event_id === 3 || e.event_id === 11))
    .map((e: any) => {
      const row: Record<string, unknown> = {
        organization_id: endpoint.organization_id,
        endpoint_id:     endpoint.id,
        event_time:      e.event_time || new Date().toISOString(),
        event_id:        e.event_id,
        raw:             e,
      };
      for (const k of Object.keys(e)) {
        if (ALLOWED_FIELDS.has(k)) row[k] = e[k];
      }
      return row;
    });

  if (eventsToInsert.length === 0) {
    return new Response(
      JSON.stringify({ success: true, message: "No supported event ids", count: 0, _version: VERSION }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let inserted = 0;
  const BATCH = 200;
  for (let i = 0; i < eventsToInsert.length; i += BATCH) {
    const batch = eventsToInsert.slice(i, i + BATCH);
    const { error } = await supabase.from("sysmon_events").insert(batch);
    if (!error) {
      inserted += batch.length;
    } else {
      console.error("Sysmon event batch insert error:", error);
    }
  }

  console.log(`[${VERSION}] Sysmon events inserted: ${inserted} of ${events.length}`);

  return new Response(
    JSON.stringify({ success: true, message: "Sysmon events received", count: inserted, _version: VERSION }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// GET /dns-policy - Return the DNS policy assigned to the requesting endpoint
// ============================================================================
// GET /mesh-config — MeshCentral enrolment config for install_mesh_agent.
//
// The mesh group id is a shared remote-access enrolment secret: anyone
// holding it can enrol a device into the Mithras remote-control group. Until
// v0.7.21 it was a hardcoded default inside CommandExecutor.psm1 — committed
// to git and shipped in cleartext to every customer endpoint.
//
// It now lives in platform_settings (super-admin RLS, no anon/authenticated
// grants after 20260812000000) and is handed out only here, behind the
// agent's own credentials. Note this is deliberately NOT exposed to the web
// console: putting it in the React bundle would be exactly as public as
// baking it into the agent.
// ============================================================================
async function handleGetMeshConfig(req: Request) {
  const endpoint = await validateAgentToken(req);

  const { data: rows, error } = await supabase
    .from("platform_settings")
    .select("key, value")
    .in("key", ["mesh_group_id", "mesh_server_url"]);

  if (error) {
    console.error(`[${VERSION}] mesh-config: settings read failed:`, error.message);
    return new Response(
      JSON.stringify({ success: false, error: "settings_unavailable", _version: VERSION }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const map: Record<string, string> = {};
  for (const r of rows ?? []) map[r.key] = (r.value ?? "").trim();

  const meshId = map["mesh_group_id"] ?? "";
  const meshUrl = map["mesh_server_url"] || "https://remote.mithras.com.au";

  if (!meshId) {
    // Fail loudly rather than returning a half-config the agent will reject
    // with a less specific message.
    console.error(
      `[${VERSION}] mesh-config: platform_settings.mesh_group_id is not set — ` +
      `remote access cannot be provisioned for endpoint ${endpoint.id}`,
    );
    return new Response(
      JSON.stringify({ success: false, error: "mesh_group_id_not_configured", _version: VERSION }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({ success: true, mesh_url: meshUrl, mesh_id: meshId, _version: VERSION }),
    {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        // Never let a proxy or browser retain a remote-access enrolment secret.
        "Cache-Control": "no-store, private",
      },
    },
  );
}

async function handleGetDnsPolicy(req: Request) {
  console.log(`[${VERSION}] handleGetDnsPolicy called`);
  const endpoint = await validateAgentToken(req);

  // Check org-level module gate
  const { data: org } = await supabase
    .from("organizations")
    .select("id, dns_module_enabled")
    .eq("id", endpoint.organization_id)
    .single();

  if (!org?.dns_module_enabled) {
    return new Response(
      JSON.stringify({ success: true, enabled: false, _version: VERSION }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Resolve which policy applies (endpoint direct > group > org default)
  const { data: resolved, error: rpcErr } = await supabase.rpc(
    "get_endpoint_dns_policy",
    { p_endpoint_id: endpoint.id }
  );
  if (rpcErr) {
    console.error("[dns-policy] rpc error:", rpcErr);
    return new Response(
      JSON.stringify({ success: false, error: "policy_resolve_failed", _version: VERSION }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
  const policyId = resolved as string | null;
  if (!policyId) {
    return new Response(
      JSON.stringify({ success: true, enabled: true, policy: null, _version: VERSION }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const [policyRes, scopesRes] = await Promise.all([
    supabase
      .from("dns_policies")
      .select(
        "id, name, upstream_provider, upstream_doh_uri, block_malware, block_phishing, block_adult, block_gambling, block_social, custom_blocklist, custom_allowlist, disable_browser_doh",
      )
      .eq("id", policyId)
      .single(),
    supabase
      .from("dns_internal_scopes")
      .select("suffix, forwarders, description, display_order")
      .eq("policy_id", policyId)
      .order("display_order"),
  ]);

  if (policyRes.error || !policyRes.data) {
    console.error("[dns-policy] policy fetch error:", policyRes.error);
    return new Response(
      JSON.stringify({ success: false, error: "policy_fetch_failed", _version: VERSION }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const dohUri = `https://dns.mithras.com.au/${endpoint.organization_id}/dns-query`;

  const response = {
    success: true,
    enabled: true,
    policy: {
      policy_id: policyRes.data.id,
      name: policyRes.data.name,
      doh_uri: dohUri,
      disable_browser_doh: policyRes.data.disable_browser_doh,
      internal_scopes: (scopesRes.data ?? []).map((s) => ({
        suffix: s.suffix,
        forwarders: s.forwarders,
        description: s.description,
      })),
    },
    _version: VERSION,
  };

  return new Response(JSON.stringify(response), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handleGetFirewallPolicy(req: Request) {
  const endpoint = await validateAgentToken(req);

  // Get endpoint's group memberships
  const { data: memberships } = await supabase
    .from("endpoint_group_memberships")
    .select("group_id")
    .eq("endpoint_id", endpoint.id);

  const groupIds = memberships?.map((m) => m.group_id) || [];

  if (groupIds.length === 0) {
    return new Response(
      JSON.stringify({ success: true, rules: [], message: "No groups assigned" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Get the organization's default firewall policy (fall back to any policy if none marked default)
  let { data: policy } = await supabase
    .from("firewall_policies")
    .select("id")
    .eq("organization_id", endpoint.organization_id)
    .eq("is_default", true)
    .maybeSingle();

  if (!policy) {
    // Fallback: use the first available policy for this org
    const { data: fallbackPolicy } = await supabase
      .from("firewall_policies")
      .select("id")
      .eq("organization_id", endpoint.organization_id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    policy = fallbackPolicy;
  }

  if (!policy) {
    return new Response(
      JSON.stringify({ success: true, rules: [], message: "No firewall policy configured" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Get all rules for this endpoint's groups
  const { data: rules, error } = await supabase
    .from("firewall_service_rules")
    .select(`
      id,
      service_name,
      port,
      protocol,
      action,
      allowed_source_groups,
      allowed_source_ips,
      mode,
      enabled,
      order_priority,
      direction
    `)
    .eq("policy_id", policy.id)
    .in("endpoint_group_id", groupIds)
    .eq("enabled", true)
    .order("order_priority", { ascending: true });

  if (error) throw error;

  // Resolve source group IPs for allow_from_groups rules
  const resolvedRules = await Promise.all(
    (rules || []).map(async (rule) => {
      const resolvedSourceIps: string[] = [...(rule.allowed_source_ips || [])];

      if (rule.action === "allow_from_groups" && rule.allowed_source_groups?.length) {
        // Get endpoints in source groups and resolve their last known IPs
        const { data: sourceEndpoints } = await supabase
          .from("endpoint_group_memberships")
          .select("endpoint_id, endpoints(id, hostname)")
          .in("group_id", rule.allowed_source_groups);

        // Get the latest status for each source endpoint to extract reported IPs
        const sourceEndpointIds = (sourceEndpoints || []).map((se) => {
          const ep = se.endpoints as unknown as { id: string } | null;
          return ep?.id;
        }).filter(Boolean) as string[];

        if (sourceEndpointIds.length > 0) {
          const { data: sourceStatuses } = await supabase
            .from("endpoint_status")
            .select("endpoint_id, raw_status")
            .in("endpoint_id", sourceEndpointIds)
            .order("collected_at", { ascending: false });

          // Extract IPs from raw_status if available
          const seenEndpoints = new Set<string>();
          for (const st of sourceStatuses || []) {
            if (seenEndpoints.has(st.endpoint_id)) continue;
            seenEndpoints.add(st.endpoint_id);
            const raw = st.raw_status as Record<string, unknown> | null;
            if (raw?.reported_ip && typeof raw.reported_ip === "string") {
              resolvedSourceIps.push(raw.reported_ip);
            }
          }
        }
      }

      return {
        id: rule.id,
        service_name: rule.service_name,
        port: rule.port,
        protocol: rule.protocol,
        action: rule.action,
        allowed_source_groups: rule.allowed_source_groups || [],
        allowed_source_ips: rule.allowed_source_ips || [],
        mode: rule.mode,
        order_priority: rule.order_priority,
      };
    })
  );

  return new Response(
    JSON.stringify({
      success: true,
      policy_id: policy.id,
      rules: resolvedRules,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// POST /health - Receive health/error reports from agent
async function handleHealthReport(req: Request) {
  const endpoint = await validateAgentToken(req);
  const body = await req.json();

  const errors = Array.isArray(body?.errors) ? body.errors : [];
  const agentVersion = body?.agent_version || null;

  // Store each error as an endpoint_log
  for (const err of errors.slice(0, 50)) {
    await supabase.from("endpoint_logs").insert({
      endpoint_id: endpoint.id,
      log_type: "health",
      message: `[${err.component || "unknown"}] ${err.message || "No message"}`,
      details: {
        severity: err.severity || "warning",
        component: err.component,
        timestamp: err.timestamp,
        agent_version: agentVersion,
      },
    });
  }

  // Create alerts for critical errors
  const criticalErrors = errors.filter((e: any) => e.severity === "error" || e.severity === "critical");
  if (criticalErrors.length > 0) {
    await supabase.from("alerts").insert({
      organization_id: endpoint.organization_id,
      endpoint_id: endpoint.id,
      alert_type: "agent_health",
      severity: "high",
      title: `Agent health issues on ${endpoint.hostname}`,
      message: `${criticalErrors.length} error(s) reported: ${criticalErrors.map((e: any) => e.message).join("; ").slice(0, 500)}`,
    });
  }

  return new Response(
    JSON.stringify({ success: true, errors_received: errors.length }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// POST /software-inventory - Receive installed software from agent
async function handleSoftwareInventory(req: Request) {
  const endpoint = await validateAgentToken(req);
  const body = await req.json();

  const software = Array.isArray(body?.software) ? body.software : [];
  if (software.length === 0) {
    return new Response(
      JSON.stringify({ success: true, message: "No software reported" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Clear existing inventory for this endpoint and replace with fresh data
  await supabase
    .from("endpoint_software_inventory")
    .delete()
    .eq("endpoint_id", endpoint.id);

  // Insert new inventory in batches
  const batchSize = 100;
  let inserted = 0;
  for (let i = 0; i < software.length; i += batchSize) {
    const batch = software.slice(i, i + batchSize).map((s: any) => ({
      endpoint_id: endpoint.id,
      organization_id: endpoint.organization_id,
      software_name: String(s.name || "Unknown").substring(0, 500),
      software_version: s.version ? String(s.version).substring(0, 100) : null,
      publisher: s.publisher ? String(s.publisher).substring(0, 500) : null,
      install_date: s.install_date ? String(s.install_date).substring(0, 50) : null,
      architecture: s.architecture ? String(s.architecture).substring(0, 20) : null,
    }));

    const { error } = await supabase.from("endpoint_software_inventory").insert(batch);
    if (error) {
      console.error("Software inventory insert error:", error);
    } else {
      inserted += batch.length;
    }
  }

  return new Response(
    JSON.stringify({ success: true, software_received: inserted }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// GET /app-whitelist-policy - mode + rules so the agent knows whether to
// observe-only or block, and which apps are allowed.
async function handleGetAppWhitelistPolicy(req: Request) {
  console.log(`[${VERSION}] handleGetAppWhitelistPolicy called`);
  const endpoint = await validateAgentToken(req);

  const [stateRes, rulesRes] = await Promise.all([
    supabase
      .from("app_whitelist_state")
      .select("mode, audit_started_at, enforce_started_at")
      .eq("endpoint_id", endpoint.id)
      .maybeSingle(),
    supabase
      .from("app_whitelist_rules")
      .select("id, match_type, match_value, app_name, publisher, enabled")
      .eq("endpoint_id", endpoint.id)
      .eq("enabled", true),
  ]);

  const mode = stateRes.data?.mode || "idle";
  const rules = (rulesRes.data ?? []).map((r: any) => ({
    id:          r.id,
    match_type:  r.match_type,
    match_value: r.match_value,
    app_name:    r.app_name,
    publisher:   r.publisher, // required for trusted_path compound match
  }));

  return new Response(
    JSON.stringify({
      success: true,
      mode,
      audit_started_at:   stateRes.data?.audit_started_at   ?? null,
      enforce_started_at: stateRes.data?.enforce_started_at ?? null,
      rules,
      _version: VERSION,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// POST /app-audit-logs - receive process-launch events from the agent.
// Body: { logs: [{ file_name, file_path, sha256, publisher, product_name,
//                  file_version, process_id, parent_path, user_name,
//                  command_line, action, rule_id, event_time }] }
async function handleAppAuditLogs(req: Request) {
  console.log(`[${VERSION}] handleAppAuditLogs called`);
  const endpoint = await validateAgentToken(req);

  const body = await req.json().catch(() => ({}));
  const logs: any[] = Array.isArray(body?.logs) ? body.logs : [];
  if (logs.length === 0) {
    return new Response(
      JSON.stringify({ success: true, count: 0, _version: VERSION }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const allowedActions = new Set(["observed", "allowed", "blocked"]);
  const rows = logs
    .filter((l) => l && typeof l === "object" && allowedActions.has(String(l.action || "observed")))
    .map((l) => ({
      organization_id: endpoint.organization_id,
      endpoint_id:     endpoint.id,
      event_time:      l.event_time || new Date().toISOString(),
      file_name:       l.file_name    ? String(l.file_name).substring(0, 500)    : null,
      file_path:       l.file_path    ? String(l.file_path).substring(0, 1000)   : null,
      sha256:          l.sha256       ? String(l.sha256).substring(0, 128)       : null,
      publisher:       l.publisher    ? String(l.publisher).substring(0, 500)    : null,
      product_name:    l.product_name ? String(l.product_name).substring(0, 500) : null,
      file_version:    l.file_version ? String(l.file_version).substring(0, 100) : null,
      process_id:      Number.isFinite(Number(l.process_id)) ? Number(l.process_id) : null,
      parent_path:     l.parent_path  ? String(l.parent_path).substring(0, 1000)  : null,
      user_name:       l.user_name    ? String(l.user_name).substring(0, 500)    : null,
      command_line:    l.command_line ? String(l.command_line).substring(0, 2000) : null,
      action:          String(l.action || "observed"),
      rule_id:         l.rule_id || null,
    }));

  let inserted = 0;
  const batchSize = 200;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase.from("app_audit_logs").insert(batch);
    if (error) {
      console.error("[app-audit-logs] insert error:", error);
    } else {
      inserted += batch.length;
    }
  }

  console.log(`[${VERSION}] app-audit-logs inserted: ${inserted} of ${rows.length}`);
  return new Response(
    JSON.stringify({ success: true, count: inserted, _version: VERSION }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// POST /wdac-applied - agent reports it applied a WDAC policy version. Updates
// endpoint_app_control_state per assigned rule set (matched by rule_set_id in
// the payload, OR auto-discovered if the endpoint has exactly one assignment).
// Body: { rules_hash, mode ('audit'|'enforce'|'off'), error?, rule_set_id? }
async function handleWdacApplied(req: Request) {
  console.log(`[${VERSION}] handleWdacApplied called`);
  const endpoint = await validateAgentToken(req);
  const body = await req.json().catch(() => ({}));

  const rulesHash = body?.rules_hash ? String(body.rules_hash) : null;
  const mode      = ["audit","enforce","off"].includes(String(body?.mode)) ? String(body.mode) : null;
  const errorMsg  = body?.error ? String(body.error).substring(0, 2000) : null;
  const explicitRuleSet = body?.rule_set_id ? String(body.rule_set_id) : null;

  // Resolve which rule_set rows to update. If the agent didn't specify, find
  // every active assignment for this endpoint and update each (they all just
  // had the same policy applied client-side).
  const { data: rows } = await supabase
    .from("endpoint_app_control_state")
    .select("endpoint_id, rule_set_id")
    .eq("endpoint_id", endpoint.id);

  if (!rows || rows.length === 0) {
    return new Response(JSON.stringify({ success: true, message: "no_assignments", _version: VERSION }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const targets = explicitRuleSet
    ? rows.filter(r => r.rule_set_id === explicitRuleSet)
    : rows;

  const patch: Record<string, unknown> = {
    last_applied_at: new Date().toISOString(),
  };
  if (rulesHash) patch.last_applied_version = rulesHash;
  if (mode)      patch.current_mode         = mode;
  if (errorMsg) {
    patch.last_apply_error    = errorMsg;
    // Increment failure counter atomically via a follow-up update.
  } else {
    patch.last_apply_error    = null;
    patch.apply_failure_count = 0;
  }

  let updated = 0;
  for (const t of targets) {
    const { error } = await supabase
      .from("endpoint_app_control_state")
      .update(patch)
      .eq("endpoint_id", t.endpoint_id)
      .eq("rule_set_id", t.rule_set_id);
    if (!error) updated++;
    else console.error(`[${VERSION}] /wdac-applied update error:`, error);

    if (errorMsg) {
      // RPC is optional — swallow failures so a missing function never
      // breaks the /wdac-applied response. PostgREST's builder is thenable
      // but not a Promise, so `.catch()` directly on it throws TypeError.
      try {
        await supabase.rpc("increment_wdac_apply_failure", {
          p_endpoint_id: t.endpoint_id, p_rule_set_id: t.rule_set_id,
        });
      } catch { /* optional */ }
    }
  }

  console.log(`[${VERSION}] wdac-applied updated ${updated} rows for endpoint ${endpoint.id}`);
  return new Response(JSON.stringify({ success: true, updated, _version: VERSION }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// Compare two semver-ish strings. Returns -1/0/+1.
// Strict numeric tuple compare on the first three dotted segments.
function cmpSemver(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

// PoC rec #4: queue an `upgrade_agent` command when an outdated v0.5.x+ host
// heartbeats. Dedup'd by checking for an existing queued/dispatched row.
async function maybeQueueAgentUpgrade(endpointId: string, orgId: string, reportedVersion: string | null) {
  if (!reportedVersion) return;
  // Only nudge agents on the modular runtime (>=0.5.0). Older hosts use the
  // separate agent-legacy-upgrade migration path.
  if (cmpSemver(reportedVersion, "0.5.0") < 0) return;

  const { data: latest } = await supabase
    .from("agent_versions")
    .select("version, download_url, sha256, ed25519_sig")
    .eq("runtime", "powershell")
    .eq("channel", "stable")
    .eq("is_active", true)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latest || cmpSemver(reportedVersion, latest.version) >= 0) return;

  // v0.7.21: never auto-queue an unsigned bundle. Agents from 0.7.21 refuse
  // these anyway (CommandExecutor.Invoke-UpgradeAgent), so queuing one would
  // just generate a failed command on every endpoint on every heartbeat.
  // Loud log, because a stable channel with no signature means the release
  // pipeline was run without SIGNING_KEY and the whole fleet has silently
  // stopped receiving updates.
  if (!latest.ed25519_sig) {
    console.error(
      `[${VERSION}] agent_versions ${latest.version} (powershell/stable) has no ed25519_sig — ` +
      `refusing to auto-queue upgrades. Re-publish with scripts/phase2a/build-release.sh and SIGNING_KEY set.`,
    );
    return;
  }

  // Dedup: skip if an upgrade already queued/dispatched and not yet expired.
  const nowIso = new Date().toISOString();
  const { data: existing } = await supabase
    .from("agent_commands")
    .select("id")
    .eq("endpoint_id", endpointId)
    .eq("command_type", "upgrade_agent")
    .in("status", ["queued", "dispatched"])
    .or("expires_at.is.null,expires_at.gt." + nowIso)
    .limit(1);

  if (existing && existing.length > 0) return;

  const { error } = await supabase
    .from("agent_commands")
    .insert({
      endpoint_id: endpointId,
      organization_id: orgId,
      command_type: "upgrade_agent",
      params: {
        target_version: latest.version,
        download_url: latest.download_url,
        sha256: latest.sha256,
        ed25519_sig: latest.ed25519_sig,
        reason: "heartbeat_version_drift",
        from_version: reportedVersion,
      },
    });
  if (error) {
    console.error(`[${VERSION}] auto-queue upgrade_agent failed:`, error);
  } else {
    console.log(`[${VERSION}] auto-queued upgrade_agent ${reportedVersion}->${latest.version} for endpoint ${endpointId}`);
  }
}
