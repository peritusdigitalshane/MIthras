-- Helper RPCs the platform health scanner depends on.
--
-- These wrap queries against tables the service role doesn't have direct
-- supabase-js access to (cron schema, pg_class, aggregates across multiple
-- public tables).
--
-- All run SECURITY DEFINER as the postgres role and check super-admin OR
-- service-role caller. Service-role calls are needed for the cron schedule.

BEGIN;

-- 1. get_failed_cron_runs(lookback_minutes) — pg_cron job_run_details aggregator.
--    Returns one row per jobname that has had at least one failed run in the
--    window, with the count + most-recent failure details.
CREATE OR REPLACE FUNCTION public.get_failed_cron_runs(lookback_minutes int DEFAULT 60)
RETURNS TABLE (
    jobname        text,
    runs           bigint,
    status         text,
    return_message text,
    last_run       timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, cron, pg_temp
AS $$
    SELECT
        j.jobname,
        COUNT(*)                                                                        AS runs,
        (ARRAY_AGG(d.status ORDER BY d.end_time DESC NULLS LAST))[1]                    AS status,
        (ARRAY_AGG(COALESCE(d.return_message, '') ORDER BY d.end_time DESC NULLS LAST))[1] AS return_message,
        MAX(d.end_time)                                                                 AS last_run
    FROM cron.job_run_details d
    JOIN cron.job j ON j.jobid = d.jobid
    WHERE d.end_time > now() - make_interval(mins => lookback_minutes)
      AND d.status = 'failed'
    GROUP BY j.jobname;
$$;

REVOKE ALL ON FUNCTION public.get_failed_cron_runs(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_failed_cron_runs(int) TO authenticated, service_role;

-- 2. get_rls_disabled_tables() — list any public.* table that has RLS off.
--    Useful for catching tables we forgot to lock down.
CREATE OR REPLACE FUNCTION public.get_rls_disabled_tables()
RETURNS TABLE (tablename text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
    SELECT c.relname::text
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'              -- ordinary tables only
      AND c.relrowsecurity = false
      -- skip partition children (they inherit RLS from the parent)
      AND NOT EXISTS (
          SELECT 1 FROM pg_inherits i
          WHERE i.inhrelid = c.oid
      )
      -- skip our own scanner tables (RLS is intentionally on, but if a
      -- migration breaks them the scanner will be the one reporting itself)
      AND c.relname NOT LIKE '%_partition_%'
    ORDER BY c.relname;
$$;

REVOKE ALL ON FUNCTION public.get_rls_disabled_tables() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_rls_disabled_tables() TO authenticated, service_role;

-- 3. get_silent_endpoints(hours_threshold) — endpoints that had at least one
--    heartbeat in the last 7 days but none in the last N hours. Filter to
--    is_active=true endpoints in active orgs only.
CREATE OR REPLACE FUNCTION public.get_silent_endpoints(hours_threshold int DEFAULT 24)
RETURNS TABLE (
    endpoint_id      uuid,
    hostname         text,
    organization_id  uuid,
    organization_name text,
    last_heartbeat   timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    WITH last_hb AS (
        SELECT
            e.id              AS endpoint_id,
            e.hostname        AS hostname,
            e.organization_id AS organization_id,
            o.name            AS organization_name,
            MAX(s.collected_at) AS last_heartbeat
        FROM endpoints e
        JOIN organizations o ON o.id = e.organization_id
        LEFT JOIN endpoint_status s ON s.endpoint_id = e.id
        WHERE e.is_active = true
        GROUP BY e.id, e.hostname, e.organization_id, o.name
    )
    SELECT *
    FROM last_hb
    WHERE last_heartbeat IS NOT NULL
      AND last_heartbeat < now() - make_interval(hours => hours_threshold)
      AND last_heartbeat > now() - interval '7 days';
$$;

REVOKE ALL ON FUNCTION public.get_silent_endpoints(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_silent_endpoints(int) TO authenticated, service_role;

-- 4. get_ai_budget_status() — month-to-date AI spend vs. configured cap,
--    per org with a budget set.
CREATE OR REPLACE FUNCTION public.get_ai_budget_status()
RETURNS TABLE (
    organization_id uuid,
    org_name        text,
    budget_usd      numeric,
    spent_usd       numeric,
    pct_used        numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT
        b.organization_id,
        o.name AS org_name,
        (b.month_budget_cents::numeric / 100.0)                                 AS budget_usd,
        COALESCE(SUM(c.cost_cents)::numeric / 100.0, 0)                         AS spent_usd,
        CASE
            WHEN b.month_budget_cents > 0
                THEN (COALESCE(SUM(c.cost_cents)::numeric, 0) / b.month_budget_cents::numeric)
            ELSE 0
        END                                                                     AS pct_used
    FROM ai_cost_budgets b
    JOIN organizations o ON o.id = b.organization_id
    LEFT JOIN ai_llm_calls c
        ON c.organization_id = b.organization_id
       AND c.created_at >= date_trunc('month', now())
       AND c.status      = 'success'
    WHERE b.organization_id IS NOT NULL
      AND b.current_month   = to_char(now(), 'YYYY-MM')
    GROUP BY b.organization_id, o.name, b.month_budget_cents;
$$;

REVOKE ALL ON FUNCTION public.get_ai_budget_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ai_budget_status() TO authenticated, service_role;

COMMIT;
