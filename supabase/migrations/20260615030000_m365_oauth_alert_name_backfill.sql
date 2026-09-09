-- =============================================================================
-- Backfill m365_high_risk_oauth_grant alert titles
--
-- The detection trigger on m365_oauth_grants emits an alert with
--   title = 'Suspicious OAuth grant: ' || COALESCE(client_display_name, client_id)
-- but before the poll function started resolving service-principal display
-- names, every alert ended up with a bare GUID in the title and description.
-- Re-polling now populates client_display_name on the grant row, but the
-- trigger doesn't re-emit on plain updates, so existing alerts keep the GUID.
--
-- This RPC, called once per tenant at the end of pollOAuthGrants, rewrites
-- those legacy alert rows using the now-known display name. Scoped to the
-- calling org; safe to re-run.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.m365_backfill_oauth_alert_names(_organization_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    _updated integer;
BEGIN
    WITH upd AS (
        UPDATE public.m365_alerts a
           SET title       = 'Suspicious OAuth grant: ' || g.client_display_name,
               description = replace(a.description, '"' || g.client_id || '"', '"' || g.client_display_name || '"')
          FROM public.m365_oauth_grants g
         WHERE a.organization_id = _organization_id
           AND a.alert_type      = 'm365_high_risk_oauth_grant'
           AND a.title           = 'Suspicious OAuth grant: ' || g.client_id
           AND g.organization_id = _organization_id
           AND g.client_display_name IS NOT NULL
           AND g.client_display_name <> g.client_id
        RETURNING 1
    )
    SELECT count(*)::int INTO _updated FROM upd;
    RETURN _updated;
END;
$$;

REVOKE ALL ON FUNCTION public.m365_backfill_oauth_alert_names(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.m365_backfill_oauth_alert_names(uuid) TO service_role;

COMMENT ON FUNCTION public.m365_backfill_oauth_alert_names(uuid) IS
'Rewrites m365_high_risk_oauth_grant alert titles + descriptions that contain a bare SP object id, replacing it with the display name now stored on the related m365_oauth_grants row. Called from m365-poll-tenants once per poll.';
