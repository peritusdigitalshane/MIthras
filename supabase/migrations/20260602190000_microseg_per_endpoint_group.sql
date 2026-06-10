-- PoC review rec #7 (and medium issue "microseg enforce creates group-level
-- rules"): the previous endpoint_microseg_enforce attached its rules to
-- whichever group the endpoint happened to be in (typically the org default).
-- Rules then applied to EVERY endpoint in that group -- not per-endpoint as
-- the dashboard implies.
--
-- Fix: each endpoint now gets its own private group, lazy-created on first
-- Enforce. Group name 'system:microseg:<endpoint_id>' is deterministic and
-- idempotent (re-Enforce just reuses it). The endpoint is the only member,
-- so rules created in this group affect only it.
--
-- The function also defends against the precondition the audit flagged:
-- if the org somehow has no firewall_policy (shouldn't happen after rec #3's
-- triggers, but belt-and-braces), it lazy-creates one.

CREATE OR REPLACE FUNCTION public.endpoint_microseg_enforce(
    p_endpoint_id uuid,
    p_direction   text DEFAULT 'inbound'
)
RETURNS public.endpoint_microseg_state
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_org_id        uuid;
    v_policy_id     uuid;
    v_group_id      uuid;
    v_observed_from timestamptz;
    v_row           public.endpoint_microseg_state;
    v_group_name    text;
BEGIN
    IF p_direction NOT IN ('inbound','outbound') THEN
        RAISE EXCEPTION 'invalid_direction' USING ERRCODE='invalid_parameter_value';
    END IF;
    SELECT organization_id INTO v_org_id FROM public.endpoints WHERE id = p_endpoint_id;
    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'endpoint_not_found' USING ERRCODE='no_data_found';
    END IF;
    IF NOT (public.is_admin_of_org(auth.uid(), v_org_id) OR public.is_super_admin(auth.uid())) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE='insufficient_privilege';
    END IF;

    SELECT observation_started_at INTO v_observed_from
      FROM public.endpoint_microseg_state
     WHERE endpoint_id = p_endpoint_id AND direction = p_direction;
    IF v_observed_from IS NULL THEN
        v_observed_from := now() - interval '7 days';
    END IF;

    -- Find (or lazy-create) the org's default firewall_policy.
    SELECT id INTO v_policy_id
      FROM public.firewall_policies
     WHERE organization_id = v_org_id
     ORDER BY is_default DESC NULLS LAST, created_at ASC
     LIMIT 1;
    IF v_policy_id IS NULL THEN
        INSERT INTO public.firewall_policies (organization_id, name, description, is_default)
        VALUES (v_org_id, 'Default firewall policy',
                'Auto-created on first microsegmentation enforce.', true)
        RETURNING id INTO v_policy_id;
    END IF;

    -- Find (or lazy-create) the per-endpoint microseg group. Deterministic name
    -- so re-Enforce reuses it. The endpoint is the sole member, so rules here
    -- never bleed onto siblings.
    v_group_name := 'system:microseg:' || p_endpoint_id::text;
    SELECT id INTO v_group_id
      FROM public.endpoint_groups
     WHERE organization_id = v_org_id
       AND name = v_group_name;
    IF v_group_id IS NULL THEN
        INSERT INTO public.endpoint_groups (organization_id, name, description)
        VALUES (v_org_id, v_group_name,
                'Per-endpoint microsegmentation rules. System-managed -- do not edit by hand.')
        RETURNING id INTO v_group_id;
    END IF;

    -- Ensure the endpoint is in its own microseg group.
    INSERT INTO public.endpoint_group_memberships (endpoint_id, group_id)
    VALUES (p_endpoint_id, v_group_id)
    ON CONFLICT (endpoint_id, group_id) DO NOTHING;

    INSERT INTO public.firewall_service_rules
          (service_name, port, protocol, action, mode, enabled,
           policy_id, endpoint_group_id, audit_started_at, direction)
    SELECT
        COALESCE(
          (array_agg(service_name ORDER BY event_time DESC) FILTER (WHERE service_name IS NOT NULL))[1],
          CASE WHEN p_direction = 'outbound' THEN 'Out-Port-' ELSE 'Port-' END || local_port::text
        ),
        local_port::text,
        lower(coalesce(protocol, 'tcp')),
        'block',
        'enforce',
        true,
        v_policy_id,
        v_group_id,
        now(),
        p_direction
    FROM public.firewall_audit_logs
    WHERE endpoint_id = p_endpoint_id
      AND direction = p_direction
      AND event_time >= v_observed_from
    GROUP BY local_port, lower(coalesce(protocol, 'tcp'))
    ON CONFLICT DO NOTHING;

    -- Flip any pre-existing rules in this private group matching observed
    -- (port, protocol, direction) to enforce mode (idempotent re-Enforce).
    UPDATE public.firewall_service_rules fsr
       SET mode = 'enforce', enabled = true
      FROM (
        SELECT local_port, lower(coalesce(protocol,'tcp')) AS protocol
          FROM public.firewall_audit_logs
         WHERE endpoint_id = p_endpoint_id
           AND direction = p_direction
           AND event_time >= v_observed_from
         GROUP BY 1, 2
      ) o
     WHERE fsr.policy_id = v_policy_id
       AND fsr.endpoint_group_id = v_group_id
       AND fsr.direction = p_direction
       AND fsr.port::text = o.local_port::text
       AND lower(fsr.protocol) = o.protocol;

    INSERT INTO public.endpoint_microseg_state (endpoint_id, organization_id, direction, state, observation_started_at, enforce_started_at, updated_at)
    VALUES (p_endpoint_id, v_org_id, p_direction, 'enforcing', v_observed_from, now(), now())
    ON CONFLICT (endpoint_id, direction) DO UPDATE
       SET state              = 'enforcing',
           enforce_started_at = now(),
           updated_at         = now()
    RETURNING * INTO v_row;
    RETURN v_row;
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.endpoint_microseg_enforce(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.endpoint_microseg_enforce(uuid, text) IS
'Enforces microsegmentation for one endpoint+direction. Lazy-creates a private group system:microseg:<ep_id> so rules apply only to this endpoint, not the whole org default group. Closes PoC rec #7.';
