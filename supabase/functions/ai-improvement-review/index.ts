// POST /functions/v1/ai-improvement-review
//
// IMPROVEMENT AGENT — phase 5 of the autonomous SOC.
//
// Reads the last 7 days of outcomes across the SOC (triage verdicts +
// consensus + customer confirms/overrides + adversarial refutations +
// human reviews) and proposes prompt + threshold + playbook updates.
//
// Writes a single ai_improvement_reports row per cycle. The proposed
// improvements are recommendations only — an operator reviews and decides
// whether to apply. (v1: no auto-apply, the risk of a bad prompt update
// degrading every subsequent triage decision is too high to take silently.)
//
// Triggered by the daily cron (02:30 UTC) or manually from /agents.
//
// Auth: x-mithras-soc-secret (cron) or service-role JWT (admin).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { callLlmStructured } from "../_shared/ai-llm.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SOC_SECRET           = Deno.env.get("AI_SOC_POLL_SECRET") ?? "";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Default falls back to the smaller model so the daily review works on
// OpenAI projects without gpt-4o access. Override via platform_settings
// .ai_improvement_model to use the bigger one — it produces better
// failure-pattern analysis but costs ~10x more.
const DEFAULT_REVIEW_MODEL = "gpt-4o-mini";
const DEFAULT_LOOKBACK_DAYS = 7;

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
    return jwt === SUPABASE_SERVICE_KEY;
}

// ============================================================================
// Metrics extraction — feeds the LLM analyst
// ============================================================================

interface FailureRow {
    alert_type: string;
    triage_verdict: string;
    triage_confidence: number;
    final_verdict: string;
    final_confidence: number;
    actual_outcome: string;  // "customer_confirmed" | "customer_overrode" | "human_overrode" | "human_approved" | "unresolved"
    disagreement_detected: boolean;
}

