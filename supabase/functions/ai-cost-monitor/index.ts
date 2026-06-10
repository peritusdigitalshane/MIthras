// POST /functions/v1/ai-cost-monitor
//
// Runs hourly. For each ai_cost_budgets row (global + per-org):
//   1. If current month has rolled over, reset alert_*_sent_at and bump current_month.
//   2. Compute this-month spend by summing ai_llm_calls.cost_microcents.
//   3. If spend >= 80% of budget and alert_at_80_pct is true and alert_80_sent_at is null,
//      fire a notification and stamp alert_80_sent_at.
//   4. Same for 100%.
//
// Notifications go through the existing alerts table — that hooks into the
// notify-alert pipeline so they reach org_alert_recipients automatically.
// For the global budget, we attribute the alert to organization_id = NULL
// (super-admin-only). The Peritus operator inbox sees it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function jsonResp(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

interface BudgetRow {
    id: string;
    organization_id: string | null;
    month_budget_cents: number;
    alert_at_80_pct: boolean;
    alert_at_100_pct: boolean;
    notify_email: string | null;
    current_month: string;
    alert_80_sent_at: string | null;
    alert_100_sent_at: string | null;
}

function thisMonth(): string {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

Deno.serve(async (req) => {
    // POST only — GET would let any unauthenticated browser navigation
    // trigger a full budget eval loop. The function uses the service-role
    // key for all DB ops; budget rows are admin-managed.
    if (req.method !== "POST") {
        return jsonResp({ error: "method_not_allowed" }, 405);
    }

    const currentMonth = thisMonth();
    const monthStart = new Date(`${currentMonth}-01T00:00:00Z`).toISOString();

    const { data: budgets, error: bErr } = await supabase
        .from("ai_cost_budgets")
        .select("id, organization_id, month_budget_cents, alert_at_80_pct, alert_at_100_pct, notify_email, current_month, alert_80_sent_at, alert_100_sent_at");
    if (bErr) return jsonResp({ error: "budget_load_failed", detail: bErr.message }, 500);

    const results: Array<Record<string, unknown>> = [];

    for (const b of (budgets ?? []) as BudgetRow[]) {
        // Month rollover: reset flags before evaluating spend so a new month
        // can re-alert cleanly.
        if (b.current_month !== currentMonth) {
            await supabase.from("ai_cost_budgets").update({
                current_month: currentMonth,
                alert_80_sent_at: null,
                alert_100_sent_at: null,
            }).eq("id", b.id);
            b.current_month = currentMonth;
            b.alert_80_sent_at = null;
            b.alert_100_sent_at = null;
        }

        // Sum this-month spend in micro-cents, filtered by org if applicable.
        // PostgREST query builders are immutable — `.eq(...)` returns a NEW
        // builder. The previous code discarded that return value, so per-org
        // budgets evaluated the GLOBAL spend total. That caused every per-org
        // budget to fire 100% alerts simultaneously once any single org
        // exceeded the global threshold.
        let q = supabase
            .from("ai_llm_calls")
            .select("cost_microcents", { count: "exact", head: false })
            .gte("created_at", monthStart);
        if (b.organization_id) q = q.eq("organization_id", b.organization_id);
        const { data: callRows, error: cErr } = await q;
        if (cErr) {
            results.push({ budget_id: b.id, error: cErr.message });
            continue;
        }

        const spentMicro = (callRows ?? []).reduce((s: number, r: { cost_microcents?: number | null }) => s + (Number(r.cost_microcents) || 0), 0);
        const spentCents = Math.floor(spentMicro / 1000);
        const pct = b.month_budget_cents > 0 ? (spentCents / b.month_budget_cents) * 100 : 0;

        const scope = b.organization_id ? `org=${b.organization_id}` : "GLOBAL";
        const updates: Record<string, unknown> = {};
        let alertFired: "80" | "100" | null = null;

        if (b.alert_at_100_pct && !b.alert_100_sent_at && pct >= 100) {
            await supabase.from("alerts").insert({
                organization_id: b.organization_id,  // null for global budget
                alert_type: "ai_budget_breach",
                severity: "high",
                title: `AI spend hit 100% of monthly budget (${scope})`,
                message: `Current month (${currentMonth}) AI spend is ${spentCents}¢ vs ${b.month_budget_cents}¢ budget (${pct.toFixed(1)}%). Further LLM calls will continue to bill — review at /admin/ai-costs.`,
            });
            updates.alert_100_sent_at = new Date().toISOString();
            alertFired = "100";
        } else if (b.alert_at_80_pct && !b.alert_80_sent_at && pct >= 80) {
            await supabase.from("alerts").insert({
                organization_id: b.organization_id,
                alert_type: "ai_budget_warning",
                severity: "medium",
                title: `AI spend hit 80% of monthly budget (${scope})`,
                message: `Current month (${currentMonth}) AI spend is ${spentCents}¢ vs ${b.month_budget_cents}¢ budget (${pct.toFixed(1)}%). Consider lowering model tier or raising the budget at /admin/ai-costs.`,
            });
            updates.alert_80_sent_at = new Date().toISOString();
            alertFired = "80";
        }

        if (Object.keys(updates).length > 0) {
            await supabase.from("ai_cost_budgets").update(updates).eq("id", b.id);
        }

        results.push({
            budget_id: b.id,
            scope,
            spent_cents: spentCents,
            budget_cents: b.month_budget_cents,
            pct: Math.round(pct * 10) / 10,
            alert_fired: alertFired,
        });
    }

    return jsonResp({ ok: true, current_month: currentMonth, budgets_evaluated: results.length, results });
});
