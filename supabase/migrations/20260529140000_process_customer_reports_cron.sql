-- 20260529140000_process_customer_reports_cron.sql
--
-- B6 fix: the customer-report enqueue cron jobs added in 20260529100200
-- insert rows into customer_reports with status='queued' but nothing in the
-- database calls the generate-customer-report edge function to process them.
-- Customers see a permanently empty report history.
--
-- This migration adds a 10-minute drain job that pings the edge function via
-- net.http_post (pg_net), which then pulls up to batch_size queued rows and
-- generates the HTML report into the customer-reports storage bucket.
--
-- The HTTP endpoint and service-role key are read from app_settings rather
-- than hard-coded so the same migration runs on cloud + replica + prod-vultr
-- without divergence. Operators are expected to set these once per env:
--
--   ALTER DATABASE postgres SET app.functions_base_url = 'https://api.mithras.com.au/functions/v1';
--   ALTER DATABASE postgres SET app.service_role_key = '<service-role-jwt>';
--
-- The job is no-op if either setting is missing (so a fresh dev environment
-- doesn't fire half-configured HTTP calls).

CREATE OR REPLACE FUNCTION public.process_queued_customer_reports()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_base text;
    v_key  text;
    v_pending int;
BEGIN
    -- Skip if nothing is queued.
    SELECT count(*) INTO v_pending FROM public.customer_reports WHERE status = 'queued';
    IF v_pending = 0 THEN RETURN; END IF;

    -- Pull base URL and service role key from platform_settings (same store
    -- as openai_api_key). Operators seed these once per env:
    --   INSERT INTO platform_settings (key, value) VALUES
    --     ('functions_base_url', 'https://api.mithras.com.au/functions/v1'),
    --     ('service_role_key',   '<jwt>')
    --   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
    SELECT value::text INTO v_base FROM public.platform_settings WHERE key = 'functions_base_url';
    SELECT value::text INTO v_key  FROM public.platform_settings WHERE key = 'service_role_key';
    -- Values stored as JSON strings may carry surrounding quotes; strip them.
    v_base := btrim(v_base, '"');
    v_key  := btrim(v_key,  '"');
    IF v_base IS NULL OR v_base = '' OR v_key IS NULL OR v_key = '' THEN
        RAISE NOTICE 'process_queued_customer_reports: functions_base_url or service_role_key missing from platform_settings; skipping';
        RETURN;
    END IF;

    PERFORM net.http_post(
        url     := v_base || '/generate-customer-report',
        headers := jsonb_build_object(
                       'Content-Type',  'application/json',
                       'Authorization', 'Bearer ' || v_key
                   ),
        body    := jsonb_build_object('batch_size', 10)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.process_queued_customer_reports() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.process_queued_customer_reports() TO postgres;

-- Schedule: every 10 minutes. Reports do not need to be sub-minute; this rate
-- keeps the queue drained even after Monday morning bursts of weekly reports.
DO $$ BEGIN
    PERFORM cron.unschedule('customer-report-drain');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
    'customer-report-drain',
    '*/10 * * * *',
    $$SELECT public.process_queued_customer_reports();$$
);
