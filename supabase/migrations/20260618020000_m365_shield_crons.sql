-- 20260618020000_m365_shield_crons.sql
--
-- pg_cron schedules for M365 Shield Phase 1:
--   - mithras-m365-pim-auto-revoke   every 5 min (4,9,14,...)
--   - mithras-m365-risk-poll         every 15 min (4,19,34,49 past)
--   - mithras-m365-oauth-poll        daily 04:13 UTC
--
-- All three functions self-gate on m365_shield_enabled inside the function
-- body, so even with the cron scheduled they no-op for non-shielded orgs.

-- ---------------------------------------------------------------------------
-- 1. PIM auto-revoke trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_m365_pim_auto_revoke()
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
        RAISE NOTICE 'trigger_m365_pim_auto_revoke: functions_base_url missing; skipping';
        RETURN;
    END IF;

    PERFORM net.http_post(
        url     := v_base || '/m365-pim-auto-revoke',
        headers := jsonb_build_object(
                       'Content-Type',  'application/json',
                       'x-cron-secret', coalesce(v_secret, '')
                   ),
        body    := '{}'::jsonb
    );
END;
$$;

REVOKE ALL     ON FUNCTION public.trigger_m365_pim_auto_revoke() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.trigger_m365_pim_auto_revoke() TO postgres;

-- ---------------------------------------------------------------------------
-- 2. Risk poll trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_m365_risk_poll()
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
        RAISE NOTICE 'trigger_m365_risk_poll: functions_base_url missing; skipping';
        RETURN;
    END IF;

    PERFORM net.http_post(
        url     := v_base || '/m365-risk-poll',
        headers := jsonb_build_object(
                       'Content-Type',  'application/json',
                       'x-cron-secret', coalesce(v_secret, '')
                   ),
        body    := '{}'::jsonb
    );
END;
$$;

REVOKE ALL     ON FUNCTION public.trigger_m365_risk_poll() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.trigger_m365_risk_poll() TO postgres;

-- ---------------------------------------------------------------------------
-- 3. OAuth poll trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_m365_oauth_poll()
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
        RAISE NOTICE 'trigger_m365_oauth_poll: functions_base_url missing; skipping';
        RETURN;
    END IF;

    PERFORM net.http_post(
        url     := v_base || '/m365-oauth-poll',
        headers := jsonb_build_object(
                       'Content-Type',  'application/json',
                       'x-cron-secret', coalesce(v_secret, '')
                   ),
        body    := '{}'::jsonb
    );
END;
$$;

REVOKE ALL     ON FUNCTION public.trigger_m365_oauth_poll() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.trigger_m365_oauth_poll() TO postgres;

-- ---------------------------------------------------------------------------
-- 4. Schedules
-- ---------------------------------------------------------------------------
DO $$ BEGIN PERFORM cron.unschedule('mithras-m365-pim-auto-revoke');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Every 5 minutes — offset from email-sweep (0,2,4,...) + identity-evaluate
-- (3,8,...) so the edge runtime doesn't dogpile.
SELECT cron.schedule(
    'mithras-m365-pim-auto-revoke',
    '4,9,14,19,24,29,34,39,44,49,54,59 * * * *',
    $$SELECT public.trigger_m365_pim_auto_revoke();$$
);

DO $$ BEGIN PERFORM cron.unschedule('mithras-m365-risk-poll');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Every 15 minutes — offset from radar-refresh (:17 past) and CA-poll (daily).
SELECT cron.schedule(
    'mithras-m365-risk-poll',
    '4,19,34,49 * * * *',
    $$SELECT public.trigger_m365_risk_poll();$$
);

DO $$ BEGIN PERFORM cron.unschedule('mithras-m365-oauth-poll');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Daily at 04:13 UTC — off-peak, well clear of the 03:17 CA poll.
SELECT cron.schedule(
    'mithras-m365-oauth-poll',
    '13 4 * * *',
    $$SELECT public.trigger_m365_oauth_poll();$$
);
