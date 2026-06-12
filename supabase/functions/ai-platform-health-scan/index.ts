// POST /functions/v1/ai-platform-health-scan
//
// Platform health scanner. Runs every 15 minutes from pg_cron and on-demand
// from the /admin/health "Run scan now" button.
//
// Flow:
//   1. Open a platform_health_runs row (status='running').
//   2. Collect raw signals — failed crons, stale pulses, RLS holes, agent
//      fleet silence, AI budget overruns, stuck jobs. All cheap SQL.
//   3. For each raw signal, ask the LLM to triage: severity (critical/high/
//      medium/low/info) + recommended_fix in one or two sentences.
//   4. UPSERT each finding into platform_health_findings keyed by finding_key
//      (idempotent — re-detected conditions bump last_seen).
//   5. AUTO-RESOLVE: any open finding NOT seen in this run gets status
//      moved to 'auto_resolved' (the underlying condition cleared).
//   6. Close the run row with summary counts.
//
// Auth: super-admin JWT (manual run from UI), or x-cron-secret header
// (pg_cron schedule). Service-role JWT is also accepted (internal calls).
//
// Returns the same structured summary that gets written to platform_health_runs.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { callLlmStructured } from "../_shared/ai-llm.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET          = Deno.env.get("CRON_SECRET") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

