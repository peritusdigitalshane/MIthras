#!/usr/bin/env python3
"""
Build the Peritus SOC Overview dashboard JSON.
Single dashboard, conditional layout via $org variable (multi-select).
Strict action criteria — only real, actionable items.
"""

import json
import sys
from pathlib import Path

DS = {"type": "grafana-postgresql-datasource", "uid": "peritus-db"}
ORG_FILTER = "e.organization_id::text IN (${org:singlequote})"
ORG_FILTER_BARE = "organization_id::text IN (${org:singlequote})"


def panel(id_, title, gridPos, type_, query, *, options=None, fieldConfig=None, transformations=None, datalinks=None):
    p = {
        "id": id_,
        "type": type_,
        "title": title,
        "gridPos": gridPos,
        "datasource": DS,
        "targets": [{"refId": "A", "datasource": DS, "rawSql": query, "format": "table" if type_ in ("table", "stat", "gauge", "piechart", "bargauge") else "time_series"}],
    }
    if options is not None:
        p["options"] = options
    if fieldConfig is not None:
        p["fieldConfig"] = fieldConfig
    if transformations:
        p["transformations"] = transformations
    if datalinks:
        # Datalinks live in fieldConfig.defaults.links
        p.setdefault("fieldConfig", {}).setdefault("defaults", {})["links"] = datalinks
    return p


# ── KPI row (gridPos y=0..3) ────────────────────────────────────────────────
def stat(id_, title, gridPos, sql, color_thresholds, unit="short"):
    """Stat panel with colored thresholds. thresholds = [(value, color)]."""
    steps = [{"color": c, "value": v} for v, c in color_thresholds]
    return panel(
        id_, title, gridPos, "stat", sql,
        options={
            "colorMode": "background",
            "graphMode": "none",
            "justifyMode": "center",
            "textMode": "value_and_name",
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
        },
        fieldConfig={
            "defaults": {
                "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": steps},
                "unit": unit,
                "mappings": [],
            },
            "overrides": [],
        },
    )


KPI_THREATS = """
SELECT COUNT(*)::int AS value
FROM public.endpoint_threats t
JOIN public.endpoints e ON e.id = t.endpoint_id
WHERE t.status = 'Active'
  AND COALESCE(t.manual_resolution_active, false) = false
  AND t.severity IN ('Severe','High')
  AND """ + ORG_FILTER

KPI_CRIT_CVES = """
SELECT COUNT(DISTINCT v.cve_id)::int AS value
FROM public.vulnerability_findings v
JOIN public.endpoints e ON e.id = v.endpoint_id
WHERE v.status = 'open'
  AND v.cvss_score >= 9.0
  AND """ + ORG_FILTER

KPI_OFFLINE = """
SELECT COUNT(*)::int AS value
FROM public.endpoints e
WHERE e.is_active = true
  AND (e.last_seen_at IS NULL OR e.last_seen_at < NOW() - INTERVAL '24 hours')
  AND """ + ORG_FILTER

KPI_RTP_OFF = """
WITH latest AS (
  SELECT DISTINCT ON (es.endpoint_id) es.endpoint_id, es.realtime_protection_enabled
  FROM public.endpoint_status es
  ORDER BY es.endpoint_id, es.collected_at DESC
)
SELECT COUNT(*)::int AS value
FROM latest
JOIN public.endpoints e ON e.id = latest.endpoint_id
WHERE latest.realtime_protection_enabled = false
  AND e.is_active = true
  AND """ + ORG_FILTER

KPI_CUSTOMERS_NEEDING = """
WITH risk AS (
  SELECT o.id, o.name,
    (SELECT COUNT(*) FROM public.endpoint_threats t JOIN public.endpoints e ON e.id=t.endpoint_id
       WHERE e.organization_id=o.id AND t.status='Active' AND COALESCE(t.manual_resolution_active,false)=false AND t.severity IN ('Severe','High')) AS hi_threats,
    (SELECT COUNT(DISTINCT v.cve_id) FROM public.vulnerability_findings v JOIN public.endpoints e ON e.id=v.endpoint_id
       WHERE e.organization_id=o.id AND v.status='open' AND v.cvss_score>=9.0) AS crit_cves,
    (SELECT COUNT(*) FROM public.endpoints e WHERE e.organization_id=o.id AND e.is_active=true
       AND (e.last_seen_at IS NULL OR e.last_seen_at < NOW() - INTERVAL '24 hours')) AS offline_24h
  FROM public.organizations o
  WHERE o.id::text IN (${org:singlequote})
)
SELECT COUNT(*)::int AS value FROM risk WHERE hi_threats > 0 OR crit_cves > 0 OR offline_24h > 0
"""

# ── Customer Risk Ranking (y=4..13) ─────────────────────────────────────────
CUSTOMER_RANKING = """
WITH latest_status AS (
  SELECT DISTINCT ON (es.endpoint_id) es.endpoint_id, es.realtime_protection_enabled
  FROM public.endpoint_status es
  ORDER BY es.endpoint_id, es.collected_at DESC
),
risk AS (
  SELECT
    o.id,
    o.name AS "Customer",
    (SELECT COUNT(*) FROM public.endpoint_threats t JOIN public.endpoints e ON e.id=t.endpoint_id
       WHERE e.organization_id=o.id AND t.status='Active' AND COALESCE(t.manual_resolution_active,false)=false AND t.severity='Severe') AS severe_n,
    (SELECT COUNT(*) FROM public.endpoint_threats t JOIN public.endpoints e ON e.id=t.endpoint_id
       WHERE e.organization_id=o.id AND t.status='Active' AND COALESCE(t.manual_resolution_active,false)=false AND t.severity='High') AS high_n,
    (SELECT COUNT(*) FROM public.endpoint_threats t JOIN public.endpoints e ON e.id=t.endpoint_id
       WHERE e.organization_id=o.id AND t.status='Active' AND COALESCE(t.manual_resolution_active,false)=false AND t.severity='Moderate') AS mod_n,
    (SELECT COUNT(DISTINCT v.cve_id) FROM public.vulnerability_findings v JOIN public.endpoints e ON e.id=v.endpoint_id
       WHERE e.organization_id=o.id AND v.status='open' AND v.cvss_score>=9.0) AS crit_cves,
    (SELECT COUNT(DISTINCT v.cve_id) FROM public.vulnerability_findings v JOIN public.endpoints e ON e.id=v.endpoint_id
       WHERE e.organization_id=o.id AND v.status='open' AND v.cvss_score>=7.0 AND v.cvss_score<9.0) AS high_cves,
    (SELECT COUNT(*) FROM latest_status ls JOIN public.endpoints e ON e.id=ls.endpoint_id
       WHERE e.organization_id=o.id AND ls.realtime_protection_enabled=false AND e.is_active=true) AS rtp_off,
    (SELECT COUNT(*) FROM public.endpoints e WHERE e.organization_id=o.id AND e.is_active=true
       AND (e.last_seen_at IS NULL OR e.last_seen_at < NOW() - INTERVAL '24 hours')) AS offline_24h,
    (SELECT COUNT(*) FROM public.endpoints e WHERE e.organization_id=o.id AND e.is_active=true) AS endpoints_total,
    (SELECT COUNT(*) FROM public.endpoints e WHERE e.organization_id=o.id AND e.is_active=true AND e.is_online=true) AS endpoints_online,
    (SELECT MAX(t.initial_detection_time) FROM public.endpoint_threats t JOIN public.endpoints e ON e.id=t.endpoint_id
       WHERE e.organization_id=o.id) AS last_threat
  FROM public.organizations o
  WHERE o.id::text IN (${org:singlequote})
)
SELECT
  "Customer",
  id::text AS _org_id,
  (severe_n*20 + high_n*10 + mod_n*5 + crit_cves*5 + high_cves*2 + rtp_off*5 + offline_24h*3)::int AS "Risk",
  (severe_n + high_n)::int AS "Threats (S+H)",
  crit_cves::int AS "Critical CVEs",
  rtp_off::int AS "RTP Off",
  offline_24h::int AS "Offline >24h",
  (endpoints_online::text || '/' || endpoints_total::text) AS "Endpoints",
  to_char(last_threat AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS "Last Threat"
FROM risk
ORDER BY "Risk" DESC, "Customer" ASC
"""

