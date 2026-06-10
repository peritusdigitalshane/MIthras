-- Cut 2 — Incident management (detect → respond).
--
-- Every Severe/High threat detection becomes an incident with:
--   - SLA timer (Severe 1h, High 4h, Moderate 1d, Low 7d)
--   - Assignment to a Peritus operator
--   - Status lifecycle (open → triaging → in_progress → resolved | false_positive)
--   - Notes append-only for audit
--   - Customer-org scoped, RLS enforced
--
-- Trigger fires on every new endpoint_threats row of severity in (Severe, High)
-- with status = 'Active'. Quarantined / Cleaning / Resolved threats don't open
-- a new incident.

CREATE TABLE IF NOT EXISTS public.incidents (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    endpoint_id       uuid REFERENCES public.endpoints(id) ON DELETE SET NULL,
    threat_id         uuid REFERENCES public.endpoint_threats(id) ON DELETE SET NULL,

    kind              text NOT NULL CHECK (kind IN ('threat','posture_drift','agent_offline','vuln_critical','custom')),
    severity          text NOT NULL CHECK (severity IN ('Severe','High','Moderate','Low')),
    status            text NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open','triaging','in_progress','resolved','false_positive')),

    title             text NOT NULL,
    description       text,

    assignee_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    assigned_at       timestamptz,

    opened_at         timestamptz NOT NULL DEFAULT now(),
    sla_due_at        timestamptz NOT NULL,
    triaged_at        timestamptz,
    resolved_at       timestamptz,
    resolved_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    resolution_notes  text,

    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incidents_org_status ON public.incidents(organization_id, status, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_assignee ON public.incidents(assignee_id) WHERE status NOT IN ('resolved','false_positive');
CREATE INDEX IF NOT EXISTS idx_incidents_sla_breached ON public.incidents(sla_due_at) WHERE status NOT IN ('resolved','false_positive');
CREATE INDEX IF NOT EXISTS idx_incidents_endpoint ON public.incidents(endpoint_id);

-- updated_at touchup
CREATE OR REPLACE FUNCTION public.touch_incidents_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_incidents_touch ON public.incidents;
CREATE TRIGGER trg_incidents_touch BEFORE UPDATE ON public.incidents
FOR EACH ROW EXECUTE FUNCTION public.touch_incidents_updated_at();

-- Notes table — append-only audit log per incident.
CREATE TABLE IF NOT EXISTS public.incident_notes (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id  uuid NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
    author_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    body         text NOT NULL,
    visibility   text NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal','customer')),
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_incident_notes_incident ON public.incident_notes(incident_id, created_at DESC);

-- RLS.
ALTER TABLE public.incidents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incident_notes  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "incidents_select_org" ON public.incidents;
CREATE POLICY "incidents_select_org" ON public.incidents FOR SELECT TO authenticated
USING (
    public.is_super_admin(auth.uid())
    OR public.is_member_of_org(auth.uid(), organization_id)
);

DROP POLICY IF EXISTS "incidents_update_admins" ON public.incidents;
CREATE POLICY "incidents_update_admins" ON public.incidents FOR UPDATE TO authenticated
USING (
    public.is_super_admin(auth.uid())
    OR public.is_admin_of_org(auth.uid(), organization_id)
);

DROP POLICY IF EXISTS "incidents_insert_service" ON public.incidents;
CREATE POLICY "incidents_insert_service" ON public.incidents FOR INSERT TO service_role
WITH CHECK (true);

DROP POLICY IF EXISTS "incident_notes_select_org" ON public.incident_notes;
CREATE POLICY "incident_notes_select_org" ON public.incident_notes FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.incidents i
         WHERE i.id = incident_notes.incident_id
           AND (public.is_super_admin(auth.uid()) OR public.is_member_of_org(auth.uid(), i.organization_id))
    )
);

DROP POLICY IF EXISTS "incident_notes_insert_org" ON public.incident_notes;
CREATE POLICY "incident_notes_insert_org" ON public.incident_notes FOR INSERT TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.incidents i
         WHERE i.id = incident_notes.incident_id
           AND (public.is_super_admin(auth.uid()) OR public.is_admin_of_org(auth.uid(), i.organization_id))
    )
);

-- ---------------------------------------------------------------------------
-- Auto-open incidents on Severe/High threats.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.open_incident_from_threat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_org   uuid;
    v_sla   interval;
    v_now   timestamptz := now();
