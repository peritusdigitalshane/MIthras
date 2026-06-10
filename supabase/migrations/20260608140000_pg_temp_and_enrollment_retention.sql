-- Wave 11 fixes:
--
--   1. get_latest_endpoint_status_ids() is SECURITY DEFINER but lacks
--      pg_temp in its search_path. Every other SECURITY DEFINER function
--      in this codebase uses `public, pg_temp` to defeat temp-object
--      hijack. Bring this one in line.
--
--   2. Add a daily retention cron that purges expired-and-unused
--      enrollment_tokens. Used tokens (use_count > 0) are kept as the
--      audit trail for who enrolled what. Tokens whose expires_at has
--      passed with NO uses are dead — they only accumulate as noise and
--      potential confusion (an admin sees 30 stale tokens in the list
--      and can't tell which were ever used).

-- 1. pg_temp on get_latest_endpoint_status_ids -----------------------------

CREATE OR REPLACE FUNCTION public.get_latest_endpoint_status_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT DISTINCT ON (endpoint_id) id
    FROM public.endpoint_status
    ORDER BY endpoint_id, collected_at DESC;
$$;

-- 2. Enrollment token retention --------------------------------------------

-- A SECURITY DEFINER cleanup helper so the cron job (which runs as the
-- postgres role, not service_role) can call it cleanly.
CREATE OR REPLACE FUNCTION public.purge_expired_enrollment_tokens()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_count integer;
BEGIN
    DELETE FROM public.enrollment_tokens
     WHERE expires_at < now() - interval '7 days'
       AND use_count = 0
       AND used_at IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_enrollment_tokens() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_expired_enrollment_tokens() TO service_role;

-- Daily cleanup at 04:15. cron.schedule is not idempotent — guard with
-- unschedule first so re-runs on a fresh replica don't trip duplicates.
DO $$
BEGIN
    PERFORM cron.unschedule('mithras-enrollment-token-cleanup');
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

SELECT cron.schedule(
    'mithras-enrollment-token-cleanup',
    '15 4 * * *',
    $cron$
        SELECT public.purge_expired_enrollment_tokens();
    $cron$
);
