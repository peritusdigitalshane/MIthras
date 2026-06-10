-- cve_lookup_cache: memoizes the AI-driven CVE lookup so we don't re-query
-- OpenAI for the same (software_name, software_version) pair on every scan.
-- TTL is enforced at read time (rows older than 7 days are ignored), but rows
-- themselves are kept indefinitely so we have a historical record of what the
-- model returned.

CREATE TABLE IF NOT EXISTS public.cve_lookup_cache (
    software_name    text         NOT NULL,
    software_version text         NOT NULL DEFAULT '',  -- '' = "no version supplied"
    cves             jsonb        NOT NULL DEFAULT '[]'::jsonb,
    model            text,        -- model id used (gpt-4o-mini, etc.)
    checked_at       timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (software_name, software_version)
);

COMMENT ON TABLE  public.cve_lookup_cache IS
'Memoizes AI CVE discovery per (software_name, software_version). 7d TTL applied at read time.';
COMMENT ON COLUMN public.cve_lookup_cache.cves IS
'JSON array of {cve_id, severity, cvss_score, description, remediation, fixed_version}.';

CREATE INDEX IF NOT EXISTS idx_cve_lookup_cache_checked_at
    ON public.cve_lookup_cache (checked_at);

-- Service-role only -- the edge function is the only writer.
ALTER TABLE public.cve_lookup_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cve_lookup_cache FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.cve_lookup_cache TO service_role;
