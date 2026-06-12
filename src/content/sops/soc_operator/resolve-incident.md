---
title: Resolve an incident
audience: soc_operator
description: Close a contained incident with resolution notes that flow to the customer report, the audit trail, and the SOC quality programme.
order: 2
estimated_minutes: 5
updated_at: 2026-06-12
tags: incident, response, resolution, audit
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure closes an incident in the Mithras platform once the threat is contained, the customer has been notified, and the autonomous response lifecycle is terminal. Resolution writes the operator's narrative to the audit trail, releases the incident from the active queue, and emits the record into the customer's monthly security report. An incident resolved without sufficient notes is a quality defect under the Peritus SOC quality programme.

## Audience and authority
The operator. Authorisation requires a record in `public.super_admins` or an `organization_memberships.role` of `admin` or `owner` for the customer organisation that owns the incident. The `Resolve` and `Mark false positive` actions on `HeaderActions` are hidden when the caller does not satisfy the authorisation check.

## Prerequisites
- The incident is in `Open`, `Triaging`, or `In progress` status. Resolution controls are not rendered on a closed incident.
- The autonomous response lifecycle on `ai_agent_actions` is terminal: `status` is `executed`, `rolled_back`, or `not_required`.
- The customer notification on `ai_agent_comms` is in a terminal state: `status` is `sent`, `delivered`, or `not_required`.
- The operator has read and validated the AI Triage chain verdict and any operator overrides recorded against `ai_triage_decisions`.

## Procedure

1. Open `/incidents/:id` for the target incident.
2. Review the cards on the Incident Detail page in order:
   - `AI Commander summary` for the one-line narrative.
   - `Playbook` to confirm every required step shows a green check.
   - `Autonomous response` to confirm the action lifecycle is terminal. A `customer_confirmed_at` timestamp indicates customer acceptance; a `rolled_back_at` timestamp indicates reversal.
   - `Customer notifications` to confirm at least one recipient received delivery, or that the notification was explicitly classified `not_required`.
3. If the `comms_failed` banner is displayed, contact the customer through the operator's direct channel before resolving. Record the out-of-band notification in the resolution notes.
4. From `HeaderActions`, click the appropriate action:
   - `Resolve` when the threat was real and the response was correct.
   - `Mark false positive` when the threat was misclassified and the response should not have fired. This action triggers a verdict update on `ai_triage_decisions` and, where applicable, an automatic rollback through the `ai-response-rollback` edge function.
5. In the resolution dialog, write the resolution notes. The notes must name the indicator, the affected endpoint, the action taken, the outcome, and any follow-up assigned to the customer or the channel partner. Notes are persisted to `incidents.resolution_notes`.
6. Click `Resolve` or `Mark false positive` to submit. The dialog closes and the Incident Detail page re-renders with the `Resolution notes` card and the resolving user identifier.

## Reference resolution notes

The following examples meet the Peritus SOC quality bar.

Real threat:

> `Trojan:Win64/Wacatac.B!ml` detected on `WH-04` at `03:14 UTC` via `T1059.001`. Defender quarantined the payload; the `isolate_network` action ran at consensus and was released after a re-scan returned clean. Root cause was a phishing email with a macro-laden `.doc`; user education ticket raised with the customer IT contact. Customer notified at `03:18 UTC`; no lateral movement observed across other endpoints. SLA met.

False positive:

> Triage classified the pattern as `wp_brute_force` against the ACME blog. Investigation showed the traffic originated from the customer's own synthetic monitoring service performing scheduled authenticated health checks. The monitoring service has been added to the customer's allow-list. The `block_source_ip` action was rolled back at `04:42 UTC`; no customer-visible impact.

## Verification
- The incident moves to the `Closed` tab on `/incidents` within thirty seconds of submission.
- The Incident Detail page displays the `Resolution notes` card with the operator's text and the resolved-by user identifier.
- A row is written to `public.activity_logs` with `action_type = 'incident_resolved'` or `action_type = 'incident_marked_false_positive'` and `actor_id = auth.uid()`.
- The next scheduled customer report for the affected organisation includes the incident in the security summary.

## Troubleshooting
- **The resolution dialog reports `incident_already_closed`.** A concurrent operator resolved the incident first. Refresh the page, open the `Activity` tab on `/incidents/:id`, and confirm the resolving user and timestamp.
- **The customer asks about a closed incident.** Share the link `/incidents/:id`. A customer administrator on the owning organisation retains read-access to the `AI Commander summary`, the `Playbook`, and the `Resolution notes` card after closure.
- **The incident was resolved in error.** Open the incident from `/incidents` and use the status control on the row to revert to `In progress`. The original resolution notes remain in `activity_logs` and are not overwritten by the revert; add a follow-up note that names the reason for re-opening.
- **`Mark false positive` returns `verdict_update_failed`.** The triage decision row is locked by an active review. Wait sixty seconds and retry. If the failure persists, override the verdict from the `AI decision drawer` and then resolve.
- **The `Resolve` button is hidden.** The caller does not satisfy the authorisation check, the incident is already closed, or the autonomous response lifecycle is not yet terminal. Confirm the operator's role on `organization_memberships`, the incident status, and the `ai_agent_actions.status` value.

## Audit and compliance
- The resolution is persisted to `public.incidents` with `resolved_at`, `resolved_by`, and `resolution_notes` populated.
- A row is written to `public.activity_logs` with `action_type = 'incident_resolved'` or `action_type = 'incident_marked_false_positive'` and `actor_id = auth.uid()`.
- A `Mark false positive` resolution writes a correlated update to `public.ai_triage_decisions` with `review_action = 'override_to_benign'` and the operator's refute note.
- The incident record and resolution notes are retained for seven years in accordance with the Peritus SOC evidentiary standard. The customer's monthly report includes the resolved incident in the security summary delivered to the addresses configured in `org_report_recipients` for category `incident`.

## Related procedures
- [Triage a new alert in the SOC console](/help/sops/soc_operator/triage-new-alert)
- [Approve or override an autonomous response](/help/sops/soc_operator/approve-auto-response)
- [Investigate a cross-tenant campaign](/help/sops/soc_operator/investigate-campaign)
