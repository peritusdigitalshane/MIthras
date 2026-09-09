-- 20260618040000_m365_sharing_and_lifecycle.sql
--
-- Sprint 1 of "what M365 customers need without P1/P2/E5":
--   1. External Sharing Audit  — SharePoint + OneDrive file shares to externals
--   2. Lifecycle Workflows     — Leaver automation (Joiner/Mover deferred)
--   3. Sign-in Geo aggregation  — RPC over existing m365_signin_risk
--
-- Replaces, commercially:
--   - Purview DLP external sharing reports         (~$5/user E5 add-on)
--   - Entra ID Governance lifecycle workflows      (~$14/user)
--   - Identity Protection geo signal               (~$9/user P2)

-- ===========================================================================
-- 1. External Sharing — one row per (drive item × permission)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.m365_shared_items (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    m365_tenant_id              UUID NOT NULL REFERENCES public.m365_tenants(id) ON DELETE CASCADE,

    -- Graph identifiers
    drive_id                    TEXT NOT NULL,
    drive_owner                 TEXT,            -- user UPN or SharePoint site display name
    drive_kind                  TEXT NOT NULL CHECK (drive_kind IN ('onedrive','sharepoint','teams')),
    item_id                     TEXT NOT NULL,
    item_name                   TEXT,
    item_path                   TEXT,
    item_type                   TEXT,            -- file | folder
    item_web_url                TEXT,
    item_size_bytes             BIGINT,
    item_last_modified_at       TIMESTAMPTZ,

    -- Permission record from /drives/{drive}/items/{item}/permissions
    permission_id               TEXT NOT NULL,
    -- 'anonymous' | 'organization' | 'users'
    link_scope                  TEXT,
    -- 'view' | 'edit' | 'embed'
    link_type                   TEXT,
    -- granted-to either a single user or a sharingInvitation
    granted_to_email            TEXT,
    granted_to_display_name     TEXT,
    granted_at                  TIMESTAMPTZ,
    expires_at                  TIMESTAMPTZ,

    -- Computed risk signal
    is_external                 BOOLEAN NOT NULL DEFAULT FALSE,
    is_anonymous_link           BOOLEAN NOT NULL DEFAULT FALSE,
    is_suspicious_domain        BOOLEAN NOT NULL DEFAULT FALSE,
    dormant_days                INT,              -- days since item_last_modified_at
    risk_score                  INT NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
    risk_factors                JSONB NOT NULL DEFAULT '[]'::jsonb,

    first_seen_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    removed_at                  TIMESTAMPTZ,
    removed_by                  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    remove_reason               TEXT,

    UNIQUE (m365_tenant_id, drive_id, item_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_m365_shared_items_org_external
    ON public.m365_shared_items (organization_id, is_external, removed_at);
CREATE INDEX IF NOT EXISTS idx_m365_shared_items_risk
    ON public.m365_shared_items (organization_id, risk_score DESC, removed_at)
    WHERE removed_at IS NULL;

COMMENT ON TABLE public.m365_shared_items IS
'Mirror of file-level external shares across OneDrive + SharePoint. Polled by m365-sharing-poll. Powers the M365 Shield External Sharing tab. Removed_at set when operator unshares via m365-sharing-unshare.';

ALTER TABLE public.m365_shared_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS m365_shared_items_select ON public.m365_shared_items;
CREATE POLICY m365_shared_items_select ON public.m365_shared_items FOR SELECT
    USING (
        public.is_super_admin(auth.uid())
        OR public.is_member_of_org(auth.uid(), organization_id)
        OR public.is_partner_admin_of_org(auth.uid(), organization_id)
    );

-- Overview RPC
CREATE OR REPLACE FUNCTION public.get_m365_sharing_overview(p_org_id UUID)
RETURNS TABLE (
    total_active           INT,
    external_active        INT,
    anonymous_links        INT,
    suspicious_domains     INT,
    dormant_over_90d       INT,
    high_risk              INT,
    last_poll_at           TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    WITH t AS (
        SELECT * FROM public.m365_shared_items
        WHERE organization_id = p_org_id AND removed_at IS NULL
    )
    SELECT
        (SELECT count(*)::int FROM t),
        (SELECT count(*)::int FROM t WHERE is_external),
        (SELECT count(*)::int FROM t WHERE is_anonymous_link),
        (SELECT count(*)::int FROM t WHERE is_suspicious_domain),
        (SELECT count(*)::int FROM t WHERE dormant_days IS NOT NULL AND dormant_days > 90),
        (SELECT count(*)::int FROM t WHERE risk_score >= 60),
        (SELECT max(last_seen_at) FROM public.m365_shared_items WHERE organization_id = p_org_id)
    ;
$$;

GRANT EXECUTE ON FUNCTION public.get_m365_sharing_overview(UUID) TO authenticated;

-- ===========================================================================
-- 2. Lifecycle workflows — leaver automation (joiner/mover Phase 2)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.lifecycle_workflows (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    m365_tenant_id              UUID NOT NULL REFERENCES public.m365_tenants(id) ON DELETE CASCADE,

    -- 'leaver' for Phase 1; 'joiner' | 'mover' Phase 2
    kind                        TEXT NOT NULL CHECK (kind IN ('leaver','joiner','mover')),

    target_user_id              TEXT NOT NULL,
    target_user_upn             TEXT NOT NULL,
    target_user_display         TEXT,

    -- For leaver: manager who receives mailbox forwarding
    manager_upn                 TEXT,
    -- For mover: new department, role, etc.
    move_context                JSONB,

    -- Operator who triggered it + when
    requested_by                UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    requested_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason                      TEXT,

    -- Status machine
    status                      TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','running','completed','partial','failed')),
    started_at                  TIMESTAMPTZ,
    completed_at                TIMESTAMPTZ,

    -- Options chosen for this run (revoke_sessions: true, etc.)
    options                     JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Step results: [{ step: 'revoke_sessions', ok: true, detail: '...' }, ...]
    steps                       JSONB NOT NULL DEFAULT '[]'::jsonb,
    error_summary               TEXT
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_workflows_org_status
    ON public.lifecycle_workflows (organization_id, status, requested_at DESC);

COMMENT ON TABLE public.lifecycle_workflows IS
'Joiner/Mover/Leaver workflow runs. Replaces Entra ID Governance lifecycle workflows for SMBs. Each row = one workflow execution with append-only step ledger.';

ALTER TABLE public.lifecycle_workflows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lifecycle_workflows_select ON public.lifecycle_workflows;
CREATE POLICY lifecycle_workflows_select ON public.lifecycle_workflows FOR SELECT
    USING (
        public.is_super_admin(auth.uid())
        OR public.is_member_of_org(auth.uid(), organization_id)
        OR public.is_partner_admin_of_org(auth.uid(), organization_id)
    );

DROP POLICY IF EXISTS lifecycle_workflows_insert ON public.lifecycle_workflows;
CREATE POLICY lifecycle_workflows_insert ON public.lifecycle_workflows FOR INSERT
    WITH CHECK (
        public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), organization_id)
    );

-- ===========================================================================
-- 3. Sign-in geo — aggregation RPC over existing m365_signin_risk + audit
-- ===========================================================================
-- We already store country in the risk_factors JSONB of m365_signin_risk via
-- the "history_country" kind. Expose a clean aggregation.

CREATE OR REPLACE FUNCTION public.get_m365_signin_geo(p_org_id UUID, p_days INT DEFAULT 7)
RETURNS TABLE (
    country_code               TEXT,
    signin_count               INT,
    unique_users               INT,
    high_risk_count            INT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    WITH expanded AS (
        SELECT
            r.user_id,
            r.risk_level,
            jsonb_array_elements(r.risk_factors) AS f
        FROM public.m365_signin_risk r
        WHERE r.organization_id = p_org_id
          AND r.last_evaluated_at >= now() - (p_days * interval '1 day')
    ),
    countries AS (
        SELECT
            user_id,
            risk_level,
            (f->>'evidence') AS country
        FROM expanded
        WHERE f->>'kind' = 'history_country'
    )
    SELECT
        country,
        count(*)::int AS signin_count,
        count(DISTINCT user_id)::int AS unique_users,
        count(*) FILTER (WHERE risk_level IN ('high','critical'))::int AS high_risk_count
    FROM countries
    WHERE country IS NOT NULL AND country <> ''
    GROUP BY country
    ORDER BY signin_count DESC
$$;

GRANT EXECUTE ON FUNCTION public.get_m365_signin_geo(UUID, INT) TO authenticated;

-- ===========================================================================
-- 4. Cron schedules
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.trigger_m365_sharing_poll()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_base text; v_secret text;
BEGIN
    SELECT btrim(value::text, '"') INTO v_base FROM public.platform_settings WHERE key = 'functions_base_url';
    SELECT btrim(value::text, '"') INTO v_secret FROM public.platform_settings WHERE key = 'mithras_cron_secret';
    IF v_base IS NULL OR v_base = '' THEN RAISE NOTICE 'trigger_m365_sharing_poll: skipping'; RETURN; END IF;
    PERFORM net.http_post(
        url := v_base || '/m365-sharing-poll',
        headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', coalesce(v_secret,'')),
        body := '{}'::jsonb
    );
END; $$;

REVOKE ALL ON FUNCTION public.trigger_m365_sharing_poll() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_m365_sharing_poll() TO postgres;

DO $$ BEGIN PERFORM cron.unschedule('mithras-m365-sharing-poll');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Daily at 02:13 UTC — well off-peak from CA poll (03:17), oauth (04:13), MFA (04:33)
SELECT cron.schedule(
    'mithras-m365-sharing-poll',
    '13 2 * * *',
    $$SELECT public.trigger_m365_sharing_poll();$$
);