async function isAuthorised(req: Request): Promise<boolean> {
    // cron-secret shortcut
    const cronSec = req.headers.get("x-cron-secret") ?? "";
    if (CRON_SECRET && cronSec === CRON_SECRET) return true;

    const auth = req.headers.get("Authorization") ?? "";
    const jwt  = auth.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return false;
    if (jwt === SUPABASE_SERVICE_KEY) return true;

    const { data: { user } } = await supabase.auth.getUser(jwt);
    if (!user) return false;
    const { data: sa } = await supabase
        .from("super_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    return !!sa;
}

// ============================================================================
// Raw signal collectors. Each returns a list of { finding_key, category,
// title, description, evidence } objects. All read-only; no side-effects.
// ============================================================================

interface RawFinding {
    finding_key: string;
    category: "cron"|"edge_function"|"database"|"agent_fleet"|"ai_pipeline"|"budget"|"integration"|"security"|"other";
    title: string;
    description: string;
    evidence: Record<string, unknown>;
}

// 1. Crons that failed within the last hour. cron.job_run_details is owned
//    by the postgres role — we need a SECURITY DEFINER helper to read it from
//    the service role, but the simpler path here is calling rpc on a wrapper.
//    Since we don't have one yet, we use the supabase-js admin client which
//    runs as the service role + has direct access via the rest gateway.
async function detectFailedCrons(): Promise<RawFinding[]> {
    const { data, error } = await supabase.rpc("get_failed_cron_runs", { lookback_minutes: 60 });
    if (error) {
        // If the RPC doesn't exist yet, surface that as a finding so we notice.
        return [{
            finding_key: "scanner:missing_rpc:get_failed_cron_runs",
            category: "edge_function",
            title: "Scanner RPC missing: get_failed_cron_runs",
            description: `The scanner expects a helper RPC to read cron.job_run_details. Error: ${error.message}`,
            evidence: { error: error.message },
        }];
    }
    const out: RawFinding[] = [];
    for (const row of (data ?? []) as Array<{ jobname: string; status: string; return_message: string; runs: number; last_run: string }>) {
        out.push({
            finding_key: `cron_failed:${row.jobname}`,
            category: "cron",
            title: `Cron job failing: ${row.jobname}`,
            description: `pg_cron job '${row.jobname}' has ${row.runs} failed run(s) in the last hour. Most recent: ${row.return_message ?? "no message"}`,
            evidence: {
                jobname: row.jobname,
                failed_runs: row.runs,
                status: row.status,
                last_run: row.last_run,
                return_message: row.return_message,
            },
        });
    }
    return out;
}

// 2. Stale pulses — crons that haven't run when they should have, or whose
//    expected downstream output has gone quiet.
async function detectStalePulses(): Promise<RawFinding[]> {
    const out: RawFinding[] = [];

    // 2a. WordPress alert detector should fire something — at minimum a
    //     heartbeat row — every 2 minutes. If site_event_logs has new rows
    //     but the detector hasn't run in >10 min, flag it.
    const { data: detLast } = await supabase
        .from("alerts")
        .select("created_at")
        .eq("alert_type", "wordpress_brute_force")
        .order("created_at", { ascending: false })
        .limit(1);
    // We can't tell whether the detector ran without seeing it write — so we
    // proxy by site_event_logs activity. If there were >100 events in last 30
    // min and no WP alert in last 30 min, that's a strong signal it's stuck.
    const since = new Date(Date.now() - 30 * 60_000).toISOString();
    const { count: evtCount } = await supabase
        .from("site_event_logs")
        .select("id", { count: "exact", head: true })
        .gte("event_time", since);
    const lastAlertTime = detLast?.[0]?.created_at ? new Date(detLast[0].created_at).getTime() : 0;
    const minsSinceWpAlert = lastAlertTime ? Math.round((Date.now() - lastAlertTime) / 60_000) : 9999;
    if ((evtCount ?? 0) > 100 && minsSinceWpAlert > 30) {
        out.push({
            finding_key: "stale_pulse:wordpress-alert-detector",
            category: "ai_pipeline",
            title: "WordPress alert detector may be stuck",
            description: `${evtCount} site_event_logs rows in the last 30 minutes but no wordpress_brute_force alert in ${minsSinceWpAlert} minutes. Detector cron may have stalled.`,
            evidence: { site_events_30min: evtCount, mins_since_last_wp_alert: minsSinceWpAlert },
        });
    }

    // 2b. AI SOC orchestration worker. Look for alerts in the last 30 min
    //     that should have been orchestrated (org has ai_soc_enabled) but
    //     have no ai_triage_decisions row OR have orchestration_state
    //     stuck in 'running'/'pending' for >5 min.
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    const { data: stuckAlerts } = await supabase
        .from("alerts")
        .select("id, alert_type, created_at, organization_id, organizations!inner(ai_soc_enabled)")
        .eq("organizations.ai_soc_enabled", true)
        .lt("created_at", tenMinAgo)
        .gte("created_at", new Date(Date.now() - 60 * 60_000).toISOString())
        .limit(50);
    let unorchestrated = 0;
    for (const a of (stuckAlerts ?? []) as Array<{ id: string }>) {
        const { data: td } = await supabase
            .from("ai_triage_decisions")
            .select("orchestration_state")
            .eq("alert_id", a.id)
            .maybeSingle();
        if (!td || (td.orchestration_state !== "completed" && td.orchestration_state !== "failed" && td.orchestration_state !== "budget_exceeded")) {
            unorchestrated++;
        }
    }
    if (unorchestrated > 0) {
        out.push({
            finding_key: "stale_pulse:ai-soc-worker",
            category: "ai_pipeline",
            title: "AI SOC worker is not consuming alerts",
            description: `${unorchestrated} alert(s) older than 10 minutes have no completed orchestration. The Deno worker on docker02 may be down or unable to reach the orchestrator.`,
            evidence: { unorchestrated_count: unorchestrated },
        });
    }

    // 2c. Auto-failed transition for stuck orchestrations >10 min old.
    //     Orchestrator dies mid-flight; the triage row stays in 'triaged' or
    //     'verified' forever; the worker only re-queues 'pending' rows so it
    //     never gets picked up. Flip such rows to 'failed' so they no longer
    //     count as in-flight and an operator-visible status reflects reality
    //     (review finding H#5).
    const { data: stuckMid, error: stuckErr } = await supabase
        .from("ai_triage_decisions")
        .update({ orchestration_state: "failed" })
        .in("orchestration_state", ["triaged", "verified"])
        .lt("created_at", tenMinAgo)
        .select("id");
    if (!stuckErr && stuckMid && stuckMid.length > 0) {
        out.push({
            finding_key: "auto_failed:stuck_orchestrations",
            category: "ai_pipeline",
            title: `${stuckMid.length} stuck orchestration(s) auto-failed`,
            description: `Triage decisions stuck in triaged/verified state for >10 min flipped to 'failed' so the worker no longer counts them as in-flight. Investigate the orchestrator crash that left them stranded.`,
            evidence: { count: stuckMid.length, sample_ids: stuckMid.slice(0, 5).map((r) => r.id) },
        });
    }

    // 2d. Surface silent agent failures the orchestrator wrote to
    //     ai_triage_decisions. These were "downgraded silently" before the
    //     critical-review fix added the failure flags.
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60_000).toISOString();
    const { data: silentFails } = await supabase
        .from("ai_triage_decisions")
        .select("id, alert_id, verification_failed, adversarial_failed, investigation_failed, commander_failed")
        .gte("created_at", sixHoursAgo)
        .or("verification_failed.eq.true,adversarial_failed.eq.true,investigation_failed.eq.true,commander_failed.eq.true")
        .limit(20);
    if (silentFails && silentFails.length > 0) {
        out.push({
            finding_key: "ai_agent_failures",
            category: "ai_pipeline",
            title: `${silentFails.length} AI agent failure(s) in last 6h`,
            description: "One or more agents in the orchestrator chain returned non-OK and the verdict was downgraded as a fail-safe. Review the affected triage decisions and check ai_llm_calls for the underlying LLM provider errors.",
            evidence: { count: silentFails.length, sample_ids: silentFails.slice(0, 5).map((r) => r.id) },
        });
    }

    // 2e. Comms failure (SMTP disabled or send threw) with an action that has
    //     auto-rollback disarmed. These are alerts where a customer never got
    //     the confirm/deny link and an analyst MUST review (review finding #4).
    const { data: stalledComms } = await supabase
        .from("ai_agent_actions")
        .select("id, alert_id, comms_failure_at, comms_failure_reason")
        .eq("comms_failed", true)
        .neq("status", "rolled_back")
        .gte("comms_failure_at", sixHoursAgo)
        .limit(20);
    if (stalledComms && stalledComms.length > 0) {
        out.push({
            finding_key: "comms_failed_actions_pending_review",
            category: "ai_pipeline",
            title: `${stalledComms.length} response(s) waiting for human comms review`,
            description: "The autonomous response fired but the customer notification couldn't be sent (SMTP disabled or unreachable). Auto-rollback timer has been disarmed; an operator must contact the customer manually and either confirm or roll back from the dashboard.",
            evidence: { count: stalledComms.length, sample_ids: stalledComms.slice(0, 5).map((r) => r.id) },
        });
    }

    return out;
}

