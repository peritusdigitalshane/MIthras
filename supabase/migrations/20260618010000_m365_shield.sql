-- 20260618010000_m365_shield.sql
--
-- Mithras M365 Shield — opt-in module that replicates the outcomes of
-- Entra ID P1/P2 + Defender for O365 + Defender for Cloud Apps + Purview
-- Audit Premium using nothing more than Microsoft Graph endpoints already
-- covered by our consented READ_ONLY_SCOPES + REMEDIATION_SCOPES sets.
--
-- Phase 1 capabilities:
--   1. PIM-lite    : time-boxed admin role elevation via roleManagement.
--   2. Risky signin: per-user 0-100 risk score from /auditLogs/signIns.
--   3. OAuth gov   : inventory + revoke of oauth2PermissionGrants.
--   4. Access rvw  : scheduled attestation of admins/guests/delegates.
--
-- Honest disclosure for every panel: where Mithras matches Microsoft,
-- where it approximates, where it cannot replace. Enforcement runs on
-- a detect-and-act loop, NOT at the IdP sign-in itself.
--
-- Spec: docs/superpowers/specs/2026-06-18-mithras-m365-shield.md

-- ===========================================================================
-- 0. Per-org enable flag
-- ===========================================================================
ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS m365_shield_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS m365_shield_enabled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS m365_shield_enabled_by UUID REFERENCES auth.users(id);

COMMENT ON COLUMN public.organizations.m365_shield_enabled IS
'Opt-in module flag. When true, Shield polls (PIM auto-revoke, risk scoring, OAuth inventory) run for this org and the /m365/shield page is fully active.';

-- Touch trigger keeps enabled_at correct without app code having to remember.
CREATE OR REPLACE FUNCTION public.touch_m365_shield_enabled_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.m365_shield_enabled = TRUE AND (OLD.m365_shield_enabled IS NULL OR OLD.m365_shield_enabled = FALSE) THEN
        NEW.m365_shield_enabled_at = now();
    END IF;
    RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_org_m365_shield_enabled_at ON public.organizations;
CREATE TRIGGER trg_org_m365_shield_enabled_at
    BEFORE UPDATE OF m365_shield_enabled ON public.organizations
    FOR EACH ROW EXECUTE FUNCTION public.touch_m365_shield_enabled_at();

-- ===========================================================================
-- 1. PIM-lite — time-boxed admin role elevations
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.pim_elevations (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    m365_tenant_id              UUID NOT NULL REFERENCES public.m365_tenants(id) ON DELETE CASCADE,
    target_user_upn             TEXT NOT NULL,
    target_user_id              TEXT NOT NULL,
    -- Graph directoryRole template id (e.g. 62e90394-69f5-4237-9190-012177145e10 = Global Administrator)
    role_template_id            TEXT NOT NULL,
    role_display_name           TEXT NOT NULL,
    -- Free-text justification — captured in audit, required by UI
    reason                      TEXT NOT NULL,
    requested_by                UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    requested_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    duration_minutes            INT NOT NULL CHECK (duration_minutes BETWEEN 15 AND 480),
    expires_at                  TIMESTAMPTZ NOT NULL,
    -- pending → active (after Graph add succeeds) → expired (auto-revoke) | revoked (manual) | failed
    status                      TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'revoked', 'expired', 'failed')),
    -- Graph roleAssignment id, so we can DELETE it on revoke.
    graph_role_assignment_id    TEXT,
    error_message               TEXT,
    activated_at                TIMESTAMPTZ,
    revoked_at                  TIMESTAMPTZ,
    revoked_by                  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    revoke_reason               TEXT
);

