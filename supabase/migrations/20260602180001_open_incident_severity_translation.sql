-- Severity scale mismatch: alerts.severity is lowercase
-- (critical/high/medium/low) but incidents.severity is Title-case
-- (Severe/High/Moderate/Low). The first cut of open_incident_from_alert
-- passed alerts.severity through verbatim and tripped the CHECK constraint.
-- This rev translates lowercase -> Title-case at the boundary.

ALTER TABLE public.incidents DROP CONSTRAINT IF EXISTS incidents_kind_check;
ALTER TABLE public.incidents ADD CONSTRAINT incidents_kind_check
  CHECK (kind = ANY (ARRAY[
    'threat'::text, 'alert'::text, 'posture_drift'::text,
    'agent_offline'::text, 'vuln_critical'::text, 'custom'::text
  ]));

CREATE OR REPLACE FUNCTION public.open_incident_from_alert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_sla       interval;
    v_now       timestamptz := now();
    v_sev_title text;
BEGIN
    IF NEW.severity NOT IN ('critical', 'high') THEN RETURN NEW; END IF;
    IF NEW.organization_id IS NULL              THEN RETURN NEW; END IF;

    v_sla := CASE NEW.severity
                 WHEN 'critical' THEN interval '1 hour'
                 WHEN 'high'     THEN interval '4 hours'
                 ELSE              interval '1 day'
             END;

    v_sev_title := CASE NEW.severity
                       WHEN 'critical' THEN 'Severe'
                       WHEN 'high'     THEN 'High'
                       WHEN 'medium'   THEN 'Moderate'
                       ELSE              'Low'
                   END;

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
        NEW.organization_id, NEW.endpoint_id, NEW.id, 'alert', v_sev_title,
        format('%s alert: %s', v_sev_title, NEW.title),
        format('%s [alert_type=%s]', NEW.message, COALESCE(NEW.alert_type, 'info')),
        v_now, v_now + v_sla
    );

    RETURN NEW;
END;
$fn$;

-- Backfill with the same translation.
INSERT INTO public.incidents(
    organization_id, endpoint_id, alert_id, kind, severity,
    title, description, opened_at, sla_due_at
)
SELECT
    a.organization_id, a.endpoint_id, a.id, 'alert',
    CASE a.severity WHEN 'critical' THEN 'Severe' WHEN 'high' THEN 'High'
                    WHEN 'medium'   THEN 'Moderate' ELSE 'Low' END,
    format('%s alert: %s',
           CASE a.severity WHEN 'critical' THEN 'Severe' WHEN 'high' THEN 'High'
                           WHEN 'medium'   THEN 'Moderate' ELSE 'Low' END,
           a.title),
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
