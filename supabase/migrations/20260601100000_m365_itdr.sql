-- Microsoft 365 / Entra ID Threat Detection (ITDR) — MVP schema.
--
-- A "tenant" here is a customer's M365 tenant linked to one Mithras
-- organization. Multi-tenant means we hold M365 tenant records for many
-- Mithras orgs; RLS scopes everything by organization_id.
--
-- Tokens live in m365_tenants. They are sensitive — only the service role
-- ever reads access_token / refresh_token. The RLS policies on m365_tenants
-- expose every column EXCEPT the token pair to org members; tokens are
-- pulled only by the polling edge function under the service role.

-- =============================================================================
-- m365_tenants — one row per (Mithras org × connected M365 tenant)
-- =============================================================================
CREATE TABLE public.m365_tenants (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    tenant_id                   TEXT NOT NULL,
    tenant_display_name         TEXT,
    tenant_domain               TEXT,

    -- OAuth token material. Treated as a secret — RLS exposes everything
    -- on this table EXCEPT these two columns to org members via the view
    -- m365_tenants_view below.
    access_token                TEXT,
    access_token_expires_at     TIMESTAMPTZ,
    refresh_token               TEXT,

    scopes                      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    consent_state               TEXT NOT NULL DEFAULT 'pending'
        CHECK (consent_state IN ('pending', 'active', 'failed', 'revoked')),

    -- Opt-in elevated consent for remediation actions (disable forwarding
    -- rule, revoke OAuth grant, force re-MFA). Off by default; flipped on
    -- per-tenant by a separate, narrower consent flow.
    remediation_enabled         BOOLEAN NOT NULL DEFAULT false,
    remediation_scopes          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

    last_poll_at                TIMESTAMPTZ,
    last_poll_error             TEXT,

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    connected_by                UUID REFERENCES public.profiles(id),

    UNIQUE (organization_id, tenant_id)
);

CREATE INDEX idx_m365_tenants_org ON public.m365_tenants(organization_id);
CREATE INDEX idx_m365_tenants_consent ON public.m365_tenants(consent_state) WHERE consent_state = 'active';

ALTER TABLE public.m365_tenants ENABLE ROW LEVEL SECURITY;

-- Members can see tenant metadata but NOT the token columns (the SELECT
-- policies below cover everything; for token access the service role
-- bypasses RLS via supabase-js with the SR key).
CREATE POLICY "Members read tenant metadata"
    ON public.m365_tenants FOR SELECT
    USING (is_member_of_org(auth.uid(), organization_id));

CREATE POLICY "Super admins read all tenants"
    ON public.m365_tenants FOR SELECT
    USING (is_super_admin(auth.uid()));