// 3. DB integrity — RLS-disabled public tables, dangling FKs.
async function detectDbIntegrity(): Promise<RawFinding[]> {
    const out: RawFinding[] = [];

    const { data: rlsHoles, error } = await supabase.rpc("get_rls_disabled_tables");
    if (!error && rlsHoles) {
        for (const row of rlsHoles as Array<{ tablename: string }>) {
            out.push({
                finding_key: `rls_disabled:${row.tablename}`,
                category: "security",
                title: `RLS disabled on public.${row.tablename}`,
                description: `Table public.${row.tablename} has Row Level Security disabled. Any authenticated user can read all rows.`,
                evidence: { table: row.tablename },
            });
        }
    }

    return out;
}

// 4. Agent fleet — endpoints that have stopped reporting. Filter to orgs
//    that are active (have at least one heartbeat in the last 7 days).
async function detectAgentFleet(): Promise<RawFinding[]> {
    const out: RawFinding[] = [];
    const { data: silent, error } = await supabase.rpc("get_silent_endpoints", { hours_threshold: 24 });
    if (error) return out;
    const count = (silent as Array<unknown> ?? []).length;
    if (count > 0) {
        out.push({
            finding_key: "agent_fleet:silent_endpoints",
            category: "agent_fleet",
            title: `${count} endpoint(s) silent for >24 hours`,
            description: `Endpoints with at least one heartbeat in the last 7 days but none in the last 24 hours. Likely offline, uninstalled, or agent crashed.`,
            evidence: { silent_count: count, sample: (silent as Array<unknown>).slice(0, 10) },
        });
    }
    return out;
}

// 5. AI budget — month-to-date spend vs. configured budget cap.
async function detectBudgetOverruns(): Promise<RawFinding[]> {
    const out: RawFinding[] = [];
    const { data, error } = await supabase.rpc("get_ai_budget_status");
    if (error || !data) return out;
    for (const row of data as Array<{ organization_id: string; budget_usd: number; spent_usd: number; pct_used: number; org_name: string }>) {
        if (row.pct_used >= 0.9) {
            out.push({
                finding_key: `budget_overrun:${row.organization_id}`,
                category: "budget",
                title: `AI budget at ${Math.round(row.pct_used * 100)}% for ${row.org_name}`,
                description: `Organization ${row.org_name} has consumed $${row.spent_usd.toFixed(2)} of $${row.budget_usd.toFixed(2)} monthly AI budget.`,
                evidence: row as unknown as Record<string, unknown>,
            });
        }
    }
    return out;
}

