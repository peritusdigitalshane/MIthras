-- Wave: stop transmitting the service-role key as a bearer token on every
-- alert notification.
--
-- BACKGROUND
-- supabase/functions/notify-alert/index.ts carries a "B4 fix" that accepts a
-- dedicated NOTIFY_ALERT_SECRET in preference to the service-role key, so the
-- key that bypasses every RLS policy on every table is not used as a shared
-- bearer. The function-side half shipped; the deployment half never did.
-- Confirmed on prod 2026-08-12:
--   * NOTIFY_ALERT_SECRET was not declared in the edge runtime at all
--   * queue_alert_notification still read platform_settings.service_role_key
--     and sent it as `Authorization: Bearer <service-role key>`
-- So the mitigation was inert and the key was on the wire for every alert.
--
-- THIS MIGRATION
-- Switches the trigger to send platform_settings.notify_alert_secret, falling
-- back to the service-role key only if the dedicated secret is absent. The
-- fallback keeps notifications working if this runs before the secret is
-- seeded, and the function still accepts both, so there is no gap in either
-- deployment order.
--
-- The secret value itself is generated/seeded out of band (never written into
-- a migration file) and must also exist as NOTIFY_ALERT_SECRET in
-- /opt/peritus-supabase/.env for the edge runtime to validate it.

CREATE OR REPLACE FUNCTION public.queue_alert_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_base   text;
    v_secret text;
    v_key    text;
BEGIN
    SELECT value::text INTO v_base   FROM public.platform_settings WHERE key = 'functions_base_url';
    SELECT value::text INTO v_secret FROM public.platform_settings WHERE key = 'notify_alert_secret';
    SELECT value::text INTO v_key    FROM public.platform_settings WHERE key = 'service_role_key';

    v_base   := btrim(v_base,   '"');
    v_secret := btrim(v_secret, '"');
    v_key    := btrim(v_key,    '"');

    -- Prefer the dedicated, independently rotatable secret. Only fall back to
    -- the service-role key if the secret has not been seeded yet.
    IF v_secret IS NULL OR v_secret = '' THEN
        v_secret := v_key;
    END IF;

    IF v_base IS NULL OR v_base = '' OR v_secret IS NULL OR v_secret = '' THEN
        -- Operator hasn't configured the platform endpoint yet; skip silently.
        RETURN NEW;
    END IF;

    PERFORM net.http_post(
        url     := v_base || '/notify-alert',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_secret
        ),
        body    := jsonb_build_object('alert_id', NEW.id)
    );
    RETURN NEW;
END $function$;