CREATE INDEX IF NOT EXISTS idx_pim_elevations_org_status
    ON public.pim_elevations (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_pim_elevations_active_expiry
    ON public.pim_elevations (status, expires_at) WHERE status = 'active';

COMMENT ON TABLE public.pim_elevations IS
'Mithras PIM-lite: time-boxed admin role elevations. Substitutes Entra ID P2 PIM. Auto-revoke cron flips status=active rows whose expires_at has passed.';

-- ===========================================================================
-- 2. Per-user risk scoring
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.m365_signin_risk (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    m365_tenant_id              UUID NOT NULL REFERENCES public.m365_tenants(id) ON DELETE CASCADE,
    user_upn                    TEXT NOT NULL,
    user_id                     TEXT NOT NULL,
    risk_score                  INT NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
    risk_level                  TEXT NOT NULL
        CHECK (risk_level IN ('none','low','medium','high','critical')),
    -- Array of { kind: string, points: number, evidence: string }
    risk_factors                JSONB NOT NULL DEFAULT '[]'::jsonb,
    signin_count_24h            INT NOT NULL DEFAULT 0,
    failed_signin_24h           INT NOT NULL DEFAULT 0,
    distinct_countries_24h      INT NOT NULL DEFAULT 0,
    distinct_asns_24h           INT NOT NULL DEFAULT 0,
    last_signin_at              TIMESTAMPTZ,
    last_evaluated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (m365_tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_m365_signin_risk_org_level
    ON public.m365_signin_risk (organization_id, risk_level);

COMMENT ON TABLE public.m365_signin_risk IS
'Mithras per-user risk score derived from /auditLogs/signIns. Substitutes Entra ID P2 Identity Protection. No cross-tenant ML — heuristic-only.';

-- ===========================================================================
-- 3. OAuth governance — extends the existing m365_oauth_grants table
--    (from 20260601100000_m365_itdr.sql) with risk-score + governance fields.
-- ===========================================================================
ALTER TABLE public.m365_oauth_grants
    ADD COLUMN IF NOT EXISTS publisher       TEXT,
    ADD COLUMN IF NOT EXISTS risk_score      INT NOT NULL DEFAULT 0
        CHECK (risk_score BETWEEN 0 AND 100),
    ADD COLUMN IF NOT EXISTS risk_level      TEXT NOT NULL DEFAULT 'low'
        CHECK (risk_level IN ('low','medium','high','critical')),
    ADD COLUMN IF NOT EXISTS revoked_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS revoked_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS revoke_reason   TEXT,
    ADD COLUMN IF NOT EXISTS deleted_at      TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_m365_oauth_grants_org_risk
    ON public.m365_oauth_grants (organization_id, risk_level, deleted_at);

COMMENT ON COLUMN public.m365_oauth_grants.risk_score IS
'0-100 risk score from m365-oauth-poll. Substitutes the OAuth slice of Defender for Cloud Apps.';

-- ===========================================================================
-- 4. Access reviews
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.m365_access_reviews (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    m365_tenant_id              UUID NOT NULL REFERENCES public.m365_tenants(id) ON DELETE CASCADE,
    -- 'admin' | 'guest' | 'mailbox_delegate' | 'shared_mailbox'
    review_kind                 TEXT NOT NULL
        CHECK (review_kind IN ('admin','guest','mailbox_delegate','shared_mailbox')),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by                  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    due_at                      TIMESTAMPTZ NOT NULL,
    completed_at                TIMESTAMPTZ,
    completed_by                UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    item_count                  INT NOT NULL DEFAULT 0,
    kept_count                  INT NOT NULL DEFAULT 0,
    removed_count               INT NOT NULL DEFAULT 0,
    notes                       TEXT
);

CREATE INDEX IF NOT EXISTS idx_m365_access_reviews_org_open
    ON public.m365_access_reviews (organization_id, completed_at);

CREATE TABLE IF NOT EXISTS public.m365_access_review_items (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id                   UUID NOT NULL REFERENCES public.m365_access_reviews(id) ON DELETE CASCADE,
    subject_id                  TEXT NOT NULL,
    subject_label               TEXT NOT NULL,
    detail                      JSONB NOT NULL DEFAULT '{}'::jsonb,
    decision                    TEXT CHECK (decision IN ('keep','remove')),
    decided_at                  TIMESTAMPTZ,
    decided_by                  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    enforced_at                 TIMESTAMPTZ,
    enforcement_error           TEXT
);

CREATE INDEX IF NOT EXISTS idx_m365_access_review_items_review
    ON public.m365_access_review_items (review_id);

COMMENT ON TABLE public.m365_access_reviews IS
'Quarterly attestation cycles for admins / guests / mailbox delegates. Substitutes Entra ID P2 Access Reviews.';

-- ===========================================================================
-- 5. RLS
-- ===========================================================================
ALTER TABLE public.pim_elevations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.m365_signin_risk          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.m365_oauth_grants         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.m365_access_reviews       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.m365_access_review_items  ENABLE ROW LEVEL SECURITY;

-- pim_elevations
DROP POLICY IF EXISTS pim_elevations_select ON public.pim_elevations;
CREATE POLICY pim_elevations_select ON public.pim_elevations FOR SELECT
    USING (
        public.is_super_admin(auth.uid())
        OR public.is_member_of_org(auth.uid(), organization_id)
        OR public.is_partner_admin_of_org(auth.uid(), organization_id)
    );

DROP POLICY IF EXISTS pim_elevations_insert ON public.pim_elevations;
CREATE POLICY pim_elevations_insert ON public.pim_elevations FOR INSERT
    WITH CHECK (
        public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), organization_id)
    );

DROP POLICY IF EXISTS pim_elevations_update ON public.pim_elevations;
CREATE POLICY pim_elevations_update ON public.pim_elevations FOR UPDATE
    USING (
        public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), organization_id)
    );

