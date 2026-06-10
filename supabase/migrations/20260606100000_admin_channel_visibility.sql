-- 20260606100000_admin_channel_visibility.sql
--
-- Super-admin channel-visibility expansion. Three new pieces:
--   1. get_admin_reseller_health_overview() — every reseller across every
--      distributor, with the same health buckets distys see for their own.
--      Powers /admin/resellers.
--   2. get_admin_partner_deal_performance() — per-partner pipeline rollup:
--      active / won / lost counts + win rate + avg endpoints + revenue
--      potential. Powers a card on /admin/deals.
--   3. get_admin_credit_ledger() — recent platform-wide credit transactions
--      with org names already resolved. Powers a ledger view on
--      /admin/credits without forcing the UI to do N+1 lookups.
--
-- These RPCs all gate on is_super_admin(auth.uid()) — caller must be a
-- super-admin (Peritus operator), not a disty or partner.

-- 1. Cross-disty reseller health -----------------------------------------
CREATE OR REPLACE FUNCTION public.get_admin_reseller_health_overview()
RETURNS TABLE (
    reseller_id        uuid,
    reseller_name      text,
    reseller_slug      text,
    distributor_id     uuid,
    distributor_name   text,
    created_at         timestamptz,
    credit_balance     integer,
    customer_count     bigint,
    active_endpoints   bigint,
    last_transaction   timestamptz,
    runway_months      numeric,
    is_stalled         boolean,
    is_overdrawn       boolean,
    is_low_runway      boolean,
    is_dormant         boolean,
    is_healthy         boolean,
    attention_score    integer
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
    WITH reseller_rows AS (
        SELECT r.id, r.name, r.slug, r.created_at, r.credit_balance,
               r.parent_partner_id AS dist_id
          FROM public.organizations r
         WHERE r.organization_type = 'partner'
    ),
    customer_counts AS (
        SELECT r.id AS reseller_id,
               count(c.id) AS customer_count
          FROM reseller_rows r
          LEFT JOIN public.organizations c
                 ON c.parent_partner_id = r.id
                AND c.organization_type = 'customer'
         GROUP BY r.id
    ),
    endpoint_counts AS (
        SELECT r.id AS reseller_id,
               count(e.id) AS active_endpoints
          FROM reseller_rows r
          LEFT JOIN public.organizations c
                 ON c.parent_partner_id = r.id
                AND c.organization_type = 'customer'
          LEFT JOIN public.endpoints e
                 ON e.organization_id = c.id
                AND e.deleted_at IS NULL
                AND e.is_active IS DISTINCT FROM false
         GROUP BY r.id
    ),
    last_txns AS (
        SELECT r.id AS reseller_id,
               max(t.created_at) AS last_transaction
          FROM reseller_rows r
          LEFT JOIN public.credit_transactions t
                 ON (t.to_org_id = r.id OR t.from_org_id = r.id)
         GROUP BY r.id
    )
    SELECT
        r.id                                 AS reseller_id,
        r.name                               AS reseller_name,
        r.slug                               AS reseller_slug,
        r.dist_id                            AS distributor_id,
        d.name                               AS distributor_name,
        r.created_at,
        r.credit_balance,
        c.customer_count,
        e.active_endpoints,
        t.last_transaction,
        CASE WHEN e.active_endpoints > 0
             THEN (r.credit_balance::numeric / e.active_endpoints::numeric)
             ELSE NULL END                   AS runway_months,
        (c.customer_count = 0 AND r.created_at < (now() - interval '30 days'))                           AS is_stalled,
        (r.credit_balance < 0)                                                                            AS is_overdrawn,
        (e.active_endpoints > 0 AND (r.credit_balance::numeric / e.active_endpoints::numeric) < 1)        AS is_low_runway,
        (t.last_transaction IS NULL OR t.last_transaction < (now() - interval '60 days'))                 AS is_dormant,
        (
            NOT (c.customer_count = 0 AND r.created_at < (now() - interval '30 days'))
            AND NOT (r.credit_balance < 0)
            AND NOT (e.active_endpoints > 0 AND (r.credit_balance::numeric / e.active_endpoints::numeric) < 1)
            AND NOT (t.last_transaction IS NULL OR t.last_transaction < (now() - interval '60 days'))
        )                                    AS is_healthy,
        (
            (CASE WHEN r.credit_balance < 0                                                              THEN 4 ELSE 0 END)
          + (CASE WHEN e.active_endpoints > 0
                       AND (r.credit_balance::numeric / e.active_endpoints::numeric) < 1                 THEN 3 ELSE 0 END)
          + (CASE WHEN c.customer_count = 0 AND r.created_at < (now() - interval '30 days')              THEN 2 ELSE 0 END)
          + (CASE WHEN t.last_transaction IS NULL OR t.last_transaction < (now() - interval '60 days')   THEN 1 ELSE 0 END)
        )::int                               AS attention_score
    FROM reseller_rows r
    LEFT JOIN customer_counts c ON c.reseller_id = r.id
    LEFT JOIN endpoint_counts e ON e.reseller_id = r.id
    LEFT JOIN last_txns       t ON t.reseller_id = r.id
    LEFT JOIN public.organizations d ON d.id = r.dist_id AND d.organization_type = 'distributor'
    ORDER BY attention_score DESC, r.name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_reseller_health_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_reseller_health_overview() TO authenticated, service_role;

COMMENT ON FUNCTION public.get_admin_reseller_health_overview() IS
'Super-admin only. Every reseller across every distributor, with health buckets (stalled/overdrawn/low_runway/dormant) and attention_score. Powers /admin/resellers.';


-- 2. Per-partner deal performance ----------------------------------------
CREATE OR REPLACE FUNCTION public.get_admin_partner_deal_performance()
RETURNS TABLE (
    reseller_id          uuid,
    reseller_name        text,
    distributor_id       uuid,
    distributor_name     text,
    active_count         bigint,
    won_count            bigint,
    lost_count           bigint,
    expired_count        bigint,
    total_completed      bigint,
    win_rate_pct         numeric,
    active_pipeline_eps  bigint,
    won_endpoints        bigint,
    avg_deal_eps         numeric,
    estimated_mrr_cents  bigint,
    last_deal_at         timestamptz
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
    WITH partners AS (
        SELECT p.id, p.name, p.parent_partner_id AS dist_id
          FROM public.organizations p
         WHERE p.organization_type = 'partner'
    ),
    deal_stats AS (
        SELECT
            d.reseller_org_id                                          AS reseller_id,
            count(*) FILTER (WHERE d.status = 'active')                AS active_count,
            count(*) FILTER (WHERE d.status = 'won')                   AS won_count,
            count(*) FILTER (WHERE d.status = 'lost')                  AS lost_count,
            count(*) FILTER (WHERE d.status = 'expired')               AS expired_count,
            COALESCE(SUM(d.estimated_endpoints)
                     FILTER (WHERE d.status = 'active'), 0)::bigint    AS active_pipeline_eps,
            COALESCE(SUM(d.estimated_endpoints)
                     FILTER (WHERE d.status = 'won'), 0)::bigint       AS won_endpoints,
            COALESCE(SUM(d.estimated_endpoints
                         * COALESCE(d.locked_retail_cents, 0))
                     FILTER (WHERE d.status = 'active'), 0)::bigint    AS estimated_mrr_cents,
            AVG(d.estimated_endpoints)::numeric                        AS avg_deal_eps,
            MAX(d.created_at)                                          AS last_deal_at
          FROM public.deal_registrations d
         GROUP BY d.reseller_org_id
    )
    SELECT
        p.id                                       AS reseller_id,
        p.name                                     AS reseller_name,
        p.dist_id                                  AS distributor_id,
        d.name                                     AS distributor_name,
        COALESCE(s.active_count, 0)                AS active_count,
        COALESCE(s.won_count, 0)                   AS won_count,
        COALESCE(s.lost_count, 0)                  AS lost_count,
        COALESCE(s.expired_count, 0)               AS expired_count,
        COALESCE(s.won_count + s.lost_count + s.expired_count, 0)
                                                   AS total_completed,
        CASE
            WHEN COALESCE(s.won_count + s.lost_count + s.expired_count, 0) = 0
                THEN NULL
            ELSE (s.won_count::numeric * 100
                  / NULLIF(s.won_count + s.lost_count + s.expired_count, 0))
        END                                        AS win_rate_pct,
        COALESCE(s.active_pipeline_eps, 0)         AS active_pipeline_eps,
        COALESCE(s.won_endpoints, 0)               AS won_endpoints,
        s.avg_deal_eps,
        COALESCE(s.estimated_mrr_cents, 0)         AS estimated_mrr_cents,
        s.last_deal_at
    FROM partners p
    LEFT JOIN deal_stats s ON s.reseller_id = p.id
    LEFT JOIN public.organizations d ON d.id = p.dist_id AND d.organization_type = 'distributor'
   WHERE COALESCE(s.active_count + s.won_count + s.lost_count + s.expired_count, 0) > 0
    ORDER BY COALESCE(s.estimated_mrr_cents, 0) DESC, COALESCE(s.active_count, 0) DESC, p.name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_partner_deal_performance() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_partner_deal_performance() TO authenticated, service_role;

COMMENT ON FUNCTION public.get_admin_partner_deal_performance() IS
'Super-admin only. Per-partner deal stats: active/won/lost/expired counts, win rate, pipeline endpoints, estimated MRR from locked_retail snapshots. Powers the performance card on /admin/deals.';


-- 3. Platform credit ledger (paginated) ----------------------------------
CREATE OR REPLACE FUNCTION public.get_admin_credit_ledger(
    _limit      integer DEFAULT 100,
    _offset     integer DEFAULT 0,
    _reason     text    DEFAULT NULL,
    _org_id     uuid    DEFAULT NULL
)
RETURNS TABLE (
    id                 uuid,
    created_at         timestamptz,
    reason             text,
    quantity           integer,
    unit_price_cents   integer,
    total_cents        integer,
    from_org_id        uuid,
    from_org_name      text,
    from_org_type      text,
    to_org_id          uuid,
    to_org_name        text,
    to_org_type        text,
    customer_org_id    uuid,
    customer_org_name  text,
    endpoint_id        uuid,
    notes              text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.is_super_admin(auth.uid()) THEN
        RAISE EXCEPTION 'super_admin_required';
    END IF;
    IF _limit IS NULL OR _limit <= 0 OR _limit > 500 THEN _limit := 100; END IF;
    IF _offset IS NULL OR _offset < 0 THEN _offset := 0; END IF;

    RETURN QUERY
    SELECT
        t.id,
        t.created_at,
        t.reason,
        t.quantity,
        t.unit_price_cents,
        (COALESCE(t.unit_price_cents, 0) * t.quantity)::integer AS total_cents,
        t.from_org_id,
        f.name           AS from_org_name,
        f.organization_type::text AS from_org_type,
        t.to_org_id,
        ot.name          AS to_org_name,
        ot.organization_type::text AS to_org_type,
        t.customer_org_id,
        c.name           AS customer_org_name,
        t.endpoint_id,
        t.notes
      FROM public.credit_transactions t
      LEFT JOIN public.organizations f  ON f.id  = t.from_org_id
      LEFT JOIN public.organizations ot ON ot.id = t.to_org_id
      LEFT JOIN public.organizations c  ON c.id  = t.customer_org_id
     WHERE (_reason IS NULL OR t.reason = _reason)
       AND (_org_id IS NULL OR t.from_org_id = _org_id OR t.to_org_id = _org_id)
     ORDER BY t.created_at DESC
     LIMIT _limit
    OFFSET _offset;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_credit_ledger(integer, integer, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_credit_ledger(integer, integer, text, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_admin_credit_ledger(integer, integer, text, uuid) IS
'Super-admin only. Paginated platform-wide credit transaction feed with org names pre-resolved. Supports filtering by reason (issuance/distributor_cut/enrolment_consume/monthly_consume/adjustment) and by from/to org id.';
