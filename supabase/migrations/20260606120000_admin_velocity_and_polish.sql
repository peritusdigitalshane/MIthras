-- 20260606120000_admin_velocity_and_polish.sql
--
-- Channel-velocity RPC + per-disty endpoint health rollup for super-admin
-- dashboards, plus a small helper that flags orgs whose subscription will
-- auto-expire from invoice ageing.

-- 1. Channel velocity — last 7/30 days rollups -------------------------
CREATE OR REPLACE FUNCTION public.get_admin_channel_velocity()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    out jsonb;
BEGIN
    IF NOT public.is_super_admin(auth.uid()) THEN
        RAISE EXCEPTION 'super_admin_required';
    END IF;

    SELECT jsonb_build_object(
        'last_7_days', jsonb_build_object(
            'new_customers',
                (SELECT count(*) FROM public.organizations
                  WHERE organization_type IN ('customer', 'home_user')
                    AND created_at > now() - interval '7 days'),
            'new_endpoints',
                (SELECT count(*) FROM public.endpoints
                  WHERE created_at > now() - interval '7 days'
                    AND deleted_at IS NULL),
            'deals_registered',
                (SELECT count(*) FROM public.deal_registrations
                  WHERE created_at > now() - interval '7 days'),
            'deals_won',
                (SELECT count(*) FROM public.deal_registrations
                  WHERE won_at IS NOT NULL
                    AND won_at > now() - interval '7 days'),
            'credits_issued',
                (SELECT COALESCE(SUM(quantity), 0)::int FROM public.credit_transactions
                  WHERE reason = 'mithras_issue'
                    AND created_at > now() - interval '7 days'),
            'credits_consumed',
                (SELECT COALESCE(SUM(quantity), 0)::int FROM public.credit_transactions
                  WHERE reason IN ('enrolment_consume', 'monthly_consume')
                    AND created_at > now() - interval '7 days')
        ),
        'last_30_days', jsonb_build_object(
            'new_customers',
                (SELECT count(*) FROM public.organizations
                  WHERE organization_type IN ('customer', 'home_user')
                    AND created_at > now() - interval '30 days'),
            'new_endpoints',
                (SELECT count(*) FROM public.endpoints
                  WHERE created_at > now() - interval '30 days'
                    AND deleted_at IS NULL),
            'deals_registered',
                (SELECT count(*) FROM public.deal_registrations
                  WHERE created_at > now() - interval '30 days'),
            'deals_won',
                (SELECT count(*) FROM public.deal_registrations
                  WHERE won_at IS NOT NULL
                    AND won_at > now() - interval '30 days'),
            'credits_issued',
                (SELECT COALESCE(SUM(quantity), 0)::int FROM public.credit_transactions
                  WHERE reason = 'mithras_issue'
                    AND created_at > now() - interval '30 days'),
            'credits_consumed',
                (SELECT COALESCE(SUM(quantity), 0)::int FROM public.credit_transactions
                  WHERE reason IN ('enrolment_consume', 'monthly_consume')
                    AND created_at > now() - interval '30 days')
        ),
        'generated_at', now()
    ) INTO out;

    RETURN out;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_channel_velocity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_channel_velocity() TO authenticated, service_role;

COMMENT ON FUNCTION public.get_admin_channel_velocity() IS
'Super-admin only. Returns rolling 7-day and 30-day counts of new customers, new endpoints, deals registered/won, credits issued/consumed. Powers the channel velocity card on /admin.';

-- 2. Per-disty endpoint health -------------------------------------------
-- Same shape as the channel-breakdown table on /admin but adds endpoint
-- health: how many are online (heartbeat in last 24h), how many have open
-- threats. Helps super-admin see at a glance "Disty A: 500 endpoints, 12
-- offline, 5 with open threats" without joining 4 tables by hand.
CREATE OR REPLACE FUNCTION public.get_admin_endpoint_health_by_disty()
RETURNS TABLE (
    distributor_id        uuid,
    distributor_name      text,
    reseller_count        bigint,
    customer_count        bigint,
    total_endpoints       bigint,
    online_24h            bigint,
    open_threats          bigint,
    endpoints_with_threat bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.is_super_admin(auth.uid()) THEN
        RAISE EXCEPTION 'super_admin_required';
    END IF;

    RETURN QUERY
    WITH distys AS (
        SELECT id, name FROM public.organizations WHERE organization_type = 'distributor'
    ),
    resellers AS (
        SELECT r.id AS reseller_id, r.parent_partner_id AS dist_id
          FROM public.organizations r
         WHERE r.organization_type = 'partner' AND r.parent_partner_id IS NOT NULL
    ),
    customers AS (
        SELECT c.id AS customer_id, rs.dist_id
          FROM public.organizations c
          JOIN resellers rs ON rs.reseller_id = c.parent_partner_id
         WHERE c.organization_type = 'customer'
    ),
    endpoints_x AS (
        SELECT e.id AS endpoint_id, e.last_seen_at, c.dist_id
          FROM public.endpoints e
          JOIN customers c ON c.customer_id = e.organization_id
         WHERE e.deleted_at IS NULL
           AND e.is_active IS DISTINCT FROM false
    ),
    threats AS (
        SELECT t.endpoint_id, e.dist_id
          FROM public.endpoint_threats t
          JOIN endpoints_x e ON e.endpoint_id = t.endpoint_id
         WHERE COALESCE(t.status, '') NOT IN ('resolved', 'cleaned', 'remediated')
           AND t.manual_resolution_active IS DISTINCT FROM true
    )
    SELECT
        d.id    AS distributor_id,
        d.name  AS distributor_name,
        (SELECT count(*) FROM resellers WHERE dist_id = d.id)                     AS reseller_count,
        (SELECT count(*) FROM customers WHERE dist_id = d.id)                     AS customer_count,
        (SELECT count(*) FROM endpoints_x WHERE dist_id = d.id)                   AS total_endpoints,
        (SELECT count(*) FROM endpoints_x WHERE dist_id = d.id
            AND last_seen_at IS NOT NULL AND last_seen_at > now() - interval '24 hours') AS online_24h,
        (SELECT count(*) FROM threats WHERE dist_id = d.id)                       AS open_threats,
        (SELECT count(DISTINCT endpoint_id) FROM threats WHERE dist_id = d.id)    AS endpoints_with_threat
      FROM distys d
     ORDER BY total_endpoints DESC, d.name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_endpoint_health_by_disty() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_endpoint_health_by_disty() TO authenticated, service_role;

COMMENT ON FUNCTION public.get_admin_endpoint_health_by_disty() IS
'Super-admin only. Per-distributor endpoint health rollup: total, online in last 24h, total open threats, endpoints with at least one open threat.';