-- m365_signin_risk — read-only for org members; writes are service-role
DROP POLICY IF EXISTS m365_signin_risk_select ON public.m365_signin_risk;
CREATE POLICY m365_signin_risk_select ON public.m365_signin_risk FOR SELECT
    USING (
        public.is_super_admin(auth.uid())
        OR public.is_member_of_org(auth.uid(), organization_id)
        OR public.is_partner_admin_of_org(auth.uid(), organization_id)
    );

-- m365_oauth_grants
DROP POLICY IF EXISTS m365_oauth_grants_select ON public.m365_oauth_grants;
CREATE POLICY m365_oauth_grants_select ON public.m365_oauth_grants FOR SELECT
    USING (
        public.is_super_admin(auth.uid())
        OR public.is_member_of_org(auth.uid(), organization_id)
        OR public.is_partner_admin_of_org(auth.uid(), organization_id)
    );

DROP POLICY IF EXISTS m365_oauth_grants_update ON public.m365_oauth_grants;
CREATE POLICY m365_oauth_grants_update ON public.m365_oauth_grants FOR UPDATE
    USING (
        public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), organization_id)
    );

-- m365_access_reviews + items
DROP POLICY IF EXISTS m365_access_reviews_select ON public.m365_access_reviews;
CREATE POLICY m365_access_reviews_select ON public.m365_access_reviews FOR SELECT
    USING (
        public.is_super_admin(auth.uid())
        OR public.is_member_of_org(auth.uid(), organization_id)
        OR public.is_partner_admin_of_org(auth.uid(), organization_id)
    );

DROP POLICY IF EXISTS m365_access_reviews_insert ON public.m365_access_reviews;
CREATE POLICY m365_access_reviews_insert ON public.m365_access_reviews FOR INSERT
    WITH CHECK (
        public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), organization_id)
    );

DROP POLICY IF EXISTS m365_access_reviews_update ON public.m365_access_reviews;
CREATE POLICY m365_access_reviews_update ON public.m365_access_reviews FOR UPDATE
    USING (
        public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), organization_id)
    );

DROP POLICY IF EXISTS m365_access_review_items_select ON public.m365_access_review_items;
CREATE POLICY m365_access_review_items_select ON public.m365_access_review_items FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.m365_access_reviews r
            WHERE r.id = review_id
              AND (
                public.is_super_admin(auth.uid())
                OR public.is_member_of_org(auth.uid(), r.organization_id)
                OR public.is_partner_admin_of_org(auth.uid(), r.organization_id)
              )
        )
    );

