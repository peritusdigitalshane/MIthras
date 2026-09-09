-- 20260614030000_siem_forwarder_and_event_ingest.sql
--
-- SIEM forwarder + generic event ingest. Two halves, one event bus.
--
-- Outbound (forwarder):
--   siem_destinations         per-customer destinations (webhook / syslog /
--                             splunk_hec / sentinel_la / elastic_http)
--   event_outbox              every row that needs delivering, plus the
--                             attempt counter and last error
--   event_outbox_status enum  pending | sent | failed_permanent
--
-- Inbound (ingest):
--   external_events           events delivered by /functions/v1/event-ingest
--                             from non-agent sources (firewalls, Linux
--                             hosts, custom apps)
--
-- Triggers populate event_outbox from the canonical tables (endpoint_threats,
-- alerts, incidents). The siem-forwarder edge function drains the outbox on
-- a 30s cron.
--
-- Note: we do NOT trigger from firewall_audit_logs by default — too noisy,
-- and customers can opt their firewall traffic into a destination via a
-- filter clause if they really want it.

BEGIN;

-- ============================================================
-- siem_destinations
-- ============================================================
DO $$ BEGIN
    CREATE TYPE public.siem_destination_kind AS ENUM (
        'webhook',
        'syslog_https',
        'splunk_hec',
        'sentinel_la',
        'elastic_http'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE public.siem_event_format AS ENUM ('json', 'cef', 'leef');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.siem_destinations (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name                text NOT NULL,
    kind                public.siem_destination_kind NOT NULL,
    format              public.siem_event_format     NOT NULL DEFAULT 'json',
    endpoint_url        text NOT NULL,
    -- Bearer token / shared secret / HEC token / workspace key etc. Stored
    -- in plain text inside the row but the row itself is gated by RLS to
    -- admins of the org and never returned in API responses without scope.
    auth_token          text,
    -- For Sentinel: the workspace ID (the secondary identifier alongside
    -- the workspace key in auth_token).
    extra               jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- What this destination wants. ARRAY of event categories the trigger
    -- writes into event_outbox: 'threat','alert','incident','firewall'.
    -- Default to threat + alert + incident (the high-signal categories).
    event_categories    text[] NOT NULL DEFAULT ARRAY['threat','alert','incident']::text[],
    enabled             boolean NOT NULL DEFAULT true,
    -- Operational state filled by the forwarder
    last_success_at     timestamptz,
    last_failure_at     timestamptz,
    last_failure_reason text,
    created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_siem_destinations_org ON public.siem_destinations(organization_id);
CREATE INDEX IF NOT EXISTS idx_siem_destinations_enabled ON public.siem_destinations(organization_id, enabled) WHERE enabled;

DROP TRIGGER IF EXISTS update_siem_destinations_updated_at ON public.siem_destinations;
CREATE TRIGGER update_siem_destinations_updated_at
    BEFORE UPDATE ON public.siem_destinations
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.siem_destinations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS siem_destinations_read ON public.siem_destinations;
CREATE POLICY siem_destinations_read ON public.siem_destinations FOR SELECT
    USING (
        public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), organization_id)
        OR public.is_partner_admin_of_org(auth.uid(), organization_id)
    );

DROP POLICY IF EXISTS siem_destinations_write ON public.siem_destinations;
CREATE POLICY siem_destinations_write ON public.siem_destinations FOR ALL
    USING (
        public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), organization_id)
        OR public.is_partner_admin_of_org(auth.uid(), organization_id)
    )
    WITH CHECK (
        public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), organization_id)
        OR public.is_partner_admin_of_org(auth.uid(), organization_id)
    );


-- ============================================================
-- event_outbox
-- ============================================================
DO $$ BEGIN
    CREATE TYPE public.event_outbox_status AS ENUM ('pending', 'sent', 'failed_permanent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.event_outbox (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    destination_id  uuid NOT NULL REFERENCES public.siem_destinations(id) ON DELETE CASCADE,
    category        text NOT NULL,                  -- threat | alert | incident | firewall | external
    source_table    text NOT NULL,                  -- canonical table name the payload was derived from
    source_id       uuid,                           -- id in that table (NULL for derived events)
    severity        text,                           -- best-effort severity copied from source
    payload         jsonb NOT NULL,                 -- normalised event payload (format-agnostic)
    status          public.event_outbox_status NOT NULL DEFAULT 'pending',
    attempts        int NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    last_error      text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    delivered_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_event_outbox_pending
    ON public.event_outbox(destination_id, next_attempt_at)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_event_outbox_org ON public.event_outbox(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_outbox_source ON public.event_outbox(source_table, source_id);

ALTER TABLE public.event_outbox ENABLE ROW LEVEL SECURITY;

-- Operators (super-admin + org admins + partner admins) can read the outbox
-- so the UI shows "last 50 events shipped / failed".
DROP POLICY IF EXISTS event_outbox_read ON public.event_outbox;
CREATE POLICY event_outbox_read ON public.event_outbox FOR SELECT
    USING (
        public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), organization_id)
        OR public.is_partner_admin_of_org(auth.uid(), organization_id)
    );

-- Writes are service_role-only. Triggers + the forwarder both run with
-- elevated privileges via SECURITY DEFINER / service-role client.
DROP POLICY IF EXISTS event_outbox_service_write ON public.event_outbox;
CREATE POLICY event_outbox_service_write ON public.event_outbox FOR ALL
    TO service_role
    USING (true) WITH CHECK (true);


