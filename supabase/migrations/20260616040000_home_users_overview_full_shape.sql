-- 20260616040000_home_users_overview_full_shape.sql
--
-- Fix /admin/home-users showing "No home-user subscribers yet" when there
-- ARE active subscribers in the DB. The frontend (AdminHomeUsers.tsx +
-- useAdminHomeUsers) expects:
--
--   {
--     generated_at: timestamptz,
--     totals: {
--       total_home_users, active_subscriptions, past_due, canceled,
--       estimated_mrr_cents, endpoints_total, endpoints_online
--     },
--     rows: [{ org_id, org_name, contact_email, stripe_status,
--              stripe_current_period_end, created_at, endpoint_count,
--              last_seen_at }]
--   }
--
-- The previous version of this RPC returned just the 5 high-level totals
-- (active_count, estimated_mrr_cents, new_30d, cancelled_30d, price). The
-- page silently rendered "no subscribers" because `data.rows` was
-- undefined and `data.totals.*` was every wrong key.

CREATE OR REPLACE FUNCTION public.get_admin_home_users_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    home_user_price_cents int := 600;  -- public Mithras Personal price ex-GST
    v_totals              jsonb;
    v_rows                jsonb;
BEGIN
    IF NOT public.is_super_admin(auth.uid()) THEN
        RAISE EXCEPTION 'forbidden';
    END IF;

    -- TOTALS. One pass over organizations + a join into endpoints for the
    -- two endpoint counts. last_seen_at on endpoints is the source of
    -- truth for "online in last 24h".
    WITH home_orgs AS (
        SELECT id, stripe_status, is_active
          FROM public.organizations
         WHERE organization_type = 'home_user'
    ),
    ep AS (
        SELECT e.organization_id, e.last_seen_at, e.is_active
          FROM public.endpoints e
          JOIN home_orgs h ON h.id = e.organization_id
         WHERE e.deleted_at IS NULL
    )
    SELECT jsonb_build_object(
        'total_home_users',     (SELECT count(*) FROM home_orgs),
        'active_subscriptions', (SELECT count(*) FROM home_orgs
                                  WHERE is_active = true
                                    AND coalesce(stripe_status, 'active') IN ('active','trialing')),
        'past_due',             (SELECT count(*) FROM home_orgs WHERE stripe_status = 'past_due'),
        'canceled',             (SELECT count(*) FROM home_orgs WHERE stripe_status IN ('canceled','unpaid')),
        'estimated_mrr_cents',  (SELECT count(*) FROM home_orgs
                                   WHERE is_active = true
                                     AND coalesce(stripe_status, 'active') IN ('active','trialing'))::bigint
                                * home_user_price_cents,
        'endpoints_total',      (SELECT count(*) FROM ep WHERE is_active = true),
        'endpoints_online',     (SELECT count(*) FROM ep
                                   WHERE is_active = true
                                     AND last_seen_at IS NOT NULL
                                     AND last_seen_at >= now() - interval '24 hours')
    ) INTO v_totals;

    -- ROWS. One row per home_user org with derived endpoint count + latest
    -- endpoint heartbeat. Sorted newest-first so freshly-subscribed
    -- customers float to the top.
    -- NOTE: use `to_jsonb(r)` not `row_to_jsonb(r)` — Postgres only ships
    -- `row_to_json` (returns json) and `to_jsonb` (returns jsonb). There is
    -- no `row_to_jsonb`.
    SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC), '[]'::jsonb)
      INTO v_rows
      FROM (
        SELECT
            o.id                          AS org_id,
            o.name                        AS org_name,
            o.home_user_email             AS contact_email,
            o.stripe_status               AS stripe_status,
            o.stripe_current_period_end   AS stripe_current_period_end,
            o.created_at                  AS created_at,
            coalesce((
                SELECT count(*) FROM public.endpoints e
                 WHERE e.organization_id = o.id
                   AND e.deleted_at IS NULL
                   AND e.is_active = true
            ), 0)                         AS endpoint_count,
            (
                SELECT max(e.last_seen_at) FROM public.endpoints e
                 WHERE e.organization_id = o.id
                   AND e.deleted_at IS NULL
            )                             AS last_seen_at
          FROM public.organizations o
         WHERE o.organization_type = 'home_user'
      ) r;

    RETURN jsonb_build_object(
        'generated_at', to_jsonb(now()),
        'totals',       v_totals,
        'rows',         v_rows
    );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_admin_home_users_overview() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_admin_home_users_overview() TO authenticated, service_role;

COMMENT ON FUNCTION public.get_admin_home_users_overview() IS
'Super-admin-gated overview for /admin/home-users: returns { generated_at, totals: {...}, rows: [...] }. Schema must match HomeUsersOverview in src/hooks/useAdminHomeUsers.ts.';
