---
title: Change your payment method
audience: home_user
description: Update the card or other payment method on your Mithras Personal subscription using the Stripe customer portal.
order: 3
estimated_minutes: 4
updated_at: 2026-06-12
tags: billing, stripe, subscription, payment
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure replaces the payment method on your Mithras Personal subscription. Mithras processes all billing through Stripe, the Payment Card Industry Data Security Standard (PCI DSS) accredited payment provider. Card details are entered into Stripe directly and are not held by Mithras.

## Audience and authority
The subscriber on a Mithras Personal plan. The payment method can be changed only by the account holder signed in at `https://www.mithras.com.au/login`. A managed Stripe customer portal session is issued from `/account`; no separate Stripe credentials are required.

## Prerequisites
- You have your sign-in credentials for the Mithras Personal account.
- Your Mithras Personal subscription exists in Stripe. The `Subscription` card on `/account` shows a `Status` value of `Active`, `Past due`, or `Trialing`.
- You have the new payment method ready: the card number, expiry, card verification code, and the billing postcode held by your card issuer.
- Pop-up windows from `www.mithras.com.au` and `billing.stripe.com` are not blocked in your browser.

## Procedure

1. Sign in at `https://www.mithras.com.au/login` with the email address on the subscription.
2. Open `/account`. Locate the `Billing` card. The card displays the current default payment method as `Card ending in <last4>` and the `Next billing date`.
3. Select the `Manage subscription` button. Mithras requests a managed Stripe customer portal session and opens `https://billing.stripe.com` in a new browser tab. The session is bound to your Mithras account; no Stripe sign-in is required.
4. In the Stripe portal, select the `Payment methods` section.
5. Select `Add payment method`. Enter the new card details in the Stripe form and select `Add`. Stripe validates the card with a zero-amount authorisation against your issuer.
6. Locate the new card in the `Payment methods` list. Select the `...` overflow menu next to it and choose `Make default`. The card is marked `Default` immediately.
7. To remove a superseded card, select its `...` overflow menu and choose `Delete`. The default card cannot be deleted.
8. Close the Stripe portal tab and return to `/account`. The `Billing` card refreshes within one minute and shows the new card's last four digits.

## Verification
- The `Billing` card on `/account` shows `Card ending in <last4>` matching the new payment method.
- The `Next billing date` on `/account` is unchanged.
- The Stripe portal `Payment methods` list shows the new card with a `Default` badge.
- If the subscription was `Past due`, Stripe automatically retries the outstanding invoice within 24 hours. The `Subscription` card returns to `Active` once the retry succeeds.

## Troubleshooting
- **The Stripe portal tab does not open.** Your browser is blocking pop-ups from `www.mithras.com.au`. Allow pop-ups for the site and select `Manage subscription` again. As an alternative, select the `Email me a billing link` option on the `Billing` card; Stripe sends a single-use portal link to your account email.
- **The new card is declined.** Stripe displays the issuer's decline reason directly under the card form. Common causes are `insufficient_funds`, `expired_card`, and `do_not_honor` for international transactions. Resolve the cause with your card issuer, then repeat the procedure.
- **The `Billing` card still shows the old card after ten minutes.** Mithras reconciles subscription state from Stripe every five minutes. Sign out of `/account` and sign back in to force a refresh. If the value does not update, contact `support@mithras.com.au` with your account email and the Stripe customer reference shown at the top of the Stripe portal.
- **The subscription is `Past due` and the retry does not complete.** Open the Stripe portal, select the open invoice from `Invoice history`, and select `Pay now` to settle it manually with the new card. Mithras restores protection within five minutes of payment confirmation.

## Audit and compliance
- Stripe records the payment method change in the customer's Stripe history and emails a confirmation to the subscription email address.
- Mithras writes an entry to `activity_logs` with `action_type = 'payment_method_updated'`. No card data is written to Mithras tables; only the masked `last4`, `brand`, and `exp_month` / `exp_year` values returned by Stripe are stored on the `Billing` card.
- Card data handling is performed entirely by Stripe under PCI DSS Service Provider Level 1. Mithras retains no full primary account number at any time.

## Related procedures
- [Install Mithras Personal on your computer](/help/sops/home_user/install-mithras-personal)
- [Cancel your Mithras Personal subscription](/help/sops/home_user/cancel-subscription)
- [What to do if Mithras blocks a file or application](/help/sops/home_user/what-to-do-if-blocked)
