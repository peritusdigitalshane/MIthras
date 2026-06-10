-- PoC review recommendation #3: today 10/11 endpoints have no Defender policy
-- assigned and 5/11 belong to no endpoint_group, so microsegmentation can't
-- enforce (precondition: endpoint must be in a group whose org has a firewall
-- policy). Despite the marketing claim, 90% of the fleet is unmanaged.
--
-- This migration:
--   (1) ensures every org with endpoints has a default firewall_policy
--   (2) adds endpoint_groups.is_default and ensures every such org has one
--   (3) backfills endpoints.policy_id with the org's default defender_policy
--   (4) adds every active endpoint to its org's default group
--   (5) installs BEFORE/AFTER triggers so new enrolments inherit defaults

-- ---------------------------------------------------------------------------
-- 1. endpoint_groups gets an is_default flag (max one per org).
-- ---------------------------------------------------------------------------
ALTER TABLE public.endpoint_groups
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_endpoint_groups_one_default_per_org
  ON public.endpoint_groups (organization_id)
  WHERE is_default;

-- ---------------------------------------------------------------------------
-- 2. Every org with active endpoints has a default firewall_policy.
--    First mark the oldest existing one default; then create one where none exists.
-- ---------------------------------------------------------------------------
WITH orgs_needing_default AS (
    SELECT DISTINCT e.organization_id
    FROM public.endpoints e
    WHERE e.deleted_at IS NULL
      AND NOT EXISTS (
          SELECT 1 FROM public.firewall_policies fp
          WHERE fp.organization_id = e.organization_id AND fp.is_default
      )
),
oldest_per_org AS (
    SELECT DISTINCT ON (organization_id) id, organization_id
    FROM public.firewall_policies
    WHERE organization_id IN (SELECT organization_id FROM orgs_needing_default)
    ORDER BY organization_id, created_at ASC
)
UPDATE public.firewall_policies fp
   SET is_default = true, updated_at = now()
  FROM oldest_per_org o
 WHERE fp.id = o.id;

INSERT INTO public.firewall_policies (organization_id, name, description, is_default)
SELECT DISTINCT e.organization_id,
       'Default firewall policy',
       'Auto-created so microsegmentation can target endpoints in this org.',
       true
  FROM public.endpoints e
 WHERE e.deleted_at IS NULL
   AND NOT EXISTS (
        SELECT 1 FROM public.firewall_policies fp
         WHERE fp.organization_id = e.organization_id
   );

-- ---------------------------------------------------------------------------
-- 3. Every org with active endpoints has a default endpoint_group, pointed at
--    that org's default defender_policy.
-- ---------------------------------------------------------------------------
-- Mark oldest existing group default per org if no group is yet marked default.
WITH orgs_needing_default_group AS (
    SELECT DISTINCT e.organization_id
    FROM public.endpoints e
    WHERE e.deleted_at IS NULL
      AND NOT EXISTS (
          SELECT 1 FROM public.endpoint_groups eg
          WHERE eg.organization_id = e.organization_id AND eg.is_default
      )
),
oldest_group_per_org AS (
    SELECT DISTINCT ON (organization_id) id, organization_id
    FROM public.endpoint_groups
    WHERE organization_id IN (SELECT organization_id FROM orgs_needing_default_group)
    ORDER BY organization_id, created_at ASC
)
UPDATE public.endpoint_groups eg
   SET is_default = true, updated_at = now()
  FROM oldest_group_per_org o
 WHERE eg.id = o.id;

INSERT INTO public.endpoint_groups (organization_id, name, description, defender_policy_id, is_default)
SELECT DISTINCT e.organization_id,
       'Default group',
       'Auto-created so endpoints can receive Defender + firewall policy.',
       (SELECT dp.id FROM public.defender_policies dp
         WHERE dp.organization_id = e.organization_id AND dp.is_default
         ORDER BY dp.created_at ASC LIMIT 1),
       true
  FROM public.endpoints e
 WHERE e.deleted_at IS NULL
   AND NOT EXISTS (
        SELECT 1 FROM public.endpoint_groups eg
         WHERE eg.organization_id = e.organization_id
   );

