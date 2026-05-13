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

# ── Threat trends (y=24..31) ────────────────────────────────────────────────
THREAT_TREND = """
SELECT
  $__timeGroupAlias(t.initial_detection_time, '$__interval'),
  t.severity AS metric,
  COUNT(*)::int AS value
FROM public.endpoint_threats t
JOIN public.endpoints e ON e.id = t.endpoint_id
WHERE $__timeFilter(t.initial_detection_time)
  AND """ + ORG_FILTER + """
GROUP BY 1, 2
ORDER BY 1
"""

EVENT_LOG_TREND = """
SELECT
  $__timeGroupAlias(el.event_time, '$__interval'),
  el.level AS metric,
  COUNT(*)::int AS value
FROM public.endpoint_event_logs el
JOIN public.endpoints e ON e.id = el.endpoint_id
WHERE $__timeFilter(el.event_time)
  AND """ + ORG_FILTER + """
GROUP BY 1, 2
ORDER BY 1
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
  COUNT(DISTINCT v.endpoint_id)::int AS "Endpoints",
  COUNT(DISTINCT e.organization_id)::int AS "Customers"
FROM public.vulnerability_findings v
JOIN public.endpoints e ON e.id = v.endpoint_id
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
    {"x": 0, "y": 4, "w": 24, "h": 10},
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
                ],
            },
            {
                "matcher": {"id": "byName", "options": "Critical CVEs"},
                "properties": [
                    {"id": "custom.cellOptions", "value": {"type": "color-background"}},
                    {"id": "thresholds", "value": {"mode": "absolute", "steps": [
                        {"color": "transparent", "value": None}, {"color": "red", "value": 1},
                    ]}},
                ],
            },
            {
                "matcher": {"id": "byName", "options": "RTP Off"},
                "properties": [
                    {"id": "custom.cellOptions", "value": {"type": "color-background"}},
                    {"id": "thresholds", "value": {"mode": "absolute", "steps": [
                        {"color": "transparent", "value": None}, {"color": "red", "value": 1},
                    ]}},
                ],
            },
            {
                "matcher": {"id": "byName", "options": "Offline >24h"},
                "properties": [
                    {"id": "custom.cellOptions", "value": {"type": "color-background"}},
                    {"id": "thresholds", "value": {"mode": "absolute", "steps": [
                        {"color": "transparent", "value": None}, {"color": "orange", "value": 1},
                    ]}},
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
    {"x": 0, "y": 14, "w": 24, "h": 10},
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


panels.append(timeseries(20, "Threats detected over time (by severity)", {"x": 0, "y": 24, "w": 12, "h": 8}, THREAT_TREND, severity_color=True))
panels.append(timeseries(21, "Endpoint event log volume (by level)", {"x": 12, "y": 24, "w": 12, "h": 8}, EVENT_LOG_TREND))

# Row 5: Endpoint Inventory
inv_panel = panel(
    30, "Endpoint Inventory (sorted by open threats, then most-recent)",
    {"x": 0, "y": 32, "w": 24, "h": 10},
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
    40, "Top open vulnerabilities (CVSS × prevalence)",
    {"x": 0, "y": 42, "w": 24, "h": 8},
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
             ]},
        ],
    },
    options={"showHeader": True, "sortBy": [{"displayName": "CVSS", "desc": True}]},
)
panels.append(vuln_panel)

# Row 7: Recent Activity
act_panel = panel(
    50, "Recent endpoint events (Critical/Error/Warning, last 50)",
    {"x": 0, "y": 50, "w": 24, "h": 8},
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

# Row 8: Firewall (collapsed row)
fw_panel = timeseries(60, "Firewall events by direction", {"x": 0, "y": 59, "w": 24, "h": 6}, FW_TREND)
fw_panel["collapsed"] = False  # the inner panel itself; we'll wrap in a row below

# Wrap the firewall panel in a collapsed row
firewall_row = {
    "id": 100,
    "type": "row",
    "title": "Firewall (click to expand)",
    "gridPos": {"x": 0, "y": 58, "w": 24, "h": 1},
    "collapsed": True,
    "panels": [fw_panel],
}
panels.append(firewall_row)

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
