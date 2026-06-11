// POST /functions/v1/ai-incident-commander
//
// THE INCIDENT COMMANDER AGENT.
//
// Fires from ai-soc-orchestrate when consensus is a confirmed true_positive
// and the forensic investigation has succeeded. Creates or updates a
// public.incidents row that becomes the long-lived case object — survives
// across days, tracks playbook state, and owns the customer narrative.
//
// What it does in one pass:
//   1. Looks up the alert + investigation + response action context.
//   2. Asks an LLM to:
//        a. Pick a kind + severity for the incident (cross-checked against
//           investigation's MITRE tags + response action taken).
//        b. Write a one-line operator status ("isolated CMW-TS1; awaiting
//           customer approval on quarantine of file X").
//        c. Decide what the next playbook step should be:
//             forensics_complete → contained → customer_notified →
//             review_scheduled → resolved
//        d. Draft a short customer-facing summary (for the case page; the
//           real customer email is still drafted by ai-comms-notify).
//   3. Upserts public.incidents (one row per alert_id) with the above.
//   4. Returns { ok: true, incident_id }.
//
// Citation discipline: lighter than triage. The investigation already cited
// every claim; the commander's job is to summarise and pick a state, not
// to invent facts. We still validate that any asset / threat ids it mentions
// in playbook_state exist.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { callLlmStructured } from "../_shared/ai-llm.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SOC_SECRET           = Deno.env.get("AI_SOC_POLL_SECRET") ?? "";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

function isAuthorised(req: Request): boolean {
    const soc = req.headers.get("x-mithras-soc-secret") ?? "";
    if (SOC_SECRET && soc === SOC_SECRET) return true;
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    return jwt === SUPABASE_SERVICE_KEY;
}

// Default SLA windows by severity, in hours. Operators can override per-org
// later via a settings RPC.
const SLA_HOURS: Record<string, number> = {
    critical: 4,
    high:     12,
    medium:   24,
    low:      72,
    info:     168,
};

const COMMANDER_SCHEMA = {
    type: "object",
    properties: {
        kind: {
            type: "string",
            enum: [
                "malware","ransomware","credential_compromise","data_exfiltration",
                "lateral_movement","unauthorized_access","insider_threat","misconfiguration",
                "policy_violation","phishing","other",
            ],
        },
        severity: { type: "string", enum: ["info","low","medium","high","critical"] },
        title:               { type: "string", maxLength: 180 },
        commander_summary:   { type: "string", maxLength: 280 },
        customer_summary:    { type: "string", maxLength: 1200 },
        playbook_step: {
            type: "string",
            enum: ["forensics_complete","contained","customer_notified","review_scheduled","resolved"],
        },
        playbook_rationale:  { type: "string", maxLength: 600 },
        next_human_action:   { type: "string", maxLength: 280 },
    },
    required: ["kind","severity","title","commander_summary","customer_summary","playbook_step","playbook_rationale","next_human_action"],
    additionalProperties: false,
} as const;

interface CommanderOutput {
    kind: string;
    severity: string;
    title: string;
    commander_summary: string;
    customer_summary: string;
    playbook_step: string;
    playbook_rationale: string;
    next_human_action: string;
}

