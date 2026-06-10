-- 20260606010000_admin_channel_overview.sql
--
-- Super-admin "command centre" RPCs.
--
-- Adds:
--   1. organizations.subscription_expires_at — optional manual override.
--      NULL means the org's expiry is derived automatically from invoice
--      ageing (see at-risk RPC below). A literal date wins over the
--      automatic logic, used for special-deal customers.
--   2. get_admin_channel_overview() — single call returning everything
--      Shane sees on /admin: totals, per-distributor channel breakdown,
--      at-risk orgs, recent activity, pending enrolment URLs.
--
-- Security: SECURITY DEFINER. Caller MUST be super-admin or the RPC
-- raises. Returns a single JSON blob so the frontend makes ONE round trip.

ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS subscription_expires_at timestamptz;

COMMENT ON COLUMN public.organizations.subscription_expires_at IS
'Optional manual subscription end date. NULL = derive from invoice ageing. Set explicitly for special-deal customers (e.g. annual prepay, free indefinite, custom term).';

CREATE OR REPLACE FUNCTION public.get_admin_channel_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    out                jsonb;
    totals             jsonb;
    channel_rows       jsonb;
    at_risk_rows       jsonb;
    pending_invites    jsonb;
    recent_activity    jsonb;
    now_ts             timestamptz := now();
    overdue_threshold  timestamptz := now() - interval '30 days';
    expiring_threshold timestamptz := now() + interval '30 days';
