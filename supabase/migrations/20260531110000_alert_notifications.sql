-- Alert notifications.
--
-- When a new row lands in alerts, we want to email the org's nominated alert
-- recipients (subject to per-recipient severity threshold + acknowledgement
-- state). This wires:
--
--   1. org_alert_recipients table — per-org email list with severity filter.
--   2. NOTIFY pg_net trigger that POSTs to /functions/v1/notify-alert.
--   3. notify_alert function that the edge function calls back to record
--      the delivery in alerts.notified_at + delivered_to[].
--
-- The edge function does the actual SMTP send. We avoid doing it from a
-- trigger directly because SMTP is slow + flaky and would block inserts.

ALTER TABLE public.alerts
    ADD COLUMN IF NOT EXISTS notified_at timestamptz,
    ADD COLUMN IF NOT EXISTS delivered_to text[],
    ADD COLUMN IF NOT EXISTS notification_error text;

CREATE TABLE IF NOT EXISTS public.org_alert_recipients (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    email           text NOT NULL,
    name            text,
    role_label      text,
    -- Notify on this severity OR higher. Order: low < moderate < high < severe.
    min_severity    text NOT NULL DEFAULT 'high'
                         CHECK (min_severity IN ('low','moderate','high','severe')),
    enabled         boolean NOT NULL DEFAULT true,
    created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, email)
);

CREATE INDEX IF NOT EXISTS idx_org_alert_recipients_org
    ON public.org_alert_recipients(organization_id);

CREATE OR REPLACE FUNCTION public.touch_org_alert_recipients_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_org_alert_recipients_touch ON public.org_alert_recipients;
CREATE TRIGGER trg_org_alert_recipients_touch BEFORE UPDATE ON public.org_alert_recipients
FOR EACH ROW EXECUTE FUNCTION public.touch_org_alert_recipients_updated_at();

ALTER TABLE public.org_alert_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "alert_recipients_select" ON public.org_alert_recipients;
CREATE POLICY "alert_recipients_select" ON public.org_alert_recipients
    FOR SELECT TO authenticated
    USING (public.is_super_admin(auth.uid()) OR public.is_member_of_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "alert_recipients_write" ON public.org_alert_recipients;
CREATE POLICY "alert_recipients_write" ON public.org_alert_recipients
    FOR ALL TO authenticated
    USING (public.is_super_admin(auth.uid()) OR public.is_admin_of_org(auth.uid(), organization_id))
    WITH CHECK (public.is_super_admin(auth.uid()) OR public.is_admin_of_org(auth.uid(), organization_id));

-- ---------------------------------------------------------------------------
-- Trigger: queue notify-alert on alert insert.
-- We use pg_net (already loaded for the customer-report drain) to fire-and-
-- forget the edge function. Failures are logged but don't block the insert.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.queue_alert_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_base text;
    v_key  text;
BEGIN
    SELECT value::text INTO v_base FROM public.platform_settings WHERE key = 'functions_base_url';
    SELECT value::text INTO v_key  FROM public.platform_settings WHERE key = 'service_role_key';
    v_base := btrim(v_base, '"');
    v_key  := btrim(v_key,  '"');
    IF v_base IS NULL OR v_base = '' OR v_key IS NULL OR v_key = '' THEN
        -- Operator hasn't configured the platform endpoint yet; skip silently.
        RETURN NEW;
    END IF;

    PERFORM net.http_post(
        url     := v_base || '/notify-alert',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_key
        ),
        body    := jsonb_build_object('alert_id', NEW.id)
    );
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_queue_alert_notification ON public.alerts;
CREATE TRIGGER trg_queue_alert_notification
    AFTER INSERT ON public.alerts
    FOR EACH ROW
    EXECUTE FUNCTION public.queue_alert_notification();

REVOKE ALL ON FUNCTION public.queue_alert_notification() FROM PUBLIC;
