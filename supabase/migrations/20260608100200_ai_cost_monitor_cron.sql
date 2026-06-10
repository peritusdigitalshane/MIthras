-- Hourly cron that calls ai-cost-monitor. Mirrors the pattern used by
-- mithras-m365-posture-daily and customer-report-drain — pg_net.http_post
-- against the internal kong host with the service-role bearer fetched from
-- private.cron_settings.

SELECT cron.schedule(
    'mithras-ai-cost-monitor',
    '0 * * * *',
    $$
        SELECT net.http_post(
            url     := 'http://supabase-kong:8000/functions/v1/ai-cost-monitor',
            headers := jsonb_build_object(
                'Content-Type',  'application/json',
                'Authorization', 'Bearer ' || (SELECT value FROM private.cron_settings WHERE key = 'service_role_key'),
                'apikey'       , (SELECT value FROM private.cron_settings WHERE key = 'service_role_key')
            ),
            body    := jsonb_build_object()
        );
    $$
);