async function gatherMetrics(periodStart: string, periodEnd: string): Promise<{
    counts: Record<string, number>;
    sample_failures: FailureRow[];
    accuracy_pct: number | null;
    fp_rate: number | null;
    fn_rate: number | null;
    avg_confidence: number | null;
}> {
    // Pull triage decisions in window with the relevant outcome columns.
    const { data: decisions } = await supabase
        .from("ai_triage_decisions")
        .select(`
            id, alert_id, verdict, confidence, final_verdict, final_confidence,
            disagreement_detected, adversarial_refuted, auto_closed,
            review_action, reviewed_at,
            alerts:alert_id ( alert_type, acknowledged )
        `)
        .gte("created_at", periodStart)
        .lte("created_at", periodEnd)
        .eq("orchestration_state", "completed");

    // Outcome resolution. For each decision:
    //   - If an action exists -> customer_confirmed / customer_overrode / unresolved
    //   - Else if human reviewed -> human_approved / human_overrode
    //   - Else unresolved
    const { data: actions } = await supabase
        .from("ai_agent_actions")
        .select("triage_decision_id, customer_confirmed_at, customer_overrode_at, status")
        .gte("created_at", periodStart);

    const actionByDecision = new Map<string, { confirmed: boolean; overrode: boolean }>();
    for (const a of (actions ?? [])) {
        actionByDecision.set(String(a.triage_decision_id), {
            confirmed: !!a.customer_confirmed_at,
            overrode:  !!a.customer_overrode_at,
        });
    }

    const counts: Record<string, number> = {
        total: 0,
        true_positive: 0, false_positive: 0, needs_human: 0, inconclusive: 0,
        customer_confirmed: 0, customer_overrode: 0,
        human_approved: 0, human_overrode: 0,
        disagreement: 0, auto_closed: 0,
        adversarial_refuted: 0,
        unresolved: 0,
    };
    const failures: FailureRow[] = [];
    const confSum = { v: 0, n: 0 };

    for (const d of (decisions ?? []) as Array<Record<string, any>>) {
        counts.total++;
        if (d.final_verdict) counts[d.final_verdict] = (counts[d.final_verdict] ?? 0) + 1;
        if (d.disagreement_detected) counts.disagreement++;
        if (d.auto_closed) counts.auto_closed++;
        if (d.adversarial_refuted === true) counts.adversarial_refuted++;
        if (d.final_confidence != null) { confSum.v += Number(d.final_confidence); confSum.n++; }

        const act = actionByDecision.get(d.id);
        let actual = "unresolved";
        if (act?.confirmed) { counts.customer_confirmed++; actual = "customer_confirmed"; }
        else if (act?.overrode) { counts.customer_overrode++; actual = "customer_overrode"; }
        else if (d.review_action === "approved")   { counts.human_approved++; actual = "human_approved"; }
        else if (d.review_action === "overridden") { counts.human_overrode++; actual = "human_overrode"; }
        else { counts.unresolved++; }

        // Failure = (TP autoclose + customer overrode it) OR (FP autoclose + human overrode it)
        // OR Triage said one thing and the human/customer disagreed.
        const isFailure =
            actual === "customer_overrode" ||
            actual === "human_overrode" ||
            (d.disagreement_detected && actual !== "unresolved");
        if (isFailure && failures.length < 50) {
            failures.push({
                alert_type:      (d.alerts as any)?.alert_type ?? "unknown",
                triage_verdict:  String(d.verdict ?? ""),
                triage_confidence: Number(d.confidence ?? 0),
                final_verdict:   String(d.final_verdict ?? ""),
                final_confidence: Number(d.final_confidence ?? 0),
                actual_outcome:  actual,
                disagreement_detected: !!d.disagreement_detected,
            });
        }
    }

    // Accuracy = (customer_confirmed + human_approved) / (counts with explicit outcome).
    const explicitOutcomes =
        counts.customer_confirmed + counts.customer_overrode +
        counts.human_approved     + counts.human_overrode;
    const correctOutcomes =
        counts.customer_confirmed + counts.human_approved;

    return {
        counts,
        sample_failures: failures,
        accuracy_pct: explicitOutcomes > 0 ? Number((correctOutcomes / explicitOutcomes * 100).toFixed(1)) : null,
        fp_rate: explicitOutcomes > 0 ? Number((counts.human_overrode / explicitOutcomes * 100).toFixed(1)) : null,
        fn_rate: explicitOutcomes > 0 ? Number((counts.customer_overrode / explicitOutcomes * 100).toFixed(1)) : null,
        avg_confidence: confSum.n > 0 ? Number((confSum.v / confSum.n).toFixed(3)) : null,
    };
}

// ============================================================================
// LLM review
// ============================================================================

interface ReviewResponse {
    summary: string;
    accuracy_observation: string;
    confidence_calibration: string;
    top_failure_patterns: Array<{
        pattern: string;
        affected_alert_types: string[];
        frequency: number;
        likely_cause: string;
    }>;
    proposed_improvements: Array<{
        target_agent: "triage" | "verification" | "adversarial" | "response" | "comms" | "hunt" | "overall";
        improvement_kind: "prompt_update" | "threshold_change" | "playbook_change" | "schema_change" | "monitoring";
        recommendation: string;
        rationale: string;
        risk_level: "low" | "medium" | "high";
    }>;
    recommendations_summary: string;
}

const REVIEW_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["summary","accuracy_observation","confidence_calibration",
               "top_failure_patterns","proposed_improvements","recommendations_summary"],
    properties: {
        summary:                { type: "string", maxLength: 800 },
        accuracy_observation:   { type: "string", maxLength: 400 },
        confidence_calibration: { type: "string", maxLength: 400 },
        top_failure_patterns: {
            type: "array", maxItems: 6,
            items: {
                type: "object", additionalProperties: false,
                required: ["pattern","affected_alert_types","frequency","likely_cause"],
                properties: {
                    pattern: { type: "string", maxLength: 200 },
                    affected_alert_types: { type: "array", items: { type: "string" }, maxItems: 8 },
                    frequency: { type: "integer", minimum: 0 },
                    likely_cause: { type: "string", maxLength: 240 },
                },
            },
        },
        proposed_improvements: {
            type: "array", maxItems: 8,
            items: {
                type: "object", additionalProperties: false,
                required: ["target_agent","improvement_kind","recommendation","rationale","risk_level"],
                properties: {
                    target_agent:    { type: "string", enum: ["triage","verification","adversarial","response","comms","hunt","overall"] },
                    improvement_kind:{ type: "string", enum: ["prompt_update","threshold_change","playbook_change","schema_change","monitoring"] },
                    recommendation:  { type: "string", maxLength: 280 },
                    rationale:       { type: "string", maxLength: 280 },
                    risk_level:      { type: "string", enum: ["low","medium","high"] },
                },
            },
        },
        recommendations_summary: { type: "string", maxLength: 600 },
    },
};

