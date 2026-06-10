// POST /functions/v1/ai-response-execute
//
// RESPONSE AGENT — phase 4 of the multi-agent SOC.
//
// Fires when the orchestrator's consensus says true_positive at high
// confidence. Snapshots current state, dispatches a reversible agent command,
// and arms an auto-rollback timer. The customer gets a notification with
// a one-click "Confirm threat" / "Mark false positive" link.
//
// Triggered by ai-soc-orchestrate after consensus, or manually from /agents
// for force-execution.
//
// Auth: x-mithras-soc-secret (orchestrator) or service-role JWT (admin).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SOC_SECRET           = Deno.env.get("AI_SOC_POLL_SECRET") ?? "";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Default consensus confidence threshold to autonomously fire response.
// Overridable per-org via organizations.settings.ai_response_min_confidence.
const DEFAULT_MIN_CONFIDENCE = 0.85;
const DEFAULT_ROLLBACK_MINUTES = 240;

// Map the Triage recommended_command set to action_kind. (Same values, but
// expressing intent — leaves room for future divergence such as M365 actions.)
const ALLOWED_ACTIONS = new Set([
    "isolate_network",
    "release_isolation",
    "kill_process",
    "quarantine_file",
    "run_quick_scan",
    "run_full_scan",
    "collect_persistence",
    "restart_agent",
]);

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

function isAuthorised(req: Request): boolean {
    const socSecret = req.headers.get("x-mithras-soc-secret") ?? "";
    if (SOC_SECRET && socSecret === SOC_SECRET) return true;
    const auth = req.headers.get("Authorization") ?? "";
    const jwt = auth.replace(/^Bearer\s+/i, "").trim();
    if (jwt === SUPABASE_SERVICE_KEY) return true;
    return false;
}

interface OrgSettings {
    ai_response_enabled?: boolean;
    ai_response_min_confidence?: number;
    ai_response_rollback_minutes?: number;
    ai_response_allowed_actions?: string[];
}

async function loadOrgGate(orgId: string): Promise<OrgSettings> {
    const { data } = await supabase.from("organizations").select("settings").eq("id", orgId).maybeSingle();
    const settings = (data?.settings as Record<string, unknown>) ?? {};
    return {
        ai_response_enabled:        settings.ai_response_enabled !== false,  // default ON
        ai_response_min_confidence: typeof settings.ai_response_min_confidence === "number" ? settings.ai_response_min_confidence as number : DEFAULT_MIN_CONFIDENCE,
        ai_response_rollback_minutes: typeof settings.ai_response_rollback_minutes === "number" ? settings.ai_response_rollback_minutes as number : DEFAULT_ROLLBACK_MINUTES,
        ai_response_allowed_actions: Array.isArray(settings.ai_response_allowed_actions) ? settings.ai_response_allowed_actions as string[] : null,
    } as OrgSettings;
}