BEGIN
    IF NEW.severity NOT IN ('Severe','High')   THEN RETURN NEW; END IF;
    IF NEW.status   NOT IN ('Active','Cleaning') THEN RETURN NEW; END IF;

    SELECT e.organization_id INTO v_org
      FROM public.endpoints e
     WHERE e.id = NEW.endpoint_id;

    IF v_org IS NULL THEN RETURN NEW; END IF;

    v_sla := CASE NEW.severity
                 WHEN 'Severe'   THEN interval '1 hour'
                 WHEN 'High'     THEN interval '4 hours'
                 WHEN 'Moderate' THEN interval '1 day'
                 ELSE              interval '7 days'
             END;

    -- Don't open a second incident for the same (endpoint, threat_id) if one
    -- is already open / triaging / in_progress — dedupe via (endpoint_id,threat_id).
    IF EXISTS (
        SELECT 1 FROM public.incidents i
         WHERE i.endpoint_id = NEW.endpoint_id
           AND i.threat_id   = NEW.id
           AND i.status NOT IN ('resolved','false_positive')
    ) THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.incidents(
        organization_id, endpoint_id, threat_id, kind, severity,
        title, description, opened_at, sla_due_at
    )
    VALUES (
        v_org, NEW.endpoint_id, NEW.id, 'threat', NEW.severity,
        format('%s threat: %s', NEW.severity, NEW.threat_name),
        format('Detected on endpoint %s, category=%s, status=%s.', NEW.endpoint_id, COALESCE(NEW.category, '?'), NEW.status),
        v_now, v_now + v_sla
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_open_incident_from_threat ON public.endpoint_threats;
CREATE TRIGGER trg_open_incident_from_threat
AFTER INSERT ON public.endpoint_threats
FOR EACH ROW EXECUTE FUNCTION public.open_incident_from_threat();

-- ---------------------------------------------------------------------------
-- Convenience RPCs: assign + resolve.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_incident(p_incident_id uuid, p_assignee uuid)
RETURNS public.incidents
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_inc public.incidents;
BEGIN
    SELECT * INTO v_inc FROM public.incidents WHERE id = p_incident_id;
    IF v_inc.id IS NULL THEN RAISE EXCEPTION 'incident_not_found' USING ERRCODE='P0002'; END IF;
    IF NOT (public.is_super_admin(auth.uid()) OR public.is_admin_of_org(auth.uid(), v_inc.organization_id)) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
    END IF;
    UPDATE public.incidents
       SET assignee_id = p_assignee,
           assigned_at = now(),
           status      = CASE WHEN status = 'open' THEN 'triaging' ELSE status END,
           triaged_at  = COALESCE(triaged_at, now())
     WHERE id = p_incident_id
     RETURNING * INTO v_inc;
    RETURN v_inc;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_incident(
    p_incident_id uuid,
    p_outcome     text DEFAULT 'resolved',
    p_notes       text DEFAULT NULL
)
RETURNS public.incidents
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_inc public.incidents;
BEGIN
    IF p_outcome NOT IN ('resolved','false_positive') THEN
        RAISE EXCEPTION 'invalid_outcome' USING ERRCODE='22023';
    END IF;
    SELECT * INTO v_inc FROM public.incidents WHERE id = p_incident_id;
    IF v_inc.id IS NULL THEN RAISE EXCEPTION 'incident_not_found' USING ERRCODE='P0002'; END IF;
    IF NOT (public.is_super_admin(auth.uid()) OR public.is_admin_of_org(auth.uid(), v_inc.organization_id)) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
    END IF;

    UPDATE public.incidents
       SET status            = p_outcome,
           resolved_at       = now(),
           resolved_by       = auth.uid(),
           resolution_notes  = COALESCE(p_notes, resolution_notes)
     WHERE id = p_incident_id
     RETURNING * INTO v_inc;

    IF p_notes IS NOT NULL AND BTRIM(p_notes) <> '' THEN
        INSERT INTO public.incident_notes(incident_id, author_id, body, visibility)
        VALUES (p_incident_id, auth.uid(), p_notes, 'internal');
    END IF;

    RETURN v_inc;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_incident(uuid, uuid)       FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_incident(uuid, uuid)   TO authenticated;
REVOKE ALL ON FUNCTION public.resolve_incident(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_incident(uuid, text, text) TO authenticated;
