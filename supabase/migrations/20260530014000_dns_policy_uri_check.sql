-- Defense in depth for SSRF: reject obviously-bad upstream_doh_uri values
-- at the DB layer. The resolver also validates at request time and re-checks
-- the destination IP at connect time, so this is belt-and-braces.
--
-- We accept ONLY values that:
--   * are NULL (means: use the platform default), OR
--   * start with https://, AND
--   * don't include a literal localhost / loopback / private / link-local IP
--
-- Hostnames aren't validated at insert time (no DNS lookup from a CHECK
-- constraint); the resolver handles those via DNS-rebinding defense.

ALTER TABLE public.dns_policies
    DROP CONSTRAINT IF EXISTS dns_policies_upstream_doh_uri_check;

ALTER TABLE public.dns_policies
    ADD CONSTRAINT dns_policies_upstream_doh_uri_check
    CHECK (
        upstream_doh_uri IS NULL
        OR (
            upstream_doh_uri ~* '^https://[^/]+/.*'
            AND upstream_doh_uri !~* 'https://(localhost|127\.|10\.|169\.254\.|192\.168\.|0\.0\.0\.0|::1|fc[0-9a-f]{2}:|fe80:)'
            AND upstream_doh_uri !~* 'https://172\.(1[6-9]|2[0-9]|3[01])\.'
            AND upstream_doh_uri !~* 'https://100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.'
        )
    );
