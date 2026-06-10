-- Per-endpoint microsegmentation state. Replaces the group-of-rules mental
-- model with a simpler one: each endpoint is in one of three states.
--
--   idle       -- not observing, not enforcing. Traffic still hits the
--                  firewall but no rules are auto-managed for this endpoint.
--   learning   -- observing inbound traffic since observation_started_at.
--                  Dashboard shows hits accumulating; agent ships every
--                  matched + unmatched inbound packet.
--   enforcing  -- the operator clicked Enforce. Rules have been auto-created
--                  for every (port, protocol) seen during the learning window.
--                  Anything not in that set should be blocked at the agent.
--
-- The actual rule rows still live in firewall_service_rules; this table is
-- just the per-endpoint state machine on top.

CREATE TABLE IF NOT EXISTS public.endpoint_microseg_state (
    endpoint_id            uuid PRIMARY KEY REFERENCES public.endpoints(id) ON DELETE CASCADE,
    organization_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    state                  text NOT NULL DEFAULT 'idle',
    observation_started_at timestamptz,
    enforce_started_at     timestamptz,
    updated_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT endpoint_microseg_valid_state CHECK (state IN ('idle','learning','enforcing'))
);

CREATE INDEX IF NOT EXISTS idx_endpoint_microseg_state_org
    ON public.endpoint_microseg_state(organization_id);

ALTER TABLE public.endpoint_microseg_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read microseg state in own org" ON public.endpoint_microseg_state;
CREATE POLICY "Read microseg state in own org"
    ON public.endpoint_microseg_state FOR SELECT
    USING (
      public.is_member_of_org(auth.uid(), organization_id)
      OR public.is_super_admin(auth.uid())
    );

DROP POLICY IF EXISTS "Modify microseg state needs admin" ON public.endpoint_microseg_state;
CREATE POLICY "Modify microseg state needs admin"
    ON public.endpoint_microseg_state FOR ALL
    USING (
      public.is_admin_of_org(auth.uid(), organization_id)
      OR public.is_super_admin(auth.uid())
    )
    WITH CHECK (
      public.is_admin_of_org(auth.uid(), organization_id)
      OR public.is_super_admin(auth.uid())
    );

-- ---------------------------------------------------------------------------
-- State transition RPCs.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.endpoint_microseg_start_learning(p_endpoint_id uuid)
RETURNS public.endpoint_microseg_state
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_org_id uuid;
    v_row    public.endpoint_microseg_state;
