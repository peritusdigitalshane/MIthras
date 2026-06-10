-- Split microseg state by direction. Each endpoint now has TWO independent
-- state machines: one for inbound rules, one for outbound. Operators can
-- learn + enforce them separately.

-- 1. Add direction to firewall_service_rules so the agent knows which way to
--    install the Windows Firewall rule. Existing rules backfill to 'inbound'.
ALTER TABLE public.firewall_service_rules
    ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'inbound';

ALTER TABLE public.firewall_service_rules
    DROP CONSTRAINT IF EXISTS valid_direction_fsr;
ALTER TABLE public.firewall_service_rules
    ADD CONSTRAINT valid_direction_fsr CHECK (direction IN ('inbound','outbound'));

-- 2. endpoint_microseg_state -- one row per (endpoint, direction).
ALTER TABLE public.endpoint_microseg_state
    ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'inbound';

ALTER TABLE public.endpoint_microseg_state
    DROP CONSTRAINT IF EXISTS endpoint_microseg_valid_direction;
ALTER TABLE public.endpoint_microseg_state
    ADD CONSTRAINT endpoint_microseg_valid_direction CHECK (direction IN ('inbound','outbound'));

-- Change PK to (endpoint_id, direction). Existing rows keep direction='inbound'.
ALTER TABLE public.endpoint_microseg_state
    DROP CONSTRAINT IF EXISTS endpoint_microseg_state_pkey;
ALTER TABLE public.endpoint_microseg_state
    ADD CONSTRAINT endpoint_microseg_state_pkey PRIMARY KEY (endpoint_id, direction);

-- ---------------------------------------------------------------------------
-- Rebuild the RPCs to take a direction param.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.endpoint_microseg_start_learning(uuid);
DROP FUNCTION IF EXISTS public.endpoint_microseg_stop(uuid);
DROP FUNCTION IF EXISTS public.endpoint_microseg_enforce(uuid);
DROP FUNCTION IF EXISTS public.get_endpoint_microseg(uuid);

CREATE OR REPLACE FUNCTION public.endpoint_microseg_start_learning(p_endpoint_id uuid, p_direction text DEFAULT 'inbound')
RETURNS public.endpoint_microseg_state
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_org_id uuid;
    v_row    public.endpoint_microseg_state;