# ── Priority Action List (y=14..23) ─────────────────────────────────────────
ACTION_LIST = """
WITH actions AS (
  -- Active Severe/High threats
  SELECT
    CASE t.severity WHEN 'Severe' THEN 1 WHEN 'High' THEN 2 ELSE 3 END AS priority,
    o.name AS customer, e.hostname,
    'Active threat' AS issue,
    t.threat_name || COALESCE(' (' || t.category || ')', '') AS detail,
    t.severity AS severity,
    EXTRACT(EPOCH FROM (NOW() - t.initial_detection_time))::bigint AS age_s,
    'Quarantine / resolve in Defender' AS recommended
  FROM public.endpoint_threats t
  JOIN public.endpoints e ON e.id = t.endpoint_id
  JOIN public.organizations o ON o.id = e.organization_id
  WHERE t.status = 'Active'
    AND COALESCE(t.manual_resolution_active, false) = false
    AND t.severity IN ('Severe','High')
    AND e.organization_id::text IN (${org:singlequote})

  UNION ALL
  -- RTP disabled
  SELECT 2 AS priority, o.name, e.hostname,
    'RTP disabled' AS issue,
    'Defender real-time protection turned off' AS detail,
    'High' AS severity,
    EXTRACT(EPOCH FROM (NOW() - ls.collected_at))::bigint AS age_s,
    'Enable RTP via Defender policy / GPO' AS recommended
  FROM (SELECT DISTINCT ON (endpoint_id) endpoint_id, realtime_protection_enabled, collected_at
        FROM public.endpoint_status ORDER BY endpoint_id, collected_at DESC) ls
  JOIN public.endpoints e ON e.id = ls.endpoint_id
  JOIN public.organizations o ON o.id = e.organization_id
  WHERE ls.realtime_protection_enabled = false
    AND e.is_active = true
    AND e.organization_id::text IN (${org:singlequote})

  UNION ALL
  -- Offline > 24h
  SELECT 3 AS priority, o.name, e.hostname,
    'Endpoint offline' AS issue,
    COALESCE('Last seen ' || to_char(e.last_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'), 'Never reported') AS detail,
    'Medium' AS severity,
    EXTRACT(EPOCH FROM (NOW() - COALESCE(e.last_seen_at, NOW() - INTERVAL '999 days')))::bigint AS age_s,
    'Investigate connectivity / confirm decommissioned' AS recommended
  FROM public.endpoints e
  JOIN public.organizations o ON o.id = e.organization_id
  WHERE e.is_active = true
    AND (e.last_seen_at IS NULL OR e.last_seen_at < NOW() - INTERVAL '24 hours')
    AND e.organization_id::text IN (${org:singlequote})

  UNION ALL
  -- Critical CVEs (>= 9)
  SELECT 1 AS priority, o.name, NULL AS hostname,
    'Critical CVE unpatched' AS issue,
    v.cve_id || ' on ' || v.affected_software || ' — affects ' || COUNT(DISTINCT v.endpoint_id)::text || ' endpoint(s) (CVSS ' || MAX(v.cvss_score)::text || ')' AS detail,
    'Severe' AS severity,
    EXTRACT(EPOCH FROM (NOW() - MIN(v.created_at)))::bigint AS age_s,
    'Deploy patch via WSUS / package manager' AS recommended
  FROM public.vulnerability_findings v
  JOIN public.endpoints e ON e.id = v.endpoint_id
  JOIN public.organizations o ON o.id = e.organization_id
  WHERE v.status = 'open'
    AND v.cvss_score >= 9.0
    AND e.organization_id::text IN (${org:singlequote})
  GROUP BY o.name, v.cve_id, v.affected_software
)
SELECT
  priority AS "Pri",
  customer AS "Customer",
  COALESCE(hostname, '—') AS "Endpoint",
  issue AS "Issue",
  severity AS "Severity",
  detail AS "Detail",
  CASE
    WHEN age_s < 3600 THEN ROUND(age_s/60.0)::text || 'm'
    WHEN age_s < 86400 THEN ROUND(age_s/3600.0)::text || 'h'
    ELSE ROUND(age_s/86400.0)::text || 'd'
  END AS "Age",
  recommended AS "Action"
FROM actions
ORDER BY priority ASC, age_s DESC
LIMIT 200
"""

# ── CVE Patching Velocity (replaces threat trend) ───────────────────────────
PATCHING_VELOCITY = """
SELECT $__timeGroupAlias(v.created_at, '1d') AS time, 'Opened' AS metric, COUNT(*)::int AS value
FROM public.vulnerability_findings v
JOIN public.endpoints e ON e.id = v.endpoint_id
WHERE $__timeFilter(v.created_at) AND """ + ORG_FILTER + """
GROUP BY 1
UNION ALL
SELECT $__timeGroupAlias(v.resolved_at, '1d') AS time, 'Mitigated' AS metric, COUNT(*)::int AS value
FROM public.vulnerability_findings v
JOIN public.endpoints e ON e.id = v.endpoint_id
WHERE v.resolved_at IS NOT NULL AND $__timeFilter(v.resolved_at) AND """ + ORG_FILTER + """
GROUP BY 1
ORDER BY time
"""

# ── Activity Heatmap (replaces event-log-by-level trend) ────────────────────
ACTIVITY_HEATMAP = """
SELECT
  $__timeGroup(el.event_time, '1h') AS time,
  EXTRACT(HOUR FROM el.event_time AT TIME ZONE 'UTC')::text AS metric,
  COUNT(*)::int AS value
FROM public.endpoint_event_logs el
JOIN public.endpoints e ON e.id = el.endpoint_id
WHERE $__timeFilter(el.event_time)
  AND """ + ORG_FILTER + """
GROUP BY 1, 2
ORDER BY 1, 2
"""

# ── Coverage KPIs ───────────────────────────────────────────────────────────
COV_REPORTING_PCT = """
SELECT ROUND(100.0 * COUNT(DISTINCT es.endpoint_id) / NULLIF(COUNT(DISTINCT e.id), 0)::numeric, 1) AS value
FROM public.endpoints e
LEFT JOIN public.endpoint_status es ON es.endpoint_id = e.id AND es.collected_at > NOW() - INTERVAL '7 days'
WHERE e.is_active = true AND e.""" + ORG_FILTER_BARE

COV_RTP_PCT = """
WITH latest AS (
  SELECT DISTINCT ON (endpoint_id) endpoint_id, realtime_protection_enabled
  FROM public.endpoint_status ORDER BY endpoint_id, collected_at DESC
)
SELECT ROUND(100.0 * SUM(CASE WHEN realtime_protection_enabled THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0)::numeric, 1) AS value
FROM latest l
JOIN public.endpoints e ON e.id = l.endpoint_id
WHERE e.is_active = true AND e.""" + ORG_FILTER_BARE

