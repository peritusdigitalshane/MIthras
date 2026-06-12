---
title: Respond to an AI cost-budget alert
audience: peritus_super_admin
description: When ai-cost-monitor fires an 80% or 100% threshold alert, how to decide between throttling, raising the cap, or hunting the runaway caller.
order: 3
estimated_minutes: 12
updated_at: 2026-06-12
tags: ai-costs, budget, ops
---

## When to use this
You got the "AI budget at 80%" or "AI budget at 100%" email from `ai-cost-monitor`. The email points at either the **global budget** or a specific **organisation budget**.

## The mental model
- Every AI call is logged to `ai_llm_calls` with the cost in microcents.
- `ai_cost_monitor` runs hourly and rolls up calls per budget.
- 80% trips a soft alert (you get an email).
- 100% trips a hard alert AND new triage-tier calls return `429 ai_budget_exhausted` until next month or the budget is raised.

## Steps

1. Open **`/admin/ai-costs`**.
2. Find the alerting budget. The KPI tile shows `spent / budget / pct`.
3. Look at the **Breakdown** table for this month — sort by `total_cost_microcents` descending. You're looking for:
   - **One feature dominating** (e.g., `cve_scan` at 80% of total) → probable runaway.
   - **One org dominating** (under a per-org budget) → a customer who needs throttling or a tier upgrade.
   - **One model** with unexpectedly high `avg_latency_ms` → upgrade or back-off.
4. Look at the **Recent calls** table. Filter to the dominant feature/org. Sort by cost descending.

## Decision tree

### If a feature is runaway

- **Triage / verification / adversarial** — these should be cheap (claude-haiku tier). If they're using an expensive model, check `ai_model_rates` for the mapping and downgrade.
- **Investigation / commander** — these are meant to be the expensive ones. Check the call count. A spike usually means orchestrator is firing too eagerly.
- **CVE scan** — every nightly run hits every endpoint with software. If you 10×'d the fleet, you 10×'d the cost. Either raise the budget proportionally or move to per-software triage (skip software with no new CVEs).

### If an org is runaway

- Open the org's row in `/admin/resellers` → drill to the customer.
- If the customer's endpoint count is consistent with prior months, the issue is **per-call cost** (model upgrade or noisy alerts). Look at their `ai_triage_decisions` count vs. last month.
- If endpoint count exploded, it's just growth — raise their per-org budget by the same factor.
- If you can't tell, ping the reseller. They may know their customer added 50 new endpoints last week.

### If neither — just growth

The platform got bigger. Raise the global budget. Document the raise in the change history.

## Acting

To **raise a budget**: `/admin/ai-costs` → click the budget row → **Edit** → bump `month_budget_cents` → save. Effective immediately.

To **throttle a feature**: there's no UI for this; do it in code by gating the agent call site on `if (await isFeatureAffordable(feature))`. Backlog item if it doesn't exist yet.

To **disable an org's spending**: set their per-org budget to `0`. New AI calls return `429`. Use as a last resort; tell the reseller first.

## Verify
- After raising the budget, the KPI tile re-computes `pct` and drops below 100%.
- The next ai-cost-monitor run (next hour) doesn't re-alert.
- Throttled features show `429 ai_budget_exhausted` in `ai_llm_calls.error_message` and stop incurring cost.

## Related
- [Audit channel margins](/help/sops/peritus_super_admin/audit-channel-margins)
- [Force rollback AI response](/help/sops/peritus_super_admin/force-rollback-ai-response)