BEGIN
    SELECT organization_id INTO v_org_id FROM public.endpoints WHERE id = p_endpoint_id;
    IF v_org_id IS NULL THEN RAISE EXCEPTION 'endpoint_not_found' USING ERRCODE='no_data_found'; END IF;
    IF NOT (public.is_admin_of_org(auth.uid(), v_org_id) OR public.is_super_admin(auth.uid())) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE='insufficient_privilege';
    END IF;

    INSERT INTO public.endpoint_microseg_state (endpoint_id, organization_id, state, observation_started_at, enforce_started_at, updated_at)
    VALUES (p_endpoint_id, v_org_id, 'learning', now(), NULL, now())
    ON CONFLICT (endpoint_id) DO UPDATE
       SET state                  = 'learning',
           observation_started_at = now(),
           enforce_started_at     = NULL,
           updated_at             = now()
    RETURNING * INTO v_row;
    RETURN v_row;
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.endpoint_microseg_start_learning(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.endpoint_microseg_stop(p_endpoint_id uuid)
RETURNS public.endpoint_microseg_state
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_org_id uuid;
    v_row    public.endpoint_microseg_state;
BEGIN
    SELECT organization_id INTO v_org_id FROM public.endpoints WHERE id = p_endpoint_id;
    IF v_org_id IS NULL THEN RAISE EXCEPTION 'endpoint_not_found' USING ERRCODE='no_data_found'; END IF;
    IF NOT (public.is_admin_of_org(auth.uid(), v_org_id) OR public.is_super_admin(auth.uid())) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE='insufficient_privilege';
    END IF;

    INSERT INTO public.endpoint_microseg_state (endpoint_id, organization_id, state, observation_started_at, enforce_started_at, updated_at)
    VALUES (p_endpoint_id, v_org_id, 'idle', NULL, NULL, now())
    ON CONFLICT (endpoint_id) DO UPDATE
       SET state                  = 'idle',
           observation_started_at = NULL,
           enforce_started_at     = NULL,
           updated_at             = now()
    RETURNING * INTO v_row;
    RETURN v_row;
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.endpoint_microseg_stop(uuid) TO authenticated;

-- Enforce -- snapshot every (port, protocol) observed since observation_started_at,
-- create / update firewall_service_rules for each in audit→enforce mode,
-- mark state=enforcing. The agent's Apply-FirewallPolicy already installs
-- block-mode rules into Windows Firewall on next policy pass.
CREATE OR REPLACE FUNCTION public.endpoint_microseg_enforce(p_endpoint_id uuid)
RETURNS public.endpoint_microseg_state
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_org_id        uuid;
    v_policy_id     uuid;
    v_group_id      uuid;
    v_observed_from timestamptz;
    v_row           public.endpoint_microseg_state;
    v_created       int := 0;
BEGIN
    SELECT organization_id INTO v_org_id FROM public.endpoints WHERE id = p_endpoint_id;
    IF v_org_id IS NULL THEN RAISE EXCEPTION 'endpoint_not_found' USING ERRCODE='no_data_found'; END IF;
    IF NOT (public.is_admin_of_org(auth.uid(), v_org_id) OR public.is_super_admin(auth.uid())) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE='insufficient_privilege';
    END IF;

    -- Pick the observation window. Falls back to last 7 days if the operator
    -- hits Enforce without a prior Start Learning.
    SELECT observation_started_at INTO v_observed_from
      FROM public.endpoint_microseg_state WHERE endpoint_id = p_endpoint_id;
    IF v_observed_from IS NULL THEN
        v_observed_from := now() - interval '7 days';
    END IF;

    -- Endpoint must belong to at least one group attached to a firewall policy.
    -- We use that group's default policy as the target. (For a "true
    -- per-endpoint rule set", create a dedicated group per endpoint.)
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

    -- Build / upsert one rule per observed (port, protocol). Match on the
    -- natural identity: same policy + group + port + protocol = same rule.
    WITH observed AS (
      SELECT
        local_port,
        lower(coalesce(protocol, 'tcp')) AS protocol,
        max(coalesce(service_name, 'Port-' || local_port::text)) AS service_name
      FROM public.firewall_audit_logs
      WHERE endpoint_id = p_endpoint_id
        AND direction = 'inbound'
        AND event_time >= v_observed_from
      GROUP BY 1, 2
    ),
    upserted AS (
      INSERT INTO public.firewall_service_rules
            (service_name, port, protocol, action, mode, enabled,
             policy_id, endpoint_group_id, audit_started_at)
      SELECT o.service_name,
             o.local_port::text,
             o.protocol,
             'block',
             'enforce',
             true,
             v_policy_id,
             v_group_id,
             now()
      FROM observed o
      ON CONFLICT DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO v_created FROM upserted;

    -- Flip every existing rule on this policy + group whose (port, protocol)
    -- matches an observed value to enforce mode too (in case the user had
    -- pre-built audit rules they wanted enforced).
    UPDATE public.firewall_service_rules fsr
       SET mode = 'enforce', enabled = true
      FROM (
        SELECT local_port, lower(coalesce(protocol,'tcp')) AS protocol
          FROM public.firewall_audit_logs
         WHERE endpoint_id = p_endpoint_id
           AND direction = 'inbound'
           AND event_time >= v_observed_from
         GROUP BY 1, 2
      ) o
     WHERE fsr.policy_id = v_policy_id
       AND fsr.endpoint_group_id = v_group_id
       AND fsr.port::text = o.local_port::text
       AND lower(fsr.protocol) = o.protocol;

    INSERT INTO public.endpoint_microseg_state (endpoint_id, organization_id, state, observation_started_at, enforce_started_at, updated_at)
    VALUES (p_endpoint_id, v_org_id, 'enforcing', v_observed_from, now(), now())
    ON CONFLICT (endpoint_id) DO UPDATE
       SET state              = 'enforcing',
           enforce_started_at = now(),
           updated_at         = now()
    RETURNING * INTO v_row;
    RETURN v_row;
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.endpoint_microseg_enforce(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Query RPC: returns the endpoint's state + aggregated observed traffic.
-- The dashboard renders only this.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_endpoint_microseg(uuid);

CREATE FUNCTION public.get_endpoint_microseg(p_endpoint_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_org_id        uuid;
    v_state_row     public.endpoint_microseg_state;
    v_observed_from timestamptz;
    v_traffic       jsonb;
BEGIN
    SELECT organization_id INTO v_org_id FROM public.endpoints WHERE id = p_endpoint_id;
    IF v_org_id IS NULL THEN RETURN NULL; END IF;
    IF NOT (public.is_member_of_org(auth.uid(), v_org_id) OR public.is_super_admin(auth.uid())) THEN
        RETURN NULL;
    END IF;

    SELECT * INTO v_state_row FROM public.endpoint_microseg_state WHERE endpoint_id = p_endpoint_id;

    -- When idle (no observation window set), show last 7 days as the default
    -- view so the operator sees something useful before clicking Start Learning.
    v_observed_from := COALESCE(v_state_row.observation_started_at, now() - interval '7 days');

    -- Two-step build: first the per-port aggregates, then attach top sources.
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
                         AND ls.direction = 'inbound'
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
          AND l.direction = 'inbound'
          AND l.event_time >= v_observed_from
        GROUP BY 1, 2
      ) a;

    RETURN jsonb_build_object(
      'endpoint_id',            p_endpoint_id,
      'state',                  COALESCE(v_state_row.state, 'idle'),
      'observation_started_at', v_state_row.observation_started_at,
      'enforce_started_at',     v_state_row.enforce_started_at,
      'traffic',                COALESCE(v_traffic, '[]'::jsonb)
    );
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.get_endpoint_microseg(uuid) TO authenticated;