DROP POLICY IF EXISTS m365_access_review_items_update ON public.m365_access_review_items;
CREATE POLICY m365_access_review_items_update ON public.m365_access_review_items FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.m365_access_reviews r
            WHERE r.id = review_id
              AND (
                public.is_super_admin(auth.uid())
                OR public.is_admin_of_org(auth.uid(), r.organization_id)
              )
        )
    );

-- ===========================================================================
-- 6. Overview RPC — single call powers the dashboard header
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.get_m365_shield_overview(p_org_id UUID)
RETURNS TABLE (
    enabled                 BOOLEAN,
    enabled_at              TIMESTAMPTZ,
    active_elevations       INT,
    pending_elevations      INT,
    elevations_24h          INT,
    high_risk_users         INT,
    critical_risk_users     INT,
    risk_users_total        INT,
    oauth_grants_total      INT,
    oauth_grants_high_risk  INT,
    open_reviews            INT,
    last_risk_poll_at       TIMESTAMPTZ,
    last_oauth_poll_at      TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT
        (SELECT m365_shield_enabled FROM public.organizations WHERE id = p_org_id),
        (SELECT m365_shield_enabled_at FROM public.organizations WHERE id = p_org_id),
        (SELECT count(*)::int FROM public.pim_elevations
            WHERE organization_id = p_org_id AND status = 'active'),
        (SELECT count(*)::int FROM public.pim_elevations
            WHERE organization_id = p_org_id AND status = 'pending'),
        (SELECT count(*)::int FROM public.pim_elevations
            WHERE organization_id = p_org_id AND requested_at >= now() - interval '24 hours'),
        (SELECT count(*)::int FROM public.m365_signin_risk
            WHERE organization_id = p_org_id AND risk_level = 'high'),
        (SELECT count(*)::int FROM public.m365_signin_risk
            WHERE organization_id = p_org_id AND risk_level = 'critical'),
        (SELECT count(*)::int FROM public.m365_signin_risk
            WHERE organization_id = p_org_id),
        (SELECT count(*)::int FROM public.m365_oauth_grants
            WHERE organization_id = p_org_id AND deleted_at IS NULL),
        (SELECT count(*)::int FROM public.m365_oauth_grants
            WHERE organization_id = p_org_id AND deleted_at IS NULL
              AND risk_level IN ('high','critical')),
        (SELECT count(*)::int FROM public.m365_access_reviews
            WHERE organization_id = p_org_id AND completed_at IS NULL),
        (SELECT max(last_evaluated_at) FROM public.m365_signin_risk
            WHERE organization_id = p_org_id),
        (SELECT max(last_seen_at) FROM public.m365_oauth_grants
            WHERE organization_id = p_org_id)
    ;
$$;

GRANT EXECUTE ON FUNCTION public.get_m365_shield_overview(UUID) TO authenticated;

-- ===========================================================================
-- 7. Iterator for crons — returns shielded tenants only
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.shielded_m365_tenants()
RETURNS TABLE (
    tenant_pk                   UUID,
    organization_id             UUID,
    tenant_id                   TEXT,
    tenant_display_name         TEXT,
    access_token                TEXT,
    refresh_token               TEXT,
    access_token_expires_at     TIMESTAMPTZ,
    scopes                      TEXT[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT
        t.id, t.organization_id, t.tenant_id, t.tenant_display_name,
        t.access_token, t.refresh_token, t.access_token_expires_at, t.scopes
    FROM public.m365_tenants t
    JOIN public.organizations o ON o.id = t.organization_id
    WHERE o.m365_shield_enabled = TRUE
      AND t.consent_state = 'active'
$$;

GRANT EXECUTE ON FUNCTION public.shielded_m365_tenants() TO service_role;
