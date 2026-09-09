---
title: Send events from non-Windows devices into Mithras
audience: customer_admin
description: Stream syslog, CEF, or JSON events from firewalls, routers, Linux hosts, and custom applications into Mithras using the public event-ingest endpoint.
order: 9
estimated_minutes: 12
updated_at: 2026-06-14
tags: siem, ingest, syslog, cef, leef, firewall, linux
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose

This procedure configures a non-Windows event source (a firewall, a router, a Linux host, or a custom application) to push events into Mithras. Events arrive in the `external_events` table inside your organisation, are surfaced in the SOC console alongside Defender threats, and flow through the same forwarder pipeline as Windows agent events. The procedure is the canonical way to extend Mithras visibility beyond the Windows agent without waiting for a native runtime for that platform.

## Audience and authority

Customer administrators whose `organization_memberships.role` is `admin` or `owner`. The ingest endpoint authenticates with a customer-issued API key that requires the `events:write` scope; only administrators can issue, scope, and revoke API keys.

## Prerequisites

- A device or application capable of sending HTTPS POST requests with a custom Authorization header. Common sources:
    - Fortinet FortiGate, pfSense, OPNsense, SonicWall, Sophos UTM, Cisco ASA / Meraki MX — all can forward syslog over HTTPS or via a small relay.
    - Linux host running `rsyslog` 8.x with `omhttp` module loaded.
    - Custom application that already emits CEF / LEEF / JSON event records.
- Outbound HTTPS to `api.mithras.com.au` from the source device.
- An API key for your Mithras organisation with the `events:write` scope. The scope is included in the **Read events** preset on the API keys page; if you used a more restrictive preset, edit the key and add `events:write`.

## Procedure

### 1. Issue an API key

1. Sign in to `https://www.mithras.com.au` as a customer administrator.
2. Open **Settings → API keys**.
3. Click **New key**. Choose a name that identifies the source (`fortigate-hq`, `linux-prod-web-01`, `pfsense-branch-melb`). Source-specific keys make rotation and revocation surgical.
4. Tick the `events:write` scope. Leave other scopes unticked unless this same key will be re-used to read data back.
5. Click **Create**. Copy the `mit_live_…` token immediately — Mithras never displays the raw token again. Paste it into your secrets manager.

### 2. Choose a wire format

Pick the format your source already speaks. All three are accepted by the same `event-ingest` endpoint:

| Wire format | Content-Type | Body shape |
|-------------|--------------|------------|
| Native JSON | `application/json` | `{"events": [ {…}, … ]}` |
| Syslog RFC 5424 | `application/json` | `{"messages": ["<165>1 …", …]}` |
| CEF, one per line | `text/plain` | newline-separated `CEF:0|Vendor|Product|…` lines |
| LEEF, one per line | `text/plain` | newline-separated `LEEF:2.0|Vendor|Product|…` lines |

JSON is the most explicit; you tell Mithras `source_kind`, `source_label`, `severity`, and any parsed fields directly. CEF and LEEF are simpler because the format defines them. Syslog RFC 5424 is the lowest common denominator for appliances that can only forward syslog.

### 3. Configure the source

#### Linux host using rsyslog 8.x with omhttp

Add this to `/etc/rsyslog.d/50-mithras.conf`, replacing the token:

```
module(load="omhttp")

action(
  type="omhttp"
  server="api.mithras.com.au"
  serverport="443"
  restpath="functions/v1/event-ingest"
  httpcontenttype="text/plain"
  template="RSYSLOG_SyslogProtocol23Format"
  httpheaders=[
    "Authorization: Bearer mit_live_REPLACE_ME_WITH_REAL_TOKEN",
    "Content-Type: text/plain"
  ]
  useHttps="on"
  batch="on"
  batch.format="kafkarest"
)
```

Reload rsyslog (`systemctl restart rsyslog`) and watch `/var/log/syslog` for delivery errors.

#### FortiGate / pfSense / generic appliance via a relay