-- ---------------------------------------------------------------------------
-- 4. Backfill: assign org's default defender_policy to every endpoint missing one.
-- ---------------------------------------------------------------------------
UPDATE public.endpoints e
   SET policy_id  = dp.id,
       updated_at = now()
  FROM public.defender_policies dp
 WHERE dp.organization_id = e.organization_id
   AND dp.is_default
   AND e.policy_id IS NULL
   AND e.deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 5. Backfill: add every endpoint without group membership to the org's default group.
-- ---------------------------------------------------------------------------
INSERT INTO public.endpoint_group_memberships (endpoint_id, group_id)
SELECT e.id, eg.id
  FROM public.endpoints e
  JOIN public.endpoint_groups eg
    ON eg.organization_id = e.organization_id AND eg.is_default
 WHERE e.deleted_at IS NULL
   AND NOT EXISTS (
        SELECT 1 FROM public.endpoint_group_memberships m
         WHERE m.endpoint_id = e.id
   )
ON CONFLICT (endpoint_id, group_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. BEFORE INSERT trigger: stamp policy_id from org default if NULL.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.endpoint_assign_default_defender_policy()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
    IF NEW.policy_id IS NULL THEN
        SELECT id INTO NEW.policy_id
          FROM public.defender_policies
         WHERE organization_id = NEW.organization_id AND is_default
         ORDER BY created_at ASC LIMIT 1;
    END IF;
    RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_endpoint_assign_default_defender ON public.endpoints;
CREATE TRIGGER trg_endpoint_assign_default_defender
BEFORE INSERT ON public.endpoints
FOR EACH ROW
EXECUTE FUNCTION public.endpoint_assign_default_defender_policy();

-- ---------------------------------------------------------------------------
-- 7. AFTER INSERT trigger: add the new endpoint to the org's default group.
--    Done AFTER INSERT so endpoint.id exists. Also lazy-creates the default
--    group + firewall_policy if the org has none yet (first endpoint in the org).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.endpoint_assign_default_group()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_group_id    uuid;
    v_defender_id uuid;
BEGIN
    -- Lazy-create firewall_policy if org has none.
    IF NOT EXISTS (SELECT 1 FROM public.firewall_policies WHERE organization_id = NEW.organization_id) THEN
        INSERT INTO public.firewall_policies (organization_id, name, description, is_default)
        VALUES (NEW.organization_id, 'Default firewall policy',
                'Auto-created on first endpoint enrolment.', true);
    END IF;

    -- Find or lazy-create default group.
    SELECT id INTO v_group_id
      FROM public.endpoint_groups
     WHERE organization_id = NEW.organization_id AND is_default
     LIMIT 1;

    IF v_group_id IS NULL THEN
        SELECT id INTO v_defender_id
          FROM public.defender_policies
         WHERE organization_id = NEW.organization_id AND is_default
         ORDER BY created_at ASC LIMIT 1;

        INSERT INTO public.endpoint_groups (organization_id, name, description, defender_policy_id, is_default)
        VALUES (NEW.organization_id, 'Default group',
                'Auto-created on first endpoint enrolment.', v_defender_id, true)
        RETURNING id INTO v_group_id;
    END IF;

    INSERT INTO public.endpoint_group_memberships (endpoint_id, group_id)
    VALUES (NEW.id, v_group_id)
    ON CONFLICT (endpoint_id, group_id) DO NOTHING;

    RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_endpoint_assign_default_group ON public.endpoints;
CREATE TRIGGER trg_endpoint_assign_default_group
AFTER INSERT ON public.endpoints
FOR EACH ROW
EXECUTE FUNCTION public.endpoint_assign_default_group();

COMMENT ON FUNCTION public.endpoint_assign_default_defender_policy() IS
'Auto-stamps endpoints.policy_id from org default on enrolment. Closes PoC rec #3 (10/11 unmanaged endpoints).';
COMMENT ON FUNCTION public.endpoint_assign_default_group() IS
'Adds new endpoints to the org default group (lazy-creates group + firewall_policy if needed). Unblocks microsegmentation enforce on fresh enrolments.';
