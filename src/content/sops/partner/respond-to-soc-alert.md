---
title: Respond to a security operations alert
audience: partner
description: Read the AI Triage Agent verdict and the Commander autonomous response, then confirm, roll back, or escalate to the Mithras SOC.
order: 6
estimated_minutes: 12
updated_at: 2026-06-12
tags: incidents, ai-soc, response, escalation
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure governs the reseller response to an open incident raised by the AI Triage Agent and the Commander. The reseller confirms the autonomous action where the verdict is sound, rolls back where it is not, and escalates to the Mithras SOC where the chain failed or the outcome is ambiguous. The procedure preserves customer protection, prevents unnecessary outage, and ensures every action is recorded for review.

## Audience and authority
Reseller staff whose user record carries a `partner` role on the partner organisation, with scope set to the customer organisation that owns the incident. Confirmation and rollback invoke the `confirm_ai_action` Remote Procedure Call (RPC) and the `ai-response-rollback` edge function respectively, both of which validate organisational authority before mutating state.

## Prerequisites
- You have received a notification of an open or contained incident, or you are reviewing open incidents at `/incidents`.
- You have console scope set to the customer organisation that owns the incident.
- You have access to the customer's operational contact for context where the autonomous action may affect production.
- You are familiar with the customer's `auto_response_policy`, including any notify-only configuration applied to tier-0 assets or tier `eol_protected` customers.

## Procedure

1. Open the incident from the notification or from `/incidents`, landing at `/incidents/:id`.
2. Read the `Commander summary` card. The card states the verdict and the autonomous action in one line.
3. Inspect the `Agent consensus` card:
   - `Triage verdict` records the AI Triage Agent classification of `malicious`, `suspicious`, or `benign`.
   - `Verification` records the second-model verification outcome.
   - `Adversarial` records the refutation outcome of `not_refuted` or `refuted`. A `refuted` verdict requires human adjudication.
4. Inspect the `Autonomous response` card to identify the action taken:
   - `isolate_network` removes the endpoint from the customer network with only the Mithras command channel permitted.
   - `kill_process` terminates the offending process tree.
   - `quarantine_file` moves the binary to quarantine and denies execution.
5. Inspect the `Auto-rollback armed` banner. Where present, the action reverses automatically after four hours unless confirmed. Resolving the incident is treated as confirmation.
6. Determine the response path:
   - Where the three agents agree, the action matches the threat, and the customer can tolerate containment until next business day, select `Confirm action` to cancel auto-rollback, then `Resolve` with notes that name the threat, the action taken, and the recommended preventive control. Resolution notes flow into the next monthly customer report.
   - Where the `Adversarial` agent returned `refuted`, the asset is a domain controller or other tier-0 system, or the customer confirms the action is a false positive on a known line-of-business application, select `Rollback now` on the `Autonomous response` card. The action reverses within minutes. Reclassify the incident as `False positive` and record the reason; the next triage uses the reclassification as context.
   - Where the verdict is `malicious` with `action_kind = 'none'`, the chain shows `Investigation failed` or `Commander failed`, or the action ran and the customer reports production impact you cannot trace, select `Escalate` in the incident header. The Mithras SOC takes ownership and you remain the customer-facing contact.

## Verification
- After `Confirm action` and `Resolve`, the incident row at `/incidents` is in status `resolved` with your identifier recorded against `resolved_by`.
- After `Rollback now`, the `Autonomous response` card shows the action state as `rolled_back` with the rollback timestamp and the reversing edge function invocation identifier.
- After `Escalate`, the incident header shows `Escalated to Mithras SOC` with the assignment timestamp and the assigned operator.
- The customer receives the appropriate closure or status email; dispatch is recorded in `public.activity_logs` with `action_type = 'incident_notification_sent'`.

## Troubleshooting
- **No autonomous action ran on a `malicious` verdict.** The customer's `auto_response_policy` is set to notify-only, or the asset is tagged tier-0 with manual confirmation required. Review the policy at the customer's policy page and confirm whether manual action is required.
- **The customer reports they were not notified.** Open the `Customer notifications` card on the incident. A `failed` row identifies the failed Simple Mail Transfer Protocol (SMTP) recipient; auto-rollback is disarmed when notifications fail so the protective action is preserved. Remediate the recipient configuration before confirming.
- **The `Adversarial` agent returned `refuted` but the action ran.** A Mithras SOC operator forced the action. The `forceFire override` badge is present on the `Autonomous response` card. Contact the named operator before reversing.
- **`confirm_ai_action` returns `permission_denied`.** Your scope is not on the customer organisation that owns the incident. Switch scope in the console organisation switcher and retry.
- **`Rollback now` returns `rollback_unavailable`.** The action is not reversible by design, such as a `kill_process` action where the process exited cleanly. Document the outcome in the resolution notes and proceed with `Resolve`.

## Audit and compliance
- The RPC `confirm_ai_action` writes a row to `public.ai_agent_actions` with `outcome = 'customer_confirmed'`, `actor_id = auth.uid()`, and the incident identifier.
- The edge function `ai-response-rollback` writes a row to `public.ai_agent_actions` with `outcome = 'rolled_back'` and captures the reversing operation identifier.
- The edge function `ai-response-execute` records the originating autonomous action with `outcome = 'executed'` and the originating Commander verdict.
- Records in `public.ai_agent_actions` are retained for 24 months in line with the customer's data retention configuration and support post-incident review and regulatory reporting obligations.

## Related procedures
- [Bulk-queue an agent upgrade across out-of-date endpoints](/help/sops/partner/push-agent-update)
- [Decommission a retired endpoint](/help/sops/partner/decommission-endpoint)
- [Review and release a monthly customer report](/help/sops/partner/review-monthly-customer-report)