// Generate a one-use rollback token. We return the raw token to the caller
// (delivered to the customer via email) and store ONLY the SHA-256 hash in
// the DB. That way an RLS leak of ai_agent_actions doesn't yield rollback
// authority over the action — same pattern as a password reset token.
function base64UrlEncode(bytes: Uint8Array): string {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sha256Hex(s: string): Promise<string> {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function generateConfirmationToken(): Promise<{ raw: string; hash: string }> {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const raw = base64UrlEncode(bytes);
    const hash = await sha256Hex(raw);
    return { raw, hash };
}

// Take a pre-action snapshot of the state we'll need to restore on rollback.
// Returns the snapshot JSON to embed in ai_agent_actions.snapshot_data.
async function takeSnapshot(actionKind: string, endpointId: string | null): Promise<Record<string, unknown>> {
    if (!endpointId) return {};
    switch (actionKind) {
        case "isolate_network": {
            const { data } = await supabase
                .from("endpoints").select("id, isolation_mode, is_isolated")
                .eq("id", endpointId).maybeSingle();
            return {
                was_isolated:   (data as any)?.is_isolated === true,
                isolation_mode: (data as any)?.isolation_mode ?? null,
            };
        }
        // Other action kinds are either irreversible (kill_process), informational
        // (scans/collect), or set their own reversal context in agent_commands.
        default:
            return {};
    }
}

Deno.serve(async (req) => {
    const preflight = handlePreflight(req); if (preflight) return preflight;
    const origin = req.headers.get("origin");
    if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, origin);
    if (!isAuthorised(req)) return jsonResponse({ error: "forbidden" }, 403, origin);

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch {}
    const triageDecisionId = String(body.triage_decision_id ?? "");
    if (!triageDecisionId) return jsonResponse({ error: "triage_decision_id_required" }, 400, origin);

    const forceOverride: string | null = typeof body.action_kind === "string" ? body.action_kind as string : null;
    const forceFire = body.force === true;

    // Load the orchestrated triage decision + the originating alert.
    const { data: td } = await supabase
        .from("ai_triage_decisions")
        .select("id, alert_id, organization_id, verdict, confidence, recommended_command, final_verdict, final_confidence, orchestration_state, disagreement_detected, adversarial_refuted")
        .eq("id", triageDecisionId).maybeSingle();
    if (!td) return jsonResponse({ error: "triage_decision_not_found" }, 404, origin);

    // Gate 1 — consensus must be complete and TP.
    if (!forceFire) {
        if (td.orchestration_state !== "completed") {
            return jsonResponse({ error: "orchestration_not_completed", state: td.orchestration_state }, 409, origin);
        }
        if (td.final_verdict !== "true_positive") {
            return jsonResponse({ error: "consensus_not_malicious", final_verdict: td.final_verdict }, 409, origin);
        }
        if (td.disagreement_detected === true) {
            // Disagreement -> escalate, don't auto-respond.
            return jsonResponse({ error: "disagreement_detected_no_autoresponse" }, 409, origin);
        }
        if (td.adversarial_refuted === true) {
            return jsonResponse({ error: "adversarial_refuted_no_autoresponse" }, 409, origin);
        }
    }

    // Gate 2 — per-org enable + confidence threshold.
    const settings = await loadOrgGate(td.organization_id as string);
    if (settings.ai_response_enabled === false && !forceFire) {
        return jsonResponse({ error: "ai_response_disabled_by_org_policy" }, 403, origin);
    }
    const finalConf = Number(td.final_confidence ?? td.confidence ?? 0);
    const minConf = settings.ai_response_min_confidence ?? DEFAULT_MIN_CONFIDENCE;
    if (!forceFire && finalConf < minConf) {
        return jsonResponse({ error: "confidence_below_threshold", final_confidence: finalConf, threshold: minConf }, 409, origin);
    }

    // Pick the action: explicit override or Triage's recommended_command.
    const actionKind = (forceOverride ?? (td.recommended_command as string | null) ?? "").trim();
    if (!actionKind || actionKind === "none" || !ALLOWED_ACTIONS.has(actionKind)) {
        return jsonResponse({ error: "no_valid_action", recommended_command: td.recommended_command }, 409, origin);
    }
    if (settings.ai_response_allowed_actions && !settings.ai_response_allowed_actions.includes(actionKind)) {
        return jsonResponse({ error: "action_not_allowed_by_org_policy", action_kind: actionKind }, 403, origin);
    }

    // Resolve endpoint_id from the alert.
    const { data: alertRow } = await supabase
        .from("alerts").select("id, endpoint_id, organization_id, acknowledged, title")
        .eq("id", td.alert_id as string).maybeSingle();
    if (!alertRow) return jsonResponse({ error: "alert_not_found" }, 404, origin);

    // Idempotency — skip if we already have an executed/in-flight action for
    // this triage decision.
    const { data: existing } = await supabase
        .from("ai_agent_actions").select("id, status")
        .eq("triage_decision_id", triageDecisionId)
        .in("status", ["executing","executed","customer_confirmed"])
        .maybeSingle();
    if (existing) {
        return jsonResponse({ ok: true, cached: true, action_id: existing.id, status: existing.status }, 200, origin);
    }

    const snapshot = await takeSnapshot(actionKind, alertRow.endpoint_id as string | null);

    // Endpoint actions need a target endpoint. M365 actions (none in v1) would skip this.
    let commandId: string | null = null;
    if (alertRow.endpoint_id) {
        const { data: cmd, error: cmdErr } = await supabase
            .from("agent_commands")
            .insert({
                endpoint_id:     alertRow.endpoint_id,
                organization_id: td.organization_id,
                command_type:    actionKind,
                params:          {
                    reason:          "ai_autonomous_response",
                    triage_decision_id: triageDecisionId,
                    alert_id:        td.alert_id,
                },
                status:          "queued",
                correlation_id:  "ai-resp-" + triageDecisionId,
            })
            .select("id").single();
        if (cmdErr || !cmd) {
            return jsonResponse({ error: "agent_command_insert_failed", details: cmdErr?.message }, 500, origin);
        }
        commandId = cmd.id;
    } else {
        return jsonResponse({ error: "no_endpoint_for_action" }, 409, origin);
    }

    const rollbackMinutes = settings.ai_response_rollback_minutes ?? DEFAULT_ROLLBACK_MINUTES;
    const rollbackAt = new Date(Date.now() + rollbackMinutes * 60_000).toISOString();

    // Generate confirmation token + hash. Only the hash is stored; the raw
    // token is returned to the caller exactly once (the customer notification
    // delivery layer is responsible for embedding it in the one-click link).
    const tokenPair = await generateConfirmationToken();

    const { data: action, error: actionErr } = await supabase
        .from("ai_agent_actions")
        .insert({
            triage_decision_id: triageDecisionId,
            alert_id:           td.alert_id,
            organization_id:    td.organization_id,
            endpoint_id:        alertRow.endpoint_id,
            action_kind:        actionKind,
            status:             "executing",
            auto_rollback_minutes: rollbackMinutes,
            snapshot_data:      snapshot,
            reasoning:          `Autonomous response: consensus ${td.final_verdict} at ${finalConf} confidence (threshold ${minConf}). Action ${actionKind} dispatched with ${rollbackMinutes}-minute rollback window.`,
            rollback_at:        rollbackAt,
            executed_at:        new Date().toISOString(),
            linked_command_id:  commandId,
            confirmation_token_hash: tokenPair.hash,
        })
        .select("id")
        .single();

    if (actionErr || !action) {
        // Try to cancel the dangling command so it doesn't execute orphaned.
        await supabase.from("agent_commands")
            .update({ status: "cancelled", error_message: "ai_action_insert_failed" })
            .eq("id", commandId);
        return jsonResponse({ error: "action_insert_failed", details: actionErr?.message }, 500, origin);
    }

    return jsonResponse({
        ok: true,
        action_id:           action.id,
        action_kind:         actionKind,
        // Raw token — deliver to the customer immediately, never store this
        // anywhere outside the email. There is no way to retrieve it later.
        confirmation_token:  tokenPair.raw,
        rollback_at:         rollbackAt,
        rollback_minutes:    rollbackMinutes,
        command_id:          commandId,
        reasoning:           `Autonomous response fired — ${actionKind} on endpoint ${alertRow.endpoint_id}. Auto-reverses in ${rollbackMinutes} minutes unless customer confirms threat.`,
    }, 200, origin);
});
