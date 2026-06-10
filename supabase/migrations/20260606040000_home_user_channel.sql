-- 20260606040000_home_user_channel.sql
--
-- Adds a direct-to-consumer "home user" sales channel alongside the B2B
-- chain. Home users buy a $6/month subscription online via Stripe Checkout
-- — no reseller, no distributor, no portal access. Their org is created
-- automatically on payment; their endpoint enrols via an emailed install
-- command; their security posture is monitored by Peritus directly.
--
-- They get:
--   - A 'home_user' organisation_type
--   - The standard default Defender / UAC / Windows Update policies
--     (auto-seeded by the existing create_default_defender_policies trigger)
--   - A Stripe customer + subscription tracked on the org row
--
-- They DON'T get:
--   - A login to any portal (super-admin manages on their behalf)
--   - Microsegmentation, app whitelisting, EOL hardening (operator features)
--   - The customer portal at /customer

-- 1. Allow 'home_user' in the organisation_type CHECK constraint.
ALTER TABLE public.organizations
    DROP CONSTRAINT IF EXISTS organizations_organization_type_check;
ALTER TABLE public.organizations
    ADD CONSTRAINT organizations_organization_type_check
    CHECK (organization_type IN ('partner', 'distributor', 'customer', 'home_user'));

-- 2. Stripe integration columns.
ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS stripe_customer_id        text,
    ADD COLUMN IF NOT EXISTS stripe_subscription_id    text,
    ADD COLUMN IF NOT EXISTS stripe_status             text,
    ADD COLUMN IF NOT EXISTS stripe_current_period_end timestamptz,
    ADD COLUMN IF NOT EXISTS home_user_email           text;

CREATE INDEX IF NOT EXISTS idx_organizations_stripe_customer
    ON public.organizations(stripe_customer_id)
    WHERE stripe_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_organizations_home_user_email
    ON public.organizations(home_user_email)
    WHERE home_user_email IS NOT NULL;

COMMENT ON COLUMN public.organizations.stripe_customer_id IS
'Stripe Customer ID for home-user orgs. NULL for B2B orgs (billed manually via /admin/invoices).';

COMMENT ON COLUMN public.organizations.stripe_status IS
'Last-known Stripe subscription status: active, past_due, canceled, unpaid, trialing, incomplete.';

COMMENT ON COLUMN public.organizations.home_user_email IS
'Contact email for home-user orgs (since they have no login). Used to send the install command + monthly status report.';

-- 3. Super-admin overview RPC for home users. Returns totals + recent + at-risk
--    in a single round trip. Same pattern as get_admin_channel_overview().
CREATE OR REPLACE FUNCTION public.get_admin_home_users_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    out             jsonb;
    totals          jsonb;
    rows            jsonb;
    now_ts          timestamptz := now();
BEGIN
    IF NOT public.is_super_admin(auth.uid()) THEN
        RAISE EXCEPTION 'super_admin_required';
    END IF;

    SELECT jsonb_build_object(
        'total_home_users',  (SELECT count(*) FROM public.organizations WHERE organization_type='home_user'),
        'active_subscriptions',
            (SELECT count(*) FROM public.organizations
              WHERE organization_type='home_user' AND stripe_status = 'active'),
        'past_due',
            (SELECT count(*) FROM public.organizations
              WHERE organization_type='home_user' AND stripe_status = 'past_due'),
        'canceled',
            (SELECT count(*) FROM public.organizations
              WHERE organization_type='home_user' AND stripe_status IN ('canceled','unpaid')),
        'estimated_mrr_cents',
            (SELECT
                (SELECT count(*) FROM public.organizations
                  WHERE organization_type='home_user' AND stripe_status='active')
                * COALESCE((SELECT wholesale_price_cents FROM public.platform_pricing_defaults WHERE tier='customer'), 1100)
            ),
        'endpoints_total',
            (SELECT count(*) FROM public.endpoints e
               JOIN public.organizations o ON o.id = e.organization_id
              WHERE o.organization_type = 'home_user'
                AND e.deleted_at IS NULL
                AND e.is_active IS DISTINCT FROM false),
        'endpoints_online',
            (SELECT count(*) FROM public.endpoints e
               JOIN public.organizations o ON o.id = e.organization_id
              WHERE o.organization_type = 'home_user'
                AND e.deleted_at IS NULL
                AND e.is_active IS DISTINCT FROM false
                AND e.last_seen_at > (now_ts - interval '24 hours'))
    ) INTO totals;

    SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC)
      INTO rows
      FROM (
        SELECT o.id              AS org_id,
               o.name            AS org_name,
               o.home_user_email AS contact_email,
               o.stripe_status,
               o.stripe_current_period_end,
               o.created_at,
               COALESCE((SELECT count(*)::int FROM public.endpoints e
                          WHERE e.organization_id = o.id
                            AND e.deleted_at IS NULL
                            AND e.is_active IS DISTINCT FROM false), 0) AS endpoint_count,
               (SELECT max(e.last_seen_at) FROM public.endpoints e
                 WHERE e.organization_id = o.id
                   AND e.deleted_at IS NULL) AS last_seen_at
          FROM public.organizations o
         WHERE o.organization_type = 'home_user'
         ORDER BY o.created_at DESC
         LIMIT 500
      ) t;

    out := jsonb_build_object(
        'generated_at', now_ts,
        'totals',       totals,
        'rows',         COALESCE(rows, '[]'::jsonb)
    );
    RETURN out;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_home_users_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_home_users_overview() TO authenticated, service_role;

COMMENT ON FUNCTION public.get_admin_home_users_overview() IS
'Super-admin view of the direct-to-consumer home-user channel. Returns totals + list of all home_user orgs with their Stripe subscription status + endpoint count.';
