-- =============================================================================
-- customer-report retry-send cron
--
-- generate-customer-report calls send-customer-report once via maybeSendReport
-- after the PDF is built. If that call fails (network blip, SMTP transient,
-- edge container restart mid-request, anything that prevents the send fn from
-- writing back), the row stays at status='ready' with sent_at IS NULL — and
-- the existing customer-report-drain cron only picks up status='queued', so
-- nothing ever fires the send again. The customer never gets the report.
--
-- This migration:
--   1. Adds a send_attempts counter to customer_reports so operators can see
--      which rows have been retried and how many times.
--   2. Adds retry_unsent_customer_reports() which posts up to 5 stale rows
--      back to send-customer-report.
--   3. Schedules it every 10 minutes, offset 5 min from the drain cron so the
--      two don't both hammer the edge functions in the same minute.
--
-- Eligibility: status='ready', sent_at IS NULL, pdf_storage_path NOT NULL
-- (a row with no PDF can't be sent — generate must rebuild), and the row's
-- updated_at is older than 15 min (initial send had time to complete; also
-- spaces retries because each send-customer-report failure bumps updated_at
-- via last_send_error). Hard ceiling of 5 retries; abandon rows older than
-- 7 days because by then the report is stale enough that operators should
-- intervene manually.
-- =============================================================================

ALTER TABLE public.customer_reports
    ADD COLUMN IF NOT EXISTS send_attempts integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.retry_unsent_customer_reports()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_base   text;
    v_key    text;
    v_row    record;
    v_picked int := 0;
BEGIN
    SELECT value::text INTO v_base FROM public.platform_settings WHERE key = 'functions_base_url';
    SELECT value::text INTO v_key  FROM public.platform_settings WHERE key = 'service_role_key';
    v_base := btrim(v_base, '"');
    v_key  := btrim(v_key,  '"');
    IF v_base IS NULL OR v_base = '' OR v_key IS NULL OR v_key = '' THEN
        RAISE NOTICE 'retry_unsent_customer_reports: functions_base_url or service_role_key missing; skipping';
        RETURN;
    END IF;

    FOR v_row IN
        SELECT id
          FROM public.customer_reports
         WHERE status = 'ready'
           AND sent_at IS NULL
           AND pdf_storage_path IS NOT NULL
           AND send_attempts < 5
           AND updated_at  < now() - interval '15 minutes'
           AND created_at  > now() - interval '7 days'
         ORDER BY updated_at ASC
         LIMIT 5
    LOOP
        UPDATE public.customer_reports
           SET send_attempts = send_attempts + 1
         WHERE id = v_row.id;

        PERFORM net.http_post(
            url     := v_base || '/send-customer-report',
            headers := jsonb_build_object(
                           'Content-Type',  'application/json',
                           'Authorization', 'Bearer ' || v_key
                       ),
            body    := jsonb_build_object('report_id', v_row.id)
        );
        v_picked := v_picked + 1;
    END LOOP;

    IF v_picked > 0 THEN
        RAISE NOTICE 'retry_unsent_customer_reports: re-fired send for % rows', v_picked;
    END IF;
END;
$$;

REVOKE ALL  ON FUNCTION public.retry_unsent_customer_reports() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.retry_unsent_customer_reports() TO postgres;

-- Every 10 minutes at :05/:15/:25/... so we never run the same minute as the
-- :00/:10/:20 drain cron (which can otherwise queue a fresh row that hasn't
-- been retried yet).
DO $$ BEGIN
    PERFORM cron.unschedule('customer-report-retry-send');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
    'customer-report-retry-send',
    '5,15,25,35,45,55 * * * *',
    $$SELECT public.retry_unsent_customer_reports();$$
);
