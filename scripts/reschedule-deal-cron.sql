-- Reschedule the deal-notifications cron to use the kong hostname (which
-- correctly proxies /functions/v1 to the edge-functions container).

SELECT cron.unschedule('mithras-deal-notifications-daily');

SELECT cron.schedule(
    'mithras-deal-notifications-daily',
    '0 23 * * *',
    $$
    SELECT net.http_post(
        url := 'http://supabase-kong:8000/functions/v1/send-deal-notifications',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (SELECT value FROM private.cron_settings WHERE key = 'service_role_key'),
            'apikey'       , (SELECT value FROM private.cron_settings WHERE key = 'service_role_key')
        ),
        body := jsonb_build_object('mode', 'all')
    );
    $$
);

SELECT net.http_post(
    url := 'http://supabase-kong:8000/functions/v1/send-deal-notifications',
    headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT value FROM private.cron_settings WHERE key = 'service_role_key'),
        'apikey'       , (SELECT value FROM private.cron_settings WHERE key = 'service_role_key')
    ),
    body := jsonb_build_object('mode', 'all')
);
SELECT pg_sleep(3);
SELECT status_code, substring(content::text, 1, 200) AS body
  FROM net._http_response ORDER BY id DESC LIMIT 1;
