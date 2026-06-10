-- The earlier security-review fix did `REVOKE SELECT ON m365_tenants FROM
-- authenticated` to stop token columns leaking. That worked, but the
-- m365_tenants_view is `security_invoker=true` — it runs as the caller, so
-- the view also gets zero rows for authenticated users. Net effect: the
-- /m365 page shows 0 tenants and the SOC counter reads 0 even though the
-- row exists and is `active`.
--
-- Correct fix: GRANT column-level SELECT on every non-token column. The
-- two genuinely sensitive columns (access_token, refresh_token) stay
-- unreachable to authenticated. RLS policies still apply per row.

-- Idempotent: revoke at table level first, then grant column-level. Safe
-- to re-run.
REVOKE SELECT ON public.m365_tenants FROM authenticated;

GRANT SELECT (
    id,
    organization_id,
    tenant_id,
    tenant_display_name,
    tenant_domain,
    scopes,
    consent_state,
    remediation_enabled,
    remediation_scopes,
    access_token_expires_at,        -- expiry timestamp is fine; the token itself is not
    last_poll_at,
    last_poll_error,
    created_at,
    updated_at,
    connected_by
) ON public.m365_tenants TO authenticated;

-- Keep the view grant intact (already exists; idempotent re-grant).
GRANT SELECT ON public.m365_tenants_view TO authenticated;

COMMENT ON COLUMN public.m365_tenants.access_token IS
    'OAuth access token (sensitive). NOT granted to the authenticated role — only the service role reads this.';
COMMENT ON COLUMN public.m365_tenants.refresh_token IS
    'OAuth refresh token (sensitive). NOT granted to the authenticated role — only the service role reads this.';
