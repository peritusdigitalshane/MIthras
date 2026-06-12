---
title: Cancel your Mithras subscription
audience: home_user
description: Cancel your Mithras Personal plan from the customer portal. No retention call, no friction — we make it easy.
order: 4
estimated_minutes: 3
updated_at: 2026-06-12
tags: billing, stripe, subscription
---

## When to use this
- You don't want to renew.
- You're switching to a different security product.
- You're consolidating to a business account managed by your employer.

We don't make you call to cancel and we don't try to talk you out of it. If Mithras isn't right for you, we'd rather you cancel cleanly.

## What "cancel" means here
- You **keep protection** until the end of your current billing period (no early termination, no refund prorating either).
- We **don't charge** you again after that.
- Your **agent stops checking in** when the period ends and the licence is reclaimed.
- Your **data** (your endpoint inventory, your historical reports) is kept for **30 days** after cancellation, then deleted. You can export reports during that window from `/account`.

## Steps

1. Sign in to **`https://www.mithras.com.au/account`**.
2. Click **Manage subscription** in the **Billing** card.
3. In the Stripe portal, click **Cancel plan**.
4. Confirm the cancellation. You'll see the date your protection ends (the current period's end date).
5. (Optional) Tell Stripe why you're leaving — we read every reason, no marketing follow-up.

## Before you cancel — useful exports

If you might come back, or just want a record:

- **Download your last 12 monthly reports** from `/account` → **Reports** → **Download all**.
- **Export your threat history** from `/account` → **Activity** → **Export CSV**.

## After you cancel

1. The Mithras tray icon stays green and active until the end of your billing period.
2. On the renewal date that would've been, the agent stops calling home.
3. You can uninstall it any time using the Mithras tray app → **Settings** → **Uninstall Mithras Personal**. Or leave it; without renewal, it eventually self-disables.

## Verify
- `/account` shows status **canceled** with the end date.
- You no longer have a `Next billing date`.
- Your Stripe portal shows the subscription as canceling.

## Changing your mind
You can **resubscribe** any time inside the 30-day data-retention window with the same email — your endpoints, reports, and exclusions come back automatically. Click **Resubscribe** on `/account`.

## Troubleshooting
- **Cancel button is missing.** That means your subscription is already cancelling. Look for the **Reactivate** link instead.
- **Charge appeared after I cancelled.** Stripe sometimes posts a final pro-rated charge if you canceled in the middle of a billing cycle — but only if you specifically picked **"end now and refund the rest"** in the portal. If unexpected, contact support@mithras.com.au with the Stripe receipt.

## Related
- [Change payment method](/help/sops/home_user/change-payment-method)
- [What to do if Mithras blocked something](/help/sops/home_user/what-to-do-if-blocked)