BEGIN
    -- Enforce caller identity.
    IF NOT public.is_super_admin(auth.uid()) THEN
        RAISE EXCEPTION 'super_admin_required';
    END IF;

    -- 1. TOTALS — top-of-page KPIs.
    WITH ep_active AS (
        SELECT count(*) AS n FROM public.endpoints
         WHERE deleted_at IS NULL AND is_active IS DISTINCT FROM false
    ),
    ep_online AS (
        SELECT count(*) AS n FROM public.endpoints
         WHERE deleted_at IS NULL AND is_active IS DISTINCT FROM false
           AND last_seen_at > (now_ts - interval '10 minutes')
    ),
    -- MRR estimate: sum of (endpoint count × effective customer rate) across
    -- all customer orgs. Effective rate = override → tier default → 0.
    mrr_est AS (
        SELECT COALESCE(SUM(
            ep_count::bigint
            * COALESCE(c.wholesale_price_cents, pd.wholesale_price_cents, 0)::bigint
        ), 0) AS cents
        FROM public.organizations c
        LEFT JOIN public.platform_pricing_defaults pd ON pd.tier = 'customer'
        LEFT JOIN (
            SELECT organization_id, count(*) AS ep_count
              FROM public.endpoints
             WHERE deleted_at IS NULL AND is_active IS DISTINCT FROM false
             GROUP BY organization_id
        ) e ON e.organization_id = c.id
        WHERE c.organization_type = 'customer'
    )
    SELECT jsonb_build_object(
        'distributors',     (SELECT count(*) FROM public.organizations WHERE organization_type = 'distributor'),
        'resellers',        (SELECT count(*) FROM public.organizations WHERE organization_type = 'partner'),
        'customers',        (SELECT count(*) FROM public.organizations WHERE organization_type = 'customer'),
        'endpoints_active', (SELECT n FROM ep_active),
        'endpoints_online', (SELECT n FROM ep_online),
        'estimated_mrr_cents', (SELECT cents FROM mrr_est),
        'currency_code',    COALESCE((SELECT currency_code FROM public.platform_pricing_defaults WHERE tier='customer'), 'AUD')
    ) INTO totals;

    -- 2. CHANNEL BREAKDOWN — per-distributor view, plus a synthetic "direct"
    --    row representing resellers + customers Peritus signed up itself
    --    (not through any distributor).
    WITH per_dist AS (
        SELECT
            d.id   AS distributor_id,
            d.name AS distributor_name,
            d.is_active,
            d.created_at,
            COUNT(DISTINCT r.id) FILTER (WHERE r.organization_type='partner')   AS reseller_count,
            COUNT(DISTINCT c.id) FILTER (WHERE c.organization_type='customer')  AS customer_count,
            COUNT(DISTINCT e.id) FILTER (WHERE e.deleted_at IS NULL
                                          AND e.is_active IS DISTINCT FROM false) AS endpoint_count,
            COALESCE(SUM(
                CASE WHEN e.deleted_at IS NULL AND e.is_active IS DISTINCT FROM false
                     THEN COALESCE(d.wholesale_price_cents,
                                   (SELECT wholesale_price_cents FROM public.platform_pricing_defaults WHERE tier='distributor'),
                                   0)
                     ELSE 0 END), 0) AS distributor_mrr_to_peritus_cents
        FROM public.organizations d
        LEFT JOIN public.organizations r
               ON r.parent_partner_id = d.id AND r.organization_type = 'partner'
        LEFT JOIN public.organizations c
               ON c.parent_partner_id = r.id AND c.organization_type = 'customer'
        LEFT JOIN public.endpoints e ON e.organization_id = c.id
        WHERE d.organization_type = 'distributor'
        GROUP BY d.id, d.name, d.is_active, d.created_at
    ),
    direct AS (
        SELECT
            NULL::uuid AS distributor_id,
            '(Direct — no distributor)'::text AS distributor_name,
            true AS is_active,
            NULL::timestamptz AS created_at,
            COUNT(DISTINCT r.id) FILTER (WHERE r.organization_type='partner')  AS reseller_count,
            COUNT(DISTINCT c.id) FILTER (WHERE c.organization_type='customer') AS customer_count,
            COUNT(DISTINCT e.id) FILTER (WHERE e.deleted_at IS NULL
                                          AND e.is_active IS DISTINCT FROM false) AS endpoint_count,
            COALESCE(SUM(
                CASE WHEN e.deleted_at IS NULL AND e.is_active IS DISTINCT FROM false
                     THEN COALESCE((SELECT wholesale_price_cents FROM public.platform_pricing_defaults WHERE tier='partner'), 0)
                     ELSE 0 END), 0) AS distributor_mrr_to_peritus_cents
        FROM public.organizations r
        LEFT JOIN public.organizations c
               ON c.parent_partner_id = r.id AND c.organization_type = 'customer'
        LEFT JOIN public.endpoints e ON e.organization_id = c.id
        WHERE r.organization_type = 'partner'
          AND r.parent_partner_id IS NULL
    )
    SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.distributor_name)
      INTO channel_rows
      FROM (
          SELECT * FROM per_dist
          UNION ALL
          SELECT * FROM direct
      ) t;

    -- 3. AT-RISK — orgs with overdue invoices, expiring/expired subscriptions,
    --    or explicit suspension. The frontend displays each with the right
    --    severity colour.
    SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.severity_rank DESC, t.org_name)
      INTO at_risk_rows
      FROM (
          -- Explicit suspended
          SELECT o.id AS org_id, o.name AS org_name, o.organization_type AS org_type,
                 'suspended'::text AS reason,
                 ('Suspended manually')::text AS detail,
                 3 AS severity_rank, NULL::numeric AS days_overdue
            FROM public.organizations o
           WHERE o.is_active = false
             AND o.organization_type IN ('partner','customer','distributor')

          UNION ALL

          -- Subscription expired (manual override)
          SELECT o.id, o.name, o.organization_type,
                 'expired',
                 ('Subscription expired ' || to_char(o.subscription_expires_at, 'YYYY-MM-DD')),
                 3,
                 EXTRACT(EPOCH FROM (now_ts - o.subscription_expires_at))/86400
            FROM public.organizations o
           WHERE o.subscription_expires_at IS NOT NULL
             AND o.subscription_expires_at < now_ts
             AND o.organization_type IN ('partner','customer','distributor')

          UNION ALL

          -- Subscription expiring soon (manual override, within 30 days)
          SELECT o.id, o.name, o.organization_type,
                 'expiring',
                 ('Expires in ' || GREATEST(0, EXTRACT(DAYS FROM (o.subscription_expires_at - now_ts))::int) || ' days'),
                 2,
                 EXTRACT(EPOCH FROM (now_ts - o.subscription_expires_at))/86400
            FROM public.organizations o
           WHERE o.subscription_expires_at IS NOT NULL
             AND o.subscription_expires_at BETWEEN now_ts AND expiring_threshold
             AND o.organization_type IN ('partner','customer','distributor')

          UNION ALL

          -- Overdue invoices (>30 days past due, still 'sent' or 'overdue').
          -- One row per distinct org, with the worst overdue figure.
          SELECT bt.id, bt.name, bt.organization_type,
                 'invoice_overdue',
                 ('$' || ROUND((SUM(i.total_cents)::numeric / 100), 2)::text ||
                  ' across ' || COUNT(*)::text || ' invoice(s), oldest ' ||
                  GREATEST(0, EXTRACT(DAYS FROM (now_ts - MIN(i.due_date)))::int) || ' days overdue'),
                 CASE WHEN MAX(GREATEST(0, EXTRACT(DAYS FROM (now_ts - i.due_date)))) > 60 THEN 3 ELSE 2 END,
                 MAX(GREATEST(0, EXTRACT(DAYS FROM (now_ts - i.due_date))::numeric))
            FROM public.invoices i
            JOIN public.organizations bt ON bt.id = i.bill_to_org_id
           WHERE i.status IN ('sent','overdue')
             AND i.due_date < CURRENT_DATE
           GROUP BY bt.id, bt.name, bt.organization_type
      ) t
     LIMIT 100;

    -- 4. PENDING INVITES — enrolment codes that have been issued but never
    --    redeemed. Tells Shane which distys/resellers haven't onboarded yet.
    SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC)
      INTO pending_invites
      FROM (
          SELECT ec.id, ec.code, ec.role, ec.expires_at, ec.created_at,
                 o.id AS org_id, o.name AS org_name, o.organization_type AS org_type
            FROM public.enrollment_codes ec
            JOIN public.organizations o ON o.id = ec.organization_id
           WHERE ec.is_active = true
             AND ec.use_count = 0
             AND (ec.expires_at IS NULL OR ec.expires_at > now_ts)
             AND o.organization_type IN ('distributor','partner','customer')
           ORDER BY ec.created_at DESC
           LIMIT 50
      ) t;

    -- 5. RECENT ACTIVITY — orgs created in the last 30 days.
    SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC)
      INTO recent_activity
      FROM (
          SELECT id AS org_id, name AS org_name, organization_type AS org_type, created_at
            FROM public.organizations
           WHERE created_at > (now_ts - interval '30 days')
             AND organization_type IN ('distributor','partner','customer')
           ORDER BY created_at DESC
           LIMIT 50
      ) t;

    out := jsonb_build_object(
        'generated_at',     now_ts,
        'totals',           totals,
        'channel',          COALESCE(channel_rows,    '[]'::jsonb),
        'at_risk',          COALESCE(at_risk_rows,    '[]'::jsonb),
        'pending_invites',  COALESCE(pending_invites, '[]'::jsonb),
        'recent_activity',  COALESCE(recent_activity, '[]'::jsonb)
    );

    RETURN out;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_channel_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_channel_overview() TO authenticated, service_role;

COMMENT ON FUNCTION public.get_admin_channel_overview() IS
'Super-admin command-centre data: totals, per-distributor channel breakdown, at-risk orgs (overdue/expiring/suspended), pending enrolment URLs, recent activity. SECURITY DEFINER + caller must be super-admin. Single JSON blob to keep frontend round-trip count to one.';
