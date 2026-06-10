-- Hotfix: the original m365_tenants_view (migration 20260601100000) was
-- created without security_invoker=true. In PostgreSQL the default is
-- security_definer, meaning the view executes as its owner (postgres)
-- regardless of the caller — completely bypassing RLS on m365_tenants.
-- Any authenticated user could read every Mithras org's tenant metadata
-- through the view.
--
-- This migration recreates the view with security_invoker=true so RLS on
-- the underlying table applies to the caller. Safe to re-run.

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