// 6. Edge function errors — count 4xx/5xx responses logged to ai_llm_calls
//    with status='error' in the last hour.
async function detectEdgeFunctionErrors(): Promise<RawFinding[]> {
    const out: RawFinding[] = [];
    const since = new Date(Date.now() - 60 * 60_000).toISOString();
    const { data, error } = await supabase
        .from("ai_llm_calls")
        .select("feature, error_message, created_at")
        .eq("status", "error")
        .gte("created_at", since)
        .limit(500);
    if (error) return out;
    const byFeature: Record<string, { count: number; sample: string }> = {};
    for (const r of (data ?? []) as Array<{ feature: string; error_message: string }>) {
        const k = r.feature || "unknown";
        if (!byFeature[k]) byFeature[k] = { count: 0, sample: r.error_message ?? "" };
        byFeature[k].count++;
    }
    for (const [feature, agg] of Object.entries(byFeature)) {
        if (agg.count >= 5) {
            out.push({
                finding_key: `llm_errors:${feature}`,
                category: "edge_function",
                title: `${agg.count} LLM errors in '${feature}' last hour`,
                description: `Feature '${feature}' logged ${agg.count} LLM call failures in the last 60 minutes. Sample: ${agg.sample.slice(0, 200)}`,
                evidence: { feature, error_count: agg.count, sample_error: agg.sample },
            });
        }
    }
    return out;
}

// ============================================================================
// Main orchestration
// ============================================================================

async function collectAllSignals(): Promise<RawFinding[]> {
    const results = await Promise.allSettled([
        detectFailedCrons(),
        detectStalePulses(),
        detectDbIntegrity(),
        detectAgentFleet(),
        detectBudgetOverruns(),
        detectEdgeFunctionErrors(),
    ]);
    const out: RawFinding[] = [];
    for (const r of results) {
        if (r.status === "fulfilled") out.push(...r.value);
        else console.warn("signal collector failed:", r.reason);
    }
    return out;
}

const TRIAGE_SCHEMA = {
    type: "object",
    properties: {
        severity:          { type: "string", enum: ["critical","high","medium","low","info"] },
        triage_verdict:    { type: "string", enum: ["real_issue","needs_human","noise"] },
        triage_reasoning:  { type: "string" },
        recommended_fix:   { type: "string" },
    },
    required: ["severity","triage_verdict","triage_reasoning","recommended_fix"],
    additionalProperties: false,
} as const;

async function triage(finding: RawFinding): Promise<{ severity: string; verdict: string; reasoning: string; fix: string; model: string; costMicrocents: number }> {
    const systemPrompt = `You are the platform health triage agent for an MSP endpoint-security SaaS.
Given a raw health-signal finding, classify it on three axes:
- severity: critical (data loss or customer impact imminent) | high (degraded service) | medium (silent failure with no immediate impact) | low (cosmetic) | info (FYI only)
- triage_verdict: real_issue (act on it) | needs_human (ambiguous, escalate) | noise (transient or expected)
- recommended_fix: ONE concrete next step, max 2 sentences. Reference specific files/commands/tables.

Be tight. No fluff. No emojis. The reader is an on-call engineer.`;

    const userPrompt = `Raw finding:
Category: ${finding.category}
Title: ${finding.title}
Description: ${finding.description}
Evidence: ${JSON.stringify(finding.evidence, null, 2)}

Triage it.`;

    const res = await callLlmStructured<{
        severity: string;
        triage_verdict: string;
        triage_reasoning: string;
        recommended_fix: string;
    }>({
        systemPrompt,
        userPrompt,
        schema: TRIAGE_SCHEMA as unknown as Record<string, unknown>,
        schemaName: "platform_health_triage",
        feature: "platform_health",
        timeoutMs: 30_000,
    });

    if (!res.ok) {
        // LLM failed — default to medium, needs_human so it still surfaces.
        return {
            severity: "medium",
            verdict: "needs_human",
            reasoning: `LLM triage failed: ${res.error}. Raw finding still surfaced for manual review.`,
            fix: "Review evidence and triage manually.",
            model: "fallback",
            costMicrocents: 0,
        };
    }
    return {
        severity: res.data.severity,
        verdict: res.data.triage_verdict,
        reasoning: res.data.triage_reasoning,
        fix: res.data.recommended_fix,
        model: res.model,
        costMicrocents: Math.round(res.costCents * 1000),
    };
}

