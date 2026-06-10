-- Microsoft 365 ITDR — pg_cron schedule for the periodic Graph poller.
--
-- Requires pg_net + pg_cron. The poller endpoint authenticates the cron
-- caller via the M365_POLL_SECRET header value matched in the edge fn.
--
-- The poller secret AND the function URL are stored in platform_settings so
-- they can be rotated without re-deploying this migration.

INSERT INTO public.platform_settings (key, value, description, is_secret)
VALUES
    ('m365_poller_url',
        'http://supabase-edge-functions:9000/m365-poll-tenants',
        'Internal URL used by pg_cron to invoke the M365 poller.', false),
    ('m365_poller_secret',
        '',
        'Shared secret for pg_cron → m365-poll-tenants. Must match M365_POLL_SECRET env on the functions container.',
        true)
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- Scheduled job
-- =============================================================================
DO $$
DECLARE
    _has_cron BOOLEAN;
    _has_net  BOOLEAN;
BEGIN
    SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') INTO _has_cron;
    SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')  INTO _has_net;

    IF NOT _has_cron OR NOT _has_net THEN
        RAISE NOTICE 'pg_cron or pg_net not available — skipping M365 cron schedule. Install them and re-run this migration.';
        RETURN;
    END IF;

    -- Drop a previous schedule if it exists (idempotent).
    BEGIN
        PERFORM cron.unschedule('m365-poll-tenants');
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    -- Every 5 minutes, on phase :00. Detections run on phase :02 (in the
    -- detections migration) so they see the freshly ingested rows.
    PERFORM cron.schedule(
        'm365-poll-tenants',
        '*/5 * * * *',
        $cron$
            SELECT net.http_post(
                url := (SELECT value FROM public.platform_settings WHERE key = 'm365_poller_url'),
                headers := jsonb_build_object(
                    'content-type', 'application/json',
                    'x-mithras-poll-secret', (SELECT value FROM public.platform_settings WHERE key = 'm365_poller_secret')
                ),
                body := '{}'::jsonb
            );
        $cron$
    );
END $$;
