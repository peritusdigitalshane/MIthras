-- 20260618030000_m365_mfa_coverage.sql
--
-- MFA Coverage tracking — mirrors /reports/authenticationMethods/userRegistrationDetails
-- from Microsoft Graph. Powers the M365 Shield "MFA Coverage" tab. First
-- thing every prospect asks: "how many of my users actually have MFA?"
-- Today Mithras can't answer it in one click — after this, it can.
--
-- Scope already covered: Reports.Read.All is in READ_ONLY_SCOPES.
--
-- Phase 1: read-only inventory + dashboard.
-- Phase 2 (deferred): auto-enrollment flow (revoke until enrolled) — covered
-- by the existing missing_mfa Identity Defence template.

CREATE TABLE IF NOT EXISTS public.m365_mfa_coverage (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    m365_tenant_id              UUID NOT NULL REFERENCES public.m365_tenants(id) ON DELETE CASCADE,
    user_id                     TEXT NOT NULL,    -- Graph user objectId
    user_upn                    TEXT NOT NULL,
    display_name                TEXT,

    -- Capability + registration state from Graph
    is_mfa_capable              BOOLEAN NOT NULL DEFAULT FALSE,
    is_mfa_registered           BOOLEAN NOT NULL DEFAULT FALSE,
    is_passwordless_capable     BOOLEAN NOT NULL DEFAULT FALSE,
    is_sspr_capable             BOOLEAN NOT NULL DEFAULT FALSE,
    is_sspr_registered          BOOLEAN NOT NULL DEFAULT FALSE,
    is_sspr_enabled             BOOLEAN NOT NULL DEFAULT FALSE,

    -- Registered methods (array of: microsoftAuthenticator, sms, voice,
    -- fido2, windowsHelloForBusiness, softwareOath, etc.)
    methods_registered          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    -- Convenience: derived "primary method" for the dashboard list
    primary_method              TEXT,

    -- Role bucketing — populated from the directoryRoles fetch so the
    -- dashboard can break MFA coverage down by privilege class.
    is_admin                    BOOLEAN NOT NULL DEFAULT FALSE,
    admin_roles                 TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

    last_signin_at              TIMESTAMPTZ,
    last_evaluated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (m365_tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_m365_mfa_coverage_org
    ON public.m365_mfa_coverage (organization_id, is_mfa_registered);
CREATE INDEX IF NOT EXISTS idx_m365_mfa_coverage_admin
    ON public.m365_mfa_coverage (organization_id, is_admin, is_mfa_registered)
    WHERE is_admin = TRUE;

COMMENT ON TABLE public.m365_mfa_coverage IS
'Per-user MFA registration state mirrored from /reports/authenticationMethods/userRegistrationDetails. Polled daily by m365-mfa-poll. Powers the M365 Shield MFA Coverage dashboard.';

-- ---------------------------------------------------------------------------
-- RLS — read for org members + partner admins + super-admins
-- ---------------------------------------------------------------------------
ALTER TABLE public.m365_mfa_coverage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS m365_mfa_coverage_select ON public.m365_mfa_coverage;
CREATE POLICY m365_mfa_coverage_select ON public.m365_mfa_coverage FOR SELECT
    USING (
        public.is_super_admin(auth.uid())
        OR public.is_member_of_org(auth.uid(), organization_id)
        OR public.is_partner_admin_of_org(auth.uid(), organization_id)
    );

-- ---------------------------------------------------------------------------
-- Overview RPC — single call powers the dashboard headline KPIs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_m365_mfa_coverage_overview(p_org_id UUID)
RETURNS TABLE (
    total_users                INT,
    users_mfa_registered       INT,
    users_mfa_capable_unreg    INT,
    users_no_mfa_capability    INT,

    admins_total               INT,
    admins_mfa_registered      INT,
    admins_at_risk             INT,         -- admins WITHOUT MFA (the scary one)

    pct_users_with_mfa         NUMERIC,
    pct_admins_with_mfa        NUMERIC,

    last_evaluated_at          TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    WITH t AS (
        SELECT * FROM public.m365_mfa_coverage WHERE organization_id = p_org_id
    )
    SELECT
        (SELECT count(*)::int FROM t),
        (SELECT count(*)::int FROM t WHERE is_mfa_registered = TRUE),
        (SELECT count(*)::int FROM t WHERE is_mfa_capable = TRUE  AND is_mfa_registered = FALSE),
        (SELECT count(*)::int FROM t WHERE is_mfa_capable = FALSE),

        (SELECT count(*)::int FROM t WHERE is_admin = TRUE),
        (SELECT count(*)::int FROM t WHERE is_admin = TRUE AND is_mfa_registered = TRUE),
        (SELECT count(*)::int FROM t WHERE is_admin = TRUE AND is_mfa_registered = FALSE),

        CASE WHEN (SELECT count(*) FROM t) = 0 THEN 0::numeric
             ELSE round(100.0 * (SELECT count(*) FROM t WHERE is_mfa_registered = TRUE) / (SELECT count(*) FROM t), 1)
        END,
        CASE WHEN (SELECT count(*) FROM t WHERE is_admin = TRUE) = 0 THEN 0::numeric
             ELSE round(100.0 * (SELECT count(*) FROM t WHERE is_admin = TRUE AND is_mfa_registered = TRUE) /
                                 (SELECT count(*) FROM t WHERE is_admin = TRUE), 1)
        END,

        (SELECT max(last_evaluated_at) FROM t)
    ;
$$;

GRANT EXECUTE ON FUNCTION public.get_m365_mfa_coverage_overview(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Cron schedule for the poll
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_m365_mfa_poll()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
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
        RAISE NOTICE 'trigger_m365_mfa_poll: functions_base_url missing; skipping';
        RETURN;
    END IF;
    PERFORM net.http_post(
        url     := v_base || '/m365-mfa-poll',
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'x-cron-secret', coalesce(v_secret, '')),
        body    := '{}'::jsonb
    );
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_m365_mfa_poll() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_m365_mfa_poll() TO postgres;

DO $$ BEGIN PERFORM cron.unschedule('mithras-m365-mfa-poll');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Daily at 04:33 UTC — off-peak, well clear of CA poll (03:17) + oauth (04:13)
SELECT cron.schedule(
    'mithras-m365-mfa-poll',
    '33 4 * * *',
    $$SELECT public.trigger_m365_mfa_poll();$$
);
