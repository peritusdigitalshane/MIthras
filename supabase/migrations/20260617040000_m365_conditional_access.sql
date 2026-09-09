-- 20260617040000_m365_conditional_access.sql
--
-- Conditional Access Phase 1 (read-only).
--
-- Pulls a customer's Conditional Access policies from Microsoft Graph
-- (`/identity/conditionalAccess/policies`, requires `Policy.Read.All` —
-- already in our consented READ_ONLY_SCOPES). Runs the policies through an
-- LLM gap analysis against best-practice patterns (require MFA for admins,
-- block legacy auth, require compliant device for sensitive apps, geo-fence
-- sign-ins, session controls) and writes findings the SOC console renders.
--
-- Why read-only first: a misconfigured CA policy can lock the entire tenant
-- out instantly. `Policy.ReadWrite.ConditionalAccess` is a Phase 2 decision.
-- We surface the gap analysis + deep-link to entra.microsoft.com so the
-- customer's M365 admin makes the change with their own eyes on the
-- "Don't lock yourself out" confirmation dialog.

-- ---------------------------------------------------------------------------
-- 1. Policy mirror — one row per (tenant, Microsoft policyId)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.m365_ca_policies (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    m365_tenant_id       UUID NOT NULL REFERENCES public.m365_tenants(id) ON DELETE CASCADE,
    organization_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    policy_id            TEXT NOT NULL,
    display_name         TEXT NOT NULL,
    -- enabled | disabled | enabledForReportingNotEnforced  (Graph values)
    state                TEXT NOT NULL,
    conditions           JSONB NOT NULL DEFAULT '{}'::jsonb,
    grant_controls       JSONB,
    session_controls     JSONB,
    created_datetime     TIMESTAMPTZ,
    modified_datetime    TIMESTAMPTZ,
    fetched_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Soft-delete flag — Graph returns the full live set every poll, so any
    -- row not seen on the latest poll is marked deleted=true rather than
    -- removed (preserves history + audit trail).
    deleted_at           TIMESTAMPTZ,
    UNIQUE (m365_tenant_id, policy_id)
);

