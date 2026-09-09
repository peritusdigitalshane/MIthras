---
title: Triage a new alert in the SOC console
audience: soc_operator
description: Inspect the multi-agent verdict trail, validate citations and refutations, and route the alert to confirm, override, or escalate.
order: 1
estimated_minutes: 10
updated_at: 2026-06-12
tags: triage, ai-soc, alerts, mitre-attack
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure governs the first analyst touch on any alert raised in the Mithras platform. The AI Triage chain (Triage, Verification, Adversarial, Investigation, Commander, Comms) has already produced a verdict and may have armed or executed an autonomous response. The operator's role is to validate the verdict trail, confirm that cited evidence resolves to real telemetry, and decide whether the alert is closed at consensus, overridden, or escalated for cross-tenant investigation. Until the operator dispositions the alert, the auto-rollback window remains the only safety net.

## Audience and authority
The operator. Authorisation requires a record in `public.super_admins` or an `organization_memberships.role` of `admin` or `owner` for the customer organisation that owns the alert. Override actions on the AI verdict trail are restricted to `super_admins` and members of the Mithras SOC roster.

## Prerequisites
- The operator is signed in to the SOC console at `https://www.mithras.com.au/soc`.
- The operator understands the AI Triage chain stages and the consensus rules documented in the platform glossary.
- The operator has read-access to `ai_triage_decisions`, `ai_agent_actions`, and `ai_agent_comms` (granted automatically to the SOC role).
- A second analyst is available for peer review of any force action under the four-eyes rule.

## Procedure

1. Open `/soc`. The console lists every cross-tenant alert in the `AI agent activity` panel, ordered by `decided_at` descending.
2. Filter the panel by `Final verdict = needs_human` and `Confidence < 0.85` to surface alerts that explicitly require operator judgement. Re-sort by `severity` if the queue depth exceeds twenty.
3. Select the target decision row. The `AI decision drawer` opens on the right. The drawer is the only per-alert surface; there is no `/alerts/:id` route.
4. Read the `Multi-agent verdict trail` card in sequence:
   - `Triage` verdict, classification, and confidence.
   - `Verification` agreement state and citation count.
   - `Adversarial` refutation state. A `refuted` chip means the adversarial agent identified a benign explanation that defeats the triage conclusion.
   - `Final verdict` chip, which represents the Commander's consensus.
5. Inspect every citation chip on the Verification card. Select each chip; it must resolve to a real row in `endpoint_event_logs`, `endpoint_threats`, `firewall_audit_logs`, or `alerts`. A citation that fails to resolve is a hallucination signal and the verdict is not trusted.
6. Map the triage classification to a MITRE ATT&CK technique using the technique IDs listed on the `Triage` card. If the technique chain is incoherent (for example `T1486` ransomware impact with no preceding `Execution` tactic citation), treat the verdict as suspect.
7. If an incident has been opened, select `Open incident` in the drawer header to load `/incidents/:id`. Review the `AI Commander summary`, the `Playbook` card, and the `Autonomous response` card in that order.
8. On the `Autonomous response` card, check the action lifecycle in `ai_agent_actions`:
   - `status = executed` with `customer_confirmed_at` populated means the customer has accepted the action.
   - `status = executed` with `force_fired = true` means an operator overrode the consensus gate; treat as a four-eyes review item.
   - `status = pending` means the action is armed but the auto-rollback timer is still running.
9. Disposition the alert from the drawer or from the Incident Detail page:
   - **Confirm at consensus.** When two of three agents agree and the Adversarial agent did not refute, select `Confirm action` on the `Autonomous response` card, then select `Resolve` from `HeaderActions` on `/incidents/:id`.
   - **Override.** When the citation trail is incoherent or the classification is wrong, use the verdict override controls in the drawer to record `Approve`, `Override`, or `Dismiss`, then write a refute note. The override writes to `ai_triage_decisions.review_action` and `ai_triage_decisions.review_reason`.
   - **Escalate.** When the indicator appears across multiple tenants or matches an active campaign, leave the incident open and follow the cross-tenant investigation procedure.

## Verification
- The disposition is reflected on the `ai_triage_decisions` row in the `review_action` and `reviewed_by` columns within thirty seconds.
- A resolved incident moves to the `Closed` tab on `/incidents` and the detail page displays the `Resolution notes` card with the operator's identifier.
- The next scheduled customer report for the affected organisation lists the incident in the security summary with the operator's notes.
- The `activity_logs` table contains a row with `action_type = 'incident_resolved'` or `action_type = 'triage_overridden'` and `actor_id = auth.uid()`.

## Troubleshooting
- **Verification card shows `failed`.** The Verification agent timed out or returned malformed JSON. The orchestrator has already downgraded the final verdict to `needs_human` for safety. Trigger `Manual re-run` from the drawer. If the second attempt fails, switch the organisation's `ai_verification_model` setting to the secondary provider and re-run.
- **Citations resolve to no rows.** The LLM has hallucinated evidence. Override the verdict to `Dismiss` with a refute note that names the missing tables. The override is recorded against `ai_triage_decisions.review_action` and the action chain is suppressed.
- **Investigation card is empty on a `true_positive` verdict.** Investigation only fires when the Commander's confidence crosses the configured threshold for the organisation. Trigger `Run Investigation` from the `Manual re-run` section of the drawer to populate the investigation card before resolving.
- **Three agents agreed in under one second.** The provider returned cached completions. Re-run the chain with the `Force re-evaluate` toggle in the drawer; cache bypass is applied for the retry.
- **The alert that triggered the incident cannot be located.** Open `/incidents/:id` and use the `View full AI analysis` action in the `HeaderActions` row to land directly on the source decision in the drawer.

## Audit and compliance
- Every operator disposition writes a row to `public.ai_triage_decisions` with `review_action`, `review_reason`, `reviewed_by`, and `reviewed_at` populated.
- A correlated row is written to `public.activity_logs` with `action_type` set to `triage_confirmed`, `triage_overridden`, or `incident_resolved` and `actor_id = auth.uid()`.
- The verdict trail, citations, and operator notes are retained in `ai_triage_decisions` for 24 months in accordance with the customer's data retention configuration and the Mithras SOC evidentiary standard.
- Force overrides and refute notes are surfaced in the customer's monthly report and are visible to the channel partner and the customer administrator.

## Related procedures
- [Approve or override an autonomous response](/help/sops/soc_operator/approve-auto-response)
- [Investigate a cross-tenant campaign](/help/sops/soc_operator/investigate-campaign)
- [Resolve an incident](/help/sops/soc_operator/resolve-incident)
