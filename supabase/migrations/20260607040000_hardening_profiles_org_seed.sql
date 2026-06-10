-- Wire create_default_hardening_profiles() into org creation.
--
-- The function was introduced in 20260408101856_07ea9b4e-… and seeds three
-- ready-to-use profiles (Win10 max, Server 2012 R2 max, balanced). It has
-- never been called on new orgs — the only org-creation trigger calls
-- create_default_defender_policies() instead. Result: hardening_profiles
-- is empty for every org in the system, and the EOL hardening feature
-- (a headline value-prop) renders an empty list with no obvious recovery.
--
-- Wire the seed into a dedicated trigger so the two policy families stay
-- independent — adding a future seed to one shouldn't reach into the
-- other's function. Then backfill the 14 orgs that were created before
-- this migration so they immediately surface the three default profiles.

CREATE OR REPLACE FUNCTION public.trg_seed_hardening_profiles_on_org_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
    PERFORM public.create_default_hardening_profiles(NEW.id);
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS seed_hardening_profiles_on_org_insert ON public.organizations;
CREATE TRIGGER seed_hardening_profiles_on_org_insert
    AFTER INSERT ON public.organizations
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_seed_hardening_profiles_on_org_insert();

-- One-time backfill — call the seed for every existing org that has no
-- profiles yet. The function uses plain INSERTs without ON CONFLICT, so
-- guard explicitly to keep the migration re-runnable.
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT o.id FROM public.organizations o
        WHERE NOT EXISTS (
            SELECT 1 FROM public.hardening_profiles p
            WHERE p.organization_id = o.id
        )
    LOOP
        PERFORM public.create_default_hardening_profiles(r.id);
    END LOOP;
END
$$;
