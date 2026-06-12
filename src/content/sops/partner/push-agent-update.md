---
title: Bulk-queue an agent upgrade across out-of-date endpoints
audience: partner
description: Use the bulk upgrade control on the endpoints view to roll the latest stable agent to every endpoint that is behind the target version.
order: 3
estimated_minutes: 5
updated_at: 2026-06-12
tags: agent, upgrade, maintenance, fleet
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure queues an agent upgrade command across every endpoint in the current scope that is running a version older than the current `Stable` channel release. Bulk upgrades close the window during which endpoints lack the latest detection logic, signed manifest, and tamper-protection improvements.

## Audience and authority
Reseller staff whose user record carries a `partner` role on the partner organisation, with scope set to a specific customer organisation or to your full managed estate. The control invokes the `bulk_queue_agent_upgrade` Remote Procedure Call (RPC) and is not visible to read-only members.

## Prerequisites
- You have selected the appropriate scope in the console organisation switcher. A reseller-wide scope upgrades every customer in your portfolio and must be a deliberate choice.
- The customer organisations within scope are not under a change freeze. Confirm via the customer's operations contact before queuing fleet-wide upgrades.
- You have read the release note for the target version and confirmed there are no documented incompatibilities with customer line-of-business software.
- The current time falls inside the maintenance window agreed with the customer, or you have explicit out-of-hours authorisation.

## Procedure

1. Open `/endpoints` in the Mithras console.
2. Inspect the version status banner immediately above the endpoint table:
   - `All up to date (v<version>)` indicates no action is required.
   - `Upgrade N to v<version>` indicates `N` endpoints are running an older version.
   - `Checking versions` indicates the version check has not completed; wait for the banner to resolve.
3. Select `Upgrade N to v<version>`.
4. Review the confirmation dialog. The dialog displays the exact count, the first ten hostnames with current and target versions, and the expected brief offline window per endpoint during the service swap.
5. If the scope or population is incorrect, select `Cancel` and adjust scope before retrying.
6. Select `Push to N`. The console invokes `bulk_queue_agent_upgrade` and returns a toast naming the count queued and the count skipped as already in flight.
7. Endpoints collect the upgrade command on the next heartbeat, typically within 60 seconds, and execute the signed update. Each endpoint is offline for 30 to 60 seconds during the service swap.

## Verification
- The version status banner re-evaluates within 30 seconds and shows a reduced count or `All up to date (v<version>)`.
- Individual endpoint pages at `/endpoints/:id` display the `Upgrade queued` chip during the in-flight window, then return to the `Up to date` badge.
- The agent activity panel on each endpoint records an entry of the form `agent_self_update -> v<version> ok`.
- The matching `activity_logs` rows for `action_type = 'agent_upgrade_queued'` reflect the count returned by the toast.

## Troubleshooting
- **A subset of endpoints remains behind for more than one hour.** The endpoints are offline at command dispatch. The queued command fires on next connection. Filter `/endpoints` by `status = 'offline'` to identify the population and follow up with the customer.
- **An endpoint records `upgrade_failed` in its activity panel.** The agent cannot reach the signed bundle storage. Verify the customer network is not intercepting `*.mithras.com.au` with a Transport Layer Security (TLS) inspecting proxy. Reissue the upgrade once connectivity is restored.
- **The wrong scope was queued.** In-flight upgrades cannot be cancelled. Patch releases are non-breaking by contract; allow the upgrade to complete and document the deviation in the customer's change log.
- **The version status banner shows `Checking versions` for more than two minutes.** The console version-check query has stalled. Refresh the page; if the state persists, escalate to the Peritus 24/7 SOC.

## Audit and compliance
- The RPC `bulk_queue_agent_upgrade` writes a row to `public.activity_logs` for every endpoint queued, with `action_type = 'agent_upgrade_queued'`, `actor_id = auth.uid()`, and the target version.
- A summary entry is written to `public.activity_logs` with `action_type = 'agent_bulk_upgrade'` capturing the requested scope and the count queued.
- Upgrade outcomes are recorded against `public.endpoints` through the `agent_version` and `last_upgrade_at` columns; the prior version is retained in `public.endpoint_version_history` for 24 months.

## Related procedures
- [Decommission a retired endpoint](/help/sops/partner/decommission-endpoint)
- [Respond to a security operations alert](/help/sops/partner/respond-to-soc-alert)
- [Install the Mithras agent on a Windows endpoint](/help/sops/customer_admin/install-agent-on-endpoint)