CREATE INDEX IF NOT EXISTS idx_m365_ca_policies_org
    ON public.m365_ca_policies (organization_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_m365_ca_policies_tenant
    ON public.m365_ca_policies (m365_tenant_id, deleted_at);

COMMENT ON TABLE  public.m365_ca_policies IS 'Mirror of Microsoft Graph /identity/conditionalAccess/policies, polled on the M365 sweep cadence. Read-only — Mithras does not edit policies in Phase 1.';
COMMENT ON COLUMN public.m365_ca_policies.state IS 'Graph state value: enabled | disabled | enabledForReportingNotEnforced.';
COMMENT ON COLUMN public.m365_ca_policies.deleted_at IS 'Set when a previously-seen policyId is absent from the latest Graph poll. Row is preserved for audit.';

-- ---------------------------------------------------------------------------
-- 2. AI gap-analysis findings — one row per (tenant, finding kind, run)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.m365_ca_findings (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    m365_tenant_id       UUID NOT NULL REFERENCES public.m365_tenants(id) ON DELETE CASCADE,
    organization_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    -- short stable key for the finding type, e.g. 'no_mfa_for_admins',
    -- 'legacy_auth_not_blocked', 'no_compliant_device_for_admin_portal',
    -- 'no_geo_restriction', 'no_session_limit_for_unmanaged_browsers'.
    finding_key          TEXT NOT NULL,
    severity             TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low','info')),
    title                TEXT NOT NULL,
    body                 TEXT NOT NULL,
    recommended_action   TEXT NOT NULL,
    -- Direct link into the customer's Entra admin centre, scoped to the
    -- right CA blade so the admin doesn't have to navigate.
    entra_deep_link      TEXT NOT NULL,
    -- Subset of policy_ids the finding is associated with — surfaces "this
    -- policy is the one missing the MFA grant control" rather than just a
    -- generic banner.
    related_policy_ids   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    -- AI cost + provenance.
    model                TEXT,
    prompt_tokens        INTEGER,
    completion_tokens    INTEGER,
    cost_microcents      BIGINT NOT NULL DEFAULT 0,
    -- Operator acknowledgement so dismissed findings don't keep nagging.
    acknowledged_at      TIMESTAMPTZ,
    acknowledged_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    acknowledged_note    TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_m365_ca_findings_org
    ON public.m365_ca_findings (organization_id, acknowledged_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_m365_ca_findings_tenant
    ON public.m365_ca_findings (m365_tenant_id, finding_key, created_at DESC);

COMMENT ON TABLE public.m365_ca_findings IS 'AI-driven gap analysis on Conditional Access policies. One row per identified gap per analysis run. Acknowledge to suppress.';

-- ---------------------------------------------------------------------------
-- 3. RLS — same shape as m365_tenants
-- ---------------------------------------------------------------------------
ALTER TABLE public.m365_ca_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.m365_ca_findings ENABLE ROW LEVEL SECURITY;

-- READ: org members + super-admins + partner admins
DROP POLICY IF EXISTS m365_ca_policies_select  ON public.m365_ca_policies;
CREATE POLICY m365_ca_policies_select ON public.m365_ca_policies FOR SELECT
    USING (
        public.is_super_admin(auth.uid())
        OR public.is_member_of_org(auth.uid(), organization_id)
        OR public.is_partner_admin_of_org(auth.uid(), organization_id)
    );

DROP POLICY IF EXISTS m365_ca_findings_select  ON public.m365_ca_findings;
CREATE POLICY m365_ca_findings_select ON public.m365_ca_findings FOR SELECT
    USING (
        public.is_super_admin(auth.uid())
        OR public.is_member_of_org(auth.uid(), organization_id)
        OR public.is_partner_admin_of_org(auth.uid(), organization_id)
    );

-- UPDATE (acknowledgement only): org admins
DROP POLICY IF EXISTS m365_ca_findings_update  ON public.m365_ca_findings;
CREATE POLICY m365_ca_findings_update ON public.m365_ca_findings FOR UPDATE
    USING (
        public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), organization_id)
    )
    WITH CHECK (
        public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), organization_id)
    );

-- INSERT/UPDATE on m365_ca_policies is service-role only (the edge fn).
-- INSERT on m365_ca_findings is service-role only (the AI fn).

-- ---------------------------------------------------------------------------
-- 4. Convenience RPC — overview tile for the org dashboard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_m365_ca_overview(p_org_id UUID)
RETURNS TABLE (
    tenant_count           INTEGER,
    policies_total         INTEGER,
    policies_enabled       INTEGER,
    policies_report_only   INTEGER,
    findings_open          INTEGER,
    findings_critical      INTEGER,
    last_fetched_at        TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT
        (SELECT count(*)::int FROM public.m365_tenants WHERE organization_id = p_org_id),
        (SELECT count(*)::int FROM public.m365_ca_policies WHERE organization_id = p_org_id AND deleted_at IS NULL),
        (SELECT count(*)::int FROM public.m365_ca_policies WHERE organization_id = p_org_id AND deleted_at IS NULL AND state = 'enabled'),
        (SELECT count(*)::int FROM public.m365_ca_policies WHERE organization_id = p_org_id AND deleted_at IS NULL AND state = 'enabledForReportingNotEnforced'),
        (SELECT count(*)::int FROM public.m365_ca_findings WHERE organization_id = p_org_id AND acknowledged_at IS NULL),
        (SELECT count(*)::int FROM public.m365_ca_findings WHERE organization_id = p_org_id AND acknowledged_at IS NULL AND severity = 'critical'),
        (SELECT max(fetched_at)    FROM public.m365_ca_policies WHERE organization_id = p_org_id)
    ;
$$;

GRANT EXECUTE ON FUNCTION public.get_m365_ca_overview(UUID) TO authenticated;