COV_DEFENDER_CURRENT_PCT = """
WITH max_ver AS (SELECT MAX(defender_version) AS v FROM public.endpoints WHERE defender_version IS NOT NULL)
SELECT ROUND(100.0 * SUM(CASE WHEN e.defender_version = max_ver.v THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0)::numeric, 1) AS value
FROM public.endpoints e, max_ver
WHERE e.is_active = true AND e.defender_version IS NOT NULL AND e.""" + ORG_FILTER_BARE

COV_AVG_CVE_AGE = """
SELECT COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - v.created_at)) / 86400)::numeric, 1), 0) AS value
FROM public.vulnerability_findings v
JOIN public.endpoints e ON e.id = v.endpoint_id
WHERE v.status = 'open' AND e.""" + ORG_FILTER_BARE

# ── Endpoints Never Reported ────────────────────────────────────────────────
ENDPOINTS_NEVER_REPORTED = """
SELECT
  o.name AS "Customer",
  e.hostname AS "Hostname",
  e.os_version AS "OS",
  to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "Registered",
  CASE
    WHEN e.last_seen_at IS NULL THEN 'Never'
    ELSE ROUND(EXTRACT(EPOCH FROM (NOW() - e.last_seen_at))/86400)::text || 'd ago'
  END AS "Last Activity",
  COALESCE(e.agent_version, '—') AS "Agent"
FROM public.endpoints e
JOIN public.organizations o ON o.id = e.organization_id
LEFT JOIN public.endpoint_status es ON es.endpoint_id = e.id
WHERE e.is_active = true
  AND e.""" + ORG_FILTER_BARE + """
GROUP BY e.id, o.name, e.hostname, e.os_version, e.created_at, e.last_seen_at, e.agent_version
HAVING COUNT(es.id) = 0
ORDER BY e.created_at DESC
"""

# ── Stale Defender Signature ────────────────────────────────────────────────
STALE_DEFENDER = """
WITH max_ver AS (SELECT MAX(defender_version) AS v FROM public.endpoints WHERE defender_version IS NOT NULL)
SELECT
  o.name AS "Customer",
  e.hostname AS "Endpoint",
  COALESCE(e.defender_version, '—') AS "Installed",
  max_ver.v AS "Latest in Fleet"
FROM public.endpoints e
JOIN public.organizations o ON o.id = e.organization_id
CROSS JOIN max_ver
WHERE e.is_active = true
  AND e.defender_version IS NOT NULL
  AND e.defender_version <> max_ver.v
  AND e.""" + ORG_FILTER_BARE + """
ORDER BY e.defender_version ASC
"""

# ── Suspicious Inbound Ports ────────────────────────────────────────────────
SUSPICIOUS_PORTS = """
SELECT
  o.name AS "Customer",
  e.hostname AS "Endpoint",
  fw.local_port AS "Port",
  CASE fw.local_port
    WHEN 22 THEN 'SSH'
    WHEN 23 THEN 'Telnet'
    WHEN 445 THEN 'SMB'
    WHEN 3389 THEN 'RDP'
    WHEN 5900 THEN 'VNC'
    WHEN 5985 THEN 'WinRM-HTTP'
    WHEN 5986 THEN 'WinRM-HTTPS'
    WHEN 6667 THEN 'IRC'
    WHEN 6697 THEN 'IRC-TLS'
    WHEN 1433 THEN 'MSSQL'
    WHEN 3306 THEN 'MySQL'
    WHEN 5432 THEN 'PostgreSQL'
    WHEN 27017 THEN 'MongoDB'
    WHEN 6379 THEN 'Redis'
    WHEN 11211 THEN 'Memcached'
    WHEN 21 THEN 'FTP'
    WHEN 25 THEN 'SMTP'
    WHEN 110 THEN 'POP3'
    WHEN 143 THEN 'IMAP'
  END AS "Service",
  COUNT(*)::int AS "Events",
  to_char(MAX(fw.event_time) AT TIME ZONE 'UTC', 'MM-DD HH24:MI') AS "Last Seen"
FROM public.firewall_audit_logs fw
JOIN public.endpoints e ON e.id = fw.endpoint_id
JOIN public.organizations o ON o.id = e.organization_id
WHERE fw.direction = 'inbound'
  AND fw.local_port IN (21,22,23,25,110,143,445,1433,3306,3389,5432,5900,5985,5986,6379,6667,6697,11211,27017)
  AND $__timeFilter(fw.event_time)
  AND e.""" + ORG_FILTER_BARE + """
GROUP BY o.name, e.hostname, fw.local_port
ORDER BY COUNT(*) DESC
LIMIT 30
"""

# ── External Destinations (RFC1918 + loopback + link-local excluded) ────────
EXTERNAL_DESTINATIONS = """
SELECT
  fw.remote_address AS "External IP",
  COUNT(*)::int AS "Events",
  COUNT(DISTINCT fw.endpoint_id)::int AS "Endpoints",
  string_agg(DISTINCT fw.direction, ', ') AS "Direction(s)",
  string_agg(DISTINCT COALESCE(fw.service_name,''), ', ') AS "Services",
  to_char(MIN(fw.event_time) AT TIME ZONE 'UTC', 'MM-DD HH24:MI') AS "First Seen",
  to_char(MAX(fw.event_time) AT TIME ZONE 'UTC', 'MM-DD HH24:MI') AS "Last Seen"
FROM public.firewall_audit_logs fw
JOIN public.endpoints e ON e.id = fw.endpoint_id
WHERE $__timeFilter(fw.event_time)
  AND fw.remote_address IS NOT NULL
  AND fw.remote_address !~ '^(10\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.|192\\.168\\.|127\\.|169\\.254\\.|fc|fd|fe80)'
  AND fw.remote_address != '::1'
  AND fw.remote_address != '0.0.0.0'
  AND e.""" + ORG_FILTER_BARE + """
GROUP BY fw.remote_address
ORDER BY COUNT(*) DESC
LIMIT 25
"""

# ── Outlier endpoints (firewall traffic > 2σ) ───────────────────────────────
OUTLIER_ENDPOINTS = """
WITH per_endpoint AS (
  SELECT fw.endpoint_id, e.hostname, o.name AS customer, COUNT(*)::int AS event_count
  FROM public.firewall_audit_logs fw
  JOIN public.endpoints e ON e.id = fw.endpoint_id
  JOIN public.organizations o ON o.id = e.organization_id
  WHERE $__timeFilter(fw.event_time)
    AND e.""" + ORG_FILTER_BARE + """
  GROUP BY 1, 2, 3
),
stats AS (SELECT AVG(event_count)::numeric AS mu, STDDEV_POP(event_count)::numeric AS sigma FROM per_endpoint)
SELECT
  customer AS "Customer",
  hostname AS "Endpoint",
  event_count AS "Events",
  ROUND(stats.mu)::int AS "Fleet Avg",
  CASE WHEN stats.sigma > 0 THEN ROUND(((event_count - stats.mu) / stats.sigma)::numeric, 1) ELSE 0 END AS "σ above mean"
FROM per_endpoint, stats
WHERE stats.sigma > 0 AND event_count > stats.mu + 2 * stats.sigma
ORDER BY event_count DESC
LIMIT 20
"""

