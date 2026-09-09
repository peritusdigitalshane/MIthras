---
title: Approve or override an autonomous response
audience: soc_operator
description: Confirm, roll back, or force-fire an autonomous action on the Incident Detail page, with full audit trail and four-eyes discipline.
order: 3
estimated_minutes: 8
updated_at: 2026-06-12
tags: ai-soc, response, override, force-fire, rollback
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure governs every operator interaction with the autonomous response engine: confirming an action that fired at consensus, rolling back an action that should not have fired, and force-firing an action that the AI Triage chain declined to take. Every path mutates `public.ai_agent_actions` and is surfaced to the customer and the channel partner. The operator is the accountable signer for any deviation from consensus.

## Audience and authority
The operator. Confirm and roll back are available to any user whose `organization_memberships.role` is `admin` or `owner` for the customer organisation, or who is recorded in `public.super_admins`. Force-fire is restricted to `super_admins` and requires authentication of the caller by the `ai-response-execute` edge function with a `force_reason` of at least eight characters.

## Prerequisites
- The operator is signed in to the SOC console and has navigated to the relevant `/incidents/:id` page.
- The `Autonomous response` card is visible and shows a valid `ai_agent_actions` row.
- The operator has verified the multi-agent verdict trail in the source `AI decision drawer` from `/soc` or `/alerts`.
- For any deviation from consensus (rollback, force-fire, or override of a refuted verdict), a second analyst is available for peer review under the four-eyes rule.

## Procedure

### Confirm an action that fired at consensus

1. Open `/incidents/:id`. Read the `AI Commander summary`, then the `Playbook` card. Every step that the playbook declares should be complete must show a green check.
2. On the `Autonomous response` card, verify that `ai_agent_actions.status = executed`, that the action kind is proportionate to the classification, and that the affected endpoint is not a tier-0 asset (domain controller, line-of-business database server, or hypervisor host).
3. Confirm that `ai_agent_comms.status = sent` for at least one customer recipient. A `failed` value indicates the customer did not receive notification and the auto-rollback timer was disarmed by the orchestrator.
4. Click `Confirm action` on the `Autonomous response` card. The auto-rollback timer is cancelled and `ai_agent_actions.customer_confirmed_at` is set to `now()`.
5. Click `Resolve` from `HeaderActions` and follow the resolve-incident procedure to close the case.

### Roll back an action

1. On `/incidents/:id`, identify the trigger for rollback. Legitimate triggers include a `refuted` chip on the Adversarial agent card, a customer report that the action broke production, a known false-positive pattern on an `eol_protected` tier customer, or evidence that the action ran against the wrong endpoint due to hostname collision.
2. Click `Rollback now` on the `Autonomous response` card. The `ai-response-rollback` edge function reverses the action and updates `ai_agent_actions.rolled_back_at` and `ai_agent_actions.customer_overrode_id` (when triggered on behalf of a customer override).
3. From `HeaderActions`, click `Mark false positive`. The triage verdict is updated to `benign` on `ai_triage_decisions`, and the future triage context includes the operator's refute note.
4. Write a refute note in the dialog that names the benign explanation, the evidence that supports it, and any follow-up the customer requires. The note is recorded against `incidents.resolution_notes`.

### Force-fire an action the consensus declined

1. Confirm that the operator-driven judgement is supportable. Acceptable grounds are cross-tenant intelligence that the AI did not have, a credential-stuffing pattern composed of low-signal events that individually fell below threshold, or an active campaign briefed by Mithras threat intelligence.
2. From the `AI decision drawer` on `/soc` or `/alerts`, click `Force-fire response`. The drawer presents a confirmation form.
3. Select the action kind explicitly. The AI did not pick one, and the kind drives both the executor path and the customer-visible label. Use `isolate_network` rather than `kill_process` whenever a system process on a tier-0 host is in scope.
4. Enter a `force_reason` of at least eight characters that names the intelligence source, the cross-tenant pattern, or the operational rationale. The text is persisted to `ai_agent_actions.override_reason`.
5. Click `Fire`. The `ai-response-execute` edge function validates that the caller is a user (not a service account), that the `force_reason` length is sufficient, and that the caller appears in `public.super_admins`. On success, `ai_agent_actions.force_fired` is set to `true` and `ai_agent_actions.override_caller_id` is set to `auth.uid()`.
6. Notify the customer and the channel partner through the Comms agent or, if speed is critical, through the operator's direct contact channel. The `forceFire override` badge will appear on every customer-facing surface for this incident.

## Verification
- After `Confirm action`: the `Autonomous response` card shows `Customer confirmed` with the confirming user identifier; the auto-rollback chip is absent.
- After `Rollback now`: `ai_agent_actions.rolled_back_at` is populated, the action chip reads `Rolled back`, and the endpoint state on `/endpoints/:id` reflects the reversed action (network reconnected, process restored, or quarantine released).
- After `Force-fire`: `ai_agent_actions.force_fired = true`, `ai_agent_actions.override_reason` contains the operator's text, and the `forceFire override` badge is visible on `/incidents/:id`, the customer view, and the channel partner view.
- The `activity_logs` table contains a corresponding row with `action_type` set to `response_confirmed`, `response_rolled_back`, or `response_force_fired`.

## Troubleshooting
- **`Force-fire response` returns `force_reason_too_short`.** The `ai-response-execute` edge function rejects any reason shorter than eight characters. Re-enter a reason that names the intelligence source and the technique under suspicion.
- **`Force-fire response` returns `caller_not_user`.** A service-role token is being presented. Sign in to the console with a real operator account; force-fire is never permitted from automation.
- **`Rollback now` reports `action_already_terminal`.** The action has already completed and cannot be reversed by the standard rollback path. Use the super-admin `Force rollback` variant on `/incidents/:id` and follow the force-rollback procedure.
- **The customer reports the rollback did not restore connectivity.** Open `/endpoints/:id`, inspect the `Defender posture` card and the `Network isolation` chip. If isolation is still active, run `Force rollback` and escalate to the Mithras on-call.
- **The `forceFire override` badge does not appear after a force-fire.** The action was executed but the badge component reads `ai_agent_actions.force_fired`. Refresh `/incidents/:id`; if the badge is still absent after thirty seconds, the column did not update and the operator must open an internal ticket against the response engine.

## Audit and compliance
- Every confirm, rollback, and force-fire writes a row to `public.activity_logs` with `action_type` set to `response_confirmed`, `response_rolled_back`, or `response_force_fired`, with `actor_id = auth.uid()` and the `incident_id` linked.
- The `ai_agent_actions` row carries the full lifecycle: `status`, `customer_confirmed_at`, `rolled_back_at`, `customer_overrode_at`, `force_fired`, `override_caller_id`, and `override_reason`. The row is retained for 24 months.
- Force-fire actions are flagged in the customer's monthly report and surfaced to the channel partner. The `forceFire override` badge is rendered on every reporting surface.
- Recurring force-fire patterns against the same classification are tracked by the Mithras SOC quality programme and feed the prompt-tuning backlog.

## Related procedures
- [Triage a new alert in the SOC console](/help/sops/soc_operator/triage-new-alert)
- [Resolve an incident](/help/sops/soc_operator/resolve-incident)
- [Force-rollback an AI response](/help/sops/platform_super_admin/force-rollback-ai-response)
