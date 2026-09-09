---
title: Forward Mithras events to your SIEM
audience: customer_admin
description: Stream Mithras threats, alerts, and incidents into Splunk, Microsoft Sentinel, Elasticsearch, or any HTTPS endpoint your security team operates.
order: 8
estimated_minutes: 15
updated_at: 2026-06-14
tags: siem, integrations, splunk, sentinel, elastic, forwarding
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose

This procedure configures a SIEM destination so that Mithras forwards security events to an HTTPS endpoint of your choice. Each destination receives every event in the categories you enable (threats, alerts, incidents, optionally firewall traffic) within sixty seconds of the event being recorded. The procedure is the canonical way to fan Mithras telemetry into a customer-owned SIEM, replacing any prior arrangement such as polling the public REST API.

## Audience and authority

Customer administrators whose `organization_memberships.role` is `admin` or `owner`. The destination is stored against your organisation; only admins of your organisation, partner admins above your organisation, and Mithras super-admins can read or modify it. The auth token attached to a destination is never returned in API responses to non-admins.

## Prerequisites

- An HTTPS endpoint that accepts POST requests. Common targets:
    - Splunk HTTP Event Collector (Splunk Cloud or self-hosted)
    - Microsoft Sentinel Log Analytics Workspace
    - Elasticsearch cluster (`_doc` endpoint or `_bulk` endpoint)
    - Any custom webhook that accepts JSON, CEF, or LEEF
- The credential the endpoint expects (HEC token, workspace key, Elastic API key, or a Bearer secret of your choice).
- For Microsoft Sentinel: the workspace ID and the primary or secondary shared key, plus the desired custom-log table name (no underscores).
- For Elasticsearch on a bulk endpoint: the full bulk URL (e.g. `https://es.example.com/mithras/_bulk`).
- Network reachability from `api.mithras.com.au` to your endpoint over TCP/443. If your SIEM sits behind a VPN or private network, terminate a public HTTPS receiver in front of it (NGINX, Cloudflare Tunnel, AWS API Gateway).

## Procedure

### 1. Open the SIEM forwarding page

1. Sign in to `https://www.mithras.com.au` as a customer administrator.
2. From the left sidebar choose **Configuration → SIEM forwarding**.
3. Confirm the page header reads "SIEM forwarding" and your organisation name appears in the breadcrumb / tenant switcher.

### 2. Add a destination

1. Click **New destination**.
2. Enter a **Name** that distinguishes this destination from any others. Use the receiving system, not "main" or "primary" — e.g. `Acme-Splunk-Cloud`, `Sentinel-IT-Ops`, `Elastic-SOC-Cluster`.
3. Choose a **Kind**. The kind determines how Mithras frames the request:
    - `Generic webhook` — POST a JSON envelope of events with an optional Bearer token.
    - `Syslog over HTTPS` — POST `{"messages": ["<rfc5424>"...]}`.
    - `Splunk HEC` — POST one event-per-line in the HEC `{event: ...}` shape with `Splunk <token>` authentication.
    - `Microsoft Sentinel (Log Analytics)` — HMAC-SHA256 signed POST to `https://<workspaceId>.ods.opinsights.azure.com/api/logs`.
    - `Elasticsearch HTTP` — POST individual `_doc` events or NDJSON to `_bulk` when the bulk option is enabled.
4. Choose a **Format**:
    - `JSON` — recommended for webhook, Splunk HEC, Sentinel, and Elastic.
    - `CEF` (ArcSight-style) — recommended for SIEMs that prefer the ArcSight Common Event Format.
    - `LEEF` — recommended for IBM QRadar.
5. Paste the **Endpoint URL**. For Splunk HEC this is `https://<host>:8088/services/collector/event`; for Elasticsearch this is the full index URL ending in `_doc` or `_bulk`; for a generic webhook this is the full HTTPS URL of your receiver.
6. Paste the **Auth token / key**. Mithras stores this server-side and uses it as the appropriate header per kind. Treat the field as sensitive — closing the dialog clears the input.
7. For Sentinel, also fill in the **Workspace ID** and the desired **Custom-log table name** (default `MithrasEvents`).
8. For Elasticsearch, tick **Use _bulk endpoint** if and only if the endpoint URL points at the `_bulk` API.
9. Tick the **event categories** to forward. Defaults are `threats`, `alerts`, and `incidents`. The `firewall` category is high volume and should only be enabled when your SIEM has capacity to receive it.
10. Confirm **Enabled** is on.
11. Click **Create destination**.