const REVIEW_SYSTEM_PROMPT = `You are the IMPROVEMENT Agent for the Mithras
autonomous SOC. You read N days of outcomes and propose specific,
actionable changes to make the SOC more accurate next week.

RULES:
1. The "ground truth" for whether the SOC was right is the customer's
   feedback — they confirmed the threat (= TP was right) or marked it as
   false positive (= TP was wrong). Human operator approve/override is
   secondary truth, but lower-confidence (they may rubber-stamp).
2. Identify FAILURE PATTERNS, not individual mistakes. "Triage classified
   X alert type as TP at high confidence and the customer overrode 3 times
   in 5 days" is a pattern. "Triage got one alert wrong" is noise.
3. Proposed improvements must be SPECIFIC. Bad: "Improve the prompt".
   Good: "Add a rule to Triage's prompt: 'PowerShell with Base64 args is
   evidence-of-malice unless the parent process is a known IT automation
   tool (SCCM, Intune, Group Policy)' to address the FP pattern on alert
   type X."
4. risk_level reflects what could go wrong if we apply this change:
   - low:    documentation, monitoring add-on, threshold ±5%
   - medium: prompt clarification, playbook adjustment
   - high:   prompt rewrite, threshold ±20%+, schema change
5. If the data is thin (low alert count, no failures yet), say so plainly
   and recommend "monitoring" (collect more data) over premature changes.
6. Output ONLY the JSON. No prose.`;

async function getReviewModel(): Promise<string> {
    const { data } = await supabase.from("platform_settings").select("key,value")
        .in("key", ["ai_improvement_model", "openai_model"]);
    const map: Record<string, string> = {};
    for (const r of (data ?? [])) map[r.key as string] = String(r.value ?? "").trim();
    return map.ai_improvement_model || map.openai_model || DEFAULT_REVIEW_MODEL;
}

function buildReviewPrompt(args: {
    period_days: number;
    counts: Record<string, number>;
    accuracy_pct: number | null;
    fp_rate: number | null;
    fn_rate: number | null;
    avg_confidence: number | null;
    sample_failures: FailureRow[];
}): string {
    const out: string[] = [];
    out.push(`## Window`);
    out.push(`Last ${args.period_days} days.`);
    out.push("");
    out.push(`## Counts`);
    for (const [k, v] of Object.entries(args.counts)) {
        if (v > 0) out.push(`  ${k}: ${v}`);
    }
    out.push("");
    out.push(`## Top-line metrics`);
    out.push(`  Accuracy on explicit-outcome decisions: ${args.accuracy_pct ?? "n/a"}%`);
    out.push(`  False-positive rate:  ${args.fp_rate ?? "n/a"}%`);
    out.push(`  False-negative rate:  ${args.fn_rate ?? "n/a"}%`);
    out.push(`  Average final confidence: ${args.avg_confidence ?? "n/a"}`);
    out.push("");
    if (args.sample_failures.length > 0) {
        out.push(`## Sampled failures (up to 50)`);
        for (const f of args.sample_failures.slice(0, 30)) {
            out.push(`  type=${f.alert_type} triage=${f.triage_verdict}@${f.triage_confidence.toFixed(2)} final=${f.final_verdict}@${f.final_confidence.toFixed(2)} outcome=${f.actual_outcome} disagreed=${f.disagreement_detected}`);
        }
    } else {
        out.push(`## No failures sampled in window`);
        out.push(`(Could mean: detection working well, OR not enough volume yet to spot patterns.)`);
    }
    out.push("");
    out.push(`Analyse and propose improvements. Output only the JSON.`);
    return out.join("\n");
}

