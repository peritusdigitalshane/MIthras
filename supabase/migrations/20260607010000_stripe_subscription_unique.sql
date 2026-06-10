-- Stripe webhook idempotency hardening.
--
-- The home-user checkout webhook (stripe-webhook) relies on a single
-- `SELECT … FROM organizations WHERE stripe_subscription_id = $1`
-- check before INSERTing a new org. Without a UNIQUE constraint the
-- TOCTOU window between SELECT and INSERT is wide enough for two
-- concurrent Stripe webhook deliveries of the same checkout.session
-- to BOTH miss the dedup and BOTH create orgs — the customer ends up
-- double-billed for a single Stripe subscription. (Stripe deliberately
-- retries webhooks on any non-2xx, so duplicate deliveries are routine.)
--
-- A partial UNIQUE index turns the race into a 23505 on the loser,
-- which the function already returns as 500 → Stripe retries → second
-- delivery hits the SELECT and short-circuits cleanly.

CREATE UNIQUE INDEX IF NOT EXISTS organizations_stripe_subscription_id_uniq
ON public.organizations (stripe_subscription_id)
WHERE stripe_subscription_id IS NOT NULL;

-- Same guarantee for the soft check on home_user_email — the checkout
-- function already does `SELECT … FROM organizations WHERE home_user_email
-- = … AND organization_type = 'home_user'` to block duplicate signups,
-- but that's only enforced at the application layer. A second concurrent
-- /personal subscription would slip through.

CREATE UNIQUE INDEX IF NOT EXISTS organizations_home_user_email_uniq
ON public.organizations (home_user_email)
WHERE organization_type = 'home_user' AND home_user_email IS NOT NULL;
