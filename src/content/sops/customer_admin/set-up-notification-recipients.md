---
title: Set up notification recipients
audience: customer_admin
description: Configure who on your team receives monthly customer reports and critical alert emails.
order: 3
estimated_minutes: 5
updated_at: 2026-06-12
tags: notifications, reports, email
---

## When to use this
- You've just onboarded — set this up so reports actually arrive.
- Your security lead has changed and you need to redirect the alert stream.
- You want to add a billing contact who shouldn't see security details.

## Prerequisites
- Org-admin or owner role.
- Email addresses you want to add (one per recipient — distribution lists are also fine).

## Steps

1. Go to **`/settings`** (or **Settings → Notification recipients** from the sidebar).
2. Click **Add recipient**.
3. Enter:
   - **Email** — where the message lands.
   - **Display name** — optional, shows in the email greeting.
   - **What they receive**:
     - ☐ Weekly report (every Monday)
     - ☐ Monthly report (1st of the month)
     - ☐ Quarterly report (Jan/Apr/Jul/Oct 1st)
     - ☐ Critical alerts (real-time when a Severe threat fires)
4. Click **Save**. A `org_report_recipients` row is written.
5. Repeat for each person.

## Verify
- The recipient appears in the list with the right check-marks.
- For a quick sanity check, open **`/customer-reports`** and click **Send test report** on any historical report — pick the new recipient as the target. They should receive it within 1 minute.
- Critical-alert recipients can be confirmed via the test EICAR detection (see Troubleshooting).

## Troubleshooting
- **Recipient says they didn't get the report.** Check the recipient's spam folder first. Then check `/customer-reports` — the row for that report shows `Sent` if SMTP succeeded, `Failed` with the error if not. If you see `Failed: smtp_disabled`, your reseller hasn't configured SMTP — contact them.
- **One person is getting reports they don't want.** Open `/settings`, click the row, uncheck the report type, save.
- **Quarterly box is unchecked for everyone.** Quarterly reports are off by default — add at least one recipient with that box ticked.
- **You want a "no reports, alerts only" recipient.** Leave all the report boxes unchecked and tick only **Critical alerts**.

## Related
- [Review threats](/help/sops/customer_admin/review-threats)
- [Understand an incident](/help/sops/customer_admin/understand-incident-detail)