# ── Customer Trust Score ────────────────────────────────────────────────────
TRUST_SCORE = """
WITH latest_status AS (
  SELECT DISTINCT ON (endpoint_id) endpoint_id, realtime_protection_enabled
  FROM public.endpoint_status ORDER BY endpoint_id, collected_at DESC
),
metrics AS (
  SELECT
    o.id, o.name,
    (SELECT COUNT(*) FROM public.endpoint_threats t JOIN public.endpoints e ON e.id=t.endpoint_id
      WHERE e.organization_id=o.id AND t.status='Active' AND t.severity IN ('Severe','High')) AS hi_threats,
    (SELECT COUNT(DISTINCT v.cve_id) FROM public.vulnerability_findings v JOIN public.endpoints e ON e.id=v.endpoint_id
      WHERE e.organization_id=o.id AND v.status='open' AND v.cvss_score>=9) AS crit_cves,
    (SELECT COUNT(*) FROM public.endpoints e WHERE e.organization_id=o.id AND e.is_active=true
      AND (e.last_seen_at IS NULL OR e.last_seen_at < NOW() - INTERVAL '24 hours')) AS offline,
    (SELECT COUNT(*) FROM latest_status ls JOIN public.endpoints e ON e.id=ls.endpoint_id
      WHERE e.organization_id=o.id AND ls.realtime_protection_enabled=false AND e.is_active=true) AS rtp_off
  FROM public.organizations o
  WHERE o.id::text IN (${org:singlequote})
)
SELECT
  name AS "Customer",
  GREATEST(0, LEAST(100, 100 - (hi_threats*15 + crit_cves*8 + offline*4 + rtp_off*6)))::int AS "Trust Score"
FROM metrics
ORDER BY "Trust Score" ASC, name
"""

# ── Weekly Posture Delta ────────────────────────────────────────────────────
WEEKLY_DELTA = """
WITH now_cves AS (
  SELECT e.organization_id, COUNT(DISTINCT v.cve_id) AS n
  FROM public.vulnerability_findings v
  JOIN public.endpoints e ON e.id = v.endpoint_id
  WHERE v.status = 'open' AND e.""" + ORG_FILTER_BARE + """
  GROUP BY 1
),
week_ago_cves AS (
  SELECT e.organization_id, COUNT(DISTINCT v.cve_id) AS n
  FROM public.vulnerability_findings v
  JOIN public.endpoints e ON e.id = v.endpoint_id
  WHERE v.created_at < NOW() - INTERVAL '7 days'
    AND (v.status = 'open' OR (v.resolved_at IS NOT NULL AND v.resolved_at > NOW() - INTERVAL '7 days'))
    AND e.""" + ORG_FILTER_BARE + """
  GROUP BY 1
),
now_threats AS (
  SELECT e.organization_id, COUNT(*) AS n
  FROM public.endpoint_threats t JOIN public.endpoints e ON e.id = t.endpoint_id
  WHERE t.status='Active' AND e.""" + ORG_FILTER_BARE + """
  GROUP BY 1
),
week_ago_threats AS (
  SELECT e.organization_id, COUNT(*) AS n
  FROM public.endpoint_threats t JOIN public.endpoints e ON e.id = t.endpoint_id
  WHERE t.initial_detection_time < NOW() - INTERVAL '7 days'
    AND (t.status='Active' OR t.last_threat_status_change_time > NOW() - INTERVAL '7 days')
    AND e.""" + ORG_FILTER_BARE + """
  GROUP BY 1
)
SELECT
  o.name AS "Customer",
  COALESCE(nc.n, 0)::int AS "Open CVEs",
  (COALESCE(nc.n, 0) - COALESCE(wc.n, 0))::int AS "CVE Δ",
  COALESCE(nt.n, 0)::int AS "Active Threats",
  (COALESCE(nt.n, 0) - COALESCE(wt.n, 0))::int AS "Threat Δ"
FROM public.organizations o
LEFT JOIN now_cves nc ON nc.organization_id = o.id
LEFT JOIN week_ago_cves wc ON wc.organization_id = o.id
LEFT JOIN now_threats nt ON nt.organization_id = o.id
LEFT JOIN week_ago_threats wt ON wt.organization_id = o.id
WHERE o.id::text IN (${org:singlequote})
ORDER BY ABS(COALESCE(nc.n, 0) - COALESCE(wc.n, 0)) DESC, o.name
"""

# ── Hunt Bookmarks (static markdown) ────────────────────────────────────────
HUNT_BOOKMARKS_MD = """## Hunt Bookmarks — copy-paste into Explore mode (SQL editor)

**Critical CVEs older than 90 days**
```sql
SELECT v.cve_id, v.affected_software, MAX(v.cvss_score), COUNT(DISTINCT v.endpoint_id), MIN(v.created_at)
FROM public.vulnerability_findings v
WHERE v.status = 'open' AND v.cvss_score >= 9.0 AND v.created_at < NOW() - INTERVAL '90 days'
GROUP BY 1, 2 ORDER BY 3 DESC;
```

**Endpoints not seen in 7 days but is_active**
```sql
SELECT o.name, e.hostname, e.last_seen_at FROM public.endpoints e
JOIN public.organizations o ON o.id = e.organization_id
WHERE e.is_active = true AND (e.last_seen_at IS NULL OR e.last_seen_at < NOW() - INTERVAL '7 days')
ORDER BY e.last_seen_at NULLS FIRST;
```

**Firewall events on suspicious port from external IP (potential brute-force)**
```sql
SELECT remote_address, local_port, COUNT(*), MIN(event_time), MAX(event_time)
FROM public.firewall_audit_logs
WHERE direction = 'inbound'
  AND local_port IN (22, 23, 445, 3389, 5900)
  AND remote_address !~ '^(10\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.|192\\.168\\.|127\\.|fc|fd|fe80)'
  AND event_time > NOW() - INTERVAL '7 days'
GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 25;
```

**Endpoints generating > 100k firewall events in 24h (lateral-movement signal)**
```sql
SELECT e.hostname, o.name, COUNT(*) FROM public.firewall_audit_logs fw
JOIN public.endpoints e ON e.id = fw.endpoint_id
JOIN public.organizations o ON o.id = e.organization_id
WHERE fw.event_time > NOW() - INTERVAL '24 hours'
GROUP BY 1, 2 HAVING COUNT(*) > 100000 ORDER BY 3 DESC;
```

**Recently mitigated CVEs (last 7 days) — celebrate**
```sql
SELECT v.cve_id, v.affected_software, v.cvss_score, v.resolved_at
FROM public.vulnerability_findings v
WHERE v.status = 'mitigated' AND v.resolved_at > NOW() - INTERVAL '7 days'
ORDER BY v.resolved_at DESC;
```
"""


