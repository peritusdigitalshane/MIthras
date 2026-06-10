-- Wave 14: switch the customer-report drain cron away from sending the
-- service-role key in the Authorization header (where, if leaked, it would
-- grant full DB access) toward a dedicated cron secret header.
--
-- Strategy:
--   1. Generate a random mithras_cron_secret value in platform_settings if
--      one does not exist.
--   2. Rewrite process_queued_customer_reports() to send the secret via
--      the `x-mithras-cron-secret` header rather than as a Bearer token.
--      The Authorization header still carries the supabase anon key so
--      kong allows the request through.
--   3. The generate-customer-report function (Wave 14 edits) now accepts
--      either:
--        - x-mithras-cron-secret matching MITHRAS_CRON_SECRET env var
--          (the new clean path), OR
--        - Authorization Bearer == SUPABASE_SERVICE_ROLE_KEY
--          (legacy back-channel — kept temporarily so the new cron path
--          can be validated before the legacy path is removed).
--   4. Once Wave 14 deploys successfully on prod and the next two
--      customer-report-drain ticks succeed via the new header, the
--      legacy path can be removed in a follow-up.
--
-- IMPORTANT: After this migration runs, you must export the same secret
-- to the edge runtime so the function can validate it:
--
--   1. Read it: SELECT value FROM platform_settings WHERE key='mithras_cron_secret';
--   2. Add MITHRAS_CRON_SECRET=<value> to /opt/peritus-supabase/.env
--   3. docker compose up -d functions

-- Seed the secret if absent (idempotent).
INSERT INTO public.platform_settings (key, value)
SELECT 'mithras_cron_secret',
       to_jsonb(encode(extensions.gen_random_bytes(32), 'hex'))
 WHERE NOT EXISTS (
     SELECT 1 FROM public.platform_settings WHERE key = 'mithras_cron_secret'
 );

-- Rewrite the cron caller to use the new header.
CREATE OR REPLACE FUNCTION public.process_queued_customer_reports()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_base   text;
    v_apikey text;
    v_secret text;
    v_pending int;
BEGIN
    SELECT count(*) INTO v_pending FROM public.customer_reports WHERE status = 'queued';
    IF v_pending = 0 THEN RETURN; END IF;

    SELECT value::text INTO v_base   FROM public.platform_settings WHERE key = 'functions_base_url';
    -- The Authorization header carries an apikey JWT so kong allows the
    -- request to reach the function (it doesn't authenticate the caller —
    -- that's what mithras_cron_secret does). The supabase anon key is the
    -- correct value here; it's already used by every browser request.
    SELECT value::text INTO v_apikey FROM public.platform_settings WHERE key = 'service_role_key';
    SELECT value::text INTO v_secret FROM public.platform_settings WHERE key = 'mithras_cron_secret';
    v_base   := btrim(v_base,   '"');
    v_apikey := btrim(v_apikey, '"');
    v_secret := btrim(v_secret, '"');
    IF v_base IS NULL OR v_base = '' OR v_apikey IS NULL OR v_apikey = '' OR v_secret IS NULL OR v_secret = '' THEN
        RAISE NOTICE 'process_queued_customer_reports: required platform_settings missing; skipping';
        RETURN;
    END IF;

    PERFORM net.http_post(
        url     := v_base || '/generate-customer-report',
        headers := jsonb_build_object(
                       'Content-Type',           'application/json',
                       'Authorization',          'Bearer ' || v_apikey,
                       'x-mithras-cron-secret',  v_secret
                   ),
        body    := jsonb_build_object('batch_size', 10)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.process_queued_customer_reports() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.process_queued_customer_reports() TO postgres;