// ============================================================================
// MAIN
// ============================================================================

Deno.serve(async (req) => {
    const preflight = handlePreflight(req); if (preflight) return preflight;
    const origin = req.headers.get("origin");
    if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, origin);
    if (!isAuthorised(req)) return jsonResponse({ error: "forbidden" }, 403, origin);

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch {}
    const agent = (typeof body.agent === "string" ? body.agent : "overall") as
        "triage" | "verification" | "adversarial" | "response" | "comms" | "hunt" | "overall";
    const days = typeof body.days === "number" && body.days > 0 && body.days <= 30
        ? body.days : DEFAULT_LOOKBACK_DAYS;

    const periodEnd   = new Date().toISOString();
    const periodStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const metrics = await gatherMetrics(periodStart, periodEnd);

    const model = await getReviewModel();
    const llm = await callLlmStructured<ReviewResponse>({
        systemPrompt: REVIEW_SYSTEM_PROMPT,
        userPrompt:   buildReviewPrompt({
            period_days: days,
            counts: metrics.counts,
            accuracy_pct: metrics.accuracy_pct,
            fp_rate: metrics.fp_rate,
            fn_rate: metrics.fn_rate,
            avg_confidence: metrics.avg_confidence,
            sample_failures: metrics.sample_failures,
        }),
        schema:     REVIEW_SCHEMA,
        schemaName: "improvement_review",
        model,
        timeoutMs:  60_000,
        feature:    "improvement",
        organizationId: null,
    });

    if (!llm.ok) {
        const { data: row } = await supabase.from("ai_improvement_reports").insert({
            period_start: periodStart,
            period_end:   periodEnd,
            agent_name:   agent,
            alerts_analyzed: metrics.counts.total,
            metrics_breakdown: metrics.counts,
            status:       "failed",
            error_message: llm.error.slice(0, 800),
            model:        llm.model ?? model,
        }).select("id").single();
        return jsonResponse({ error: "llm_failed", details: llm.error, report_id: row?.id }, 502, origin);
    }

    const { data: row, error: insErr } = await supabase.from("ai_improvement_reports").insert({
        period_start: periodStart,
        period_end:   periodEnd,
        agent_name:   agent,
        alerts_analyzed: metrics.counts.total,
        accuracy_score: metrics.accuracy_pct != null ? metrics.accuracy_pct / 100 : null,
        false_positive_rate: metrics.fp_rate != null ? metrics.fp_rate / 100 : null,
        false_negative_rate: metrics.fn_rate != null ? metrics.fn_rate / 100 : null,
        avg_confidence_calibration: metrics.avg_confidence,
        top_failure_patterns: llm.data.top_failure_patterns,
        proposed_improvements: llm.data.proposed_improvements,
        metrics_breakdown: metrics.counts,
        summary: llm.data.summary,
        recommendations_summary: llm.data.recommendations_summary,
        status: "drafted",
        model: llm.model,
        prompt_tokens: llm.promptTokens,
        completion_tokens: llm.completionTokens,
        cost_microcents: Math.round((llm.costCents ?? 0) * 1000),
        latency_ms: llm.latencyMs,
        raw_response: llm.raw,
    }).select("id").single();
    if (insErr) {
        return jsonResponse({ error: "persist_failed", details: insErr.message }, 500, origin);
    }

    return jsonResponse({
        ok: true,
        report_id: row?.id,
        alerts_analyzed: metrics.counts.total,
        accuracy_pct: metrics.accuracy_pct,
        proposed_improvements: llm.data.proposed_improvements.length,
        top_failure_patterns: llm.data.top_failure_patterns.length,
        cost_microcents: Math.round((llm.costCents ?? 0) * 1000),
    }, 200, origin);
});