BEGIN
    IF p_direction NOT IN ('inbound','outbound') THEN
        RAISE EXCEPTION 'invalid_direction' USING ERRCODE='invalid_parameter_value';
    END IF;
    SELECT organization_id INTO v_org_id FROM public.endpoints WHERE id = p_endpoint_id;
    IF v_org_id IS NULL THEN RAISE EXCEPTION 'endpoint_not_found' USING ERRCODE='no_data_found'; END IF;
    IF NOT (public.is_admin_of_org(auth.uid(), v_org_id) OR public.is_super_admin(auth.uid())) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE='insufficient_privilege';
    END IF;

    INSERT INTO public.endpoint_microseg_state (endpoint_id, organization_id, direction, state, observation_started_at, enforce_started_at, updated_at)
    VALUES (p_endpoint_id, v_org_id, p_direction, 'learning', now(), NULL, now())
    ON CONFLICT (endpoint_id, direction) DO UPDATE
       SET state                  = 'learning',
           observation_started_at = now(),
           enforce_started_at     = NULL,
           updated_at             = now()
    RETURNING * INTO v_row;
    RETURN v_row;
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.endpoint_microseg_start_learning(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.endpoint_microseg_stop(p_endpoint_id uuid, p_direction text DEFAULT 'inbound')
RETURNS public.endpoint_microseg_state
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_org_id uuid;
    v_row    public.endpoint_microseg_state;
BEGIN
    IF p_direction NOT IN ('inbound','outbound') THEN
        RAISE EXCEPTION 'invalid_direction' USING ERRCODE='invalid_parameter_value';
    END IF;
    SELECT organization_id INTO v_org_id FROM public.endpoints WHERE id = p_endpoint_id;
    IF v_org_id IS NULL THEN RAISE EXCEPTION 'endpoint_not_found' USING ERRCODE='no_data_found'; END IF;
    IF NOT (public.is_admin_of_org(auth.uid(), v_org_id) OR public.is_super_admin(auth.uid())) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE='insufficient_privilege';
    END IF;

    INSERT INTO public.endpoint_microseg_state (endpoint_id, organization_id, direction, state, observation_started_at, enforce_started_at, updated_at)
    VALUES (p_endpoint_id, v_org_id, p_direction, 'idle', NULL, NULL, now())
    ON CONFLICT (endpoint_id, direction) DO UPDATE
       SET state                  = 'idle',
           observation_started_at = NULL,
           enforce_started_at     = NULL,
           updated_at             = now()
    RETURNING * INTO v_row;
    RETURN v_row;
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.endpoint_microseg_stop(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.endpoint_microseg_enforce(p_endpoint_id uuid, p_direction text DEFAULT 'inbound')
RETURNS public.endpoint_microseg_state
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_org_id        uuid;
    v_policy_id     uuid;
    v_group_id      uuid;
    v_observed_from timestamptz;
    v_row           public.endpoint_microseg_state;
BEGIN
    IF p_direction NOT IN ('inbound','outbound') THEN
        RAISE EXCEPTION 'invalid_direction' USING ERRCODE='invalid_parameter_value';
    END IF;
    SELECT organization_id INTO v_org_id FROM public.endpoints WHERE id = p_endpoint_id;
    IF v_org_id IS NULL THEN RAISE EXCEPTION 'endpoint_not_found' USING ERRCODE='no_data_found'; END IF;
    IF NOT (public.is_admin_of_org(auth.uid(), v_org_id) OR public.is_super_admin(auth.uid())) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE='insufficient_privilege';
    END IF;

    SELECT observation_started_at INTO v_observed_from
      FROM public.endpoint_microseg_state
     WHERE endpoint_id = p_endpoint_id AND direction = p_direction;
    IF v_observed_from IS NULL THEN
        v_observed_from := now() - interval '7 days';
    END IF;

    SELECT fp.id, eg.id
      INTO v_policy_id, v_group_id
      FROM public.endpoint_group_memberships egm
      JOIN public.endpoint_groups eg ON eg.id = egm.group_id
      JOIN public.firewall_policies fp ON fp.organization_id = eg.organization_id
     WHERE egm.endpoint_id = p_endpoint_id
       AND eg.organization_id = v_org_id
     ORDER BY fp.is_default DESC NULLS LAST, fp.created_at ASC
     LIMIT 1;
    IF v_policy_id IS NULL THEN
        RAISE EXCEPTION 'endpoint_has_no_group_with_firewall_policy'
            USING ERRCODE='restrict_violation',
            DETAIL='Add the endpoint to a group that has a firewall policy first.';
    END IF;

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

    -- Flip any pre-existing rules matching the observed (port, protocol, direction)
    -- to enforce mode too.
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

CREATE OR REPLACE FUNCTION public.get_endpoint_microseg(p_endpoint_id uuid, p_direction text DEFAULT 'inbound')
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_org_id        uuid;
    v_state_row     public.endpoint_microseg_state;
    v_observed_from timestamptz;
    v_traffic       jsonb;
BEGIN
    IF p_direction NOT IN ('inbound','outbound') THEN RETURN NULL; END IF;
    SELECT organization_id INTO v_org_id FROM public.endpoints WHERE id = p_endpoint_id;
    IF v_org_id IS NULL THEN RETURN NULL; END IF;
    IF NOT (public.is_member_of_org(auth.uid(), v_org_id) OR public.is_super_admin(auth.uid())) THEN
        RETURN NULL;
    END IF;

    SELECT * INTO v_state_row
      FROM public.endpoint_microseg_state
     WHERE endpoint_id = p_endpoint_id AND direction = p_direction;

    v_observed_from := COALESCE(v_state_row.observation_started_at, now() - interval '7 days');

    SELECT COALESCE(jsonb_agg(
              jsonb_build_object(
                'local_port',     a.local_port,
                'protocol',       a.protocol,
                'service_name',   a.service_name,
                'hits_24h',       a.hits_24h,
                'hits_7d',        a.hits_7d,
                'unique_sources', a.unique_sources,
                'last_seen',      a.last_seen,
                'top_sources', (
                  SELECT COALESCE(jsonb_agg(jsonb_build_object('ip', s.remote_address, 'count', s.cnt) ORDER BY s.cnt DESC), '[]'::jsonb)
                    FROM (
                      SELECT remote_address, COUNT(*) AS cnt
                        FROM public.firewall_audit_logs ls
                       WHERE ls.endpoint_id = p_endpoint_id
                         AND ls.direction = p_direction
                         AND ls.local_port = a.local_port
                         AND lower(coalesce(ls.protocol,'tcp')) = a.protocol
                         AND ls.event_time >= v_observed_from
                       GROUP BY remote_address
                       ORDER BY COUNT(*) DESC
                       LIMIT 5
                    ) s
                )
              )
              ORDER BY a.hits_7d DESC, a.last_seen DESC NULLS LAST
           ), '[]'::jsonb)
      INTO v_traffic
      FROM (
        SELECT
          local_port,
          lower(coalesce(protocol, 'tcp'))                                  AS protocol,
          (array_agg(service_name ORDER BY event_time DESC) FILTER (WHERE service_name IS NOT NULL))[1] AS service_name,
          COUNT(*) FILTER (WHERE event_time >= now() - interval '24 hours') AS hits_24h,
          COUNT(*)                                                          AS hits_7d,
          COUNT(DISTINCT remote_address)                                    AS unique_sources,
          MAX(event_time)                                                   AS last_seen
        FROM public.firewall_audit_logs l
        WHERE l.endpoint_id = p_endpoint_id
          AND l.direction = p_direction
          AND l.event_time >= v_observed_from
        GROUP BY 1, 2
      ) a;

    RETURN jsonb_build_object(
      'endpoint_id',            p_endpoint_id,
      'direction',              p_direction,
      'state',                  COALESCE(v_state_row.state, 'idle'),
      'observation_started_at', v_state_row.observation_started_at,
      'enforce_started_at',     v_state_row.enforce_started_at,
      'traffic',                COALESCE(v_traffic, '[]'::jsonb)
    );
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.get_endpoint_microseg(uuid, text) TO authenticated;