### 3. Send a test event and confirm receipt

1. The destination now appears in the list. Click **Test** beside it.
2. Mithras inserts a synthetic event of category `test` into the outbox; the forwarder picks it up on the next cron tick (within 60 seconds).
3. In the destination's receiving system, locate the event by searching for `category=test` (JSON), `LEEF:...|test|...` (LEEF), or `CEF:0|Mithras|...|test|...` (CEF). The payload includes `sent_by: console` and a timestamp.
4. Back in the Mithras console, click **Recent** beside the destination. The test event should be marked with a green tick under "Last 50 events".
5. If the event is marked failed (red cross), expand the row to read the error. The most common causes are:
    - DNS or TLS failure (endpoint URL unreachable or invalid certificate)
    - Authentication rejected (wrong token, expired HEC token, missing Sentinel workspace key)
    - HTTP 413 Payload Too Large (destination has a small body limit; reduce categories)

### 4. Verify a real event flows end-to-end

1. From a test endpoint with the Mithras agent installed, trigger a benign detection. For Windows the simplest method is downloading the EICAR test file to `C:\Users\<user>\Downloads\eicar.txt`. Defender quarantines it within seconds and the agent ships a `threat` event to Mithras within the next agent heartbeat.
2. Mithras records the event in `endpoint_threats`. A trigger writes a copy to the outbox for every enabled destination whose `event_categories` includes `threat`.
3. Within 60 seconds the event reaches your SIEM. Confirm by searching your SIEM for the `threat_name` value (`EICAR_Test_File` for Defender's signature).
4. Clean up the EICAR file from quarantine if you don't want it lingering — see `customer_admin/review-threats.md` for the procedure.

### 5. Review failure handling

Failed deliveries retry on an exponential backoff: 30 seconds, 60 seconds, 120 seconds, 240 seconds, 480 seconds, 960 seconds, 1800 seconds, 3600 seconds. After eight attempts the event is marked `failed_permanent` and stops retrying. The destination's `last_failure_reason` field carries the most recent error string for the Mithras console; the per-event `last_error` is visible in the **Recent** drop-down for forensics.

Operate to these expectations:

- The destination's `last_success_at` should advance with every batch. If your SIEM is healthy and Mithras has events to send, this timestamp will move within the minute.
- Sustained `last_failure_at` without an intervening `last_success_at` indicates the destination is offline or misconfigured. Investigate immediately; events queued during an outage will keep retrying up to the backoff cap but a permanent outage will start losing events after eight attempts per event.

### 6. Decommission a destination

When a SIEM is retired or replaced:

1. Open SIEM forwarding.
2. Toggle the destination's **Enabled** switch off. New events stop being queued; events already in flight finish or expire normally.
3. After confirming downstream stakeholders have switched off any dashboards or alerts driven by that destination, click the trash icon to delete it. Deletion drops any still-queued events and removes the row entirely.

## Verification

The procedure is complete when all of the following are true:

- The destination appears in the SIEM forwarding list with **Enabled** on.
- A test event has been delivered and is visible in the receiving SIEM.
- A real threat event (e.g. EICAR) has been delivered and is visible in the receiving SIEM.
- The destination's `last_success_at` is more recent than its `last_failure_at`.
- No events for the destination have an `attempts` count greater than zero in **Recent** (or, if there are retries, they have all subsequently succeeded).

## Rollback

If the destination is causing operational issues:

1. Toggle the destination's **Enabled** switch off. This is non-destructive; the row is retained, the auth token is preserved, and toggling it back on resumes delivery from new events forward.
2. If the destination is delivering successfully but the receiving system is overwhelmed, disable the `firewall` category and keep `threats`, `alerts`, `incidents` enabled. These three categories combined produce orders of magnitude fewer events than firewall traffic.

## Related procedures

- `customer_admin/review-threats.md` — interpreting threat events.
- `customer_admin/understand-incident-detail.md` — interpreting the incident events that arrive in your SIEM.
- `customer_admin/set-up-notification-recipients.md` — receive email notifications in parallel with SIEM forwarding.

## Compliance notes

Mithras retains a copy of every forwarded event in `event_outbox` for thirty days after delivery for audit purposes. Auth tokens are stored unencrypted at rest inside the row, gated by row-level security; treat your SIEM credential the same way you would any other sensitive secret and rotate it whenever a member with administrator access to this Mithras organisation departs.

The forwarder operates inside Mithras infrastructure in Australia. Egress to your destination's endpoint URL crosses whatever region the URL resolves to; consider that path when reasoning about data residency.
