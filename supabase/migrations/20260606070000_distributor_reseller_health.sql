-- 20260606070000_distributor_reseller_health.sql
--
-- Surface "which of my resellers needs my attention?" to distributors.
--
-- Buckets resellers into:
--   - stalled       — created > 30 days ago AND 0 customers
--   - overdrawn     — credit_balance < 0
--   - low_runway    — runway < 1 month
--   - dormant       — no credit_transactions in last 60 days (no buys, no consume)
--   - healthy       — none of the above
--
-- A reseller can be in multiple buckets; we report them all as boolean flags.
-- Sarah (the distributor manager) wants to see all of these in one screen so
-- she can pick up the phone before a reseller churns.

CREATE OR REPLACE FUNCTION public.get_distributor_reseller_health(_distributor_org_id uuid)
RETURNS TABLE (
    reseller_id        uuid,
    reseller_name      text,
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
    -- Distributor admins see their own resellers; super-admins see any.
    IF NOT (public.is_super_admin(auth.uid())
            OR public.is_admin_of_org(auth.uid(), _distributor_org_id)) THEN
        RAISE EXCEPTION 'caller_not_distributor_admin';
    END IF;

    RETURN QUERY
    WITH reseller_rows AS (
        SELECT r.id, r.name, r.created_at, r.credit_balance
          FROM public.organizations r
         WHERE r.parent_partner_id = _distributor_org_id
           AND r.organization_type = 'partner'
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
        r.id                         AS reseller_id,
        r.name                       AS reseller_name,
        r.created_at,
        r.credit_balance,
        c.customer_count,
        e.active_endpoints,
        t.last_transaction,
        CASE WHEN e.active_endpoints > 0
             THEN (r.credit_balance::numeric / e.active_endpoints::numeric)
             ELSE NULL END           AS runway_months,
        -- Bucket flags
        (c.customer_count = 0 AND r.created_at < (now() - interval '30 days'))                           AS is_stalled,
        (r.credit_balance < 0)                                                                            AS is_overdrawn,
        (e.active_endpoints > 0 AND (r.credit_balance::numeric / e.active_endpoints::numeric) < 1)        AS is_low_runway,
        (t.last_transaction IS NULL OR t.last_transaction < (now() - interval '60 days'))                 AS is_dormant,
        (
            -- Healthy = none of the warning conditions
            NOT (c.customer_count = 0 AND r.created_at < (now() - interval '30 days'))
            AND NOT (r.credit_balance < 0)
            AND NOT (e.active_endpoints > 0 AND (r.credit_balance::numeric / e.active_endpoints::numeric) < 1)
            AND NOT (t.last_transaction IS NULL OR t.last_transaction < (now() - interval '60 days'))
        )                            AS is_healthy,
        -- Attention score: higher = needs you sooner. Used by the UI to sort.
        (
            (CASE WHEN r.credit_balance < 0                                                              THEN 4 ELSE 0 END)
          + (CASE WHEN e.active_endpoints > 0
                       AND (r.credit_balance::numeric / e.active_endpoints::numeric) < 1                 THEN 3 ELSE 0 END)
          + (CASE WHEN c.customer_count = 0 AND r.created_at < (now() - interval '30 days')              THEN 2 ELSE 0 END)
          + (CASE WHEN t.last_transaction IS NULL OR t.last_transaction < (now() - interval '60 days')   THEN 1 ELSE 0 END)
        )::int                       AS attention_score
    FROM reseller_rows r
    LEFT JOIN customer_counts c ON c.reseller_id = r.id
    LEFT JOIN endpoint_counts e ON e.reseller_id = r.id
    LEFT JOIN last_txns t       ON t.reseller_id = r.id
    ORDER BY attention_score DESC, r.name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_distributor_reseller_health(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_distributor_reseller_health(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_distributor_reseller_health(uuid) IS
'Per-reseller health rollup for the distributor command center. Returns balance, runway, customer/endpoint counts, last txn, and four warning bucket flags (stalled/overdrawn/low_runway/dormant). attention_score lets the UI sort by who-needs-action-first.';
