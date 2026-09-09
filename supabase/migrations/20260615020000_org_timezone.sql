-- =============================================================================
-- Per-organisation timezone
--
-- Each org (partner, distributor, customer, home_user) carries its own IANA
-- timezone string. The console renders dates in this zone for any user whose
-- active organisation is the org. A per-user localStorage override still wins
-- at the UI layer for individuals on the road.
--
-- Default: Australia/Sydney — the platform's primary market.
-- =============================================================================

ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Australia/Sydney';

COMMENT ON COLUMN public.organizations.timezone IS
'IANA timezone identifier (e.g. Australia/Sydney). Used for date display in the console for users whose active org is this row. Partner admins set this themselves via set_organization_timezone().';

-- Backfill any pre-existing NULLs that survived the default (defensive — the
-- column is NOT NULL so this is a no-op in a fresh deploy, but useful when
-- the column already existed nullable).
UPDATE public.organizations
   SET timezone = 'Australia/Sydney'
 WHERE timezone IS NULL;

-- ----------------------------------------------------------------------------
-- RPC: scoped writer. Org admins, partner admins (over the row), and super
-- admins can change their own org's timezone. Validates the timezone string
-- via Postgres's pg_timezone_names catalogue so we don't accept garbage.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_organization_timezone(
    _org_id   uuid,
    _timezone text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT (
           public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), _org_id)
        OR public.is_partner_admin_of_org(auth.uid(), _org_id)
    ) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    IF _timezone IS NULL OR length(btrim(_timezone)) = 0 THEN
        RAISE EXCEPTION 'timezone_required' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = _timezone) THEN
        RAISE EXCEPTION 'invalid_timezone:%', _timezone USING ERRCODE = '22023';
    END IF;

    UPDATE public.organizations
       SET timezone = _timezone,
           updated_at = now()
     WHERE id = _org_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_organization_timezone(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_organization_timezone(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.set_organization_timezone(uuid, text) IS
'Update an org timezone. Allowed for org admins, partner admins over that org, and super admins. Validates against pg_timezone_names so only real IANA zones are accepted.';
