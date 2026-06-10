-- Close the remaining RLS / SECURITY DEFINER holes flagged by the
-- 2026-05-29 multi-agent prod-readiness review.
--
-- 1. firewall_audit_logs INSERT must be service_role only (the partition
--    migration earlier today re-introduced an unrestricted policy).
-- 2. activity_logs INSERT must be service_role only — any org member could
--    impersonate any user/action in the audit trail.
-- 3. get_router_uptime_stats needs SET search_path to close a search-path
--    hijack vector.
-- 4. Unschedule the daily-cleanup-old-data pg_cron job that points at the
--    frozen cloud Supabase URL with a hardcoded anon JWT.

-- 1. firewall_audit_logs INSERT
DROP POLICY IF EXISTS "Allow insert firewall audit logs for valid endpoints" ON public.firewall_audit_logs;
CREATE POLICY "Service role can insert firewall audit logs"
ON public.firewall_audit_logs FOR INSERT TO service_role WITH CHECK (true);

-- 2. activity_logs INSERT
DROP POLICY IF EXISTS "Users can insert org activity logs" ON public.activity_logs;
CREATE POLICY "Service role can insert activity logs"
ON public.activity_logs FOR INSERT TO service_role WITH CHECK (true);

-- The log_activity SECURITY DEFINER helper is still the right path for app
-- writes; the SECURITY DEFINER context bypasses RLS so users can keep calling
-- it via supabase.rpc('log_activity', ...). The change above only blocks
-- direct PostgREST inserts that forge user_id.

-- 3. get_router_uptime_stats search_path hardening
DO $migrate$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'get_router_uptime_stats'
  ORDER BY p.oid DESC
  LIMIT 1;

  IF v_def IS NULL THEN
    RAISE NOTICE 'get_router_uptime_stats not present, skipping';
    RETURN;
  END IF;

  -- Inject SET search_path after SECURITY DEFINER if not already present.
  IF v_def NOT ILIKE '%SET search_path%' THEN
    v_def := regexp_replace(
      v_def,
      'SECURITY DEFINER',
      'SECURITY DEFINER' || E'\nSET search_path = public, pg_temp',
      'i'
    );
    EXECUTE v_def;
  ELSE
    RAISE NOTICE 'get_router_uptime_stats already has SET search_path';
  END IF;
END
$migrate$;

-- 4. Unschedule the pg_cron job that targets the frozen cloud Supabase URL.
DO $$
BEGIN
  PERFORM cron.unschedule('daily-cleanup-old-data');
EXCEPTION WHEN OTHERS THEN
  -- job did not exist on this database
  NULL;
END $$;