CREATE POLICY "Partner admins read customer tenants"
    ON public.m365_tenants FOR SELECT
    USING (is_partner_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Admins manage their org's tenants"
    ON public.m365_tenants FOR ALL
    USING (is_admin_of_org(auth.uid(), organization_id))
    WITH CHECK (is_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Super admins manage all tenants"
    ON public.m365_tenants FOR ALL
    USING (is_super_admin(auth.uid()))
    WITH CHECK (is_super_admin(auth.uid()));

-- A token-stripped projection. App code reads from this view; only the
-- service role (which bypasses RLS) reads tokens from the base table.
--
-- security_invoker=true is CRITICAL: without it the view runs as its
-- owner and bypasses RLS on m365_tenants, leaking every org's tenant
-- metadata to any authenticated user. With it, the policies on the
-- underlying table apply to whoever is querying.
CREATE OR REPLACE VIEW public.m365_tenants_view
    WITH (security_invoker = true) AS
    SELECT
        id, organization_id, tenant_id, tenant_display_name, tenant_domain,
        scopes, consent_state,
        remediation_enabled, remediation_scopes,
        access_token_expires_at,
        last_poll_at, last_poll_error,
        created_at, updated_at, connected_by
    FROM public.m365_tenants;

GRANT SELECT ON public.m365_tenants_view TO authenticated;

-- =============================================================================
-- m365_sign_in_events — Entra ID sign-in audit log
-- =============================================================================
CREATE TABLE public.m365_sign_in_events (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    m365_tenant_id              UUID NOT NULL REFERENCES public.m365_tenants(id) ON DELETE CASCADE,
    organization_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    graph_event_id              TEXT NOT NULL,                -- dedup key
    user_principal_name         TEXT,
    user_display_name           TEXT,
    user_id                     TEXT,
    app_display_name            TEXT,
    client_app_used             TEXT,

    ip_address                  INET,
    country                     TEXT,
    city                        TEXT,

    risk_level                  TEXT,                          -- low | medium | high | none | hidden
    risk_state                  TEXT,                          -- atRisk | confirmedCompromised | dismissed | none
    risk_event_types            TEXT[],

    status_error_code           INTEGER,
    status_failure_reason       TEXT,
    conditional_access_status   TEXT,                          -- success | failure | notApplied
    is_interactive              BOOLEAN,

    occurred_at                 TIMESTAMPTZ NOT NULL,          -- from Graph (createdDateTime)
    ingested_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    raw_event                   JSONB,

    UNIQUE (m365_tenant_id, graph_event_id)
);

CREATE INDEX idx_m365_signin_tenant_occurred ON public.m365_sign_in_events(m365_tenant_id, occurred_at DESC);
CREATE INDEX idx_m365_signin_org_occurred ON public.m365_sign_in_events(organization_id, occurred_at DESC);
CREATE INDEX idx_m365_signin_risk ON public.m365_sign_in_events(organization_id, occurred_at DESC)
    WHERE risk_level IN ('medium', 'high');
CREATE INDEX idx_m365_signin_user ON public.m365_sign_in_events(m365_tenant_id, user_principal_name, occurred_at DESC);

ALTER TABLE public.m365_sign_in_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members read sign-in events"
    ON public.m365_sign_in_events FOR SELECT
    USING (is_member_of_org(auth.uid(), organization_id));

CREATE POLICY "Super admins read all sign-in events"
    ON public.m365_sign_in_events FOR SELECT
    USING (is_super_admin(auth.uid()));

CREATE POLICY "Partner admins read customer sign-in events"
    ON public.m365_sign_in_events FOR SELECT
    USING (is_partner_admin_of_org(auth.uid(), organization_id));

-- Only the service role (via the poller) inserts.
CREATE POLICY "Service role writes sign-in events"
    ON public.m365_sign_in_events FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- =============================================================================
-- m365_audit_events — directory / admin audit log
-- =============================================================================
CREATE TABLE public.m365_audit_events (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    m365_tenant_id              UUID NOT NULL REFERENCES public.m365_tenants(id) ON DELETE CASCADE,
    organization_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    graph_event_id              TEXT NOT NULL,
    activity_display_name       TEXT,                          -- e.g. 'Add member to role'
    category                    TEXT,                          -- UserManagement | RoleManagement | ApplicationManagement | ...
    operation_type              TEXT,                          -- Add | Update | Delete | Assign

    initiated_by_user_upn       TEXT,
    initiated_by_user_id        TEXT,
    initiated_by_app_id         TEXT,
    initiated_by_app_name       TEXT,

    target_resources            JSONB,
    additional_details          JSONB,
    result                      TEXT,                          -- success | failure | timeout | unknownFutureValue
    result_reason               TEXT,

    occurred_at                 TIMESTAMPTZ NOT NULL,
    ingested_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    raw_event                   JSONB,

    UNIQUE (m365_tenant_id, graph_event_id)
);

CREATE INDEX idx_m365_audit_tenant_occurred ON public.m365_audit_events(m365_tenant_id, occurred_at DESC);
CREATE INDEX idx_m365_audit_org_occurred ON public.m365_audit_events(organization_id, occurred_at DESC);
CREATE INDEX idx_m365_audit_category ON public.m365_audit_events(m365_tenant_id, category, occurred_at DESC);

ALTER TABLE public.m365_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members read audit events"
    ON public.m365_audit_events FOR SELECT
    USING (is_member_of_org(auth.uid(), organization_id));

CREATE POLICY "Super admins read all audit events"
    ON public.m365_audit_events FOR SELECT
    USING (is_super_admin(auth.uid()));

CREATE POLICY "Partner admins read customer audit events"
    ON public.m365_audit_events FOR SELECT
    USING (is_partner_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Service role writes audit events"
    ON public.m365_audit_events FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- =============================================================================
-- m365_mailbox_rules — current state, refreshed by poller
--
-- The poller upserts the full set for each user every poll. We keep one
-- row per (tenant, user, rule_id); a rule that disappears between polls
-- is marked inactive rather than deleted, so the audit trail survives.
-- =============================================================================
CREATE TABLE public.m365_mailbox_rules (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    m365_tenant_id              UUID NOT NULL REFERENCES public.m365_tenants(id) ON DELETE CASCADE,
    organization_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    user_principal_name         TEXT NOT NULL,
    user_id                     TEXT NOT NULL,
    rule_id                     TEXT NOT NULL,
    rule_name                   TEXT,

    enabled                     BOOLEAN NOT NULL DEFAULT true,
    is_active                   BOOLEAN NOT NULL DEFAULT true,       -- false once the rule disappears
    conditions                  JSONB,
    actions                     JSONB,

    -- Computed indicators that the detection engine reads cheaply.
    forwards_externally         BOOLEAN NOT NULL DEFAULT false,
    forward_to_addresses        TEXT[],
    moves_to_folder             TEXT,
    deletes_messages            BOOLEAN NOT NULL DEFAULT false,

    first_seen_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    raw_rule                    JSONB,

    UNIQUE (m365_tenant_id, user_id, rule_id)
);

CREATE INDEX idx_m365_mailbox_rules_tenant ON public.m365_mailbox_rules(m365_tenant_id, last_seen_at DESC);
CREATE INDEX idx_m365_mailbox_rules_org ON public.m365_mailbox_rules(organization_id);
CREATE INDEX idx_m365_mailbox_rules_external_fwd ON public.m365_mailbox_rules(organization_id, last_seen_at DESC)
    WHERE forwards_externally = true AND is_active = true;

ALTER TABLE public.m365_mailbox_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members read mailbox rules"
    ON public.m365_mailbox_rules FOR SELECT
    USING (is_member_of_org(auth.uid(), organization_id));

CREATE POLICY "Super admins read all mailbox rules"
    ON public.m365_mailbox_rules FOR SELECT
    USING (is_super_admin(auth.uid()));

CREATE POLICY "Partner admins read customer mailbox rules"
    ON public.m365_mailbox_rules FOR SELECT
    USING (is_partner_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Service role writes mailbox rules"
    ON public.m365_mailbox_rules FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- =============================================================================
-- m365_oauth_grants — granted OAuth scopes per (tenant, principal, app)
-- =============================================================================
CREATE TABLE public.m365_oauth_grants (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    m365_tenant_id              UUID NOT NULL REFERENCES public.m365_tenants(id) ON DELETE CASCADE,
    organization_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    grant_id                    TEXT NOT NULL,                 -- Graph oauth2PermissionGrant id
    client_id                   TEXT NOT NULL,                 -- the OAuth app's appId
    client_display_name         TEXT,
    consent_type                TEXT,                          -- 'AllPrincipals' | 'Principal'
    principal_user_id           TEXT,                          -- null when consent_type=AllPrincipals
    principal_upn               TEXT,
    scope                       TEXT,                          -- space-separated scope list

    -- Computed signals.
    has_high_risk_scope         BOOLEAN NOT NULL DEFAULT false,
    high_risk_scopes_matched    TEXT[],

    first_seen_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_active                   BOOLEAN NOT NULL DEFAULT true,
    raw_grant                   JSONB,

    UNIQUE (m365_tenant_id, grant_id)
);

CREATE INDEX idx_m365_oauth_tenant ON public.m365_oauth_grants(m365_tenant_id, last_seen_at DESC);
CREATE INDEX idx_m365_oauth_high_risk ON public.m365_oauth_grants(organization_id, last_seen_at DESC)
    WHERE has_high_risk_scope = true AND is_active = true;

ALTER TABLE public.m365_oauth_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members read oauth grants"
    ON public.m365_oauth_grants FOR SELECT
    USING (is_member_of_org(auth.uid(), organization_id));

CREATE POLICY "Super admins read all oauth grants"
    ON public.m365_oauth_grants FOR SELECT
    USING (is_super_admin(auth.uid()));

CREATE POLICY "Partner admins read customer oauth grants"
    ON public.m365_oauth_grants FOR SELECT
    USING (is_partner_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Service role writes oauth grants"
    ON public.m365_oauth_grants FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- =============================================================================
-- Trigger: keep updated_at fresh on m365_tenants
-- =============================================================================
CREATE OR REPLACE FUNCTION public.m365_tenants_touch_updated_at()
    RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_m365_tenants_touch
    BEFORE UPDATE ON public.m365_tenants
    FOR EACH ROW EXECUTE FUNCTION public.m365_tenants_touch_updated_at();

-- =============================================================================
-- Settings seed: register the Azure AD app credential keys (no secrets here,
-- just the slots — the user fills them in via Admin → Settings → M365).
-- =============================================================================
INSERT INTO public.platform_settings (key, value, description, is_secret)
VALUES
    ('m365_azure_client_id',     '', 'Azure AD multi-tenant app client ID (Application ID).', false),
    ('m365_azure_client_secret', '', 'Azure AD app client secret value.',                      true),
    ('m365_azure_redirect_uri',  '', 'OAuth redirect URI registered on the Azure AD app (must match exactly).', false),
    ('m365_azure_authority',     'https://login.microsoftonline.com', 'OAuth authority. Override only for sovereign clouds.', false)
ON CONFLICT (key) DO NOTHING;
