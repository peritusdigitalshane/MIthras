// POST /functions/v1/ai-soc-orchestrate
//
// MULTI-AGENT SOC ORCHESTRATOR.
//
// New entry point fired by the alerts INSERT trigger (replacing direct
// invocation of ai-triage-alert). Coordinates the three agents and computes
// the consensus that drives auto-response.
//
// Flow:
//   1. Triage Agent      (ai-triage-alert)      — first verdict
//   2. Verification      (ai-verify-triage)     — independent re-classification
//   3. Adversarial       (ai-adversarial-check) — ONLY if (triage=TP OR disagreement)
//   4. Consensus         — written to ai_triage_decisions.final_verdict / .final_confidence
//
// Auto-close + auto-response decisions downstream consume final_verdict, not
// the triage verdict. That's the safety mechanism: a single LLM call can no
// longer single-handedly drive a customer-impacting action.
//
// Auth: x-mithras-soc-secret (from the Postgres trigger via pg_net) or
// service-role JWT (manual re-runs from /admin).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SOC_SECRET           = Deno.env.get("AI_SOC_POLL_SECRET") ?? "";
const FUNCTIONS_BASE       = Deno.env.get("FUNCTIONS_BASE_URL") ?? `${SUPABASE_URL}/functions/v1`;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

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

// Invoke another edge function with service-role auth, return parsed JSON.
async function callAgent(name: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: any }> {
    try {
        const resp = await fetch(`${FUNCTIONS_BASE}/${name}`, {
            method: "POST",
            headers: {
                "content-type":          "application/json",
                "x-mithras-soc-secret":  SOC_SECRET,
                "Authorization":         `Bearer ${SUPABASE_SERVICE_KEY}`,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(60_000),
        });
        let data: any = null;
        try { data = await resp.json(); } catch {}
        return { ok: resp.ok, status: resp.status, data };
    } catch (e) {
        return { ok: false, status: 0, data: { error: e instanceof Error ? e.message : String(e) } };
    }
}

// Consensus rules:
//
// Case A — Triage + Verification AGREE on verdict
//   • Both agree on FP at high confidence -> final = FP, conf = avg, no adversarial needed
//   • Both agree on TP at high confidence -> adversarial runs to verify; if not_refuted, final = TP
//   • Both agree but low confidence       -> final = needs_human (escalate)
//
// Case B — Triage + Verification DISAGREE
//   • Always run adversarial as tiebreaker
//   • If adversarial refutes triage's verdict, final = verification's verdict
//   • If adversarial does NOT refute triage's verdict, final = triage's verdict
//   • Confidence is dampened to the lower of the two
//
// Case C — Triage said needs_human or inconclusive
//   • Verification runs anyway (cheap insurance)
//   • Adversarial skipped (nothing high-stakes to refute)
//   • final = needs_human
function computeConsensus(args: {
    triageVerdict: string;
    triageConfidence: number;
    verifyVerdict: string | null;
    verifyConfidence: number | null;
    advRefuted: boolean | null;
    advCounterVerdict: string | null;
}): { finalVerdict: string; finalConfidence: number; disagreement: boolean; reasoning: string } {
    const { triageVerdict, triageConfidence, verifyVerdict, verifyConfidence, advRefuted, advCounterVerdict } = args;

    // Verification didn't complete (error or budget) — fall back to triage,
    // but with confidence damped because we couldn't get a second opinion.
    if (!verifyVerdict || verifyConfidence == null) {
        return {
            finalVerdict: triageVerdict === "true_positive" || triageVerdict === "false_positive"
                ? "needs_human"
                : triageVerdict,
            finalConfidence: Math.min(triageConfidence, 0.6),
            disagreement: false,
            reasoning: "Verification agent unavailable; downgraded to needs_human as a safety measure.",
        };
    }

    const agree = triageVerdict === verifyVerdict;

    // Case A: agreement
    if (agree) {
        const avgConf = (triageConfidence + verifyConfidence) / 2;

        if (triageVerdict === "true_positive") {
            // Only TP requires adversarial review before commit.
            if (advRefuted === true) {
                // Adversarial successfully refuted -> demote to needs_human.
                return {
                    finalVerdict: "needs_human",
                    finalConfidence: Math.min(avgConf, 0.6),
                    disagreement: false,
                    reasoning: "Triage and Verification agreed on true_positive, but Adversarial successfully refuted. Demoted to needs_human.",
                };
            }
            if (advRefuted === false) {
                return {
                    finalVerdict: "true_positive",
                    finalConfidence: Math.min(0.99, avgConf + 0.05),
                    disagreement: false,
                    reasoning: "Triage + Verification agreed on true_positive; Adversarial failed to refute. High confidence.",
                };
            }
            // Adversarial didn't run (shouldn't happen for TP, but defensive)
            return {
                finalVerdict: "true_positive",
                finalConfidence: avgConf,
                disagreement: false,
                reasoning: "Triage + Verification agreed on true_positive. Adversarial not run.",
            };
        }

        // FP, needs_human, inconclusive — no adversarial needed.
        return {
            finalVerdict: triageVerdict,
            finalConfidence: avgConf,
            disagreement: false,
            reasoning: `Triage + Verification agreed on ${triageVerdict}.`,
        };
    }

    // Case B: disagreement
    // Adversarial was used as a tiebreaker. Its target was triage's verdict.
    // If refuted -> verification wins. If not_refuted -> triage wins.
    const dampedConf = Math.min(triageConfidence, verifyConfidence);

    if (advRefuted === true) {
        // Adversarial refuted triage -> verification's call stands.
        // But further dampen confidence because there was disagreement at all.
        return {
            finalVerdict: verifyVerdict,
            finalConfidence: Math.min(dampedConf, 0.7),
            disagreement: true,
            reasoning: `Disagreement: Triage said ${triageVerdict}, Verification said ${verifyVerdict}. Adversarial sided with Verification.`,
        };
    }
    if (advRefuted === false) {
        return {
            finalVerdict: triageVerdict,
            finalConfidence: Math.min(dampedConf, 0.7),
            disagreement: true,
            reasoning: `Disagreement: Triage said ${triageVerdict}, Verification said ${verifyVerdict}. Adversarial failed to refute Triage.`,
        };
    }

    // Adversarial didn't run despite disagreement -> conservative escalation.
    return {
        finalVerdict: "needs_human",
        finalConfidence: 0.5,
        disagreement: true,
        reasoning: `Disagreement between Triage (${triageVerdict}) and Verification (${verifyVerdict}). Adversarial unavailable. Escalating.`,
    };
}

// Detach the heavy multi-agent work from the inbound request lifecycle.
// Supabase edge runtime can kill an isolate when the client disconnects
// (pg_net trigger's 60s timeout, browser tab close, etc.) — that aborts
// the orchestrator mid-chain and we end up with orphaned ai_triage_decisions
// at orchestration_state='pending'. EdgeRuntime.waitUntil() (available on
// Deno's Supabase runtime) ensures the promise keeps running until done.
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;
function detach(p: Promise<unknown>): void {
    try {
        if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
            EdgeRuntime.waitUntil(p);
        }
    } catch { /* ignore — fall through, p still runs */ }
}

