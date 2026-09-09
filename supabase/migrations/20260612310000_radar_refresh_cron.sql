-- Schedule radar-refresh to run every hour at :17 (offset from the existing
-- :00 / :15 / :30 / :45 family of crons so we never share an edge-runtime
-- spike with platform-health-scan, the cve-auto-scan rollup, or the customer
-- report drain). The function self-handles cron-secret auth so we use the
-- standard CRON_SECRET header.

CREATE OR REPLACE FUNCTION public.trigger_radar_refresh()
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
        RAISE NOTICE 'trigger_radar_refresh: functions_base_url missing; skipping';
        RETURN;
    END IF;

    PERFORM net.http_post(
        url     := v_base || '/radar-refresh',
        headers := jsonb_build_object(
                       'Content-Type',  'application/json',
                       'x-cron-secret', coalesce(v_secret, '')
                   ),
        body    := '{}'::jsonb
    );
END;
$$;

REVOKE ALL  ON FUNCTION public.trigger_radar_refresh() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.trigger_radar_refresh() TO postgres;

DO $$ BEGIN
    PERFORM cron.unschedule('mithras-radar-refresh');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
    'mithras-radar-refresh',
    '17 * * * *',
    $$SELECT public.trigger_radar_refresh();$$
);
