-- PoC retest #1: the existing endpoint_threats rows were all classified as
-- 'Unknown' because the v0.5.x DefenderCollector mis-mapped SeverityID. The
-- agent fix (v0.6.1) corrects the enum and pulls SeverityID from
-- Get-MpThreatCatalog. This migration backfills the rows already in the DB
-- so analysts see correct colours and incidents auto-open immediately,
-- without waiting for the next heartbeat cycle to refresh them.
--
-- We use the same name-prefix taxonomy the server fallback uses (added to
-- agent-heartbeat in this same session) so the mapping is deterministic.

UPDATE public.endpoint_threats
SET severity = CASE
        WHEN lower(threat_name) LIKE 'virus:%'        OR lower(threat_name) LIKE 'ransom:%'        THEN 'Severe'
        WHEN lower(threat_name) LIKE 'trojan:%'       OR lower(threat_name) LIKE 'trojandownloader:%'
          OR lower(threat_name) LIKE 'trojandropper:%' OR lower(threat_name) LIKE 'backdoor:%'
          OR lower(threat_name) LIKE 'hacktool:%'     OR lower(threat_name) LIKE 'worm:%'
          OR lower(threat_name) LIKE 'rootkit:%'      OR lower(threat_name) LIKE 'ransomware:%'
          OR lower(threat_name) LIKE 'remoteaccess:%' OR lower(threat_name) LIKE 'exploit:%'        THEN 'High'
        WHEN lower(threat_name) LIKE 'pua:%'          OR lower(threat_name) LIKE 'pup:%'
          OR lower(threat_name) LIKE 'adware:%'       OR lower(threat_name) LIKE 'monitortool:%'    THEN 'Moderate'
        WHEN lower(threat_name) LIKE 'misleading:%'   OR lower(threat_name) LIKE 'constructor:%'   THEN 'Low'
        ELSE severity
    END
WHERE severity = 'Unknown'
  AND threat_name IS NOT NULL
  AND threat_name NOT LIKE 'Threat %';  -- skip server-side fallback-named rows

-- Now fire open_incident_from_threat for any newly-reclassified Severe/High
-- row that doesn't already have an open incident. Mirrors the trigger body
-- (kept simple: dedup on (endpoint_id, threat_id) just like the trigger does).
INSERT INTO public.incidents(
    organization_id, endpoint_id, threat_id, kind, severity,
    title, description, opened_at, sla_due_at
)
SELECT
    e.organization_id,
    t.endpoint_id,
    t.id,
    'threat',
    t.severity,
    format('%s threat: %s', t.severity, t.threat_name),
    format('Detected on endpoint %s, category=%s, status=%s.',
           t.endpoint_id, COALESCE(t.category, '?'), t.status),
    COALESCE(t.last_threat_status_change_time, t.initial_detection_time, now()),
    COALESCE(t.last_threat_status_change_time, t.initial_detection_time, now())
      + CASE t.severity
            WHEN 'Severe' THEN interval '1 hour'
            WHEN 'High'   THEN interval '4 hours'
            ELSE              interval '1 day'
        END
FROM public.endpoint_threats t
JOIN public.endpoints e ON e.id = t.endpoint_id
WHERE t.severity IN ('Severe','High')
  AND t.status   IN ('Active','Cleaning')
  AND NOT EXISTS (
      SELECT 1 FROM public.incidents i
       WHERE i.endpoint_id = t.endpoint_id
         AND i.threat_id   = t.id
         AND i.status NOT IN ('resolved','false_positive')
  );