async function runOrchestration(alertId: string, force: boolean): Promise<Record<string, unknown>> {
    // === STEP 1: TRIAGE ===
    const triageResp = await callAgent("ai-triage-alert", { alert_id: alertId, force });
    if (!triageResp.ok && triageResp.status !== 429) {
        return { ok: false, error: "triage_failed", details: triageResp.data };
    }
    if (triageResp.status === 429) {
        await supabase.from("ai_triage_decisions").update({
            orchestration_state: "budget_exceeded",
        }).eq("alert_id", alertId);
        return { ok: false, error: "budget_exceeded" };
    }

    // Load the triage decision row to get the id + verdict.
    const { data: triageDecision } = await supabase
        .from("ai_triage_decisions")
        .select("id, organization_id, verdict, confidence, key_indicators, reasoning_steps, summary, status")
        .eq("alert_id", alertId).maybeSingle();
    if (!triageDecision) {
        return { ok: false, error: "triage_decision_missing" };
    }
    if (triageDecision.status !== "completed" || !triageDecision.verdict) {
        await supabase.from("ai_triage_decisions").update({
            orchestration_state: "failed",
        }).eq("id", triageDecision.id);
        return { ok: false, error: "triage_did_not_complete", status: triageDecision.status };
    }

    // Persist triage's verdict to ai_agent_verdicts (mirror) so all three
    // agents live in one queryable place.
    await supabase.from("ai_agent_verdicts").upsert({
        triage_decision_id: triageDecision.id,
        alert_id: alertId,
        organization_id: triageDecision.organization_id,
        agent_name: "triage",
        verdict: triageDecision.verdict,
        confidence: triageDecision.confidence,
        summary: triageDecision.summary,
        key_indicators: triageDecision.key_indicators ?? [],
        reasoning_steps: triageDecision.reasoning_steps ?? [],
        refutations: [],
    }, { onConflict: "triage_decision_id,agent_name" });

    await supabase.from("ai_triage_decisions").update({
        orchestration_state: "triaged",
    }).eq("id", triageDecision.id);

    // === STEP 2: VERIFICATION ===
    // Verification runs on every completed triage, regardless of verdict.
    // Cost is small, value is high (catches Triage false_positives that
    // would otherwise auto-close).
    const verifyResp = await callAgent("ai-verify-triage", {
        alert_id: alertId,
        triage_decision_id: triageDecision.id,
    });
    // Surface verification failures explicitly. Without this, a timeout or
    // 429 from the LLM provider silently downgrades the verdict to
    // needs_human with no operator-visible signal — review finding H#3.
    const verificationFailed = !verifyResp.ok;

    // Load the verification verdict.
    const { data: verifyRow } = await supabase
        .from("ai_agent_verdicts")
        .select("verdict, confidence")
        .eq("triage_decision_id", triageDecision.id)
        .eq("agent_name", "verification")
        .maybeSingle();
    const verifyVerdict   = verifyRow?.verdict ?? null;
    const verifyConfidence = verifyRow?.confidence == null ? null : Number(verifyRow.confidence);

    await supabase.from("ai_triage_decisions").update({
        orchestration_state: "verified",
    }).eq("id", triageDecision.id);

    // === STEP 3: ADVERSARIAL (conditional) ===
    // Fire if: triage said true_positive (high-stakes) OR triage and verification disagree.
    const triageSaidTP = triageDecision.verdict === "true_positive";
    const agentsDisagree = !!verifyVerdict && verifyVerdict !== triageDecision.verdict;
    let advRefuted: boolean | null = null;
    const advCounterVerdict: string | null = null;
    let adversarialFailed = false;

    if (triageSaidTP || agentsDisagree) {
        const advResp = await callAgent("ai-adversarial-check", {
            alert_id: alertId,
            triage_decision_id: triageDecision.id,
        });
        const { data: advRow } = await supabase
            .from("ai_agent_verdicts")
            .select("verdict")
            .eq("triage_decision_id", triageDecision.id)
            .eq("agent_name", "adversarial")
            .maybeSingle();
        if (advRow?.verdict === "refuted")     advRefuted = true;
        if (advRow?.verdict === "not_refuted") advRefuted = false;

        // If the adversarial call failed AND there's no verdict row, the
        // safe interpretation is "refuted" — not "didn't run". The whole
        // point of adversarial review is to block autonomous response on
        // hallucinations; failing open defeats it (review finding H#2).
        if (!advResp.ok && advRefuted === null) {
            adversarialFailed = true;
            advRefuted = true;
        }
    }

    // === STEP 4: CONSENSUS ===
    const consensus = computeConsensus({
        triageVerdict:    triageDecision.verdict as string,
        triageConfidence: Number(triageDecision.confidence ?? 0),
        verifyVerdict,
        verifyConfidence,
        advRefuted,
        advCounterVerdict,
    });

    // Auto-close based on FINAL verdict, not Triage verdict. The whole point.
    const validCitationCount =
        (Array.isArray(triageDecision.key_indicators)  ? triageDecision.key_indicators.length  : 0) +
        (Array.isArray(triageDecision.reasoning_steps) ? triageDecision.reasoning_steps.length : 0);
    const shouldAutoClose =
        consensus.finalVerdict === "false_positive" &&
        consensus.finalConfidence >= 0.95 &&
        validCitationCount >= 1 &&
        !consensus.disagreement;

    await supabase.from("ai_triage_decisions").update({
        final_verdict:        consensus.finalVerdict,
        final_confidence:     consensus.finalConfidence,
        disagreement_detected: consensus.disagreement,
        adversarial_refuted:  advRefuted,
        consensus_reasoning:  consensus.reasoning,
        orchestration_state:  "completed",
        auto_closed:          shouldAutoClose,
        // Failure flags so the dashboard + health scan can surface silent
        // downgrades. NULL is reserved for "didn't run for legitimate
        // reasons" — these are always TRUE/FALSE.
        verification_failed:  verificationFailed,
        adversarial_failed:   adversarialFailed,
    }).eq("id", triageDecision.id);

    // === STEP 4b: FORENSIC INVESTIGATION ===
    // ai-investigate-alert (the "L2 analyst" of the AI SOC) pulls the full
    // event-log context around the alert, reconstructs the attack chain,
    // identifies affected assets, drafts containment + eradication steps,
    // and writes a customer-facing report — every claim cited.
    //
    // Fire whenever consensus is true_positive OR there's meaningful
    // disagreement (operator will want the timeline either way). We skip
    // false_positive and inconclusive — no point spending the LLM budget
    // on alerts the consensus already dismissed.
    //
    // Investigation runs BEFORE response so the response agent (and the
    // comms agent below) can reference the attack chain in its decisions
    // and the customer email. We never block response on investigation
    // succeeding — if it errors out we log and continue.
    let investigationId: string | null = null;
    let investigationFailed = false;
    const worthInvestigating =
        consensus.finalVerdict === "true_positive" ||
        (consensus.finalVerdict === "needs_human" && consensus.disagreement);
    if (worthInvestigating) {
        try {
            const invResp = await callAgent("ai-investigate-alert", {
                alert_id:           alertId,
                triage_decision_id: triageDecision.id,
            });
            if (invResp.ok && invResp.data?.investigation?.id) {
                investigationId = invResp.data.investigation.id;
            } else {
                investigationFailed = true;
            }
        } catch (e) {
            investigationFailed = true;
            console.error("forensic investigation failed (non-fatal):", e instanceof Error ? e.message : String(e));
        }
        if (investigationFailed) {
            await supabase.from("ai_triage_decisions")
                .update({ investigation_failed: true })
                .eq("id", triageDecision.id);
        }
    }

    // === STEP 5: AUTONOMOUS RESPONSE ===
    // Fire the Response Agent if consensus is solid TP. The agent applies
    // additional gates (org policy, confidence threshold, action-kind allowlist)
    // and is responsible for snapshotting + scheduling rollback.
    let responseAction: any = null;
    if (
        consensus.finalVerdict === "true_positive" &&
        !consensus.disagreement &&
        advRefuted !== true
    ) {
        const respResp = await callAgent("ai-response-execute", {
            triage_decision_id: triageDecision.id,
        });
        if (respResp.ok && respResp.data?.ok) {
            responseAction = respResp.data;
        }
    }

    // === STEP 5b: INCIDENT COMMANDER ===
    // For confirmed true_positive verdicts at high/critical severity, escalate
    // to a long-lived incident. The commander agent creates or updates the
    // platform incidents row, drafts the customer status update, sets SLA,
    // and links investigation + response together. Lower-severity TPs are
    // handled by the response + comms pipeline directly without spinning up
    // an incident object.
    let incidentId: string | null = null;
    let commanderFailed = false;
    const shouldOpenIncident =
        consensus.finalVerdict === "true_positive" &&
        !consensus.disagreement &&
        advRefuted !== true &&
        investigationId !== null;
    if (shouldOpenIncident) {
        try {
            const icResp = await callAgent("ai-incident-commander", {
                alert_id:           alertId,
                triage_decision_id: triageDecision.id,
                investigation_id:   investigationId,
                response_action:    responseAction,
            });
            if (icResp.ok && icResp.data?.incident_id) {
                incidentId = icResp.data.incident_id;
            } else {
                commanderFailed = true;
            }
        } catch (e) {
            commanderFailed = true;
            console.error("incident commander failed (non-fatal):", e instanceof Error ? e.message : String(e));
        }
        if (commanderFailed) {
            // Minimal-fallback incident — without this, an autonomous response
            // fires + a customer email may go out, but no incidents row exists
            // for the analyst to find. Review finding H#4.
            const { data: fallback } = await supabase.from("incidents")
                .insert({
                    organization_id:   triageDecision.organization_id,
                    alert_id:          alertId,
                    kind:              "alert",
                    severity:          "High",
                    status:            responseAction ? "contained" : "open",
                    title:             "AI Commander failed — manual review required",
                    description:       "ai-incident-commander did not complete. Triage/Verify/Adversarial all agreed this was a true positive; investigation completed. Operator must review and confirm response.",
                    triage_decision_id: triageDecision.id,
                    investigation_id:  investigationId,
                    commander_summary: "(commander agent failed — see ai_triage_decisions.commander_failed)",
                    opened_at:         new Date().toISOString(),
                    triaged_at:        new Date().toISOString(),
                })
                .select("id").maybeSingle();
            if (fallback) incidentId = fallback.id as string;
            await supabase.from("ai_triage_decisions")
                .update({ commander_failed: true })
                .eq("id", triageDecision.id);
        }
    }

    // === STEP 6: CUSTOMER COMMS ===
    // Send a customer-facing email whenever consensus is true_positive OR
    // there was meaningful disagreement worth surfacing. Skipped for
    // false_positive (auto-closed) and inconclusive (nothing to say).
    let commsResult: any = null;
    const worthNotifying =
        consensus.finalVerdict === "true_positive" ||
        (consensus.finalVerdict === "needs_human" && consensus.disagreement);
    if (worthNotifying) {
        const commsResp = await callAgent("ai-comms-notify", {
            triage_decision_id: triageDecision.id,
            action_id:          responseAction?.action_id ?? null,
            confirmation_token: responseAction?.confirmation_token ?? null,
        });
        if (commsResp.ok && commsResp.data?.ok) {
            commsResult = commsResp.data;
        }
    }

    if (shouldAutoClose) {
        await supabase.from("alerts").update({
            acknowledged: true,
            acknowledged_at: new Date().toISOString(),
        }).eq("id", alertId);
    } else {
        // If triage had auto-closed but consensus says otherwise, REOPEN the alert.
        // This prevents single-agent confident-wrong calls from silencing real threats.
        const { data: alertRow } = await supabase
            .from("alerts").select("acknowledged").eq("id", alertId).maybeSingle();
        if (alertRow?.acknowledged === true && consensus.finalVerdict !== "false_positive") {
            await supabase.from("alerts").update({
                acknowledged: false,
                acknowledged_at: null,
            }).eq("id", alertId);
        }
    }

    return {
        ok: true,
        triage_decision_id: triageDecision.id,
        triage_verdict:     triageDecision.verdict,
        verification_verdict: verifyVerdict,
        adversarial_refuted: advRefuted,
        final_verdict:      consensus.finalVerdict,
        final_confidence:   consensus.finalConfidence,
        disagreement:       consensus.disagreement,
        auto_closed:        shouldAutoClose,
        reasoning:          consensus.reasoning,
        investigation_id:   investigationId,
        incident_id:        incidentId,
        response_action:    responseAction,
        comms:              commsResult,
    };
}

