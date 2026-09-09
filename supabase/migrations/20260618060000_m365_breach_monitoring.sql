-- 20260618060000_m365_breach_monitoring.sql
--
-- Dark web breach monitoring via Have I Been Pwned.
--
-- Two flows:
--   1. Per-domain subscription using customer-provided HIBP API key
--      (customer subscribes to HIBP, verifies domain, gets API key, pastes
--      it into Mithras). Powers per-user breach detection across the tenant.
--   2. Pwned Passwords check via k-anonymity (no auth required, free).
--      Helper for operator-assisted password reset flow.
--
-- Cost to Mithras: $0. Cost to customer: $0 if manual, $3.95/mo if they want
-- API key for automated polling.

-- ===========================================================================
-- 1. Per-domain subscription
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.m365_breach_monitoring (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    m365_tenant_id              UUID NOT NULL REFERENCES public.m365_tenants(id) ON DELETE CASCADE,
    domain                      TEXT NOT NULL,

    -- HIBP API key — sensitive. RLS exposes everything on this table
    -- EXCEPT this column to org members. Service role bypasses RLS.
    hibp_api_key                TEXT,

    verified_at                 TIMESTAMPTZ,
    verified_by                 UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    last_polled_at              TIMESTAMPTZ,
    last_poll_status            TEXT,           -- 'ok' | 'rate_limited' | 'invalid_key' | 'unverified_domain' | 'http_xxx'
    last_poll_error             TEXT,
    last_poll_findings_count    INT DEFAULT 0,

    is_enabled                  BOOLEAN NOT NULL DEFAULT TRUE,
    notes                       TEXT,

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (m365_tenant_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_m365_breach_monitoring_org
    ON public.m365_breach_monitoring (organization_id, is_enabled);

COMMENT ON TABLE public.m365_breach_monitoring IS
'Per-domain HIBP Domain Search subscription. Polled daily by m365-breach-poll. Customer registers + verifies domain at haveibeenpwned.com, pastes API key here.';

COMMENT ON COLUMN public.m365_breach_monitoring.hibp_api_key IS
'HIBP API key. Sensitive. Only service-role + super-admin can read this column (enforced by the view m365_breach_monitoring_safe used by the frontend).';

-- View that hides the API key from non-service-role callers
CREATE OR REPLACE VIEW public.m365_breach_monitoring_safe AS
SELECT
    id, organization_id, m365_tenant_id, domain,
    (hibp_api_key IS NOT NULL) AS has_api_key,
    verified_at, verified_by,
    last_polled_at, last_poll_status, last_poll_error, last_poll_findings_count,
    is_enabled, notes,
    created_at, updated_at
FROM public.m365_breach_monitoring;

GRANT SELECT ON public.m365_breach_monitoring_safe TO authenticated;

ALTER TABLE public.m365_breach_monitoring ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS m365_breach_monitoring_select ON public.m365_breach_monitoring;
CREATE POLICY m365_breach_monitoring_select ON public.m365_breach_monitoring FOR SELECT
    USING (
        public.is_super_admin(auth.uid())
        OR public.is_member_of_org(auth.uid(), organization_id)
        OR public.is_partner_admin_of_org(auth.uid(), organization_id)
    );

-- ===========================================================================
-- 2. Breach findings — per (org, user, breach)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.m365_breach_findings (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    m365_tenant_id              UUID NOT NULL REFERENCES public.m365_tenants(id) ON DELETE CASCADE,

    user_upn                    TEXT NOT NULL,
    -- HIBP breach identifier (e.g. "Adobe", "LinkedIn", "Optus")
    breach_name                 TEXT NOT NULL,

    -- Cached from /api/v3/breach/{name}
    breach_title                TEXT,
    breach_date                 DATE,
    pwn_count                   BIGINT,
    breach_domain               TEXT,
    description                 TEXT,
    data_classes                TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    is_verified                 BOOLEAN,
    is_sensitive                BOOLEAN,
    is_fabricated               BOOLEAN,
    is_retired                  BOOLEAN,
    logo_path                   TEXT,

    -- Mithras lifecycle
    first_seen_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_at             TIMESTAMPTZ,
    acknowledged_by             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    acknowledge_note            TEXT,

    UNIQUE (organization_id, user_upn, breach_name)
);

CREATE INDEX IF NOT EXISTS idx_m365_breach_findings_org_user
    ON public.m365_breach_findings (organization_id, user_upn, first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_m365_breach_findings_recent
    ON public.m365_breach_findings (organization_id, first_seen_at DESC)
    WHERE acknowledged_at IS NULL;

COMMENT ON TABLE public.m365_breach_findings IS
'Per-user breach exposure. first_seen_at = when Mithras first detected this exposure (NOT when the breach occurred). Compare with breach_date for "your data was in the wild for X days before we found it".';

ALTER TABLE public.m365_breach_findings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS m365_breach_findings_select ON public.m365_breach_findings;
CREATE POLICY m365_breach_findings_select ON public.m365_breach_findings FOR SELECT
    USING (
        public.is_super_admin(auth.uid())
        OR public.is_member_of_org(auth.uid(), organization_id)
        OR public.is_partner_admin_of_org(auth.uid(), organization_id)
    );

DROP POLICY IF EXISTS m365_breach_findings_update ON public.m365_breach_findings;
CREATE POLICY m365_breach_findings_update ON public.m365_breach_findings FOR UPDATE
    USING (
        public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), organization_id)
    );

-- ===========================================================================
-- 3. Overview RPC
-- ===========================================================================
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
            WHERE organization_id = p_org_id AND last_poll_status = 'ok'),
        (SELECT count(DISTINCT user_upn)::int FROM m365_breach_findings
            WHERE organization_id = p_org_id),
        (SELECT count(*)::int FROM m365_breach_findings WHERE organization_id = p_org_id),
        (SELECT count(*)::int FROM m365_breach_findings
            WHERE organization_id = p_org_id AND acknowledged_at IS NULL),
        (SELECT count(*)::int FROM m365_breach_findings
            WHERE organization_id = p_org_id AND first_seen_at >= now() - interval '24 hours'),
        (SELECT count(*)::int FROM m365_breach_findings
            WHERE organization_id = p_org_id AND first_seen_at >= now() - interval '30 days'),
        (SELECT max(last_polled_at) FROM m365_breach_monitoring WHERE organization_id = p_org_id)
