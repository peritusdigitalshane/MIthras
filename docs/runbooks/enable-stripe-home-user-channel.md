# Enabling the Stripe home-user channel

The `/personal` sales page, the Stripe Checkout edge function, and the
webhook handler are all deployed and running. They're gated behind missing
env vars — the page renders a friendly "subscriptions opening soon" message
until you complete the steps below.

## What you need

- A Stripe account (test mode is fine for initial validation, live for go-live)
- SSH access to `root@149.28.186.142`
- ~30 minutes

## Step 1 — Create the Stripe Product + Price

In your Stripe dashboard (test or live, whichever you're configuring):

1. Products → **Add product**
2. Name: `Mithras Personal`
3. Description: `Enterprise-grade endpoint security for one personal Windows PC. Cancel anytime.`
4. Pricing model: **Recurring**
5. Price: **$6.00 AUD** (or USD if you want USD; the public page says AUD)
6. Billing period: **Monthly**
7. **Save**
8. Copy the **Price ID** (looks like `price_1Nxxxxxxxxxxxxxxxxxxxxxx`) — you'll paste it as `STRIPE_HOMEUSER_PRICE_ID` below

## Step 2 — Set up the webhook endpoint

Still in the Stripe dashboard:

1. Developers → Webhooks → **Add endpoint**
2. Endpoint URL: `https://api.mithras.com.au/functions/v1/stripe-webhook`
3. Description: `Mithras home-user subscription lifecycle`
4. Events to send — select these three:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. **Add endpoint**
6. On the new endpoint's page, click **Reveal** under "Signing secret" — copy the value starting with `whsec_…` — you'll paste it as `STRIPE_WEBHOOK_SECRET` below

## Step 3 — Get your Stripe API key

1. Developers → API keys
2. Copy the **Secret key** (`sk_test_…` for test mode, `sk_live_…` for live)
3. This is `STRIPE_SECRET_KEY` below

> **Never paste any of these secrets into git, MkDocs, or memory files.**
> Add them to Passbolt → *Docker - docker-pub-01 / External Services* under
> a new entry called "Stripe — Mithras Personal".

## Step 4 — Put the three secrets on docker02

```bash
ssh root@149.28.186.142

# Append the three secrets to the supabase stack env. Replace the
# placeholders below with the real values from steps 1-3.
cat >> /opt/peritus-supabase/.env <<'EOF'

# Mithras Personal — Stripe home-user channel
STRIPE_SECRET_KEY=sk_live_REPLACE_ME
STRIPE_WEBHOOK_SECRET=whsec_REPLACE_ME
STRIPE_HOMEUSER_PRICE_ID=price_REPLACE_ME
STRIPE_HOMEUSER_SUCCESS_URL=https://www.mithras.com.au/personal/success
STRIPE_HOMEUSER_CANCEL_URL=https://www.mithras.com.au/personal
# Where Stripe returns the user after they finish the self-serve Billing
# Portal (cancel / update card). Should be the home-user account page.
STRIPE_HOMEUSER_PORTAL_RETURN_URL=https://www.mithras.com.au/account
EOF

# Restart edge functions so they pick up the new env
docker compose -f /opt/peritus-supabase/docker-compose.yml restart functions
sleep 5
docker compose -f /opt/peritus-supabase/docker-compose.yml logs --tail 10 functions
```

## Step 5 — Smoke test

In test mode you can use Stripe's test card `4242 4242 4242 4242` with any
future expiry and any CVC.

1. Go to `https://www.mithras.com.au/personal`
2. Enter a test email
3. Click **Subscribe via Stripe** — you should be redirected to a Stripe
   Checkout page (not see the "subscriptions opening soon" alert)
4. Complete checkout with the test card
5. Within ~10 seconds you should:
   - See a new row in `organizations` with `organization_type='home_user'` and
     `stripe_status='active'`
   - Receive the welcome email at the address you typed
   - See the subscriber appear at `/admin/home-users`

Verify the row exists:
```bash
ssh root@149.28.186.142 'docker exec -i supabase-db psql -U postgres -d postgres -c "
  SELECT name, home_user_email, stripe_status, created_at
    FROM organizations WHERE organization_type='\''home_user'\'' ORDER BY created_at DESC LIMIT 5;
"'
```

## Step 6 — Switching to live mode

When you're ready for real money:

1. Repeat steps 1-3 in **live mode** of your Stripe dashboard
2. Replace the three `sk_live_…` / `whsec_…` / `price_…` values in
   `/opt/peritus-supabase/.env` with the live values
3. Restart functions
4. Update `STRIPE_HOMEUSER_SUCCESS_URL` and `STRIPE_HOMEUSER_CANCEL_URL` if
   the production URLs differ from the test URLs (they shouldn't)

## What the webhook actually does (for context)

On `checkout.session.completed` (event metadata.role = `home_user`):
1. Creates a new `organizations` row with `organization_type='home_user'`,
   `home_user_email`, the Stripe customer + subscription IDs, and
   `stripe_status='active'`
2. The existing `create_default_defender_policies` trigger fires on insert
   and seeds the org with **Secure Defender / UAC / Windows Update policies**
   automatically — exactly what we want for a home user
3. Creates a single-use `enrollment_tokens` row so the agent installer can
   authenticate
4. Calls `send-home-user-welcome` which emails the install command + code

On `customer.subscription.updated`:
- Syncs `stripe_status` and `stripe_current_period_end` on the org

On `customer.subscription.deleted`:
- Marks org `is_active=false`. The agent stops ingesting on its next
  heartbeat. Data retained.

## Step 6 — Enable the Stripe Billing Portal

Mithras serves a self-serve `/account` page where home users can manage
or cancel their subscription. It opens a Stripe-hosted billing portal
session, so you have to enable the portal in Stripe once:

1. Stripe Dashboard → **Settings → Billing → Customer portal**
2. Toggle on **Allow customers to cancel subscriptions**
   (cancel-at-end-of-period is the default; that's fine)
3. Toggle on **Allow customers to update payment methods**
4. Save

No price/product config needed — the portal honours whatever subscription
the customer is on. The `STRIPE_HOMEUSER_PORTAL_RETURN_URL` env var above
controls where Stripe drops the customer after they're done.

## Known limitations / future work

- **Cancellation propagates via webhook only.** The home user clicks
  cancel in the Stripe portal, Stripe fires `customer.subscription.deleted`
  or `customer.subscription.updated`, the webhook flips `stripe_status`
  and `is_active=false`. There's no live polling — if the webhook is down
  the org will look active in `/admin/home-users` until it recovers.
- **Cancellation doesn't uninstall the agent automatically.** The agent
  stops ingesting because heartbeats are rejected (org is inactive), but
  the agent service stays installed. A user has to uninstall manually if
  they want a clean machine. Could be improved with a "soft-suspend →
  agent self-uninstalls after 30 days inactive" follow-up.
- **No first-failure handling for the welcome email.** If SMTP fails the
  webhook returns 500 and Stripe retries — eventually it gives up. If you
  see a home user in `/admin/home-users` with no endpoint after 24h, the
  install email may have bounced.
- **The install command in the email references `install-personal.ps1`** —
  that script doesn't exist yet. It needs to be a thin wrapper that calls
  `install-agent.ps1` with a `-PersonalMode` flag. To-do.

## Roll back

If Stripe causes problems, remove the env vars and restart functions —
`/personal` will revert to "subscriptions opening soon" and no new
subscriptions can be created. Existing home-user orgs are untouched.