# ── Endpoint inventory (y=32..41) ───────────────────────────────────────────
ENDPOINT_INVENTORY = """
WITH latest_status AS (
  SELECT DISTINCT ON (endpoint_id) endpoint_id, realtime_protection_enabled, collected_at
  FROM public.endpoint_status ORDER BY endpoint_id, collected_at DESC
),
threats_per AS (
  SELECT endpoint_id, COUNT(*) AS active_threats
  FROM public.endpoint_threats
  WHERE status='Active' AND COALESCE(manual_resolution_active,false)=false
  GROUP BY endpoint_id
)
SELECT
  o.name AS "Customer",
  e.hostname AS "Hostname",
  e.os_version AS "OS",
  CASE WHEN e.is_online THEN 'Online' ELSE 'Offline' END AS "Status",
  CASE
    WHEN e.last_seen_at IS NULL THEN 'Never'
    WHEN e.last_seen_at > NOW() - INTERVAL '1 hour' THEN ROUND(EXTRACT(EPOCH FROM (NOW()-e.last_seen_at))/60)::text || 'm ago'
    WHEN e.last_seen_at > NOW() - INTERVAL '1 day' THEN ROUND(EXTRACT(EPOCH FROM (NOW()-e.last_seen_at))/3600)::text || 'h ago'
    ELSE ROUND(EXTRACT(EPOCH FROM (NOW()-e.last_seen_at))/86400)::text || 'd ago'
  END AS "Last Seen",
  CASE WHEN ls.realtime_protection_enabled IS TRUE THEN 'On'
       WHEN ls.realtime_protection_enabled IS FALSE THEN 'Off'
       ELSE '?' END AS "RTP",
  COALESCE(e.defender_version, '—') AS "Defender",
  COALESCE(e.agent_version, '—') AS "Agent",
  COALESCE(tp.active_threats, 0)::int AS "Threats"
FROM public.endpoints e
JOIN public.organizations o ON o.id = e.organization_id
LEFT JOIN latest_status ls ON ls.endpoint_id = e.id
LEFT JOIN threats_per tp ON tp.endpoint_id = e.id
WHERE e.is_active = true
  AND """ + ORG_FILTER + """
ORDER BY tp.active_threats DESC NULLS LAST, e.last_seen_at DESC NULLS LAST
"""

# ── Vulnerability profile (y=42..49) ────────────────────────────────────────
TOP_VULNS = """
SELECT
  v.cve_id AS "CVE",
  v.affected_software AS "Software",
  MAX(v.cvss_score)::numeric(4,1) AS "CVSS",
  COUNT(DISTINCT v.endpoint_id)::int AS "# Endpoints",
  string_agg(DISTINCT e.hostname, ', ' ORDER BY e.hostname) AS "Affected Hosts",
  string_agg(DISTINCT o.name, ', ' ORDER BY o.name) AS "Customers",
  to_char(MIN(v.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "First Seen",
  CASE
    WHEN (NOW() - MIN(v.created_at)) > INTERVAL '90 days' THEN 'OVERDUE'
    WHEN (NOW() - MIN(v.created_at)) > INTERVAL '30 days' THEN 'Aging'
    ELSE 'Recent'
  END AS "Age",
  EXTRACT(EPOCH FROM (NOW() - MIN(v.created_at)))::bigint / 86400 AS "Days Open"
FROM public.vulnerability_findings v
JOIN public.endpoints e ON e.id = v.endpoint_id
JOIN public.organizations o ON o.id = e.organization_id
WHERE v.status = 'open'
  AND """ + ORG_FILTER + """
GROUP BY v.cve_id, v.affected_software
ORDER BY MAX(v.cvss_score) DESC NULLS LAST, COUNT(DISTINCT v.endpoint_id) DESC
LIMIT 25
"""

# ── Recent activity (y=50..57) ──────────────────────────────────────────────
RECENT_ACTIVITY = """
SELECT
  to_char(el.event_time AT TIME ZONE 'UTC', 'MM-DD HH24:MI') AS "Time",
  o.name AS "Customer",
  e.hostname AS "Endpoint",
  el.level AS "Level",
  COALESCE(el.log_source, '—') AS "Source",
  LEFT(el.message, 180) AS "Message"
FROM public.endpoint_event_logs el
JOIN public.endpoints e ON e.id = el.endpoint_id
JOIN public.organizations o ON o.id = e.organization_id
WHERE el.level IN ('Critical','Error','Warning')
  AND """ + ORG_FILTER + """
ORDER BY el.event_time DESC
LIMIT 50
"""

# ── Firewall (y=58..63, collapsed) ──────────────────────────────────────────
FW_TREND = """
SELECT
  $__timeGroupAlias(fw.event_time, '$__interval'),
  fw.direction AS metric,
  COUNT(*)::int AS value
FROM public.firewall_audit_logs fw
WHERE $__timeFilter(fw.event_time)
  AND fw.""" + ORG_FILTER_BARE + """
GROUP BY 1, 2
ORDER BY 1
"""

# ─────────────────────────────────────────────────────────────────────────────
# Assemble panels
# ─────────────────────────────────────────────────────────────────────────────

panels = []

# Row 1: KPI strip
panels.append(stat(1, "Active Threats (S+H)", {"x": 0, "y": 0, "w": 5, "h": 4}, KPI_THREATS,
                   [(0, "green"), (1, "red")]))
panels.append(stat(2, "Critical CVEs Open", {"x": 5, "y": 0, "w": 5, "h": 4}, KPI_CRIT_CVES,
                   [(0, "green"), (1, "red")]))
panels.append(stat(3, "Endpoints Offline >24h", {"x": 10, "y": 0, "w": 5, "h": 4}, KPI_OFFLINE,
                   [(0, "green"), (1, "orange"), (5, "red")]))
panels.append(stat(4, "RTP Disabled", {"x": 15, "y": 0, "w": 5, "h": 4}, KPI_RTP_OFF,
                   [(0, "green"), (1, "red")]))
panels.append(stat(5, "Customers Needing Attention", {"x": 20, "y": 0, "w": 4, "h": 4}, KPI_CUSTOMERS_NEEDING,
                   [(0, "green"), (1, "orange"), (3, "red")]))

