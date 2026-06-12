---
title: Cancel your Mithras Personal subscription
audience: home_user
description: Cancel your Mithras Personal subscription through the Stripe customer portal and understand what happens to your protection and data.
order: 4
estimated_minutes: 5
updated_at: 2026-06-12
tags: billing, stripe, subscription, cancellation
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure cancels your Mithras Personal subscription at the end of the current billing period. Protection continues until that date. After the period ends, the subscription is closed, the agent stops reporting, and account data is retained for the documented grace window before deletion.

## Audience and authority
The subscriber on a Mithras Personal plan, signed in at `https://www.mithras.com.au/login`. Cancellation is self-service through the Stripe customer portal session issued from `/account`. No support contact is required to cancel.

## Prerequisites
- You have your sign-in credentials for the Mithras Personal account.
- The `Subscription` card on `/account` shows a `Status` value of `Active`, `Past due`, or `Trialing`.
- You have completed any data exports you require. See `Procedure` step 1 for the recommended exports.
- Pop-up windows from `www.mithras.com.au` and `billing.stripe.com` are not blocked in your browser.

## Procedure

1. Export any data you wish to retain before cancelling. From `/account`, select `Reports` and then `Download all reports` to retrieve the last 12 monthly reports as a single archive. Select `Activity` and then `Export CSV` to retrieve your detection history.
2. Sign in at `https://www.mithras.com.au/login`. Open `/account`.
3. Locate the `Billing` card. Select the `Manage subscription` button. A new browser tab opens `https://billing.stripe.com` with a managed portal session bound to your account.
4. In the Stripe portal, select the `Cancel plan` button on the active subscription.
5. Stripe displays the date on which protection will end. This is the last day of the current billing period. Confirm the date is correct.
6. Optionally select a cancellation reason from the list provided. Reasons are reviewed by Mithras Customer Operations and do not trigger any further contact.
7. Select `Cancel subscription` to confirm. The subscription is immediately marked for cancellation at the period end.
8. Close the Stripe portal tab. Return to `/account` and confirm the `Subscription` card reflects the change.

## Verification
- The `Subscription` card on `/account` shows `Status` as `Cancels on <date>`, where `<date>` is the last day of the current billing period.
- The `Next billing date` field is replaced by `Ends on <date>`.
- The Stripe portal shows the subscription with `Cancels at period end` and lists the same end date.
- The `Mithras Personal` tray icon remains green with the tooltip `Protected` until the end date. Protection is not reduced before that date.
- On the day after the end date, the tray icon transitions to grey with the tooltip `Subscription ended`, and the device is marked `Inactive` on `/account`.

## Troubleshooting
- **The `Cancel plan` button is not present.** The subscription is already scheduled for cancellation. The portal instead shows a `Renew subscription` button. To reverse the cancellation, select `Renew subscription`. To confirm cancellation is in effect, return to `/account` and read the `Subscription` card.
- **A charge appears after you cancelled.** The cancellation defaults to `end of current period`; no further full charges occur. If you selected the optional `Cancel and refund` action in the Stripe portal, Stripe issues a prorated refund within five working days. Unexpected charges should be reported to `support@mithras.com.au` with the Stripe receipt identifier.
- **You need to uninstall the agent before the end date.** Right-click the `Mithras Personal` tray icon, select `Settings`, then select `Uninstall Mithras Personal`. Approve the User Account Control prompt. The installer removes the `MithrasAgent` service, the `C:\Program Files\Mithras` directory, and the `C:\ProgramData\Mithras` data directory.
- **You wish to resubscribe within the data retention window.** Sign in at `/login`, open `/account`, and select `Resubscribe`. If the same Windows account and computer are used, the existing exclusions and detection history are reattached automatically. After the retention window closes, resubscribing starts a new account state.

## Audit and compliance
- Stripe records the cancellation against the customer record and emails a confirmation to the subscription email address.
- Mithras writes an entry to `activity_logs` with `action_type = 'subscription_cancelled'` and the scheduled end date.
- After the end date, the agent's last heartbeat is recorded and the device row is set to `is_active = false`. Detection history, monthly reports, and exclusion rules are retained for 30 days in line with the Mithras Personal data retention policy. After 30 days, account-scoped data is deleted and cannot be recovered. Aggregated, non-identifying telemetry is retained as set out in the Mithras Personal privacy notice.

## Related procedures
- [Change your payment method](/help/sops/home_user/change-payment-method)
- [Install Mithras Personal on your computer](/help/sops/home_user/install-mithras-personal)
- [What to do if Mithras blocks a file or application](/help/sops/home_user/what-to-do-if-blocked)
