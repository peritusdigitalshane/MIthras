---
title: Read and act on an incident detail page
audience: customer_admin
description: Interpret every card on /incidents/:id, confirm or reverse the autonomous response, and know when the Mithras SOC will act for you.
order: 4
estimated_minutes: 10
updated_at: 2026-06-12
tags: incidents, ai-soc, response
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure explains how to read the incident detail page at `/incidents/:id`, how to interpret each card on it, and how to act on the autonomous response Mithras has already taken. Customer administrators are expected to confirm or reverse autonomous actions within the rollback window; this document defines exactly how.

## Audience and authority
Customer administrators whose `organization_memberships.role` is `admin` or `owner`. Confirming an action or marking it a false positive invokes the `confirm_ai_action` Remote Procedure Call (RPC) and writes to `public.ai_agent_actions`; both privileges are gated on the `admin` or `owner` role. Customer members can read the page but cannot act on it.

## Prerequisites
- An incident has been created for your organisation. Severe and High threats automatically create an incident; Moderate and Low threats are visible on `/threats` only.
- You are signed in to the Mithras console at `https://www.mithras.com.au/login`.
- You can identify which endpoint and which user are associated with the incident.

## Procedure

1. Open the incident from the email notification or by navigating to `/incidents` and selecting the row. The page loads at `/incidents/:id`.
2. Read the **Header** card. It states:
   - **Severity** — the classification assigned by the AI Commander. Values are `Severe`, `High`, `Moderate`, `Low`.
   - **Status** — one of `Open`, `Triaging`, `In progress`, `Resolved`, `False positive`.
   - **Response target** — the window the AI Commander uses to drive autonomous response steps. One hour for `Severe`, four hours for `High`, one business day for `Moderate`, seven days for `Low`. These are internal targets used to sequence automated containment, not a contractual SLA.
   - **Commander kind** — the precise incident class (for example `malware`, `credential_compromise`, `ransomware_precursor`).
3. Read the **AI Commander summary** card. The single-line operator summary is written by the Incident Commander Agent. The collapsible **Customer-facing summary** is the version reproduced in your monthly customer report.
4. Read the **Playbook** card. It lists the ordered response stages: `forensics_complete`, `contained`, `customer_notified`, `review_scheduled`, `resolved`. The active stage is marked **In progress**; completed stages display the timestamp of completion.
5. Read the **Agent consensus** card. The card displays three verdicts:
   - **Triage** — the first-line classification by the AI Triage Agent.
   - **Verification** — an independent re-classification by a second model.
   - **Adversarial** — a counter-argument that attempts to refute the verdict. A value of `not_refuted` indicates the verdict survived adversarial review.
   When all three verdicts agree and the adversarial result is `not_refuted`, the consensus is trusted and the playbook advances autonomously. Disagreement holds the incident at the current stage and surfaces it for operator review at `/soc/incidents`.
6. Read the **Autonomous response** card. The card states:
   - **Action kind** — for example `isolate_network`, `kill_process`, `quarantine_file`.
   - **Status** — `executing`, `executed`, `customer_confirmed`, or `rolled_back`.
   - **Auto-rollback armed** banner — the action will be automatically reversed at the displayed expiry timestamp unless confirmed first. The default window is four hours.
   - **`forceFire` override** badge — a SOC operator manually bypassed the consensus gates. Treat this as an explicit signal to read the case in detail.
7. Decide on action:
   - To make the containment permanent, select **Confirm action**. The button calls the `confirm_ai_action` RPC and sets the status to `customer_confirmed`. The auto-rollback is cancelled.
   - To reverse the containment, select **Rollback now**. The agent receives the reversal command at the next heartbeat. Provide a written reason of at least twenty characters; the reason is retained in the audit trail.
   - To take no decision, allow the auto-rollback timer to expire. The action is reversed automatically at the timestamp shown on the banner.
8. Read the **Customer notifications** card. Each email dispatched by the AI Comms Agent is listed with its delivery status. A `failed` row indicates a delivery error; the platform automatically disarms the auto-rollback when no notification reached you, and the Mithras SOC is alerted.
9. After closure, read the **Resolution notes** card. The notes are written by the operator who closed the case and are reproduced in your monthly customer report.

## Verification
- The **Status** chip in the header reflects the action you took. `customer_confirmed` confirms a permanent action; `rolled_back` confirms a reversal.
- The **Auto-rollback armed** banner is absent once an action has been confirmed or rolled back.
- The endpoint at `/endpoints/:id` reflects the post-action state. For an `isolate_network` action that was confirmed, the endpoint shows **Network isolated**; for a rolled-back action, the endpoint returns to **Online**.
- The audit log at `/activity` contains a matching `ai_action_confirmed` or `ai_action_rolled_back` row with your user identifier.

## Troubleshooting
- **The Confirm action and Rollback now buttons are disabled.** Your `organization_memberships.role` is `member`. Ask an administrator or owner in your organisation to act, or escalate to your reseller for a role change.
- **The Auto-rollback armed banner shows an expiry in the past.** The rollback has already executed. Refresh the page; the **Status** chip will display `rolled_back`. Re-issuing the original action requires a fresh incident or a manual request to the Mithras SOC.
- **The Agent consensus card shows disagreement and the playbook has not advanced.** The incident is queued for the Mithras SOC. Expected handling time is the SLA shown in the header. No customer action is required until the SOC contacts you.
- **A customer notification row is `failed`.** The associated auto-rollback has been disarmed. The Mithras SOC has been alerted and will contact you through a fallback channel. Confirm the **Notification recipients** configuration at `/settings` to prevent recurrence.

## Audit and compliance
- The action record is retained in `public.ai_agent_actions` for 24 months in accordance with the customer's data retention configuration.
- Customer decisions (confirm, rollback, mark false positive) are written to `public.activity_logs` with `action_type` of `ai_action_confirmed`, `ai_action_rolled_back`, or `ai_action_false_positive`, and `actor_id = auth.uid()`.
- Outbound notifications and their delivery status are recorded in `public.ai_agent_comms`.
- Incident metadata, the consensus trail, and resolution notes are summarised in the monthly customer report distributed via `public.customer_reports`.

## Related procedures
- [Review threats detected on your endpoints](/help/sops/customer_admin/review-threats)
- [Configure notification recipients](/help/sops/customer_admin/set-up-notification-recipients)
- [Request an emergency unlock for an endpoint](/help/sops/customer_admin/request-emergency-unlock)
