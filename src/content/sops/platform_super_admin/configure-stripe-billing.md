---
title: Configure Stripe billing for Mithras Personal
audience: platform_super_admin
description: Connect the Stripe account that bills Mithras Personal subscriptions, register the webhook, and verify the end-to-end checkout flow with a test card.
order: 6
estimated_minutes: 30
updated_at: 2026-06-12
tags: stripe, billing, integrations, home-user, onboarding
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure connects the Stripe account that processes Mithras Personal subscription payments to the platform, registers the inbound webhook that synchronises subscription state into `public.organizations`, and verifies the full sign-up → payment → provisioning loop with a real Stripe test card. Until the procedure completes, no home user can subscribe; the `/personal` signup will fail at the checkout step.

## Audience and authority
Mithras platform operators whose `user_id` is present in `public.super_admins`. The admin surface at `/settings` is gated by `is_super_admin(auth.uid())`, and the `stripe-settings` edge function rejects calls from any other role. Stripe account access requires either the **Owner** or **Administrator** role on the Mithras Stripe account.

## Prerequisites
- A Stripe account in **Test mode** for initial configuration and **Live mode** for production go-live. The same procedure runs against both — only the secret keys differ.
- The Stripe account already has a Product representing the Mithras Personal subscription with a recurring price (typically AUD 11 / month / endpoint). If it does not, create it under **Stripe Dashboard → Product catalogue → Add product** before starting; recurring billing, monthly cadence, AUD currency, no trial period.
- DNS for `api.mithras.com.au` and `www.mithras.com.au` resolves to the production load balancer.
- The Mithras console is reachable at `https://www.mithras.com.au` and you have signed in as a super-admin.
- You hold the Stripe account credentials in Passbolt under `External Services → Stripe → Mithras account`. Never paste the live secret key into Slack, email, or a ticket.

## Procedure

### 1. Capture the Stripe secrets

1. Sign in to the **Stripe Dashboard** at `https://dashboard.stripe.com`.
2. Confirm the dashboard mode in the top-right toggle — **Test** for the initial configuration, **Live** for go-live. The remainder of this procedure assumes you have decided which mode you are configuring.
3. Open **Developers → API keys**. Record the **Secret key** value (it starts with `sk_test_...` in test mode or `sk_live_...` in live mode). This is shown only once on creation of a restricted key, or in full on the platform's default secret key. Treat it as a credential.
4. Open **Product catalogue**, locate the Mithras Personal price, and record its **Price ID** (it starts with `price_...`). Each price ID is mode-specific; the test-mode price ID is different from the live-mode price ID.

### 2. Configure the platform-side secrets

1. Open **`/settings`** in the Mithras console.
2. Locate the **Stripe billing** card.
3. Populate the fields:
   - **Secret key** — the `sk_test_...` or `sk_live_...` value captured in step 1.3.
   - **Webhook signing secret** — leave blank for now; it is generated in step 3 and added back in step 4.
   - **Personal price ID** — the `price_...` value from step 1.4.
   - **Success URL** — set to `https://www.mithras.com.au/personal/success`.
   - **Cancel URL** — set to `https://www.mithras.com.au/personal`.
   - **Portal return URL** — set to `https://www.mithras.com.au/account`.
4. Toggle **Enable Stripe billing** to the on position.
5. Select **Save**. The card writes the secrets to the `stripe_*` platform setting rows; secret-key fields are encrypted at rest and never returned to the browser in the clear (they display as `__redacted__` on reload).
6. Select **Test connection**. The console calls `stripe-settings → status`, which pings Stripe's `GET /v1/account`. The card displays the detected mode (`test` or `live`) and the account name.

### 3. Register the webhook in Stripe

1. In the Stripe Dashboard, open **Developers → Webhooks → Add endpoint**.
2. Endpoint URL: `https://api.mithras.com.au/functions/v1/stripe-webhook`.
3. **Listen to events** → choose **Select events**, then tick exactly these three:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Set the **Description** to `Mithras Personal subscription sync — peritus-platform`.
5. Select **Add endpoint**.
6. On the resulting endpoint detail page, select **Reveal** under **Signing secret** and copy the `whsec_...` value. This value is shown to you exactly once on this dashboard session; store it in Passbolt.

### 4. Wire the webhook secret back to the platform

