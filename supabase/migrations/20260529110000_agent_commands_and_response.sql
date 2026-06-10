-- Phase 3 agent command channel + active response primitives.
--
-- Adds:
--   - public.agent_commands  : durable queue of commands the server wants the
--     agent to execute. Heartbeat handler returns up to N queued rows and the
--     agent posts results back which the server applies to the same row.
--   - response_playbooks     : declarative rules ("when a Severe threat lands,
--     isolate the endpoint and open an incident"). Pre-seeded with sensible
--     defaults.
--   - trigger on endpoint_threats that fires the playbook engine.
--   - persistence_snapshots  : agent-side enumeration of registry Run keys,
--     services, scheduled tasks. Diff-only telemetry.

-- ===========================================================================
-- 1. Agent command queue
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.agent_commands (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint_id       uuid NOT NULL REFERENCES public.endpoints(id) ON DELETE CASCADE,
    organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    command_type      text NOT NULL
                          CHECK (command_type IN (
                              'isolate_network',
                              'release_isolation',
                              'kill_process',
                              'quarantine_file',
                              'collect_persistence',
                              'run_quick_scan',
                              'run_full_scan',
                              'restart_agent'
                          )),
    params            jsonb NOT NULL DEFAULT '{}'::jsonb,
    status            text NOT NULL DEFAULT 'queued'
                          CHECK (status IN ('queued','dispatched','succeeded','failed','expired','cancelled')),
    issued_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    issued_at         timestamptz NOT NULL DEFAULT now(),
    dispatched_at     timestamptz,
    completed_at      timestamptz,
    expires_at        timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
    result            jsonb,
    error_message     text,
    correlation_id    text,
    incident_id       uuid REFERENCES public.incidents(id) ON DELETE SET NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_commands_endpoint_queue
    ON public.agent_commands(endpoint_id, status, issued_at)
    WHERE status IN ('queued','dispatched');
CREATE INDEX IF NOT EXISTS idx_agent_commands_org   ON public.agent_commands(organization_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_commands_incident ON public.agent_commands(incident_id) WHERE incident_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.touch_agent_commands_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_agent_commands_touch ON public.agent_commands;
CREATE TRIGGER trg_agent_commands_touch BEFORE UPDATE ON public.agent_commands
FOR EACH ROW EXECUTE FUNCTION public.touch_agent_commands_updated_at();

ALTER TABLE public.agent_commands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_commands_select_org" ON public.agent_commands;
CREATE POLICY "agent_commands_select_org" ON public.agent_commands FOR SELECT TO authenticated
USING (public.is_super_admin(auth.uid()) OR public.is_member_of_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "agent_commands_insert_admin" ON public.agent_commands;
CREATE POLICY "agent_commands_insert_admin" ON public.agent_commands FOR INSERT TO authenticated
WITH CHECK (
    public.is_super_admin(auth.uid())
    OR public.is_admin_of_org(auth.uid(), organization_id)
);

DROP POLICY IF EXISTS "agent_commands_service" ON public.agent_commands;
CREATE POLICY "agent_commands_service" ON public.agent_commands FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- enqueue helper — called from UI hooks. Caller proves authority via RLS WITH CHECK.
CREATE OR REPLACE FUNCTION public.enqueue_agent_command(
    p_endpoint_id uuid,
    p_command_type text,
    p_params jsonb DEFAULT '{}'::jsonb,
    p_incident_id uuid DEFAULT NULL
)
RETURNS public.agent_commands
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_org uuid;
    v_row public.agent_commands;
BEGIN
    SELECT organization_id INTO v_org FROM public.endpoints WHERE id = p_endpoint_id;
    IF v_org IS NULL THEN
        RAISE EXCEPTION 'endpoint_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF NOT (public.is_super_admin(auth.uid()) OR public.is_admin_of_org(auth.uid(), v_org)) THEN
        RAISE EXCEPTION 'forbidden_admin_only' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.agent_commands(
        endpoint_id, organization_id, command_type, params,
        issued_by, incident_id
    ) VALUES (
        p_endpoint_id, v_org, p_command_type, COALESCE(p_params, '{}'::jsonb),
        auth.uid(), p_incident_id
    )
    RETURNING * INTO v_row;
    RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_agent_command(uuid, text, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_agent_command(uuid, text, jsonb, uuid) TO authenticated;

-- ===========================================================================
-- 2. Response playbooks: declarative rules that fire commands on event triggers
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.response_playbooks (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
    name              text NOT NULL,
    description       text,
    trigger_kind      text NOT NULL CHECK (trigger_kind IN ('threat','posture_drift','custom')),
    -- Filter against the trigger event. Empty fields = match-all.
    min_severity      text CHECK (min_severity IN ('Severe','High','Moderate','Low')),
    threat_name_like  text,
    -- Actions: ordered list of {command_type, params} the engine enqueues.
    actions           jsonb NOT NULL DEFAULT '[]'::jsonb,
    is_enabled        boolean NOT NULL DEFAULT true,
    created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_response_playbooks_org_enabled ON public.response_playbooks(organization_id, is_enabled);

CREATE OR REPLACE FUNCTION public.touch_response_playbooks_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_response_playbooks_touch ON public.response_playbooks;
CREATE TRIGGER trg_response_playbooks_touch BEFORE UPDATE ON public.response_playbooks
FOR EACH ROW EXECUTE FUNCTION public.touch_response_playbooks_updated_at();

ALTER TABLE public.response_playbooks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "response_playbooks_select" ON public.response_playbooks;
CREATE POLICY "response_playbooks_select" ON public.response_playbooks FOR SELECT TO authenticated
USING (
    public.is_super_admin(auth.uid())
    OR organization_id IS NULL
    OR public.is_member_of_org(auth.uid(), organization_id)
);

DROP POLICY IF EXISTS "response_playbooks_admin" ON public.response_playbooks;
CREATE POLICY "response_playbooks_admin" ON public.response_playbooks FOR ALL TO authenticated
USING (
    public.is_super_admin(auth.uid())
    OR (organization_id IS NOT NULL AND public.is_admin_of_org(auth.uid(), organization_id))
)
WITH CHECK (
    public.is_super_admin(auth.uid())
    OR (organization_id IS NOT NULL AND public.is_admin_of_org(auth.uid(), organization_id))
);

-- Seed two platform-wide defaults that fire on Severe / High threats.
-- These are GLOBAL (organization_id=NULL) and apply to every customer unless
-- they create org-specific overrides.
INSERT INTO public.response_playbooks (organization_id, name, description, trigger_kind, min_severity, actions, is_enabled)
SELECT NULL, 'Auto-isolate on Severe threat',
       'When Defender flags a Severe threat as Active, isolate the endpoint and open an incident. The endpoint can still reach the platform API.',
       'threat', 'Severe',
       jsonb_build_array(jsonb_build_object('command_type','isolate_network','params','{}'::jsonb)),
       true
 WHERE NOT EXISTS (SELECT 1 FROM public.response_playbooks WHERE name = 'Auto-isolate on Severe threat' AND organization_id IS NULL);

INSERT INTO public.response_playbooks (organization_id, name, description, trigger_kind, min_severity, actions, is_enabled)
SELECT NULL, 'Quick scan on High threat',
       'When Defender flags a High threat as Active, kick off a quick scan.',
       'threat', 'High',
       jsonb_build_array(jsonb_build_object('command_type','run_quick_scan','params','{}'::jsonb)),
       true
 WHERE NOT EXISTS (SELECT 1 FROM public.response_playbooks WHERE name = 'Quick scan on High threat' AND organization_id IS NULL);

-- Playbook engine: fires on every endpoint_threats insert and matches against
-- the relevant rows in response_playbooks.
CREATE OR REPLACE FUNCTION public.run_threat_playbooks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_org      uuid;
    v_pb       record;
    v_action   jsonb;
    v_incident uuid;
    v_sev_rank int;
    v_min_rank int;
BEGIN
    IF NEW.status NOT IN ('Active','Cleaning') THEN RETURN NEW; END IF;

    SELECT organization_id INTO v_org FROM public.endpoints WHERE id = NEW.endpoint_id;
    IF v_org IS NULL THEN RETURN NEW; END IF;

    -- Map severity to rank for the >= comparison.
    v_sev_rank := CASE NEW.severity WHEN 'Severe' THEN 4 WHEN 'High' THEN 3 WHEN 'Moderate' THEN 2 WHEN 'Low' THEN 1 ELSE 0 END;

    -- Look up the related incident (the open_incident_from_threat trigger
    -- has already opened one for Severe/High).
    SELECT id INTO v_incident
      FROM public.incidents
     WHERE endpoint_id = NEW.endpoint_id AND threat_id = NEW.id
     ORDER BY opened_at DESC LIMIT 1;

    FOR v_pb IN
        SELECT *
          FROM public.response_playbooks
         WHERE is_enabled = true
           AND trigger_kind = 'threat'
           AND (organization_id IS NULL OR organization_id = v_org)
           AND (threat_name_like IS NULL OR NEW.threat_name ILIKE threat_name_like)
    LOOP
        v_min_rank := CASE v_pb.min_severity WHEN 'Severe' THEN 4 WHEN 'High' THEN 3 WHEN 'Moderate' THEN 2 WHEN 'Low' THEN 1 ELSE 0 END;
        IF v_min_rank > v_sev_rank THEN CONTINUE; END IF;

        FOR v_action IN SELECT * FROM jsonb_array_elements(v_pb.actions)
        LOOP
            BEGIN
                INSERT INTO public.agent_commands(
                    endpoint_id, organization_id, command_type, params,
                    incident_id, correlation_id
                ) VALUES (
                    NEW.endpoint_id, v_org,
                    (v_action->>'command_type')::text,
                    COALESCE(v_action->'params', '{}'::jsonb),
                    v_incident,
                    'playbook:' || v_pb.id::text
                );
            EXCEPTION WHEN OTHERS THEN
                -- Don't let one malformed action block the threat insert.
                NULL;
            END;
        END LOOP;
    END LOOP;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_run_threat_playbooks ON public.endpoint_threats;
CREATE TRIGGER trg_run_threat_playbooks
AFTER INSERT ON public.endpoint_threats
FOR EACH ROW EXECUTE FUNCTION public.run_threat_playbooks();

-- ===========================================================================
-- 3. Endpoint persistence snapshots
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.endpoint_persistence_snapshots (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint_id       uuid NOT NULL REFERENCES public.endpoints(id) ON DELETE CASCADE,
    organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    -- Stable hash of the canonicalised snapshot so we only insert on change.
    snapshot_hash     text NOT NULL,
    -- Counts by kind for quick dashboards without parsing the blob.
    run_key_count     int NOT NULL DEFAULT 0,
    service_count     int NOT NULL DEFAULT 0,
    task_count        int NOT NULL DEFAULT 0,
    -- Detail blob: { run_keys:[...], services:[...], tasks:[...] }
    payload           jsonb NOT NULL,
    collected_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_persistence_endpoint_collected ON public.endpoint_persistence_snapshots(endpoint_id, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_persistence_org_collected     ON public.endpoint_persistence_snapshots(organization_id, collected_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_persistence_endpoint_hash ON public.endpoint_persistence_snapshots(endpoint_id, snapshot_hash);

ALTER TABLE public.endpoint_persistence_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "persistence_select_org" ON public.endpoint_persistence_snapshots;
CREATE POLICY "persistence_select_org" ON public.endpoint_persistence_snapshots FOR SELECT TO authenticated
USING (public.is_super_admin(auth.uid()) OR public.is_member_of_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "persistence_insert_service" ON public.endpoint_persistence_snapshots;
CREATE POLICY "persistence_insert_service" ON public.endpoint_persistence_snapshots FOR INSERT TO service_role WITH CHECK (true);
