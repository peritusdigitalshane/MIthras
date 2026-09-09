-- Schedule identity-evaluate. Phase A cadence: every 5 minutes. The
-- corresponding edge fn self-mutexes against overlapping runs.
--
-- Tuning the cadence is a platform-settings change: set
-- `identity_evaluate_schedule` to a cron expression and re-run this
-- migration (or call the unschedule/reschedule snippet inline). Marketing
-- copy is qualitative ("near-real-time") so the dial is internal.

CREATE OR REPLACE FUNCTION public.trigger_identity_evaluate()
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
        RAISE NOTICE 'trigger_identity_evaluate: functions_base_url missing; skipping';
        RETURN;
    END IF;

    PERFORM net.http_post(
        url     := v_base || '/identity-evaluate',
        headers := jsonb_build_object(
                       'Content-Type',  'application/json',
                       'x-cron-secret', coalesce(v_secret, '')
                   ),
        body    := '{}'::jsonb
    );
END;
$$;

REVOKE ALL     ON FUNCTION public.trigger_identity_evaluate() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.trigger_identity_evaluate() TO postgres;

DO $$ BEGIN
    PERFORM cron.unschedule('mithras-identity-evaluate');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Every 5 minutes — offset from the :17-past-hour radar refresh and the
-- :00/:30 cadence of email + heartbeat work so edge-runtime spikes don't
-- dogpile.
SELECT cron.schedule(
    'mithras-identity-evaluate',
    '3,8,13,18,23,28,33,38,43,48,53,58 * * * *',
    $$SELECT public.trigger_identity_evaluate();$$
);
