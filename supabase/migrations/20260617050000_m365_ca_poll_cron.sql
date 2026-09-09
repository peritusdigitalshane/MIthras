-- Schedule m365-ca-poll daily. Conditional Access policies don't change
-- minute-to-minute; a daily sweep is plenty for surfacing drift and
-- generating gap-analysis findings. Operators can hit "Refresh now" on
-- /m365/conditional-access for an on-demand pull.

CREATE OR REPLACE FUNCTION public.trigger_m365_ca_poll()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_base   text;
    v_secret text;
BEGIN
    SELECT btrim(value::text, '"') INTO v_base
      FROM public.platform_settings WHERE key = 'functions_base_url';
    SELECT btrim(value::text, '"') INTO v_secret
      FROM public.platform_settings WHERE key = 'mithras_cron_secret';

    IF v_base IS NULL OR v_base = '' THEN
        RAISE NOTICE 'trigger_m365_ca_poll: functions_base_url missing; skipping';
        RETURN;
    END IF;

    PERFORM net.http_post(
        url     := v_base || '/m365-ca-poll',
        headers := jsonb_build_object(
                       'Content-Type',  'application/json',
                       'x-cron-secret', coalesce(v_secret, '')
                   ),
        body    := '{}'::jsonb
    );
END;
$$;

REVOKE ALL     ON FUNCTION public.trigger_m365_ca_poll() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.trigger_m365_ca_poll() TO postgres;

DO $$ BEGIN
    PERFORM cron.unschedule('mithras-m365-ca-poll');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- 03:17 UTC — offset from the 02:23 ai-digest and the :17-past-hour
-- radar refresh so we don't dogpile the edge-runtime.
SELECT cron.schedule(
    'mithras-m365-ca-poll',
    '17 3 * * *',
    $$SELECT public.trigger_m365_ca_poll();$$
);