# Row 2: Customer Risk Ranking
risk_panel = panel(
    10, "Customer Risk Ranking (sorted by score, click name → drill down)",
    {"x": 0, "y": 8, "w": 24, "h": 10},
    "table", CUSTOMER_RANKING,
    fieldConfig={
        "defaults": {
            "custom": {"align": "auto", "cellOptions": {"type": "auto"}, "inspect": False},
            "color": {"mode": "thresholds"},
            "thresholds": {"mode": "absolute", "steps": [{"color": "transparent", "value": None}]},
            "mappings": [],
        },
        "overrides": [
            {
                "matcher": {"id": "byName", "options": "Risk"},
                "properties": [
                    {"id": "custom.cellOptions", "value": {"type": "color-background", "mode": "gradient"}},
                    {"id": "color", "value": {"mode": "thresholds"}},
                    {"id": "thresholds", "value": {"mode": "absolute", "steps": [
                        {"color": "green", "value": None},
                        {"color": "yellow", "value": 5},
                        {"color": "orange", "value": 10},
                        {"color": "red", "value": 25},
                    ]}},
                ],
            },
            {
                "matcher": {"id": "byName", "options": "Threats (S+H)"},
                "properties": [
                    {"id": "custom.cellOptions", "value": {"type": "color-background"}},
                    {"id": "thresholds", "value": {"mode": "absolute", "steps": [
                        {"color": "transparent", "value": None}, {"color": "red", "value": 1},
                    ]}},
                    {"id": "links", "value": [{
                        "title": "View action list for ${__data.fields.Customer}",
                        "url": "/d/peritus-soc-overview?var-org=${__data.fields._org_id}&viewPanel=11",
                    }]},
                ],
            },
            {
                "matcher": {"id": "byName", "options": "Critical CVEs"},
                "properties": [
                    {"id": "custom.cellOptions", "value": {"type": "color-background"}},
                    {"id": "thresholds", "value": {"mode": "absolute", "steps": [
                        {"color": "transparent", "value": None}, {"color": "red", "value": 1},
                    ]}},
                    {"id": "links", "value": [{
                        "title": "Show CVEs for ${__data.fields.Customer}",
                        "url": "/d/peritus-soc-overview?var-org=${__data.fields._org_id}&viewPanel=40",
                    }]},
                ],
            },
            {
                "matcher": {"id": "byName", "options": "RTP Off"},
                "properties": [
                    {"id": "custom.cellOptions", "value": {"type": "color-background"}},
                    {"id": "thresholds", "value": {"mode": "absolute", "steps": [
                        {"color": "transparent", "value": None}, {"color": "red", "value": 1},
                    ]}},
                    {"id": "links", "value": [{
                        "title": "Show endpoint inventory for ${__data.fields.Customer}",
                        "url": "/d/peritus-soc-overview?var-org=${__data.fields._org_id}&viewPanel=30",
                    }]},
                ],
            },
            {
                "matcher": {"id": "byName", "options": "Offline >24h"},
                "properties": [
                    {"id": "custom.cellOptions", "value": {"type": "color-background"}},
                    {"id": "thresholds", "value": {"mode": "absolute", "steps": [
                        {"color": "transparent", "value": None}, {"color": "orange", "value": 1},
                    ]}},
                    {"id": "links", "value": [{
                        "title": "Show endpoint inventory for ${__data.fields.Customer}",
                        "url": "/d/peritus-soc-overview?var-org=${__data.fields._org_id}&viewPanel=30",
                    }]},
                ],
            },
            {
                "matcher": {"id": "byName", "options": "Endpoints"},
                "properties": [
                    {"id": "links", "value": [{
                        "title": "Show endpoint inventory for ${__data.fields.Customer}",
                        "url": "/d/peritus-soc-overview?var-org=${__data.fields._org_id}&viewPanel=30",
                    }]},
                ],
            },
            {
                "matcher": {"id": "byName", "options": "_org_id"},
                "properties": [{"id": "custom.hidden", "value": True}],
            },
            {
                "matcher": {"id": "byName", "options": "Customer"},
                "properties": [{"id": "links", "value": [{
                    "title": "Drill into ${__data.fields.Customer}",
                    "url": "/d/peritus-soc-overview?var-org=${__data.fields._org_id}",
                }]}],
            },
        ],
    },
    options={
        "showHeader": True,
        "sortBy": [{"displayName": "Risk", "desc": True}],
        "footer": {"show": False, "reducer": ["sum"], "fields": ""},
    },
)
panels.append(risk_panel)

# Row 3: Action List
action_panel = panel(
    11, "Priority Action List (strict — every row is a real action)",
    {"x": 0, "y": 18, "w": 24, "h": 10},
    "table", ACTION_LIST,
    fieldConfig={
        "defaults": {
            "custom": {"align": "auto", "cellOptions": {"type": "auto"}},
            "color": {"mode": "thresholds"},
            "mappings": [],
            "thresholds": {"mode": "absolute", "steps": [{"color": "transparent", "value": None}]},
        },
        "overrides": [
            {
                "matcher": {"id": "byName", "options": "Pri"},
                "properties": [
                    {"id": "custom.cellOptions", "value": {"type": "color-background", "mode": "basic"}},
                    {"id": "thresholds", "value": {"mode": "absolute", "steps": [
                        {"color": "red", "value": None},
                        {"color": "orange", "value": 2},
                        {"color": "yellow", "value": 3},
                    ]}},
                    {"id": "custom.width", "value": 50},
                ],
            },
            {
                "matcher": {"id": "byName", "options": "Severity"},
                "properties": [
                    {"id": "mappings", "value": [
                        {"type": "value", "options": {"Severe": {"color": "red", "index": 0}}},
                        {"type": "value", "options": {"High":   {"color": "orange", "index": 1}}},
                        {"type": "value", "options": {"Medium": {"color": "yellow", "index": 2}}},
                    ]},
                    {"id": "custom.cellOptions", "value": {"type": "color-text"}},
                ],
            },
            {
                "matcher": {"id": "byName", "options": "Detail"},
                "properties": [{"id": "custom.width", "value": 480}],
            },
            {
                "matcher": {"id": "byName", "options": "Action"},
                "properties": [{"id": "custom.width", "value": 320}],
            },
        ],
    },
    options={
        "showHeader": True,
        "sortBy": [{"displayName": "Pri", "desc": False}],
        "footer": {"show": True, "reducer": ["count"], "fields": ["Issue"]},
    },
)
panels.append(action_panel)

# Row 4: Trends
def timeseries(id_, title, gridPos, sql, severity_color=False):
    fc = {
        "defaults": {
            "color": {"mode": "palette-classic"},
            "custom": {
                "drawStyle": "bars",
                "lineWidth": 0,
                "fillOpacity": 90,
                "barAlignment": 0,
                "stacking": {"mode": "normal", "group": "A"},
                "showPoints": "never",
                "spanNulls": False,
            },
            "mappings": [],
        },
        "overrides": [],
    }
    if severity_color:
        fc["overrides"] = [
            {"matcher": {"id": "byName", "options": "Severe"}, "properties": [{"id": "color", "value": {"mode": "fixed", "fixedColor": "red"}}]},
            {"matcher": {"id": "byName", "options": "High"},   "properties": [{"id": "color", "value": {"mode": "fixed", "fixedColor": "orange"}}]},
            {"matcher": {"id": "byName", "options": "Moderate"},"properties": [{"id": "color", "value": {"mode": "fixed", "fixedColor": "yellow"}}]},
            {"matcher": {"id": "byName", "options": "Low"},    "properties": [{"id": "color", "value": {"mode": "fixed", "fixedColor": "blue"}}]},
        ]
    return panel(
        id_, title, gridPos, "timeseries", sql,
        fieldConfig=fc,
        options={
            "legend": {"showLegend": True, "displayMode": "list", "placement": "bottom", "calcs": []},
            "tooltip": {"mode": "multi", "sort": "desc"},
        },
    )


# Row 1.5: Posture Coverage KPIs (NEW)
panels.append(stat(6,  "% Endpoints Reporting (7d)", {"x": 0,  "y": 4, "w": 6, "h": 4}, COV_REPORTING_PCT,
                   [(0, "red"), (50, "orange"), (90, "yellow"), (99, "green")], unit="percent"))
panels.append(stat(7,  "% RTP Enabled",              {"x": 6,  "y": 4, "w": 6, "h": 4}, COV_RTP_PCT,
                   [(0, "red"), (90, "yellow"), (99, "green")], unit="percent"))
panels.append(stat(8,  "% Defender Current",         {"x": 12, "y": 4, "w": 6, "h": 4}, COV_DEFENDER_CURRENT_PCT,
                   [(0, "red"), (75, "orange"), (95, "yellow"), (99, "green")], unit="percent"))
panels.append(stat(9,  "Avg Days CVEs Open",         {"x": 18, "y": 4, "w": 6, "h": 4}, COV_AVG_CVE_AGE,
                   [(0, "green"), (30, "yellow"), (60, "orange"), (90, "red")], unit="d"))


