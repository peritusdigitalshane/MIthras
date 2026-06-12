---
title: Configure notification recipients
audience: customer_admin
description: Add or remove the email addresses that receive incident alerts, autonomous-response notifications, and monthly reports.
order: 3
estimated_minutes: 6
updated_at: 2026-06-12
tags: notifications, recipients, comms
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure configures which email addresses receive the categories of communication Mithras generates: monthly customer reports, incident alerts requiring a customer decision, and autonomous-response notifications armed with one-click rollback. Incorrect or stale recipients result in missed approvals and force-expiry of containment actions.

## Audience and authority
Customer administrators whose `organization_memberships.role` is `admin` or `owner`. Recipient changes are written to `public.org_report_recipients` and take effect on the next outbound message.

## Prerequisites
- The user account that will own a recipient slot has consented to receive operational security communications.
- You are signed in to the Mithras console at `https://www.mithras.com.au/login`.

## Procedure

1. Open **`/settings`**.
2. Locate the **Notification recipients** section.
3. For each notification category, configure recipients independently:
   - **Monthly customer report** — addressed to executive sponsors, IT leads, and any nominated compliance contact. Delivered between the first and fifth business day of each month.
   - **Incident notification** — addressed to the staff who triage and decide on Mithras-initiated containment actions. The one-click **Confirm action** and **Mark false positive** links in these messages are authenticated by a single-use token; treat them as privileged.
   - **Autonomous-response notification** — sent at the moment the AI Commander dispatches a containment action. Recipients are typically the same as the incident category; separate them if your operations and security teams are distinct.
4. For each recipient, enter the email address and select the **Active** toggle. Save the row.
5. Remove any addresses that are no longer current. Disabling a recipient is preferred over deletion where you wish to preserve the audit history.

## Verification
- The **Notification recipients** section lists every active recipient with the correct category assignment.
- Send a test message using the **Send test** button on each category. Each recipient receives an email within two minutes confirming the category and the sending address.
- The audit log at `/activity` shows a row with `action_type = 'recipients_updated'` and your user identifier.

## Troubleshooting
- **A recipient does not receive the test message.** Confirm the address is correct and that the recipient has not unsubscribed. Bounce events are recorded against the address; the **Send test** dialog surfaces the most recent delivery status.
- **A test message is delivered, but a real incident notification is not.** Confirm the recipient is active for the **Incident notification** category specifically. Monthly-report recipients do not receive incident messages.
- **A confirmation link in a notification email returns `token_expired`.** The one-click action token is valid for the duration of the auto-rollback window, which defaults to four hours. If the action has already rolled back, the link is no longer usable; review the incident at `/incidents/:id` and act from the console.

## Audit and compliance
- Recipient changes are recorded in `public.activity_logs` with the actor identifier and a JSON diff of the changed rows.
- Outbound messages are logged in `public.ai_agent_comms` with their delivery status. Failed deliveries automatically disarm the auto-rollback for the associated action and surface a banner on the incident detail page.

## Related procedures
- [Understand the incident detail page](/help/sops/customer_admin/understand-incident-detail)
- [Review threats](/help/sops/customer_admin/review-threats)