$$;

GRANT EXECUTE ON FUNCTION public.get_m365_breach_overview(UUID) TO authenticated;

-- ===========================================================================
-- 4. Cron
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.trigger_m365_breach_poll()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_base text; v_secret text;
BEGIN
    SELECT btrim(value::text, '"') INTO v_base FROM public.platform_settings WHERE key = 'functions_base_url';
    SELECT btrim(value::text, '"') INTO v_secret FROM public.platform_settings WHERE key = 'mithras_cron_secret';
    IF v_base IS NULL OR v_base = '' THEN RAISE NOTICE 'trigger_m365_breach_poll: skipping'; RETURN; END IF;
    PERFORM net.http_post(
        url := v_base || '/m365-breach-poll',
        headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', coalesce(v_secret,'')),
        body := '{}'::jsonb
    );
END; $$;

REVOKE ALL ON FUNCTION public.trigger_m365_breach_poll() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_m365_breach_poll() TO postgres;

DO $$ BEGIN PERFORM cron.unschedule('mithras-m365-breach-poll');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Daily at 03:53 UTC — off-peak. Slotted between CA poll (03:17) and oauth (04:13).
SELECT cron.schedule(
    'mithras-m365-breach-poll',
    '53 3 * * *',
    $$SELECT public.trigger_m365_breach_poll();$$
);

-- ===========================================================================
-- 5. Acknowledge finding helper
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.acknowledge_breach_finding(p_finding_id UUID, p_note TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_org_id UUID;
BEGIN
    SELECT organization_id INTO v_org_id FROM m365_breach_findings WHERE id = p_finding_id;
    IF v_org_id IS NULL THEN RETURN FALSE; END IF;
    IF NOT (public.is_super_admin(auth.uid()) OR public.is_admin_of_org(auth.uid(), v_org_id)) THEN
        RAISE EXCEPTION 'forbidden';
    END IF;
    UPDATE m365_breach_findings SET
        acknowledged_at = now(),
        acknowledged_by = auth.uid(),
        acknowledge_note = p_note
    WHERE id = p_finding_id AND acknowledged_at IS NULL;
    RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.acknowledge_breach_finding(UUID, TEXT) TO authenticated;
