-- 20260614060000_email_security.sql
--
-- M365 email security: AI-driven phishing / BEC / spam / malware detection.
--
-- Two tables:
--   email_threats   — one row per message Mithras has classified. The
--                     payload is small (sender, subject, classification,
--                     AI reasoning, IOCs); we never persist the full body.
--   email_sweep_runs — bookkeeping for the polling sweep so we don't
--                     re-scan messages we've already seen. Per-mailbox
--                     watermark.
--
-- Triggers on email_threats fan out into event_outbox so any customer
-- with SIEM forwarding set up automatically gets phishing detections in
-- their Splunk/Sentinel/Elastic without extra config.

BEGIN;

DO $$ BEGIN
    CREATE TYPE public.email_threat_classification AS ENUM (
        'phishing',
        'bec',
        'spam',
        'malware',
        'suspicious',
        'legitimate'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE public.email_action AS ENUM (
        'none',
        'flagged',
        'user_warned',
        'quarantined',
        'released'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- email_threats
-- ============================================================
CREATE TABLE IF NOT EXISTS public.email_threats (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    m365_tenant_id      uuid NOT NULL REFERENCES public.m365_tenants(id) ON DELETE CASCADE,
    -- Microsoft Graph message id. Composite-unique with the user mailbox.
    graph_message_id    text NOT NULL,
    -- Mailbox owner — the user the message was delivered to.
    recipient_user_id   text,            -- Graph user object id
    recipient_email     text NOT NULL,
    -- Envelope + best-effort identity.
    sender_email        text,
    sender_domain       text,
    sender_display_name text,
    subject             text,
    received_at         timestamptz NOT NULL,
    -- Classification fields. AI reasoning is bounded so we don't store
    -- multi-page hallucinations.
    classification      public.email_threat_classification NOT NULL,
    confidence          int NOT NULL CHECK (confidence BETWEEN 0 AND 100),
    severity            text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
    ai_reasoning        text,
    iocs                jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- Headers we kept because they back the reasoning. NEVER the body.
    headers             jsonb NOT NULL DEFAULT '{}'::jsonb,
    action_taken        public.email_action NOT NULL DEFAULT 'flagged',
    action_taken_at     timestamptz,
    action_taken_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    -- Audit trail for review.
    reviewed_at         timestamptz,
    reviewed_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    reviewer_verdict    text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (m365_tenant_id, graph_message_id, recipient_user_id)
);

CREATE INDEX IF NOT EXISTS idx_email_threats_org_time
    ON public.email_threats(organization_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_threats_classification
    ON public.email_threats(organization_id, classification, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_threats_user
    ON public.email_threats(organization_id, recipient_email);

ALTER TABLE public.email_threats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_threats_read ON public.email_threats;
CREATE POLICY email_threats_read ON public.email_threats FOR SELECT
    USING (
        public.is_super_admin(auth.uid())
        OR public.is_member_of_org(auth.uid(), organization_id)
        OR public.is_partner_admin_of_org(auth.uid(), organization_id)
    );

DROP POLICY IF EXISTS email_threats_admin_update ON public.email_threats;
CREATE POLICY email_threats_admin_update ON public.email_threats FOR UPDATE
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

DROP POLICY IF EXISTS email_threats_service_insert ON public.email_threats;
CREATE POLICY email_threats_service_insert ON public.email_threats FOR INSERT
    TO service_role WITH CHECK (true);

-- ============================================================
-- email_sweep_runs — per-mailbox watermark
-- ============================================================
CREATE TABLE IF NOT EXISTS public.email_sweep_runs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    m365_tenant_id      uuid NOT NULL REFERENCES public.m365_tenants(id) ON DELETE CASCADE,
    recipient_user_id   text NOT NULL,
    recipient_email     text,
    -- High-water mark — Graph returns messages in receivedDateTime order;
    -- we ask for messages after this timestamp on the next sweep.
    last_message_received_at timestamptz,
    messages_scanned    int NOT NULL DEFAULT 0,
    threats_detected    int NOT NULL DEFAULT 0,
    last_swept_at       timestamptz NOT NULL DEFAULT now(),
    last_error          text,
    UNIQUE (m365_tenant_id, recipient_user_id)
);

CREATE INDEX IF NOT EXISTS idx_email_sweep_runs_org
    ON public.email_sweep_runs(organization_id);

ALTER TABLE public.email_sweep_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_sweep_runs_read ON public.email_sweep_runs;
CREATE POLICY email_sweep_runs_read ON public.email_sweep_runs FOR SELECT
    USING (
        public.is_super_admin(auth.uid())
        OR public.is_member_of_org(auth.uid(), organization_id)
        OR public.is_partner_admin_of_org(auth.uid(), organization_id)
    );

DROP POLICY IF EXISTS email_sweep_runs_service_write ON public.email_sweep_runs;
CREATE POLICY email_sweep_runs_service_write ON public.email_sweep_runs FOR ALL
    TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- Trigger: medium+ severity email_threats fan out into the event_outbox.
-- Reuses the SIEM forwarder we built earlier today.
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_event_outbox_email_threats()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Only forward medium+ severity threats. Spam is noisy.
    IF NEW.severity IN ('low','medium','high','critical') AND NEW.classification != 'legitimate' THEN
        PERFORM public.enqueue_event_for_destinations(
            NEW.organization_id,
            'alert',
            'email_threats',
            NEW.id,
            NEW.severity,
            jsonb_build_object(
                'id', NEW.id,
                'classification', NEW.classification,
                'confidence', NEW.confidence,
                'severity', NEW.severity,
                'sender', NEW.sender_email,
                'sender_domain', NEW.sender_domain,
                'recipient', NEW.recipient_email,
                'subject', NEW.subject,
                'received_at', NEW.received_at,
                'reasoning', NEW.ai_reasoning,
                'iocs', NEW.iocs
            )
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS email_threats_to_outbox ON public.email_threats;
CREATE TRIGGER email_threats_to_outbox
    AFTER INSERT ON public.email_threats
    FOR EACH ROW EXECUTE FUNCTION public.trg_event_outbox_email_threats();

-- ============================================================
-- pg_cron job — kick the sweep every 5 minutes
-- ============================================================
CREATE OR REPLACE FUNCTION public.kick_email_security_sweep()
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
        url     := v_base || '/m365-email-sweep',
        headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || v_key
        ),
        body    := '{}'::jsonb,
        timeout_milliseconds := 60000
    );
END;
$$;

DO $$ BEGIN
    PERFORM cron.unschedule('mithras-email-security-sweep');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
    'mithras-email-security-sweep',
    '*/5 * * * *',  -- every 5 minutes
    $kick$SELECT public.kick_email_security_sweep();$kick$
);

COMMIT;