1. Return to **`/settings → Stripe billing**.
2. Paste the `whsec_...` value into the **Webhook signing secret** field.
3. Select **Save**. The platform stores the value and uses it on every inbound webhook to verify the `Stripe-Signature` header.
4. Select **Test connection** again. The card now shows **All checks pass** with three green ticks: account reachable, price ID resolvable, webhook secret stored.

### 5. End-to-end checkout test

1. From a private browser window, navigate to `https://www.mithras.com.au/personal`.
2. Enter a test email such as `+stripe-test@yourdomain.example` and complete the signup. The checkout button redirects to Stripe Checkout.
3. On the Stripe Checkout page, pay with the standard Visa success card: number `4242 4242 4242 4242`, any future expiry, any three-digit CVC, any postcode. (Use `4000 0025 0000 3155` to validate 3D Secure flow if your live account has SCA enabled.)
4. After Stripe completes the payment, you are redirected to `https://www.mithras.com.au/personal/success`. The `checkout.session.completed` webhook fires within five seconds.
5. From an admin tab open `/admin/home-users`. The new home user organisation appears in the list with `stripe_status = 'active'` and `subscription_expires_at` thirty days in the future.

### 6. Verify the portal round-trip

1. Sign in as the home-user test account and open **`/account`**.
2. Select **Manage subscription**. The console calls `stripe-customer-portal`, which generates a Stripe Customer Portal session and redirects.
3. In the portal, select **Cancel plan**. Confirm cancellation at period end.
4. Within two minutes, the `customer.subscription.updated` webhook fires. On `/admin/home-users`, the row reflects `stripe_status = 'canceled'` and the same period-end timestamp returned by Stripe.

## Verification

- `/settings → Stripe billing` shows **All checks pass** for account, price ID, and webhook secret.
- A new row in `public.organizations` with `organization_type = 'home_user'`, `stripe_subscription_id` populated, and `stripe_status = 'active'` exists after the test checkout.
- An entry appears in `public.activity_logs` with `action_type = 'home_user_provisioned'` and the test email.
- The Stripe Dashboard **Webhooks** view shows the three event types delivered with HTTP 200 responses against the registered endpoint.
- The test home-user account can sign in at `https://www.mithras.com.au/login` and reach `/account` without error.

## Troubleshooting

- **`/settings → Stripe billing` shows `Connection failed: invalid_api_key`.** The secret key was copied with surrounding whitespace, was copied from the wrong mode (live key against the test dashboard or vice versa), or was rotated in Stripe after configuration. Re-copy from **Developers → API keys** and save.
- **Webhook signature verification fails on every event.** The `whsec_...` recorded in **Stripe billing** does not match the endpoint's signing secret. Stripe rotates this value whenever you delete and re-create the endpoint; if you re-created it, copy the new secret and save. Inspect the failing event in **Stripe Dashboard → Webhooks → Events → Failed** for the exact error.
- **Checkout succeeds but no row appears in `public.organizations`.** The webhook never reached the platform. Verify the endpoint URL is exactly `https://api.mithras.com.au/functions/v1/stripe-webhook` (no trailing slash, no path typo). Confirm DNS resolves and the Supabase edge runtime is healthy at `/admin/health`. Re-deliver the failed event from the Stripe webhook event detail page.
- **Customer portal returns 404 or `no_such_customer`.** The home-user organisation has a `stripe_customer_id` that no longer exists in the connected Stripe account. This commonly happens when switching from test mode to live mode without re-provisioning the customer. Delete the organisation row through `/admin/home-users` and have the user re-subscribe through `/personal`.
- **Test card succeeds but Stripe shows `requires_action`.** Strong Customer Authentication (SCA) was challenged and the test card path was not completed. Repeat the test with card `4000 0025 0000 3155` to walk the 3D Secure flow. Production card behaviour follows the issuer's SCA policy.

## Audit and compliance

- Stripe secret-key writes are recorded in `public.activity_logs` with `action_type = 'platform_setting_updated'`, `resource_type = 'stripe_settings'`, and the operator's `user_id`. The values themselves are encrypted in `public.platform_settings` and never appear in the audit trail.
- Every Stripe webhook delivery is logged by the `stripe-webhook` edge function with the event id, type, and outcome. Failed verifications return HTTP 400 and are visible in **Stripe Dashboard → Webhooks → Events** with the corresponding error message.
- Card data is handled exclusively by Stripe under PCI DSS Service Provider Level 1. Mithras stores only the masked metadata returned by Stripe (`last4`, `brand`, `exp_month`, `exp_year`, `stripe_customer_id`, `stripe_subscription_id`). No primary account number is retained on the Mithras side at any time.
- Subscription lifecycle events are mirrored to `public.organizations` columns `stripe_status`, `stripe_subscription_id`, `stripe_current_period_end`, and `subscription_expires_at`. These records are retained for the lifetime of the customer relationship plus seven years in accordance with the Mithras financial records retention policy.

## Related procedures

- [Respond to an AI cost-budget alert](/help/sops/platform_super_admin/respond-to-ai-budget-alert)
- [Audit channel margins](/help/sops/platform_super_admin/audit-channel-margins)
- [Home user: change payment method](/help/sops/home_user/change-payment-method)
- [Home user: cancel subscription](/help/sops/home_user/cancel-subscription)
