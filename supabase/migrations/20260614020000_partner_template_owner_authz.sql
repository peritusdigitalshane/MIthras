-- 20260614020000_partner_template_owner_authz.sql
--
-- Follow-up to 20260614010000_partner_templates_and_rings.sql.
--
-- Closes a cross-tenant write hole flagged by automated security review:
-- the original create_partner_template_from_group only authorised the
-- caller against the SOURCE customer org. Because the template's owner
-- (v_owner) is the parent partner above that customer, a customer-admin
-- (who has no rights over the partner tenant) could insert a row into the
-- partner's partner_policy_templates.
--
-- Impact in practice: limited — the snapshot only contains policy values
-- the customer-admin already reads. But it still places a row inside the
-- partner's tenancy and would show up in the partner's template list,
-- which violates the tenancy boundary.
--
-- Fix: after computing v_owner, re-check authorisation against the OWNER
-- org. Only a super-admin or a partner-admin (or admin) of the owner org
-- may create a template owned by that org.
--
-- This migration is a pure CREATE OR REPLACE of the one function. No
-- schema changes, no data changes.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_partner_template_from_group(
    p_group_id      uuid,
    p_template_name text,
    p_description   text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_group       public.endpoint_groups%ROWTYPE;
    v_owner       uuid;
    v_def         jsonb;
    v_wuf         jsonb;
    v_ring        jsonb;
    v_template_id uuid;
BEGIN
    SELECT * INTO v_group FROM public.endpoint_groups WHERE id = p_group_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'group_not_found'; END IF;

    -- Gate #1: the caller must be authorised against the SOURCE org so
    -- that they can legitimately read the policy rows we're about to
    -- snapshot. Without this the function could leak policy details to a
    -- caller who couldn't otherwise see them.
    IF NOT (
        public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), v_group.organization_id)
        OR public.is_partner_admin_of_org(auth.uid(), v_group.organization_id)
    ) THEN
        RAISE EXCEPTION 'forbidden_source';
    END IF;

    -- Templates are owned by the partner above the source org, or by the
    -- org itself when it has no parent (self-distributed direct customer
    -- or a partner shaping its own templates).
    SELECT COALESCE(parent_partner_id, id) INTO v_owner
        FROM public.organizations WHERE id = v_group.organization_id;

    -- Gate #2 (new): the caller must ALSO be authorised against the OWNER
    -- org. A customer-admin of a sub-org has rights to read their own
    -- policies (gate #1) but not to write into the parent partner's
    -- tenancy. Super-admins and partner-admins of the owner pass.
    IF NOT (
        public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), v_owner)
        OR public.is_partner_admin_of_org(auth.uid(), v_owner)
    ) THEN
        RAISE EXCEPTION 'forbidden_owner';
    END IF;

    -- Snapshot defender policy
    IF v_group.defender_policy_id IS NOT NULL THEN
        SELECT to_jsonb(d) INTO v_def FROM public.defender_policies d WHERE d.id = v_group.defender_policy_id;
        v_def := v_def - 'id' - 'organization_id' - 'is_default' - 'created_at' - 'updated_at';
    END IF;

    -- Snapshot Windows Update policy
    IF v_group.windows_update_policy_id IS NOT NULL THEN
        SELECT to_jsonb(w) INTO v_wuf FROM public.windows_update_policies w WHERE w.id = v_group.windows_update_policy_id;
        v_wuf := v_wuf - 'id' - 'organization_id' - 'created_at' - 'updated_at';
    END IF;

    -- Snapshot update ring if attached
    IF v_group.update_ring_id IS NOT NULL THEN
        SELECT to_jsonb(r) INTO v_ring FROM public.update_rings r WHERE r.id = v_group.update_ring_id;
        v_ring := v_ring - 'id' - 'organization_id' - 'is_default' - 'created_at' - 'updated_at';
    END IF;

    INSERT INTO public.partner_policy_templates
        (owner_org_id, name, description, defender_policy, windows_update_policy, update_ring, created_by)
    VALUES
        (v_owner, p_template_name, p_description, v_def, v_wuf, v_ring, auth.uid())
    RETURNING id INTO v_template_id;

    RETURN v_template_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_partner_template_from_group(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_partner_template_from_group(uuid, text, text) TO authenticated;

COMMIT;
