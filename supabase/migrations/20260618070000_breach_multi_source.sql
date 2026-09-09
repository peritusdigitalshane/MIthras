-- 20260618070000_breach_multi_source.sql
--
-- Multi-source dark-web monitoring. Add Hudson Rock (free, infostealer logs)
-- and GitHub credential-leak search alongside the existing HIBP integration.
-- Both new sources are FREE and use platform-managed API keys, so customers
-- get them at zero cost.
--
-- Schema changes:
--   - m365_breach_findings.source        — which source detected this finding
--   - m365_breach_findings.source_detail — source-specific evidence blob
--   - new unique constraint includes source so a user can appear in the same
--     "breach name" from multiple sources independently
--   - m365_breach_monitoring.hudson_rock_enabled / github_enabled — per-domain toggles
--   - cron schedules for the two new pollers

ALTER TABLE public.m365_breach_findings
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'hibp'
        CHECK (source IN ('hibp','hudson_rock','github_leak'));

ALTER TABLE public.m365_breach_findings
    ADD COLUMN IF NOT EXISTS source_detail JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Replace the existing unique constraint so it includes source.
ALTER TABLE public.m365_breach_findings
    DROP CONSTRAINT IF EXISTS m365_breach_findings_organization_id_user_upn_breach_name_key;

DO $$ BEGIN
    ALTER TABLE public.m365_breach_findings
        ADD CONSTRAINT m365_breach_findings_unique_per_source
        UNIQUE (organization_id, user_upn, breach_name, source);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_m365_breach_findings_source
    ON public.m365_breach_findings (organization_id, source, first_seen_at DESC);

-- Per-domain toggles. Default ON for the two free sources.
ALTER TABLE public.m365_breach_monitoring
    ADD COLUMN IF NOT EXISTS hudson_rock_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS hudson_rock_last_polled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS hudson_rock_last_findings_count INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS github_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS github_last_polled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS github_last_findings_count INT DEFAULT 0;

-- Refresh the safe view to expose the new toggles
DROP VIEW IF EXISTS public.m365_breach_monitoring_safe;
CREATE OR REPLACE VIEW public.m365_breach_monitoring_safe AS
SELECT
    id, organization_id, m365_tenant_id, domain,
    (hibp_api_key IS NOT NULL) AS has_api_key,
    verified_at, verified_by,
    last_polled_at, last_poll_status, last_poll_error, last_poll_findings_count,
    hudson_rock_enabled, hudson_rock_last_polled_at, hudson_rock_last_findings_count,
    github_enabled,      github_last_polled_at,      github_last_findings_count,
    is_enabled, notes,
    created_at, updated_at
FROM public.m365_breach_monitoring;

GRANT SELECT ON public.m365_breach_monitoring_safe TO authenticated;

-- ---------------------------------------------------------------------------
-- Bootstrap: when a customer has at least one connected, shielded M365 tenant
-- with a tenant_domain set, auto-create a m365_breach_monitoring row so the
-- free sources start polling without operator setup. (Idempotent.)
-- ---------------------------------------------------------------------------
INSERT INTO public.m365_breach_monitoring (organization_id, m365_tenant_id, domain, is_enabled)
SELECT
    t.organization_id,
    t.id,
    lower(t.tenant_domain),
    TRUE
FROM public.m365_tenants t
JOIN public.organizations o ON o.id = t.organization_id
WHERE o.m365_shield_enabled = TRUE
  AND t.consent_state = 'active'
  AND t.tenant_domain IS NOT NULL
  AND t.tenant_domain <> ''
ON CONFLICT (m365_tenant_id, domain) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Cron triggers for the two new pollers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_m365_breach_poll_hudson_rock()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_base text; v_secret text;
BEGIN
    SELECT btrim(value::text, '"') INTO v_base FROM public.platform_settings WHERE key = 'functions_base_url';
    SELECT btrim(value::text, '"') INTO v_secret FROM public.platform_settings WHERE key = 'mithras_cron_secret';
    IF v_base IS NULL OR v_base = '' THEN RAISE NOTICE 'trigger_m365_breach_poll_hudson_rock: skipping'; RETURN; END IF;
    PERFORM net.http_post(
        url := v_base || '/m365-breach-poll-hudson-rock',
        headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', coalesce(v_secret,'')),
        body := '{}'::jsonb
    );
END; $$;

