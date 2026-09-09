-- 20260614040000_group_policy_propagation.sql
--
-- Makes endpoint_groups the source of truth for per-endpoint policy
-- assignments.
--
-- Today: endpoints.policy_id / wdac_policy_id / uac_policy_id /
--        windows_update_policy_id are set per-endpoint. The agent reads
--        these columns at heartbeat time. Groups carry policy IDs too
--        but assigning a policy to a group has no effect on its members.
--
-- After: joining a group, or changing the group's policy IDs, copies the
--        group's values onto every member endpoint. The agent doesn't
--        change at all; it keeps reading endpoints.* and picks up the
--        new policy on the next heartbeat.
--
-- This means an MSP can manage policy entirely at the group level — never
-- touch an individual endpoint unless they explicitly want an override.
-- Per-endpoint overrides are still possible (direct UPDATE to the
-- endpoints row); they're just no longer the only path.
--
-- The propagator only touches columns the group has a non-NULL value for.
-- Setting a group's defender_policy_id back to NULL does NOT wipe the
-- endpoints' policy_id — we treat NULL as "no opinion" so partial group
-- migrations don't accidentally unassign policies.

BEGIN;

-- ============================================================
-- Core function: apply a group's policies to one endpoint
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_group_policies_to_endpoint(
    p_endpoint_id uuid,
    p_group_id    uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    g public.endpoint_groups%ROWTYPE;
BEGIN
    SELECT * INTO g FROM public.endpoint_groups WHERE id = p_group_id;
    IF NOT FOUND THEN RETURN; END IF;

    -- Only copy non-NULL fields. NULL on the group means "the group is
    -- silent about this module" — don't clobber whatever the endpoint
    -- already has.
    UPDATE public.endpoints
    SET
        policy_id                = COALESCE(g.defender_policy_id,       policy_id),
        wdac_policy_id           = COALESCE(g.wdac_policy_id,           wdac_policy_id),
        uac_policy_id            = COALESCE(g.uac_policy_id,            uac_policy_id),
        windows_update_policy_id = COALESCE(g.windows_update_policy_id, windows_update_policy_id),
        updated_at               = now()
    WHERE id = p_endpoint_id;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_group_policies_to_endpoint(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_group_policies_to_endpoint(uuid, uuid) TO authenticated;


-- ============================================================
-- Trigger: when an endpoint joins a group, push the group's policies
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_group_membership_propagate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Run for INSERT and UPDATE that swaps the group id.
    PERFORM public.apply_group_policies_to_endpoint(NEW.endpoint_id, NEW.group_id);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS group_membership_propagate ON public.endpoint_group_memberships;
CREATE TRIGGER group_membership_propagate
    AFTER INSERT OR UPDATE OF group_id ON public.endpoint_group_memberships
    FOR EACH ROW EXECUTE FUNCTION public.trg_group_membership_propagate();


-- ============================================================
-- Trigger: when a group's policy IDs change, re-propagate to ALL members
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_group_policy_change_propagate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_changed boolean := false;
BEGIN
    -- Detect whether any policy column actually changed. Avoid recursive
    -- writes when only updated_at / description / name moves.
    IF NEW.defender_policy_id       IS DISTINCT FROM OLD.defender_policy_id       THEN v_changed := true; END IF;
    IF NEW.wdac_policy_id           IS DISTINCT FROM OLD.wdac_policy_id           THEN v_changed := true; END IF;
    IF NEW.uac_policy_id            IS DISTINCT FROM OLD.uac_policy_id            THEN v_changed := true; END IF;
    IF NEW.windows_update_policy_id IS DISTINCT FROM OLD.windows_update_policy_id THEN v_changed := true; END IF;
    -- gpo_policy_id and update_ring_id live on the group only — no
    -- endpoint-level column today. The agent reads them via the group at
    -- heartbeat-time (separate code path), so no propagation needed here.

    IF v_changed THEN
        UPDATE public.endpoints e
        SET
            policy_id                = COALESCE(NEW.defender_policy_id,       e.policy_id),
            wdac_policy_id           = COALESCE(NEW.wdac_policy_id,           e.wdac_policy_id),
            uac_policy_id            = COALESCE(NEW.uac_policy_id,            e.uac_policy_id),
            windows_update_policy_id = COALESCE(NEW.windows_update_policy_id, e.windows_update_policy_id),
            updated_at               = now()
        FROM public.endpoint_group_memberships m
        WHERE m.group_id = NEW.id AND e.id = m.endpoint_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS group_policy_change_propagate ON public.endpoint_groups;
CREATE TRIGGER group_policy_change_propagate
    AFTER UPDATE ON public.endpoint_groups
    FOR EACH ROW EXECUTE FUNCTION public.trg_group_policy_change_propagate();


-- ============================================================
-- Effective-policy resolver: belt + braces for the agent path
--
-- Resolves an endpoint's effective policy by checking the endpoint
-- columns first (set by the propagation triggers) and falling back to
-- any group the endpoint is in. Lets the agent-api eventually move to a
-- single-source-of-truth read without breaking the existing path.
-- ============================================================
CREATE OR REPLACE FUNCTION public.effective_endpoint_policies(p_endpoint_id uuid)
RETURNS TABLE(
    defender_policy_id       uuid,
    wdac_policy_id           uuid,
    uac_policy_id            uuid,
    windows_update_policy_id uuid,
    update_ring_id           uuid,
    source                   text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH e AS (
        SELECT id, policy_id, wdac_policy_id, uac_policy_id, windows_update_policy_id
        FROM public.endpoints WHERE id = p_endpoint_id
    ),
    g AS (
        SELECT eg.defender_policy_id, eg.wdac_policy_id, eg.uac_policy_id,
               eg.windows_update_policy_id, eg.update_ring_id
        FROM public.endpoint_group_memberships m
        JOIN public.endpoint_groups eg ON eg.id = m.group_id
        WHERE m.endpoint_id = p_endpoint_id
        ORDER BY eg.is_default DESC NULLS LAST, eg.updated_at DESC
        LIMIT 1
    )
    SELECT
        COALESCE(e.policy_id,                (SELECT defender_policy_id       FROM g)),
        COALESCE(e.wdac_policy_id,           (SELECT wdac_policy_id           FROM g)),
        COALESCE(e.uac_policy_id,            (SELECT uac_policy_id            FROM g)),
        COALESCE(e.windows_update_policy_id, (SELECT windows_update_policy_id FROM g)),
        (SELECT update_ring_id FROM g),
        CASE
            WHEN e.policy_id IS NOT NULL THEN 'endpoint'
            WHEN EXISTS (SELECT 1 FROM g)   THEN 'group'
            ELSE 'none'
        END
    FROM e;
$$;

REVOKE ALL ON FUNCTION public.effective_endpoint_policies(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.effective_endpoint_policies(uuid) TO authenticated;


-- ============================================================
-- Backfill: walk current memberships and propagate. Idempotent.
-- ============================================================
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT m.endpoint_id, m.group_id
        FROM public.endpoint_group_memberships m
        JOIN public.endpoint_groups g ON g.id = m.group_id
        WHERE g.defender_policy_id       IS NOT NULL
           OR g.wdac_policy_id           IS NOT NULL
           OR g.uac_policy_id            IS NOT NULL
           OR g.windows_update_policy_id IS NOT NULL
    LOOP
        PERFORM public.apply_group_policies_to_endpoint(r.endpoint_id, r.group_id);
    END LOOP;
END $$;

COMMIT;
