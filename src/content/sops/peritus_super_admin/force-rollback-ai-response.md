---
title: Force-rollback an AI Triage Agent response
audience: peritus_super_admin
description: Reverse an autonomous AI Triage Agent action from the Incident Detail page, attribute the override, and capture context for prompt review.
order: 4
estimated_minutes: 8
updated_at: 2026-06-12
tags: ai-soc, override, incident-response
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure executes an operator override of an autonomous action taken by the AI Triage Agent when the customer-driven confirmation flow is insufficient — typically because the action has caused, or is causing, customer impact. The procedure reverses the action by invoking the `ai-response-rollback` edge function from the Incident Detail page, writes the override to the audit log, and optionally reclassifies the underlying triage decision so the verdict no longer contributes positive history to future triage.

## Audience and authority
The operator executing this procedure is a Peritus platform operator whose `user_id` is present in `public.super_admins`. The `Force rollback` control on the Incident Detail page is rendered only when `is_super_admin(auth.uid())` returns true and the action is in a reversible state. Invocation of `ai-response-rollback` writes to `public.ai_agent_actions` and `public.activity_logs` under the operator's identity.

## Prerequisites
- An autonomous action — `isolate_network`, `kill_process`, or `quarantine_file` — has been recorded in `public.ai_agent_actions` for the incident in question.
- The action is not in `customer_confirmed` state. Customer-confirmed actions require customer-initiated rollback through the standard confirmation flow.
- The operator has identified the root cause of the misfire to a sufficient standard to record a written justification of at least twenty characters.
- The operator has confirmed the affected endpoint is reachable, or has accepted that the inverse command will be queued for the next agent heartbeat.

## Procedure

1. Open the Incident Detail page from `/soc` or directly via the incident link in the operator's alert email.
2. Locate the `Autonomous response` card. The card lists the action taken, the verdict attributed by the AI Triage Agent, the adversarial agent's adjudication, and the action state.
3. Select `Force rollback`. The control is distinct from the customer-facing `Rollback now` control and is visible only to super-admin operators.
4. Populate the override dialog:
   - `Reason` — a written justification of at least twenty characters. The value is persisted to `public.ai_agent_actions.rollback_reason` and to `public.activity_logs`. State the observed false-positive signal, the customer impact, and any correlated incidents.
   - `Adjust verdict?` — when selected, reclassifies the triage decision from its original verdict to `benign`. Select this option when the underlying decision is incorrect; do not select it when the verdict was correct but the action choice was disproportionate.
   - `Notify customer?` — defaults to selected. When selected, dispatches the customer-facing rollback notification email immediately rather than deferring to the next scheduled report.
5. Select `Rollback now`. The platform invokes the `ai-response-rollback` edge function with the action identifier and the operator's bearer token.
6. The edge function writes the reversal command to the affected endpoint's command queue and updates `public.ai_agent_actions.state` to `force_rolled_back`. The inverse command — `unisolate_network`, `restart_process`, or `restore_file` — is delivered on the next agent heartbeat, typically within thirty seconds.

## Verification
- The `Autonomous response` card displays the action state as `force_rolled_back`, attributed to the operator's `user_id`, with the recorded `rollback_reason`.
- The Endpoint Detail page for the affected endpoint shows the inverse command in the command-execution log with a populated `executed_at` timestamp.
- The triage decision in `public.ai_triage_decisions` carries a populated `operator_verdict` column when the verdict was reclassified.
- `/activity` records a row with `action_type = 'ai_response_rolled_back'`, the action identifier, the reason, and the operator's `user_id`.
- The customer-facing rollback notification appears in the customer's email outbox audit when `Notify customer?` was selected.

## Troubleshooting
- **The `Force rollback` control is disabled.** The action is already in `customer_confirmed` state. Customer confirmation supersedes operator override; contact the customer's primary administrator before any further reversal.
- **The inverse command has not executed within five minutes.** The endpoint is offline. Inspect `endpoints.last_seen` to confirm. The inverse command remains queued and will execute on the next heartbeat. Do not re-issue the rollback; duplicate inverse commands produce ambiguous endpoint state.
- **The customer reports the endpoint remains isolated after the inverse command executed.** Inspect `endpoint_status.is_isolated` for the latest snapshot. A persistent `true` value indicates an agent state mismatch; execute `restart_agent_service` from the Endpoint Detail page to force agent reinitialisation.
- **Three or more force rollbacks have been executed across distinct customers within sixty minutes with a shared root cause.** This indicates a model-quality or prompt regression. Open a high-severity finding on `/admin/health` with the tag `ai_soc_regression`, link the affected incidents, and notify engineering for prompt and model rate review.

## Audit and compliance
- The reversal writes a row to `public.activity_logs` with `action_type = 'ai_response_rolled_back'`, the affected `action_id`, the operator's `user_id`, and the full `rollback_reason` text.
- The action row in `public.ai_agent_actions` is updated with `state = 'force_rolled_back'`, `rolled_back_by = auth.uid()`, and `rolled_back_at = now()`.
- A reclassification updates `public.ai_triage_decisions.operator_verdict` and `operator_verdict_set_by`. The original verdict is retained for model-quality analysis.
- AI agent actions are retained in `public.ai_agent_actions` for 24 months in accordance with the customer's data retention configuration and support post-incident review, regulator notification, and prompt regression analysis.

## Related procedures
- [Respond to an AI cost-budget alert](/help/sops/peritus_super_admin/respond-to-ai-budget-alert)
- [Audit channel margins across the reseller hierarchy](/help/sops/peritus_super_admin/audit-channel-margins)
- [Re-enable Microsoft 365 sign-in and directory audit polling](/help/sops/peritus_super_admin/re-enable-signin-audit)
