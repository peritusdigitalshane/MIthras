---
title: Escalate a security concern
audience: customer_member
description: Report a suspected security event to your reseller in a structured manner that preserves evidence and accelerates response.
order: 2
estimated_minutes: 4
updated_at: 2026-06-12
tags: escalation, incident-response, customer-member
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure defines the channel, evidence, and conduct required when a non-administrative member of a customer organisation observes or is informed of a suspected security event. Correct escalation preserves volatile evidence, enables the reseller and the Peritus 24/7 SOC to triage at speed, and protects the affected device from inadvertent disturbance.

## Audience and authority
Members of a customer organisation whose `organization_memberships.role` is `member`. The procedure is read-only with respect to the platform: it does not authorise the reader to execute any RPC, dispatch any edge function, or change any policy. All mutating response actions are performed by the reseller or by the Peritus 24/7 SOC on the reader's behalf.

## Prerequisites
- You hold an active membership in the customer organisation.
- You are signed in to the Mithras console at `https://www.mithras.com.au/login`, or you can reach the console from another device.
- The contact details for your reseller are published at `/customer/contact`.
- A means of recording the time, the device name, and what was observed is available to you (notebook, phone camera, or the device itself if it is unaffected).

## Procedure

1. Leave the affected device powered on and connected to the network. Do not shut it down, restart it, hibernate it, or disconnect any cables. Volatile memory contains evidence that the Peritus 24/7 SOC may require.
2. Instruct the user of the affected device to step away from the keyboard. Do not click links, do not close windows, and do not dismiss popup messages on the affected device.
3. From an unaffected device, open the Mithras console and navigate to `/customer/contact`. The page renders the primary security contact details for your reseller: `Contact name`, `Email`, `Telephone`, and `Operating hours`.
4. Use the telephone number for any concern that is in progress or that involves user data, credentials, or financial systems. Use the email address only for retrospective reports of an event that has concluded.
5. State the following information to the reseller, in this order:
   - The full name of the staff member who observed the event.
   - The hostname of the affected device, as it appears on `/customer/endpoints`.
   - The local time at which the event was first noticed.
   - The exact text of any popup, dialog, ransom note, or unusual email subject line.
   - The actions taken on the device since the event was noticed, including `none`.
6. Remain on the call until the reseller confirms the concern has been logged and that you are released. Do not perform any action on the affected device that the reseller has not explicitly requested.
7. If a separate user reports a similar event on a different device while the first call is in progress, repeat the procedure for the second device. Each device is triaged separately.

## Verification
- A reseller representative has acknowledged the report by telephone or by reply email.
- The affected device remains powered on, on the network, and untouched by users.
- An incident record subsequently appears at `/customer/threats` against the affected endpoint, or in the next monthly report at `/customer/reports` under `Notable events`.
- An entry appears in `public.activity_logs` against the affected endpoint with `action_type` in the `customer_concern_*` family, written by the reseller on your behalf.

## Troubleshooting
- **The reseller telephone number is unanswered and the concern is time-critical.** Use the secondary number published on `/customer/contact` under `After-hours escalation`. That number reaches the Peritus 24/7 SOC. Reserve this channel for events involving active encryption, mass account lockout, or suspected financial fraud.
- **The page `/customer/contact` does not display contact details.** Your reseller has not yet populated the record. Notify your customer administrator immediately; they hold the authority to request a backfill.
- **You cannot reach the Mithras console.** Telephone your customer administrator and report verbally. The administrator holds the contact details independently.
- **A second event begins while you are on the call.** Inform the representative on the call of the second device before ending the call. Do not place the first call on hold to start a second call.

## Audit and compliance
- The reseller records the concern by writing to `public.alerts` with the affected `endpoint_id` and a category corresponding to the reported behaviour.
- Subsequent response actions are recorded to `public.ai_agent_actions` (for automated containment) and `public.activity_logs` (for human actions), each retained for 24 months in accordance with the customer's data retention configuration.
- Where the concern results in the dispatch of `ai-response-execute` or `ai-response-rollback`, the action and its rollback evidence are retained against the same incident.
- Where the concern is later confirmed as an incident, a row is written to `public.incidents` and the incident is summarised in the next monthly report under `Notable events`.

## Related procedures
- [Read your monthly Mithras report](/help/sops/customer_member/read-monthly-report)
