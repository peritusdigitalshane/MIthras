---
title: Resolve an incident
audience: soc_operator
description: Close the loop on a contained incident with notes that flow to the customer's monthly report.
order: 2
estimated_minutes: 5
updated_at: 2026-06-12
tags: incident, response, ai-soc
---

## When to use this
The Autonomous Response card on `/incidents/:id` shows the threat has been contained, the customer has been notified, and you've reviewed the playbook. Now you're closing the case.

## Prerequisites
- The incident is in `Open`, `Triaging`, or `In progress` status (closed incidents don't show the resolve buttons).
- You have role super-admin OR org admin of the customer.

## Steps

1. Open **`/incidents/:id`** for the incident.
2. Review the cards in order:
   - **AI Commander summary** — confirm the one-line summary matches your understanding.
   - **Playbook** — every step that should be done has a green check.
   - **Autonomous response** — `status='executed'` or `customer_confirmed`; if `comms_failed` banner shows, contact the customer before closing.
   - **Customer notifications** — at least one row with `Sent` status (unless you've decided notification wasn't required).
3. Click the appropriate top-right button:
   - **Resolve** — the threat was real and we acted on it.
   - **False positive** — the threat wasn't real; the response should be unwound.
4. In the dialog, write resolution notes — these go into:
   - The audit trail (`incidents.resolution_notes`)
   - The next monthly customer report PDF
   - Your team's weekly review (if you run one)
5. Click **Resolve** / **Mark false positive**.

## What good notes look like

Resolve (real threat):
> Wacatac.B!ml detected on WH-04 03:14 UTC. Defender quarantined; isolation released after re-scan returned clean. Source: phishing email with macro-laden .doc — reported user education ticket to ACME IT. Customer notified 03:18; no spread observed in other endpoints. SLA met.

False positive:
> Detected as "wp_brute_force" on ACME blog. Investigation showed traffic was from ACME's own monitoring tool doing scheduled health-check logins. Tool will be added to allow-list. No action taken on customer.

## Verify
- The incident moves to the **Closed** tab on `/incidents`.
- The detail page now shows the **Resolution notes** card with your text + the resolved-by user.
- The customer's next monthly report includes this incident in the security summary.

## Troubleshooting
- **"This incident is already closed"** — refresh; someone else got there first. Open the audit log on the row to see who.
- **Customer is asking about an incident you already closed.** Send them the direct link `/incidents/:id` — they can read the commander summary even after closing if they're org-admin on their side.
- **You closed by accident.** Open the row, change status back to `In progress` via the status dropdown on the list page. Resolution notes stay in the audit log even after re-opening.

## Related
- [Triage a new alert](/help/sops/soc_operator/triage-new-alert)
- [Approve an auto-response](/help/sops/soc_operator/approve-auto-response)