async function runScan(): Promise<Record<string, unknown>> {
    const t0 = Date.now();

    // Open the run row.
    const { data: runRow } = await supabase
        .from("platform_health_runs").insert({}).select("id").single();
    const runId = runRow?.id as string;

    let opened = 0, updated = 0, resolved = 0, totalCost = 0;
    const seenKeys: string[] = [];

    try {
        const signals = await collectAllSignals();

        for (const raw of signals) {
            seenKeys.push(raw.finding_key);

            // Was it open before? If so we just bump last_seen; no LLM cost.
            const { data: existing } = await supabase
                .from("platform_health_findings")
                .select("id, status, seen_count")
                .eq("finding_key", raw.finding_key)
                .maybeSingle();

            if (existing && (existing.status === "open" || existing.status === "acknowledged")) {
                await supabase.from("platform_health_findings")
                    .update({
                        last_seen: new Date().toISOString(),
                        seen_count: (existing.seen_count ?? 0) + 1,
                        description: raw.description,
                        evidence: raw.evidence,
                    })
                    .eq("id", existing.id);
                updated++;
                continue;
            }

            // New (or previously resolved) — triage with LLM.
            const tr = await triage(raw);
            totalCost += tr.costMicrocents;

            if (existing) {
                // Re-open a previously resolved finding.
                await supabase.from("platform_health_findings")
                    .update({
                        status: "open",
                        severity: tr.severity,
                        title: raw.title,
                        description: raw.description,
                        evidence: raw.evidence,
                        triage_verdict: tr.verdict,
                        triage_reasoning: tr.reasoning,
                        recommended_fix: tr.fix,
                        triage_model: tr.model,
                        triage_cost_microcents: tr.costMicrocents,
                        last_seen: new Date().toISOString(),
                        seen_count: (existing.seen_count ?? 0) + 1,
                        resolved_at: null,
                        resolved_by: null,
                        resolution_note: null,
                    })
                    .eq("id", existing.id);
                opened++;
            } else {
                await supabase.from("platform_health_findings").insert({
                    finding_key: raw.finding_key,
                    category: raw.category,
                    severity: tr.severity,
                    title: raw.title,
                    description: raw.description,
                    evidence: raw.evidence,
                    triage_verdict: tr.verdict,
                    triage_reasoning: tr.reasoning,
                    recommended_fix: tr.fix,
                    triage_model: tr.model,
                    triage_cost_microcents: tr.costMicrocents,
                });
                opened++;
            }
        }

        // Auto-resolve: anything OPEN that we didn't see this run.
        const { data: allOpen } = await supabase
            .from("platform_health_findings")
            .select("id, finding_key")
            .in("status", ["open","acknowledged"]);
        const seenSet = new Set(seenKeys);
        const toResolve = (allOpen ?? []).filter(r => !seenSet.has(r.finding_key as string));
        for (const r of toResolve) {
            await supabase.from("platform_health_findings")
                .update({
                    status: "auto_resolved",
                    resolved_at: new Date().toISOString(),
                    resolution_note: "Condition no longer detected by scanner.",
                })
                .eq("id", r.id);
            resolved++;
        }

        // Close the run.
        const dt = Date.now() - t0;
        const summary = {
            run_id: runId,
            signals_collected: signals.length,
            findings_opened: opened,
            findings_updated: updated,
            findings_resolved: resolved,
            duration_ms: dt,
            triage_cost_microcents: totalCost,
        };
        await supabase.from("platform_health_runs")
            .update({
                finished_at: new Date().toISOString(),
                duration_ms: dt,
                status: "succeeded",
                signals_collected: signals.length,
                findings_opened: opened,
                findings_updated: updated,
                findings_resolved: resolved,
                triage_cost_microcents: totalCost,
            })
            .eq("id", runId);

        return summary;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await supabase.from("platform_health_runs")
            .update({
                finished_at: new Date().toISOString(),
                duration_ms: Date.now() - t0,
                status: "failed",
                error_message: msg,
                signals_collected: 0,
                findings_opened: opened,
                findings_updated: updated,
                findings_resolved: resolved,
            })
            .eq("id", runId);
        return { run_id: runId, error: msg };
    }
}

Deno.serve(async (req) => {
    const origin = req.headers.get("Origin");
    if (req.method === "OPTIONS") return handlePreflight(req);

    if (!await isAuthorised(req)) {
        return jsonResponse({ error: "unauthorized" }, 401, origin);
    }

    try {
        const result = await runScan();
        return jsonResponse(result, 200, origin);
    } catch (e) {
        return jsonResponse({ error: "scan_failed", details: e instanceof Error ? e.message : String(e) }, 500, origin);
    }
});
