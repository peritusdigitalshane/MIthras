---
title: Change your payment method
audience: home_user
description: Update the credit card or other payment method on your Mithras Personal subscription via the Stripe customer portal.
order: 3
estimated_minutes: 3
updated_at: 2026-06-12
tags: billing, stripe, subscription
---

## When to use this
- Your card expired or was reissued.
- You want to switch to a different card.
- A payment failed and you got the "Your Mithras subscription needs attention" email.

## How payment is handled
Mithras Personal uses **Stripe** for all billing. We never see or store your card number directly — you manage payment from the Stripe customer portal.

## Steps

1. Sign in to **`https://www.mithras.com.au/account`**.
2. Click **Manage subscription** in the **Billing** card. This opens the Stripe portal in a new tab (no extra login needed; you're authenticated via Mithras).
3. Click **Payment methods** in the Stripe portal.
4. Click **+ Add payment method**, enter the new card details (or pick a saved one).
5. Make the new method **default**.
6. (Optional) Remove the old card with **... → Delete**.
7. Close the Stripe tab. The change is instant.

## What happens next
- Your next renewal (monthly or annual depending on your plan) will charge the new card.
- If you had a failed payment, Stripe **automatically retries** within 24 hours. You don't need to do anything else.

## Verify
- Back on `/account`, the **Billing** card shows the last 4 digits of the new card.
- The **Next billing date** is unchanged.

## Troubleshooting
- **Stripe portal won't open.** Disable popup blockers for `mithras.com.au` and try again. If still no joy, contact support@mithras.com.au with your account email — they can email you a portal link directly.
- **Card was declined.** Stripe shows the bank's exact reason. Most often: international transaction blocked, expired CVC, insufficient funds. Fix at your bank's end and try again.
- **Payment succeeded but Mithras still shows "needs attention."** Mithras polls Stripe every 5 minutes. Wait, then refresh `/account`. Still stuck after 30 minutes → contact support.

## Related
- [Cancel subscription](/help/sops/home_user/cancel-subscription)
- [Install Mithras Personal](/help/sops/home_user/install-mithras-personal)