-- ============================================================
-- external_events  (Phase 2 — generic ingest endpoint)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.external_events (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    -- Which non-agent source this came from.
    source_kind     text NOT NULL CHECK (source_kind IN (
        'firewall', 'router', 'linux_host', 'mac_host', 'custom_app',
        'cloud_workload', 'iot', 'other'
    )),
    -- Free-text identifier for the sender ('FortiGate-A','pfsense-1','prod-web-01').
    source_label    text,
    -- Best-effort severity normalised to 'low' | 'medium' | 'high' | 'critical'.
    severity        text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
    -- Wire format we accepted ('json','cef','leef','rfc5424').
    wire_format     text NOT NULL DEFAULT 'json',
    -- Vendor / product. CEF gives us these natively; for JSON we accept
    -- explicit fields and default to the source_kind.
    vendor          text,
    product         text,
    event_name      text,
    raw_message     text,
    parsed          jsonb NOT NULL DEFAULT '{}'::jsonb,
    event_time      timestamptz NOT NULL DEFAULT now(),
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_external_events_org_time
    ON public.external_events(organization_id, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_external_events_source
    ON public.external_events(organization_id, source_kind, source_label);

ALTER TABLE public.external_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS external_events_read ON public.external_events;
CREATE POLICY external_events_read ON public.external_events FOR SELECT
    USING (
        public.is_super_admin(auth.uid())
        OR public.is_member_of_org(auth.uid(), organization_id)
        OR public.is_partner_admin_of_org(auth.uid(), organization_id)
    );

DROP POLICY IF EXISTS external_events_service_write ON public.external_events;
CREATE POLICY external_events_service_write ON public.external_events FOR INSERT
    TO service_role WITH CHECK (true);


-- ============================================================
-- Trigger: every endpoint_threats insert fans out to every enabled
-- destination whose event_categories contains 'threat'.
-- ============================================================
CREATE OR REPLACE FUNCTION public.enqueue_event_for_destinations(
    p_org_id       uuid,
    p_category     text,
    p_source_table text,
    p_source_id    uuid,
    p_severity     text,
    p_payload      jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.event_outbox (organization_id, destination_id, category, source_table, source_id, severity, payload)
    SELECT p_org_id, d.id, p_category, p_source_table, p_source_id, p_severity, p_payload
    FROM public.siem_destinations d
    WHERE d.organization_id = p_org_id
      AND d.enabled
      AND p_category = ANY(d.event_categories);
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_event_outbox_endpoint_threats()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org uuid;
BEGIN
    SELECT organization_id INTO v_org FROM public.endpoints WHERE id = NEW.endpoint_id;
    IF v_org IS NULL THEN RETURN NEW; END IF;
    PERFORM public.enqueue_event_for_destinations(
        v_org, 'threat', 'endpoint_threats', NEW.id, NEW.severity::text,
        jsonb_build_object(
            'id', NEW.id,
            'endpoint_id', NEW.endpoint_id,
            'threat_id', NEW.threat_id,
            'threat_name', NEW.threat_name,
            'severity', NEW.severity,
            'category', NEW.category,
            'status', NEW.status,
            'initial_detection_time', NEW.initial_detection_time,
            'last_threat_status_change_time', NEW.last_threat_status_change_time
        )
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS endpoint_threats_to_outbox ON public.endpoint_threats;
CREATE TRIGGER endpoint_threats_to_outbox
    AFTER INSERT ON public.endpoint_threats
    FOR EACH ROW EXECUTE FUNCTION public.trg_event_outbox_endpoint_threats();


CREATE OR REPLACE FUNCTION public.trg_event_outbox_alerts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.organization_id IS NULL THEN RETURN NEW; END IF;
    PERFORM public.enqueue_event_for_destinations(
        NEW.organization_id, 'alert', 'alerts', NEW.id, NEW.severity::text,
        to_jsonb(NEW)
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS alerts_to_outbox ON public.alerts;
CREATE TRIGGER alerts_to_outbox
    AFTER INSERT ON public.alerts
    FOR EACH ROW EXECUTE FUNCTION public.trg_event_outbox_alerts();


CREATE OR REPLACE FUNCTION public.trg_event_outbox_incidents()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.organization_id IS NULL THEN RETURN NEW; END IF;
    PERFORM public.enqueue_event_for_destinations(
        NEW.organization_id, 'incident', 'incidents', NEW.id, NEW.severity::text,
        to_jsonb(NEW)
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS incidents_to_outbox ON public.incidents;
CREATE TRIGGER incidents_to_outbox
    AFTER INSERT ON public.incidents
    FOR EACH ROW EXECUTE FUNCTION public.trg_event_outbox_incidents();


-- ============================================================
-- pg_cron job — drain the outbox every 30s
-- ============================================================
-- Uses pg_net to ping the siem-forwarder edge function. Reads endpoint URL
-- + service key from db settings the same way customer-reports-cron does,
-- and no-ops when either is missing.

CREATE OR REPLACE FUNCTION public.kick_siem_forwarder()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_base text;
    v_key  text;
BEGIN
    v_base := current_setting('app.functions_base_url', true);
    v_key  := current_setting('app.service_role_key', true);
    IF v_base IS NULL OR v_base = '' OR v_key IS NULL OR v_key = '' THEN
        RETURN;
    END IF;
    PERFORM net.http_post(
        url     := v_base || '/siem-forwarder',
        headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || v_key
        ),
        body    := '{}'::jsonb,
        timeout_milliseconds := 25000
    );
END;
$$;

-- Schedule. pg_cron has 1-minute granularity, so we kick once a minute and
-- the forwarder itself decides how much to drain per call.
DO $$ BEGIN
    PERFORM cron.unschedule('mithras-siem-forwarder');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
    'mithras-siem-forwarder',
    '* * * * *',  -- every minute
    $kick$SELECT public.kick_siem_forwarder();$kick$
);

COMMIT;
