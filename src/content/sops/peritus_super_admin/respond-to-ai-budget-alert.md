---
title: Respond to an AI cost-budget alert
audience: peritus_super_admin
description: Triage an 80% or 100% AI cost-budget threshold alert and choose between raising the budget, throttling a feature, or constraining a single organisation.
order: 3
estimated_minutes: 12
updated_at: 2026-06-12
tags: ai-costs, budget, ops
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure responds to an alert dispatched by the `ai-cost-monitor` edge function when a global or per-organisation AI budget reaches its 80% soft threshold or its 100% hard threshold. At 100% the platform returns `429 ai_budget_exhausted` for new triage-tier calls under the breached budget until the budget is raised or the next billing cycle begins. The procedure identifies the dominant cost driver, decides on an appropriate intervention, and records the decision for change-management review.

## Audience and authority
The operator executing this procedure is a Peritus platform operator whose `user_id` is present in `public.super_admins`. The route `/admin/ai-costs` is gated by `is_super_admin(auth.uid())`. Budget mutations write directly to `public.ai_cost_budgets` under the operator's identity and take effect at the next invocation of the `ai-cost-monitor` edge function.

## Prerequisites
- The operator has received an alert email originating from `ai-cost-monitor` that identifies either the global budget or a named organisation budget.
- The operator can reach `/admin/ai-costs` and observe non-empty rollup tiles for the current billing period.
- The operator has reviewed the most recent entries in `/activity` for `action_type = 'ai_budget_changed'` to confirm no concurrent budget mutation is in flight.

## Procedure

1. Navigate to `/admin/ai-costs`. The current-period rollup renders.
2. Locate the alerting budget row. The KPI tile displays `spent_microcents`, `month_budget_microcents`, and the computed percentage from `public.ai_cost_budgets`.
3. Inspect the `Cost breakdown` table for the current period, sorted by `total_cost_microcents` descending. Identify the dominant cost dimension using the three diagnostic patterns:
   - A single feature dominates aggregate cost. This indicates a runaway feature or a model misconfiguration.
   - A single organisation dominates aggregate cost under a per-organisation budget. This indicates either organic customer growth or a noisy alert source.
   - A single model exhibits abnormal `avg_latency_ms` against expected. This indicates a model regression or upstream incident.
4. Open the `Recent calls` table and filter by the dominant feature or organisation. Sort by `cost_microcents` descending. Inspect the top fifty rows in `public.ai_llm_calls` and correlate against entries in `public.ai_triage_decisions` for the same window.
5. Select the intervention path corresponding to the diagnostic outcome:
   - For a runaway triage, verification, or adversarial feature, confirm the assigned model in `public.ai_model_rates`. Triage-tier features are expected to run on the lowest-cost model rate. If a higher-cost rate is bound, schedule a model downgrade and record the change in the change log.
   - For a runaway investigation or commander feature, confirm the orchestrator firing rate against the corresponding entries in `public.ai_agent_actions`. A rate increase consistent with alert volume indicates organic growth; a rate increase decoupled from alert volume indicates an orchestrator regression.
   - For a runaway CVE scan feature, confirm endpoint count growth against the prior period. Proportional growth indicates organic expansion. Disproportionate growth indicates a scan-scope misconfiguration.
6. For a runaway organisation, navigate to `/admin/resellers`, drill into the customer organisation, and compare the current-period `ai_triage_decisions` count against the prior period. A proportional increase that tracks endpoint growth indicates organic expansion; an increase that does not track endpoint growth indicates a noisy alert source or a model upgrade applied to the organisation.
7. Apply the chosen intervention:
   - To raise a budget, select the budget row in `/admin/ai-costs` and choose `Edit`. Update `month_budget_cents` and record the justification in the `Reason` field. The change takes effect immediately.
   - To constrain a single organisation, set the organisation's per-organisation `month_budget_cents` to zero. New AI calls return `429 ai_budget_exhausted`. This intervention is reserved for the runaway scenarios where reseller notification has been completed.
   - To throttle a feature, file a backlog task to gate the agent call site behind `isFeatureAffordable(feature)`. Feature-level throttling does not have a runtime control surface.

## Verification
- Following a budget raise, the `/admin/ai-costs` KPI tile recomputes the percentage and reports below 100% within sixty seconds.
- The next scheduled invocation of `ai-cost-monitor` — running hourly — does not re-emit the threshold alert for the affected budget.
- Calls subject to a hard exhaust return `429 ai_budget_exhausted` and the corresponding row in `public.ai_llm_calls` carries `error_message = 'ai_budget_exhausted'`. The call does not contribute to `total_cost_microcents`.
- The intervention is reflected in `public.ai_cost_budgets` with an updated `last_modified_by` matching the operator's `user_id`.

## Troubleshooting
- **The alert persists after a budget raise.** The KPI tile may be reading a cached aggregate. Wait for the next `ai-cost-monitor` invocation, then refresh. If the tile remains above 100%, the budget was raised on the wrong row; confirm the budget identifier in the alert email against `public.ai_cost_budgets.id`.
- **The dominant feature in the breakdown table has zero matching rows in `Recent calls`.** The aggregation window includes calls evicted from the recent-calls retention buffer. Query `public.ai_llm_calls` directly with the relevant date range; the breakdown view trims to the last seven days for performance.
- **The `Edit` control on a budget row is disabled.** A concurrent mutation is in flight. Refresh the page after sixty seconds and retry. If the control remains disabled, inspect `/activity` for an in-flight `ai_budget_changed` row that has not closed and escalate to engineering.
- **An organisation has been set to a zero budget but continues to incur cost.** Edge function caching can retain the prior budget for up to five minutes. Restart the `peritus-edge-functions` container if immediate cutoff is required.

## Audit and compliance
- Every budget mutation writes a row to `public.activity_logs` with `action_type = 'ai_budget_changed'`, the affected `budget_id`, the prior and new values of `month_budget_cents`, and the operator's `user_id`.
- Hard exhaustion events write a row to `public.ai_llm_calls` with `error_message = 'ai_budget_exhausted'`. These rows are retained for 24 months and support cost-allocation review for resellers and customers.
- Threshold alerts dispatched by `ai-cost-monitor` are retained in `public.platform_health_findings` for 12 months and contribute to platform-health reporting on `/admin/health`.

## Related procedures
- [Audit channel margins across the reseller hierarchy](/help/sops/peritus_super_admin/audit-channel-margins)
- [Force-rollback an AI Triage Agent response](/help/sops/peritus_super_admin/force-rollback-ai-response)
- [Re-enable Microsoft 365 sign-in and directory audit polling](/help/sops/peritus_super_admin/re-enable-signin-audit)