# Row 4: CVE Patching Velocity + Activity Heatmap (REPLACES threat-trend + event-log-trend)
def patching_panel():
    return panel(
        20, "CVE patching velocity (opened vs mitigated)",
        {"x": 0, "y": 28, "w": 12, "h": 8},
        "timeseries", PATCHING_VELOCITY,
        fieldConfig={
            "defaults": {"color": {"mode": "palette-classic"}, "custom": {
                "drawStyle": "bars", "lineWidth": 0, "fillOpacity": 80, "stacking": {"mode": "none", "group": "A"}, "showPoints": "never",
            }},
            "overrides": [
                {"matcher": {"id": "byName", "options": "Opened"},    "properties": [{"id": "color", "value": {"mode": "fixed", "fixedColor": "red"}}]},
                {"matcher": {"id": "byName", "options": "Mitigated"}, "properties": [{"id": "color", "value": {"mode": "fixed", "fixedColor": "green"}}]},
            ],
        },
        options={"legend": {"showLegend": True, "displayMode": "list", "placement": "bottom"}, "tooltip": {"mode": "multi", "sort": "desc"}},
    )


def heatmap_panel():
    return panel(
        21, "Endpoint activity heatmap (events by hour of day)",
        {"x": 12, "y": 28, "w": 12, "h": 8},
        "heatmap", ACTIVITY_HEATMAP,
        fieldConfig={"defaults": {"custom": {"scaleDistribution": {"type": "linear"}, "hideFrom": {"tooltip": False, "viz": False, "legend": False}}}, "overrides": []},
        options={
            "calculate": False,
            "color": {"scheme": "Oranges", "fill": "dark-orange", "mode": "scheme", "steps": 64, "reverse": False, "exponent": 0.5},
            "cellGap": 1, "cellValues": {"unit": "short"},
            "yAxis": {"axisPlacement": "left", "reverse": False, "unit": "short"},
            "rowsFrame": {"layout": "auto", "value": "hour"},
            "tooltip": {"mode": "single", "yHistogram": False, "showColorScale": False},
            "legend": {"show": True},
            "exemplars": {"color": "rgba(255,0,255,0.7)"},
        },
    )

panels.append(patching_panel())
panels.append(heatmap_panel())

# Row 5: Endpoint Inventory
inv_panel = panel(
    30, "Endpoint Inventory (sorted by open threats, then most-recent)",
    {"x": 0, "y": 36, "w": 24, "h": 10},
    "table", ENDPOINT_INVENTORY,
    fieldConfig={
        "defaults": {"custom": {"align": "auto"}, "mappings": [], "thresholds": {"mode": "absolute", "steps": [{"color": "transparent", "value": None}]}},
        "overrides": [
            {"matcher": {"id": "byName", "options": "Status"},
             "properties": [{"id": "mappings", "value": [
                 {"type": "value", "options": {"Online":  {"color": "green",  "index": 0}}},
                 {"type": "value", "options": {"Offline": {"color": "red",    "index": 1}}},
             ]}, {"id": "custom.cellOptions", "value": {"type": "color-text"}}]},
            {"matcher": {"id": "byName", "options": "RTP"},
             "properties": [{"id": "mappings", "value": [
                 {"type": "value", "options": {"On":  {"color": "green", "index": 0}}},
                 {"type": "value", "options": {"Off": {"color": "red",   "index": 1}}},
                 {"type": "value", "options": {"?":   {"color": "yellow","index": 2}}},
             ]}, {"id": "custom.cellOptions", "value": {"type": "color-text"}}]},
            {"matcher": {"id": "byName", "options": "Threats"},
             "properties": [
                 {"id": "custom.cellOptions", "value": {"type": "color-background"}},
                 {"id": "thresholds", "value": {"mode": "absolute", "steps": [
                     {"color": "transparent", "value": None}, {"color": "red", "value": 1},
                 ]}},
             ]},
        ],
    },
    options={"showHeader": True, "sortBy": [{"displayName": "Threats", "desc": True}]},
)
panels.append(inv_panel)

# Row 6: Vulnerabilities
vuln_panel = panel(
    40, "Open vulnerabilities (click CVE → NVD lookup; click hosts → endpoint inventory)",
    {"x": 0, "y": 46, "w": 24, "h": 10},
    "table", TOP_VULNS,
    fieldConfig={
        "defaults": {"custom": {"align": "auto"}, "thresholds": {"mode": "absolute", "steps": [{"color": "transparent", "value": None}]}},
        "overrides": [
            {"matcher": {"id": "byName", "options": "CVSS"},
             "properties": [
                 {"id": "custom.cellOptions", "value": {"type": "color-background", "mode": "gradient"}},
                 {"id": "thresholds", "value": {"mode": "absolute", "steps": [
                     {"color": "green", "value": None}, {"color": "yellow", "value": 4},
                     {"color": "orange", "value": 7}, {"color": "red", "value": 9},
                 ]}},
                 {"id": "custom.width", "value": 70},
             ]},
            {"matcher": {"id": "byName", "options": "CVE"},
             "properties": [
                 {"id": "links", "value": [{
                     "title": "Look up ${__value.text} on NVD",
                     "url": "https://nvd.nist.gov/vuln/detail/${__value.text}",
                     "targetBlank": True,
                 }]},
                 {"id": "custom.width", "value": 140},
             ]},
            {"matcher": {"id": "byName", "options": "Age"},
             "properties": [
                 {"id": "mappings", "value": [
                     {"type": "value", "options": {"OVERDUE": {"color": "red", "index": 0}}},
                     {"type": "value", "options": {"Aging":   {"color": "orange", "index": 1}}},
                     {"type": "value", "options": {"Recent":  {"color": "green", "index": 2}}},
                 ]},
                 {"id": "custom.cellOptions", "value": {"type": "color-text"}},
                 {"id": "custom.width", "value": 90},
             ]},
            {"matcher": {"id": "byName", "options": "Days Open"},
             "properties": [{"id": "custom.width", "value": 90}]},
            {"matcher": {"id": "byName", "options": "# Endpoints"},
             "properties": [{"id": "custom.width", "value": 90}]},
            {"matcher": {"id": "byName", "options": "Affected Hosts"},
             "properties": [
                 {"id": "links", "value": [{
                     "title": "Show endpoint inventory",
                     "url": "/d/peritus-soc-overview?${org:queryparam}&viewPanel=30",
                 }]},
             ]},
        ],
    },
    options={"showHeader": True, "sortBy": [{"displayName": "CVSS", "desc": True}]},
)
panels.append(vuln_panel)

# Row 7: Recent Activity
act_panel = panel(
    50, "Recent endpoint events (Critical/Error/Warning, last 50)",
    {"x": 0, "y": 56, "w": 24, "h": 8},
    "table", RECENT_ACTIVITY,
    fieldConfig={
        "defaults": {"custom": {"align": "auto"}, "thresholds": {"mode": "absolute", "steps": [{"color": "transparent", "value": None}]}},
        "overrides": [
            {"matcher": {"id": "byName", "options": "Level"},
             "properties": [
                 {"id": "mappings", "value": [
                     {"type": "value", "options": {"Critical": {"color": "red",    "index": 0}}},
                     {"type": "value", "options": {"Error":    {"color": "orange", "index": 1}}},
                     {"type": "value", "options": {"Warning":  {"color": "yellow", "index": 2}}},
                 ]},
                 {"id": "custom.cellOptions", "value": {"type": "color-text"}},
             ]},
            {"matcher": {"id": "byName", "options": "Message"},
             "properties": [{"id": "custom.width", "value": 600}]},
        ],
    },
)
panels.append(act_panel)

# ─── Collapsed row sections ─────────────────────────────────────────────────