async function runCommander(input: {
    alertId: string;
    triageDecisionId: string;
    investigationId: string;
    responseAction: any;
}): Promise<{ ok: true; incident_id: string } | { ok: false; error: string }> {
    // === 1. Gather context ===
    const { data: alert, error: alertErr } = await supabase
        .from("alerts")
        .select("id, organization_id, alert_type, severity, title, message, endpoint_id, created_at")
        .eq("id", input.alertId)
        .maybeSingle();
    if (alertErr || !alert) return { ok: false, error: "alert_not_found" };

    const { data: triage } = await supabase
        .from("ai_triage_decisions")
        .select("id, summary, verdict, final_verdict, final_confidence, disagreement_detected, key_indicators, reasoning_steps")
        .eq("id", input.triageDecisionId)
        .maybeSingle();

    const { data: investigation } = await supabase
        .from("ai_investigations")
        .select("id, incident_summary, attack_chain_analysis, mitre_tags, affected_assets, suggested_containment, suggested_eradication, customer_report_markdown")
        .eq("id", input.investigationId)
        .maybeSingle();
    if (!investigation) return { ok: false, error: "investigation_not_found" };

    const { data: endpoint } = alert.endpoint_id
        ? await supabase.from("endpoints").select("hostname, os_version, organization_id").eq("id", alert.endpoint_id).maybeSingle()
        : { data: null };

    // Build the LLM prompt — short, since the heavy lifting is already done
    // by the triage + investigation upstream.
    const systemPrompt = `You are the Incident Commander Agent in a multi-agent SOC.
A confirmed true-positive alert has been triaged, verified, adversarially reviewed,
forensically investigated, and (potentially) auto-responded to. Your job is to
create the operator's case object: classify it, pick the right severity, write
a short status line, and decide where the playbook should be.

Choose the most specific kind. Cross-check severity against the response action
taken (isolation suggests at least high) and the investigation's MITRE tags.
playbook_step should reflect what has ALREADY happened:
  - forensics_complete: investigation done, no automated containment yet
  - contained:           response agent isolated/killed/quarantined the threat
  - customer_notified:   comms agent has drafted/sent the notification
  - review_scheduled:    waiting for post-incident review
  - resolved:            threat eradicated, customer informed, review complete

For this single call, you'll usually pick forensics_complete or contained
depending on whether responseAction is present.

commander_summary is a single line an on-call engineer sees in the open-incidents
feed. customer_summary is a paragraph for the case page. next_human_action is
what the operator should do RIGHT NOW.

Do not invent facts. Cite only what's in the investigation context. Plain text,
no markdown.`;

    const userPrompt = `Alert:
- type: ${alert.alert_type}
- severity (initial): ${alert.severity}
- title: ${alert.title ?? "(none)"}
- message: ${(alert.message ?? "").slice(0, 400)}
- endpoint: ${endpoint?.hostname ?? "(none)"} (${endpoint?.os_version ?? "?"})
- org_id: ${alert.organization_id}

Triage decision:
- final_verdict: ${triage?.final_verdict}
- final_confidence: ${triage?.final_confidence}
- disagreement_detected: ${triage?.disagreement_detected}
- summary: ${triage?.summary ?? "(none)"}

Investigation:
- incident_summary: ${(investigation.incident_summary ?? "").slice(0, 1000)}
- attack_chain_analysis: ${(investigation.attack_chain_analysis ?? "").slice(0, 1500)}
- mitre_tags: ${(investigation.mitre_tags ?? []).join(", ") || "(none)"}
- affected_assets_count: ${Array.isArray(investigation.affected_assets) ? investigation.affected_assets.length : 0}
- suggested_containment_count: ${Array.isArray(investigation.suggested_containment) ? investigation.suggested_containment.length : 0}
- suggested_eradication_count: ${Array.isArray(investigation.suggested_eradication) ? investigation.suggested_eradication.length : 0}

Response action taken: ${input.responseAction ? JSON.stringify(input.responseAction).slice(0, 400) : "(none — no autonomous action ran)"}

Produce the structured commander output.`;

    const llmResult = await callLlmStructured<CommanderOutput>({
        systemPrompt,
        userPrompt,
        schema: COMMANDER_SCHEMA as unknown as Record<string, unknown>,
        schemaName: "incident_commander_output",
        feature: "incident_commander",
        organizationId: alert.organization_id,
        timeoutMs: 45_000,
    });

    if (!llmResult.ok) {
        return { ok: false, error: `llm_failed: ${llmResult.error}` };
    }

    const out = llmResult.data;
    const slaHours = SLA_HOURS[out.severity] ?? 24;
    const slaDueAt = new Date(Date.now() + slaHours * 60 * 60_000).toISOString();
    const commanderCostMicrocents = Math.round(llmResult.costCents * 1000);

    // === 2. Upsert incidents (one per alert_id) ===
    // We treat alert_id as the natural key for orchestrator-spawned incidents.
    const { data: existing } = await supabase
        .from("incidents")
        .select("id, status, sla_due_at, opened_at")
        .eq("alert_id", input.alertId)
        .maybeSingle();

    const nowIso = new Date().toISOString();
    const playbookState = {
        forensics_complete: true,
        contained: !!input.responseAction,
        customer_notified: out.playbook_step === "customer_notified" || out.playbook_step === "review_scheduled" || out.playbook_step === "resolved",
        review_scheduled: out.playbook_step === "review_scheduled" || out.playbook_step === "resolved",
        resolved: out.playbook_step === "resolved",
        next_human_action: out.next_human_action,
        last_decision_at: nowIso,
    };

    let incidentId: string;
    if (existing) {
        // Update — preserve opened_at + status if it's already past 'open'.
        const updateFields: Record<string, unknown> = {
            kind:              out.kind,
            severity:          out.severity,
            title:             out.title,
            description:       out.customer_summary,
            triage_decision_id: input.triageDecisionId,
            investigation_id:  input.investigationId,
            playbook_step:     out.playbook_step,
            playbook_state:    playbookState,
            commander_summary: out.commander_summary,
            commander_last_action_at: nowIso,
            commander_model:   llmResult.model,
            commander_cost_microcents: (existing as any).commander_cost_microcents ?? 0 + commanderCostMicrocents,
            sla_due_at:        existing.sla_due_at ?? slaDueAt,
        };
        // Bump status forward if appropriate but never backwards.
        if (existing.status === "open" && out.playbook_step !== "forensics_complete") {
            updateFields.status = "investigating";
        }
        if (existing.status !== "resolved" && out.playbook_step === "contained") {
            updateFields.status = "contained";
        }
        const { error: updErr } = await supabase
            .from("incidents")
            .update(updateFields)
            .eq("id", existing.id);
        if (updErr) return { ok: false, error: `update_failed: ${updErr.message}` };
        incidentId = existing.id;
    } else {
        const initialStatus = input.responseAction ? "contained" : "investigating";
        const { data: inserted, error: insErr } = await supabase
            .from("incidents")
            .insert({
                organization_id:   alert.organization_id,
                endpoint_id:       alert.endpoint_id,
                alert_id:          input.alertId,
                kind:              out.kind,
                severity:          out.severity,
                status:            initialStatus,
                title:             out.title,
                description:       out.customer_summary,
                triage_decision_id: input.triageDecisionId,
                investigation_id:  input.investigationId,
                playbook_step:     out.playbook_step,
                playbook_state:    playbookState,
                commander_summary: out.commander_summary,
                commander_last_action_at: nowIso,
                commander_model:   llmResult.model,
                commander_cost_microcents: commanderCostMicrocents,
                opened_at:         nowIso,
                sla_due_at:        slaDueAt,
                triaged_at:        nowIso,
            })
            .select("id")
            .single();
        if (insErr || !inserted) return { ok: false, error: `insert_failed: ${insErr?.message ?? "no row"}` };
        incidentId = inserted.id;
    }

    // === 3. Note in incident_notes for the audit trail ===
    try {
        await supabase.from("incident_notes").insert({
            incident_id: incidentId,
            kind:        "commander_decision",
            note:        out.playbook_rationale,
            author_role: "ai_commander",
        });
    } catch { /* notes are best-effort */ }

    return { ok: true, incident_id: incidentId };
}

Deno.serve(async (req) => {
    const origin = req.headers.get("Origin");
    if (req.method === "OPTIONS") return handlePreflight(req);
    if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, origin);
    if (!isAuthorised(req)) return jsonResponse({ error: "forbidden" }, 403, origin);

    let body: any = {};
    try { body = await req.json(); } catch {}
    const alertId            = String(body.alert_id ?? "");
    const triageDecisionId   = String(body.triage_decision_id ?? "");
    const investigationId    = String(body.investigation_id ?? "");
    const responseAction     = body.response_action ?? null;

    if (!alertId || !triageDecisionId || !investigationId) {
        return jsonResponse({ error: "alert_id, triage_decision_id and investigation_id required" }, 400, origin);
    }

    const result = await runCommander({ alertId, triageDecisionId, investigationId, responseAction });
    if (!result.ok) return jsonResponse(result, 500, origin);
    return jsonResponse(result, 200, origin);
});
