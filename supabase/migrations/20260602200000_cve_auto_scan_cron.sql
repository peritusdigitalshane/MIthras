-- PoC review rec #10: cve-auto-scan currently only runs when an operator
-- opens /vulnerabilities and clicks Scan. The audit found 3/7 endpoints with
-- software inventory had ever been scanned, and many CVE findings were stale.
-- Schedule a nightly per-org sweep so the platform actually behaves like a
-- continuous scanner.
--
-- Pattern mirrors m365-poll-tenants:
--   * URL + secret in platform_settings (gitignored at the secret level)
--   * pg_cron job uses net.http_post via the docker-internal edge URL

-- 1. Settings rows (idempotent; values can be edited freely).
INSERT INTO public.platform_settings (key, value, description)
VALUES (
    'cve_auto_scan_url',
    'http://supabase-edge-functions:9000/cve-auto-scan',
    'Internal edge URL for the nightly cve-auto-scan cron. Reachable only inside the docker network.'
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO public.platform_settings (key, value, description)
VALUES (
    'cve_auto_scan_secret',
    -- Random 32-byte hex generated at install-time. Operators rotate this with
    -- a plain UPDATE platform_settings SET value = '<new>' WHERE key = '...'.
    encode(gen_random_bytes(32), 'hex'),
    'Shared secret for the cve-auto-scan cron job. Sent as x-mithras-cron-secret. Rotate as needed.'
)
ON CONFLICT (key) DO NOTHING;

-- 2. Nightly cron at 03:15 UTC. Fans out one POST per org that has any active
--    endpoints with software inventory -- skips empty orgs to avoid wasted
--    OpenAI calls. net.http_post is fire-and-forget; the function returns
--    quickly (cache hits in the common case).
SELECT cron.schedule(
    'cve-auto-scan-nightly',
    '15 3 * * *',
    $cron$
    SELECT net.http_post(
        url     := (SELECT value FROM public.platform_settings WHERE key = 'cve_auto_scan_url'),
        headers := jsonb_build_object(
                       'content-type',           'application/json',
                       'x-mithras-cron-secret',  (SELECT value FROM public.platform_settings WHERE key = 'cve_auto_scan_secret')
                   ),
        body    := jsonb_build_object('organization_id', o.id, 'batch_size', 60)
    )
    FROM public.organizations o
    WHERE EXISTS (
        SELECT 1 FROM public.endpoint_software_inventory esi
         WHERE esi.organization_id = o.id
    );
    $cron$
);
