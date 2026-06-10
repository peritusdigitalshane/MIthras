// POST /functions/v1/ai-response-rollback
//
// Rolls back an autonomous Response Agent action. Three callers:
//   * Customer one-click "Mark as false positive" link from the notification email
//     (authenticated by confirmation_token; no JWT required)
//   * Operator manual rollback from the agent dashboard (JWT)
//   * Direct service call (cron + manual ops)
//
// Customer "Confirm threat" instead routes to ai-response-confirm — separate
// function so the two flows have distinct audit trails.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SOC_SECRET           = Deno.env.get("AI_SOC_POLL_SECRET") ?? "";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const REVERSAL_KIND: Record<string, string | null> = {
    isolate_network:    "release_isolation",
    release_isolation:  "isolate_network",
    kill_process:       null,
    quarantine_file:    null,
    run_quick_scan:     null,
    run_full_scan:      null,
    collect_persistence: null,
    restart_agent:      null,
};

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

async function sha256Hex(s: string): Promise<string> {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function resolveAuth(req: Request, body: Record<string, unknown>): Promise<{
    ok: boolean;
    reason: "service" | "operator" | "token_link" | "denied";
    userId?: string;
    actionId?: string;
}> {
    const socSecret = req.headers.get("x-mithras-soc-secret") ?? "";
    if (SOC_SECRET && socSecret === SOC_SECRET) return { ok: true, reason: "service" };
    const auth = req.headers.get("Authorization") ?? "";
    const jwt = auth.replace(/^Bearer\s+/i, "").trim();
    if (jwt === SUPABASE_SERVICE_KEY) return { ok: true, reason: "service" };

    // Token-based one-click link: body.confirmation_token is the raw token the
    // customer received via email. We hash it server-side and look up by hash —
    // the plaintext token is never stored anywhere in the DB.
    const token = String(body.confirmation_token ?? "").trim();
    if (token) {
        // Tokens are 43 chars (base64url-encoded 32 random bytes). Reject
        // anything outside that range as a fast denial — protects against
        // timing oracle on the lookup for obviously-malformed inputs.
        if (token.length < 20 || token.length > 64) {
            return { ok: false, reason: "denied" };
        }
        const hash = await sha256Hex(token);
        const { data: action } = await supabase
            .from("ai_agent_actions").select("id, rollback_at, status")
            .eq("confirmation_token_hash", hash).maybeSingle();
        if (action && action.status === "executed" && (!action.rollback_at || new Date(action.rollback_at).getTime() > Date.now())) {
            return { ok: true, reason: "token_link", actionId: action.id as string };
        }
        return { ok: false, reason: "denied" };
    }

    // Operator JWT.
    if (jwt) {
        const { data: { user } } = await supabase.auth.getUser(jwt);
        if (user) return { ok: true, reason: "operator", userId: user.id };
    }
    return { ok: false, reason: "denied" };
}

Deno.serve(async (req) => {
    const preflight = handlePreflight(req); if (preflight) return preflight;
    const origin = req.headers.get("origin");
    if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, origin);

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch {}

    const authz = await resolveAuth(req, body);
    if (!authz.ok) return jsonResponse({ error: "forbidden" }, 403, origin);

    const actionId = authz.actionId ?? String(body.action_id ?? "");
    if (!actionId) return jsonResponse({ error: "action_id_required" }, 400, origin);

    // Load the action with tenancy check for operator callers.
    const { data: action } = await supabase
        .from("ai_agent_actions")
        .select("id, organization_id, endpoint_id, action_kind, status, customer_overrode_at, rolled_back_at, linked_command_id")
        .eq("id", actionId).maybeSingle();
    if (!action) return jsonResponse({ error: "action_not_found" }, 404, origin);

    if (authz.reason === "operator") {
        // Operator must be org-admin of the action's org OR super-admin.
        const { data: superAdmin } = await supabase
            .from("super_admins").select("user_id").eq("user_id", authz.userId).maybeSingle();
        if (!superAdmin) {
            const { data: membership } = await supabase
                .from("organization_memberships")
                .select("role")
                .eq("user_id", authz.userId)
                .eq("organization_id", action.organization_id)
                .maybeSingle();
            if (!membership || !["admin","owner"].includes(membership.role as string)) {
                return jsonResponse({ error: "forbidden" }, 403, origin);
            }
        }
    }

    // Idempotent — already rolled back?
    if (action.status === "rolled_back" || action.rolled_back_at) {
        return jsonResponse({ ok: true, cached: true, status: action.status }, 200, origin);
    }
    if (action.status === "customer_confirmed") {
        return jsonResponse({ error: "already_confirmed_cannot_rollback" }, 409, origin);
    }

    const reversalKind = REVERSAL_KIND[action.action_kind as string];
    let rollbackCommandId: string | null = null;

    if (reversalKind && action.endpoint_id) {
        // Try to cancel any not-yet-dispatched forward command first so we don't
        // race with the agent.
        if (action.linked_command_id) {
            await supabase.from("agent_commands")
                .update({ status: "cancelled", error_message: "ai_rollback_cancelled" })
                .eq("id", action.linked_command_id)
                .in("status", ["queued","dispatched"]);
        }

        const { data: cmd, error: cmdErr } = await supabase
            .from("agent_commands")
            .insert({
                endpoint_id:     action.endpoint_id,
                organization_id: action.organization_id,
                command_type:    reversalKind,
                params: {
                    reason: authz.reason === "token_link" ? "customer_marked_false_positive" : "operator_rollback",
                    source_action_id: action.id,
                },
                status:          "queued",
                correlation_id:  "ai-rollback-" + action.id,
            })
            .select("id").single();
        if (!cmdErr && cmd) rollbackCommandId = cmd.id as string;
    }

    const isCustomerOverride = authz.reason === "token_link" || body.kind === "customer_override";

    const update: Record<string, unknown> = {
        status:            "rolled_back",
        rolled_back_at:    new Date().toISOString(),
        rollback_command_id: rollbackCommandId,
    };
    if (isCustomerOverride) update.customer_overrode_at = new Date().toISOString();

    await supabase.from("ai_agent_actions").update(update).eq("id", actionId);

    // Customer-override implies the call was a false positive — re-mark the
    // alert as acknowledged (closed). Operator rollback leaves the alert
    // state alone since it might be precautionary.
    if (isCustomerOverride) {
        const { data: act } = await supabase
            .from("ai_agent_actions").select("alert_id").eq("id", actionId).maybeSingle();
        if (act?.alert_id) {
            await supabase.from("alerts")
                .update({ acknowledged: true, acknowledged_at: new Date().toISOString() })
                .eq("id", act.alert_id);
        }
    }

    return jsonResponse({
        ok: true,
        rolled_back: true,
        reversal_command_id: rollbackCommandId,
        customer_override: isCustomerOverride,
    }, 200, origin);
});
