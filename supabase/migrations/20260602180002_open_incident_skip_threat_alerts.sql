-- Followup to rec #6: a Defender threat fires open_incident_from_threat AND
-- create_alert_on_threat, the latter then chaining into open_incident_from_alert.
-- Net result: a single threat produces TWO incidents.
--
-- Solution: open_incident_from_alert skips alerts whose alert_type is
-- 'threat_detected' (the marker create_alert_on_threat sets). The threat path
-- remains canonical for Defender-derived events; alerts of all OTHER types
-- (ransomware indicator, M365 risky sign-in, etc.) still open incidents.

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
    -- Defender threats already open incidents via open_incident_from_threat.
    -- Skip the alert-derived path to avoid a second incident per event.
    IF NEW.alert_type = 'threat_detected'       THEN RETURN NEW; END IF;

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

-- Backfill cleanup: remove the alert-derived incidents whose underlying alert
-- is alert_type='threat_detected' AND whose threat already has its own incident.
-- Safety: only delete still-open ones we just auto-opened; don't touch any
-- incident an analyst has triaged/resolved.
DELETE FROM public.incidents i
 WHERE i.kind = 'alert'
   AND i.status = 'open'
   AND i.assignee_id IS NULL
   AND i.triaged_at IS NULL
   AND EXISTS (
       SELECT 1 FROM public.alerts a
        WHERE a.id = i.alert_id
          AND a.alert_type = 'threat_detected'
   );
