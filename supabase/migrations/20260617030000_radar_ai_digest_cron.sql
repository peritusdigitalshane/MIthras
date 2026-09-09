-- Schedule radar-ai-digest to run once a day. The digest reads the latest
-- external feed mirrors + fleet tiles and asks an LLM to write a tight
-- three-bullet "what changed this week" summary, stored under tile_key
-- 'ai_weekly_digest'. Daily is the right cadence: feeds refresh hourly
-- under us so a daily digest is fresh enough, and one LLM call per day is
-- negligible cost-wise.
--
-- Runs at 02:23 UTC ≈ 13:23 Sydney — early enough that anyone scanning
-- the /intel page during the AU workday sees the freshest summary.

CREATE OR REPLACE FUNCTION public.trigger_radar_ai_digest()
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
        RAISE NOTICE 'trigger_radar_ai_digest: functions_base_url missing; skipping';
        RETURN;
    END IF;

    PERFORM net.http_post(
        url     := v_base || '/radar-ai-digest',
        headers := jsonb_build_object(
                       'Content-Type',  'application/json',
                       'x-cron-secret', coalesce(v_secret, '')
                   ),
        body    := '{}'::jsonb
    );
END;
$$;

REVOKE ALL     ON FUNCTION public.trigger_radar_ai_digest() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.trigger_radar_ai_digest() TO postgres;

DO $$ BEGIN
    PERFORM cron.unschedule('mithras-radar-ai-digest');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
    'mithras-radar-ai-digest',
    '23 2 * * *',
    $$SELECT public.trigger_radar_ai_digest();$$
);