Most appliances can forward syslog UDP/514 but few can perform an HTTPS POST with a Bearer header. Stand up a small relay alongside the appliance — a Linux box, container, or Cloudflare Worker that listens for syslog UDP and forwards each line into the JSON envelope below:

```http
POST /functions/v1/event-ingest HTTP/1.1
Host: api.mithras.com.au
Authorization: Bearer mit_live_REPLACE_ME_WITH_REAL_TOKEN
Content-Type: application/json

{
  "messages": [
    "<134>1 2026-06-14T07:14:00Z fg-hq fortios - - - srcip=203.0.113.5 action=blocked"
  ]
}
```

#### Custom application emitting JSON

Native JSON gives you direct control over `source_kind`, `source_label`, `severity` (`low`, `medium`, `high`, `critical`), `vendor`, `product`, `event_name`, and a `parsed` object of arbitrary key/value pairs:

```http
POST /functions/v1/event-ingest HTTP/1.1
Host: api.mithras.com.au
Authorization: Bearer mit_live_REPLACE_ME_WITH_REAL_TOKEN
Content-Type: application/json

{
  "events": [
    {
      "source_kind": "custom_app",
      "source_label": "billing-api",
      "severity": "high",
      "vendor": "Acme",
      "product": "Billing",
      "event_name": "auth_failure_burst",
      "raw_message": "5 failed logins in 30s from 10.0.0.42",
      "parsed": { "user": "svc-billing", "src_ip": "10.0.0.42", "count": 5 }
    }
  ]
}
```

### 4. Confirm receipt in Mithras

1. From your source, send one event.
2. In the Mithras console, open **Hunting → Event search** or run a direct query against `external_events` filtered by `source_label`.
3. Expected response from a successful POST: `200 OK` with body `{"accepted":1}`. Anything else is a problem:
    - `400 invalid_json` — body wasn't valid JSON.
    - `400 expected_events_or_messages_array` — JSON was valid but didn't contain `events` or `messages`.
    - `400 no_events_parsed_from_plaintext` — sent `text/plain` but no `CEF:`, `LEEF:`, or `<pri>1` lines were found.
    - `401 invalid_token` — the API key has been revoked or doesn't exist.
    - `403 insufficient_scope` — the API key lacks `events:write`.
    - `413 too_many_events` — more than 500 events in a single POST. Split into smaller batches.

### 5. Forward the external events out to your SIEM (optional)

If you've followed `connect-siem-forwarding.md`, ingested external events are not yet forwarded by default. To include them, add `external` to the `event_categories` array on the destination row via the SIEM forwarding editor (the option appears once at least one external event has been ingested). This routes any future `external_events` insert into the outbox alongside Mithras-native events.

## Verification

The procedure is complete when all of the following are true:

- An HTTPS POST from your source returns `200 {"accepted": N}` for `N` greater than zero.
- The event appears in `external_events` for your organisation (visible via **Hunting → Event search** or the underlying table).
- The `source_kind`, `source_label`, and `severity` columns are populated as expected.
- A test send and a real event send have both succeeded within the same hour with no `4xx` responses in between.

## Rollback

If the integration is causing operational issues:

1. Revoke the API key from **Settings → API keys**. Future POSTs immediately return `401`; existing data is retained.
2. Disable or stop the rsyslog action / relay / custom app sending events. There is no harm in leaving previously-ingested rows in place.

## Related procedures

- `customer_admin/connect-siem-forwarding.md` — forward events the other direction (Mithras → SIEM).
- `partner/issue-customer-api-key.md` — partner-administered API key issuance for customers without admin access.

## Compliance notes

API keys are stored as SHA-256 hashes; Mithras never holds the raw token after issuance. Rotate keys at least every 12 months and immediately on suspicion of compromise. The ingest endpoint enforces a 1 MB body cap and 500-event-per-request cap to prevent log-flood denial-of-service; sources that exceed those limits should batch on their own side.

External events are stored alongside Windows agent events in the same per-organisation tables and are subject to the same retention windows.