Deno.serve(async (req) => {
    const preflight = handlePreflight(req); if (preflight) return preflight;
    const origin = req.headers.get("origin");
    if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, origin);
    if (!isAuthorised(req)) return jsonResponse({ error: "forbidden" }, 403, origin);

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch {}
    const alertId = String(body.alert_id ?? "");
    if (!alertId) return jsonResponse({ error: "alert_id_required" }, 400, origin);

    const force = body.force === true;
    // When the caller passes wait=true we run synchronously (for /agents
    // manual fire). Otherwise we accept the alert, kick off the chain in
    // the background (surviving client disconnect), and return immediately.
    const waitForResult = body.wait === true;

    if (waitForResult) {
        try {
            const result = await runOrchestration(alertId, force);
            return jsonResponse(result, 200, origin);
        } catch (e) {
            return jsonResponse({ error: "orchestration_failed", details: e instanceof Error ? e.message : String(e) }, 500, origin);
        }
    }

    detach(runOrchestration(alertId, force).catch((e) => {
        console.error("orchestration_background_failed", { alert_id: alertId, error: e instanceof Error ? e.message : String(e) });
    }));

    return jsonResponse({
        ok: true,
        queued: true,
        alert_id: alertId,
        note: "Orchestration running in the background. Poll ai_triage_decisions.orchestration_state for progress.",
    }, 202, origin);
});