REVOKE ALL ON FUNCTION public.trigger_m365_breach_poll_hudson_rock() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_m365_breach_poll_hudson_rock() TO postgres;

CREATE OR REPLACE FUNCTION public.trigger_m365_breach_poll_github()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_base text; v_secret text;
BEGIN
    SELECT btrim(value::text, '"') INTO v_base FROM public.platform_settings WHERE key = 'functions_base_url';
    SELECT btrim(value::text, '"') INTO v_secret FROM public.platform_settings WHERE key = 'mithras_cron_secret';
    IF v_base IS NULL OR v_base = '' THEN RAISE NOTICE 'trigger_m365_breach_poll_github: skipping'; RETURN; END IF;
    PERFORM net.http_post(
        url := v_base || '/m365-breach-poll-github',
        headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', coalesce(v_secret,'')),
        body := '{}'::jsonb
    );
END; $$;

REVOKE ALL ON FUNCTION public.trigger_m365_breach_poll_github() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_m365_breach_poll_github() TO postgres;

DO $$ BEGIN PERFORM cron.unschedule('mithras-m365-breach-poll-hudson-rock');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Hudson Rock — daily 02:43 UTC
SELECT cron.schedule(
    'mithras-m365-breach-poll-hudson-rock',
    '43 2 * * *',
    $$SELECT public.trigger_m365_breach_poll_hudson_rock();$$
);

DO $$ BEGIN PERFORM cron.unschedule('mithras-m365-breach-poll-github');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- GitHub — daily 02:58 UTC
SELECT cron.schedule(
    'mithras-m365-breach-poll-github',
    '58 2 * * *',
    $$SELECT public.trigger_m365_breach_poll_github();$$
);

-- ---------------------------------------------------------------------------
-- Refresh the overview RPC to break out per-source counts
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_m365_breach_overview(p_org_id UUID)
RETURNS TABLE (
    domains_total                INT,
    domains_verified             INT,
    domains_with_api_key         INT,
    domains_polling_ok           INT,
    users_breached               INT,
    findings_total               INT,
    findings_unack               INT,
    findings_new_24h             INT,
    findings_new_30d             INT,
    findings_hibp                INT,
    findings_hudson_rock         INT,
    findings_github              INT,
    last_poll_at                 TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT
        (SELECT count(*)::int FROM m365_breach_monitoring WHERE organization_id = p_org_id),
        (SELECT count(*)::int FROM m365_breach_monitoring
            WHERE organization_id = p_org_id AND verified_at IS NOT NULL),
        (SELECT count(*)::int FROM m365_breach_monitoring
            WHERE organization_id = p_org_id AND hibp_api_key IS NOT NULL),
        (SELECT count(*)::int FROM m365_breach_monitoring
            WHERE organization_id = p_org_id
              AND (last_poll_status = 'ok' OR hudson_rock_last_polled_at IS NOT NULL OR github_last_polled_at IS NOT NULL)),
        (SELECT count(DISTINCT user_upn)::int FROM m365_breach_findings WHERE organization_id = p_org_id),
        (SELECT count(*)::int FROM m365_breach_findings WHERE organization_id = p_org_id),
        (SELECT count(*)::int FROM m365_breach_findings WHERE organization_id = p_org_id AND acknowledged_at IS NULL),
        (SELECT count(*)::int FROM m365_breach_findings WHERE organization_id = p_org_id AND first_seen_at >= now() - interval '24 hours'),
        (SELECT count(*)::int FROM m365_breach_findings WHERE organization_id = p_org_id AND first_seen_at >= now() - interval '30 days'),
        (SELECT count(*)::int FROM m365_breach_findings WHERE organization_id = p_org_id AND source = 'hibp'),
        (SELECT count(*)::int FROM m365_breach_findings WHERE organization_id = p_org_id AND source = 'hudson_rock'),
        (SELECT count(*)::int FROM m365_breach_findings WHERE organization_id = p_org_id AND source = 'github_leak'),
        (SELECT GREATEST(
            (SELECT max(last_polled_at) FROM m365_breach_monitoring WHERE organization_id = p_org_id),
            (SELECT max(hudson_rock_last_polled_at) FROM m365_breach_monitoring WHERE organization_id = p_org_id),
            (SELECT max(github_last_polled_at) FROM m365_breach_monitoring WHERE organization_id = p_org_id)
        ))
$$;

GRANT EXECUTE ON FUNCTION public.get_m365_breach_overview(UUID) TO authenticated;
