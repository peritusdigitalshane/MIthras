-- 20260605040000_health_rpcs.sql
--
-- Lightweight RPCs the super-admin Health Dashboard calls via the
-- health-check edge function. Each is SECURITY DEFINER + locked to the
-- service_role so only the edge function (using SUPABASE_SERVICE_ROLE_KEY)
-- can invoke them — never end-user JWTs.

CREATE OR REPLACE FUNCTION public.get_db_version_for_health()
RETURNS TABLE (version text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
    SELECT version();
$$;

REVOKE ALL ON FUNCTION public.get_db_version_for_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_db_version_for_health() TO service_role;

CREATE OR REPLACE FUNCTION public.get_pg_cron_health()
RETURNS TABLE (
    enabled              boolean,
    jobs_total           bigint,
    jobs_active          bigint,
    last_run_age_minutes integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, cron, pg_catalog
AS $$
DECLARE
    has_pg_cron boolean;
BEGIN
    SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') INTO has_pg_cron;
    IF NOT has_pg_cron THEN
        RETURN QUERY SELECT false, 0::bigint, 0::bigint, NULL::integer;
        RETURN;
    END IF;
    RETURN QUERY
    SELECT
        true,
        (SELECT count(*) FROM cron.job),
        (SELECT count(*) FROM cron.job WHERE active),
        (SELECT EXTRACT(EPOCH FROM (now() - MAX(start_time)))::int / 60 FROM cron.job_run_details);
END;
$$;

REVOKE ALL ON FUNCTION public.get_pg_cron_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pg_cron_health() TO service_role;

COMMENT ON FUNCTION public.get_db_version_for_health() IS
'Returns Postgres version(). Used by the health-check edge function as a '
'cheap proof-of-life query.';

COMMENT ON FUNCTION public.get_pg_cron_health() IS
'Exposes a summary of pg_cron state (extension presence, job counts, '
'most-recent run age) to the health-check edge function. Returns '
'enabled=false instead of erroring when pg_cron is not installed.';