def simple_table(id_, title, gridPos, sql, color_rules=None, hidden_cols=None, column_widths=None, datalinks_per_col=None):
    overrides = []
    if color_rules:
        for col, rules in color_rules.items():
            overrides.append({"matcher": {"id": "byName", "options": col}, "properties": [
                {"id": "custom.cellOptions", "value": {"type": "color-background"}},
                {"id": "thresholds", "value": {"mode": "absolute", "steps": rules}},
            ]})
    if hidden_cols:
        for col in hidden_cols:
            overrides.append({"matcher": {"id": "byName", "options": col}, "properties": [{"id": "custom.hidden", "value": True}]})
    if column_widths:
        for col, w in column_widths.items():
            overrides.append({"matcher": {"id": "byName", "options": col}, "properties": [{"id": "custom.width", "value": w}]})
    if datalinks_per_col:
        for col, links in datalinks_per_col.items():
            overrides.append({"matcher": {"id": "byName", "options": col}, "properties": [{"id": "links", "value": links}]})
    return panel(id_, title, gridPos, "table", sql,
        fieldConfig={"defaults": {"custom": {"align": "auto"}, "thresholds": {"mode": "absolute", "steps": [{"color": "transparent", "value": None}]}}, "overrides": overrides},
        options={"showHeader": True},
    )


# ━━━ Section: Coverage Gaps (collapsed) ━━━
section_coverage = {
    "id": 200,
    "type": "row",
    "title": "🛡️  Coverage Gaps — endpoints we can't see, signatures going stale",
    "gridPos": {"x": 0, "y": 64, "w": 24, "h": 1},
    "collapsed": True,
    "panels": [
        simple_table(
            201, "Endpoints never reported (likely failed agent install)",
            {"x": 0, "y": 65, "w": 12, "h": 8}, ENDPOINTS_NEVER_REPORTED,
            color_rules={"Last Activity": [{"color": "red", "value": None}]},
        ),
        simple_table(
            202, "Stale Defender signature (older than fleet leader)",
            {"x": 12, "y": 65, "w": 12, "h": 8}, STALE_DEFENDER,
            color_rules={"Installed": [{"color": "orange", "value": None}]},
        ),
    ],
}
panels.append(section_coverage)

# ━━━ Section: Threat Hunt (collapsed) ━━━
section_hunt = {
    "id": 300,
    "type": "row",
    "title": "🎯  Threat Hunt — suspicious ports, external destinations, traffic outliers",
    "gridPos": {"x": 0, "y": 65, "w": 24, "h": 1},
    "collapsed": True,
    "panels": [
        simple_table(
            301, "Suspicious inbound ports (SSH/Telnet/SMB/RDP/VNC/IRC/DB/mail)",
            {"x": 0, "y": 66, "w": 24, "h": 10}, SUSPICIOUS_PORTS,
            color_rules={"Events": [{"color": "transparent", "value": None}, {"color": "orange", "value": 100}, {"color": "red", "value": 10000}]},
            column_widths={"Port": 80, "Service": 110, "Events": 100},
        ),
        simple_table(
            302, "External destinations (RFC1918 + loopback + link-local excluded)",
            {"x": 0, "y": 76, "w": 12, "h": 9}, EXTERNAL_DESTINATIONS,
            color_rules={"Events": [{"color": "transparent", "value": None}, {"color": "orange", "value": 1000}]},
        ),
        simple_table(
            303, "Outlier endpoints (firewall traffic > 2σ above fleet mean)",
            {"x": 12, "y": 76, "w": 12, "h": 9}, OUTLIER_ENDPOINTS,
            color_rules={"σ above mean": [{"color": "orange", "value": None}, {"color": "red", "value": 3.0}]},
        ),
    ],
}
panels.append(section_hunt)

# ━━━ Section: Customer Comparison (collapsed) ━━━
section_compare = {
    "id": 400,
    "type": "row",
    "title": "📊  Customer Comparison — trust scores, week-over-week trends",
    "gridPos": {"x": 0, "y": 66, "w": 24, "h": 1},
    "collapsed": True,
    "panels": [
        simple_table(
            401, "Trust Score (100 = best; falls with active threats, critical CVEs, offline endpoints, RTP off)",
            {"x": 0, "y": 67, "w": 12, "h": 9}, TRUST_SCORE,
            color_rules={"Trust Score": [
                {"color": "red", "value": None},
                {"color": "orange", "value": 50},
                {"color": "yellow", "value": 75},
                {"color": "green", "value": 90},
            ]},
        ),
        simple_table(
            402, "Weekly posture delta (Δ vs 7 days ago)",
            {"x": 12, "y": 67, "w": 12, "h": 9}, WEEKLY_DELTA,
            color_rules={
                "CVE Δ": [{"color": "green", "value": None}, {"color": "transparent", "value": -0.01}, {"color": "red", "value": 1}],
                "Threat Δ": [{"color": "green", "value": None}, {"color": "transparent", "value": -0.01}, {"color": "red", "value": 1}],
            },
        ),
    ],
}
panels.append(section_compare)

# ━━━ Section: Firewall trend (collapsed) ━━━
section_firewall = {
    "id": 500,
    "type": "row",
    "title": "🔥  Firewall — traffic volume by direction",
    "gridPos": {"x": 0, "y": 67, "w": 24, "h": 1},
    "collapsed": True,
    "panels": [
        timeseries(501, "Firewall events by direction", {"x": 0, "y": 68, "w": 24, "h": 8}, FW_TREND),
    ],
}
panels.append(section_firewall)

# ━━━ Section: Hunt Bookmarks (collapsed markdown) ━━━
section_bookmarks = {
    "id": 600,
    "type": "row",
    "title": "📖  Hunt Bookmarks — saved SQL snippets for the Explore view",
    "gridPos": {"x": 0, "y": 68, "w": 24, "h": 1},
    "collapsed": True,
    "panels": [
        {
            "id": 601,
            "type": "text",
            "title": "",
            "gridPos": {"x": 0, "y": 69, "w": 24, "h": 16},
            "options": {"mode": "markdown", "content": HUNT_BOOKMARKS_MD},
        },
    ],
}
panels.append(section_bookmarks)

# ─────────────────────────────────────────────────────────────────────────────

dashboard = {
    "title": "Peritus SOC Overview",
    "uid": "peritus-soc-overview",
    "schemaVersion": 39,
    "version": 1,
    "tags": ["soc", "peritus"],
    "timezone": "browser",
    "refresh": "1m",
    "time": {"from": "now-7d", "to": "now"},
    "timepicker": {},
    "weekStart": "",
    "editable": True,
    "fiscalYearStartMonth": 0,
    "graphTooltip": 0,
    "liveNow": False,
    "annotations": {"list": []},
    "templating": {
        "list": [
            {
                "name": "org",
                "label": "Customer",
                "type": "query",
                "datasource": DS,
                "query": "SELECT name AS __text, id::text AS __value FROM public.organizations ORDER BY name",
                "refresh": 1,
                "regex": "",
                "sort": 1,
                "multi": True,
                "includeAll": True,
                "current": {"text": "All", "value": ["$__all"]},
            }
        ]
    },
    "panels": panels,
}

out = Path(sys.argv[1] if len(sys.argv) > 1 else "soc-overview.json")
out.write_text(json.dumps(dashboard, indent=2))
print(f"wrote {out} ({out.stat().st_size} bytes, {len(panels)} top-level items)")
