// Mithras AI SOC orchestration worker.
//
// Why this exists: on this Supabase edge-functions + pg_net combination,
// pg_net's HTTP calls to /functions/v1/ai-soc-orchestrate reliably get cut
// off ~5s in — long enough for Triage to write its verdict but too short
// for the rest of the multi-agent chain to run. Same orchestrator invoked
// over plain HTTP from outside the docker network (or any caller that
// holds the connection long enough) completes the full chain.
//
// This worker side-steps the pg_net path entirely:
//   1. Poll Postgres directly via supabase-js for alerts whose org has
//      ai_soc_enabled AND that don't yet have a completed orchestration.
//   2. For each, POST to the orchestrator with {wait: true} over plain
//      fetch() with a generous 180s timeout — Deno keeps the connection
//      open the whole time, the orchestrator chain runs to completion,
//      Verification + Adversarial + Comms all fire as designed.
//
// Single-tenant docker network presence: the container joins the existing
// `supabase_default` network as an external attachment. It reaches both
// supabase-edge-functions:9000 (orchestrator) and supabase-db:5432
// (via supabase-js → supabase-rest:3000 → kong:8000 — for service-role)
// the same way every other supabase service does.
//
// Failures are isolated per alert: a hung orchestrator call (180s timeout)
// or transient runtime error doesn't crash the worker — we log and move on
// to the next alert / next poll cycle.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// --- config (all via env) ---
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SOC_SECRET    = Deno.env.get("AI_SOC_POLL_SECRET") ?? "";
const ORCH_URL      = Deno.env.get("ORCH_URL")
    ?? "http://supabase-kong:8000/functions/v1/ai-soc-orchestrate";
const POLL_MS       = parseInt(Deno.env.get("POLL_INTERVAL_MS") ?? "15000", 10);
const MAX_PER_CYCLE = parseInt(Deno.env.get("MAX_PER_CYCLE") ?? "3", 10);
const ORCH_TIMEOUT  = parseInt(Deno.env.get("ORCH_TIMEOUT_MS") ?? "180000", 10);
const ALERT_LOOKBACK_MIN = parseInt(Deno.env.get("ALERT_LOOKBACK_MIN") ?? "60", 10);

if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("FATAL: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY must be set");
    Deno.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});

function ts(): string { return new Date().toISOString(); }

// Find alerts that need orchestration. We deliberately match the SQL in
// public.process_pending_ai_orchestrations() — same selection criteria, same
// 60-min lookback window. Returns alert_ids ordered newest-first.
async function findPending(): Promise<string[]> {
    const since = new Date(Date.now() - ALERT_LOOKBACK_MIN * 60_000).toISOString();
    const { data: alerts, error } = await supabase
        .from("alerts")
        .select("id, organization_id, organizations!inner(ai_soc_enabled)")
        .eq("organizations.ai_soc_enabled", true)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(50);
    if (error) {
        console.error(`[${ts()}] findPending: ${error.message}`);
        return [];
    }

    const out: string[] = [];
    for (const a of (alerts ?? []) as Array<{ id: string }>) {
        if (out.length >= MAX_PER_CYCLE) break;
        const { data: td } = await supabase
            .from("ai_triage_decisions")
            .select("orchestration_state")
            .eq("alert_id", a.id)
            .maybeSingle();
        // No row yet, or row exists but not completed → process.
        if (!td || (td.orchestration_state !== "completed"
                 && td.orchestration_state !== "failed"
                 && td.orchestration_state !== "budget_exceeded")) {
            out.push(a.id);
        }
    }
    return out;
}

// Fire one synchronous orchestration. The orchestrator function (when
// invoked with wait=true) runs the full multi-agent chain inline and
// returns the consensus row when done.
async function runOne(alertId: string): Promise<void> {
    const t0 = Date.now();
    try {
        const resp = await fetch(ORCH_URL, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-mithras-soc-secret": SOC_SECRET,
            },
            body: JSON.stringify({ alert_id: alertId, wait: true }),
            signal: AbortSignal.timeout(ORCH_TIMEOUT),
        });
        const text = await resp.text();
        const dt = Date.now() - t0;
        if (resp.ok) {
            console.log(`[${ts()}] alert ${alertId} -> ${resp.status} in ${dt}ms`);
            // Best-effort: parse the response so we can log the consensus.
            try {
                const body = JSON.parse(text);
                if (body.final_verdict) {
                    console.log(`  consensus: ${body.final_verdict} @ ${body.final_confidence}, disagreement=${body.disagreement}`);
                }
            } catch { /* opaque body is fine */ }
        } else {
            console.error(`[${ts()}] alert ${alertId} -> ${resp.status} in ${dt}ms: ${text.slice(0, 200)}`);
        }
    } catch (e) {
        const dt = Date.now() - t0;
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[${ts()}] alert ${alertId} fetch failed after ${dt}ms: ${msg}`);
    }
}

// One poll cycle. Returns count of alerts processed.
async function cycle(): Promise<number> {
    const pending = await findPending();
    if (pending.length === 0) return 0;
    console.log(`[${ts()}] cycle: ${pending.length} pending alert(s)`);
    for (const id of pending) {
        await runOne(id);
    }
    return pending.length;
}

async function main(): Promise<void> {
    console.log(`[${ts()}] mithras-ai-soc-worker started`);
    console.log(`  ORCH_URL=${ORCH_URL}`);
    console.log(`  POLL_INTERVAL_MS=${POLL_MS}`);
    console.log(`  MAX_PER_CYCLE=${MAX_PER_CYCLE}`);
    console.log(`  ORCH_TIMEOUT_MS=${ORCH_TIMEOUT}`);

    // Graceful shutdown so docker stop / restart doesn't kill mid-orchestration.
    let shutting = false;
    for (const sig of ["SIGINT", "SIGTERM"] as const) {
        try { Deno.addSignalListener(sig, () => { shutting = true; console.log(`[${ts()}] ${sig} received, finishing in-flight cycle`); }); } catch { /* not all platforms */ }
    }

    while (!shutting) {
        try {
            await cycle();
        } catch (e) {
            console.error(`[${ts()}] cycle error: ${e instanceof Error ? e.message : String(e)}`);
        }
        await new Promise(r => setTimeout(r, POLL_MS));
    }
    console.log(`[${ts()}] exit`);
}

main().catch((e) => {
    console.error(`[${ts()}] main crashed:`, e);
    Deno.exit(1);
});
