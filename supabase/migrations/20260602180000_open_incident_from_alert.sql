-- PoC review rec #6: Incidents.tsx headline promises 'Severe and High threats
-- auto-open an incident' but the trigger only fires on endpoint_threats.
-- 11 alerts sit in the system including 1 critical ransomware_indicator, with
-- zero incidents ever opened from them.
--
-- Mirror open_incident_from_threat for alerts:
--   * adds incidents.alert_id (FK + dedup key)
--   * trigger fires for severity IN ('critical','high')
--   * SLA: critical=1h, high=4h
--   * dedup: skip if an open / triaging / in_progress incident already has this alert_id

ALTER TABLE public.incidents
    ADD COLUMN IF NOT EXISTS alert_id uuid REFERENCES public.alerts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_incidents_alert
    ON public.incidents(alert_id)
    WHERE alert_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.open_incident_from_alert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_sla interval;
    v_now timestamptz := now();
BEGIN
    IF NEW.severity NOT IN ('critical', 'high') THEN RETURN NEW; END IF;
    IF NEW.organization_id IS NULL                THEN RETURN NEW; END IF;

    v_sla := CASE NEW.severity
                 WHEN 'critical' THEN interval '1 hour'
                 WHEN 'high'     THEN interval '4 hours'
                 ELSE              interval '1 day'
             END;

    -- Dedup on alert_id: never spawn a second incident for the same alert
    -- while one is still open / triaging / in progress.
    IF EXISTS (
        SELECT 1 FROM public.incidents i
         WHERE i.alert_id = NEW.id
           AND i.status NOT IN ('resolved','false_positive')
    ) THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.incidents(
        organization_id, endpoint_id, alert_id, kind, severity,
        title, description, opened_at, sla_due_at
    )
    VALUES (
        NEW.organization_id, NEW.endpoint_id, NEW.id, 'alert', NEW.severity,
        format('%s alert: %s', NEW.severity, NEW.title),
        format('%s [alert_type=%s]', NEW.message, COALESCE(NEW.alert_type, 'info')),
        v_now, v_now + v_sla
    );

    RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_open_incident_from_alert ON public.alerts;
CREATE TRIGGER trg_open_incident_from_alert
AFTER INSERT ON public.alerts
FOR EACH ROW
EXECUTE FUNCTION public.open_incident_from_alert();

-- Backfill: open incidents for every existing critical/high alert that doesn't
-- already have one. Bounded by the dedup predicate inside the function via
-- temporary trigger replay against already-existing rows.
INSERT INTO public.incidents(
    organization_id, endpoint_id, alert_id, kind, severity,
    title, description, opened_at, sla_due_at
)
SELECT
    a.organization_id, a.endpoint_id, a.id, 'alert', a.severity,
    format('%s alert: %s', a.severity, a.title),
    format('%s [alert_type=%s]', a.message, COALESCE(a.alert_type, 'info')),
    a.created_at,
    a.created_at + CASE a.severity
                       WHEN 'critical' THEN interval '1 hour'
                       WHEN 'high'     THEN interval '4 hours'
                       ELSE              interval '1 day'
                   END
FROM public.alerts a
WHERE a.severity IN ('critical','high')
  AND a.organization_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM public.incidents i
       WHERE i.alert_id = a.id
         AND i.status NOT IN ('resolved','false_positive')
  );

COMMENT ON FUNCTION public.open_incident_from_alert() IS
'Mirrors open_incident_from_threat for the alerts pipeline. Critical+high alerts auto-open an incident with severity-driven SLA. Closes PoC rec #6.';
