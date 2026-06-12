---
title: Decommission a retired endpoint
audience: partner
description: Authorise the tamper-protected uninstall path so a returned, replaced, or offboarded device is cleanly removed from the customer estate.
order: 4
estimated_minutes: 5
updated_at: 2026-06-12
tags: agent, uninstall, lifecycle, offboarding
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure authorises a tamper-protected uninstall of the Mithras agent on a specific endpoint and records the justification in the audit trail. The procedure is the supported path for decommissioning returned, replaced, or offboarded devices and is the only mechanism that releases the licence allocation cleanly.

## Audience and authority
Reseller staff whose user record carries a `partner` role on the partner organisation, with scope set to the customer organisation that owns the endpoint. The action invokes the `authorize_endpoint_uninstall` Remote Procedure Call (RPC), which rejects callers lacking administrative authority on the owning organisation.

## Prerequisites
- The endpoint is owned by a customer in your managed estate and is visible at `/endpoints`.
- The endpoint is online or is expected to come online within 30 minutes. The agent collects the uninstall command on its next heartbeat.
- You hold the device hostname and the business reason for decommissioning, sufficient for an audit reviewer to understand the action without further context.
- The customer has authorised the decommission either through a ticket reference, written approval, or an explicit decommission policy.

## Procedure

1. Open `/endpoints` and select the target endpoint to open `/endpoints/:id`.
2. Confirm the device identity in the endpoint header: hostname, last-seen timestamp, owning customer organisation, and assigned policy set.
3. Inspect the lifecycle row near the top of the page:
   - `Decommission` button indicates the endpoint is eligible for uninstall.
   - `Decommissioning` chip indicates an uninstall is in flight; proceed to Verification.
   - `Uninstalled` chip indicates the endpoint is already decommissioned.
4. Select `Decommission`.
5. In the confirmation dialog, enter a justification of at least 10 characters that names the hostname and the reason. Acceptable examples include `Laptop AC-LAP-042 returned to IT, replaced by AC-LAP-118` and `Customer Acme offboarded per ticket #4421`.
6. Select `Decommission` to invoke `authorize_endpoint_uninstall`. A toast confirms the command was queued and names the target endpoint.

## Verification
- The lifecycle chip on `/endpoints/:id` transitions to `Uninstalled` within three minutes of agent confirmation.
- The endpoint moves to status `Offline` on `/endpoints` and ceases to emit heartbeats.
- Executing `Get-Service MithrasAgent` on the device returns a `Cannot find any service` error, confirming the service is removed.
- The licence allocation for the endpoint is released and visible in the next `licence_transactions` reconciliation on `/partner/credits`.

## Troubleshooting
- **The lifecycle chip remains `Decommissioning` after 30 minutes.** The agent has not reported back. Confirm the device is powered on and has network connectivity. Where the device is reachable, run the break-glass cleanup script from the customer's `/deploy` page under an elevated PowerShell session.
- **The wrong endpoint was decommissioned.** The command is not reversible once queued. Re-enrol the device using a fresh installer command from the customer's `/deploy` page. The new enrolment creates a distinct `endpoints` row; the original row remains in the audit trail.
- **`authorize_endpoint_uninstall` returns `permission_denied`.** Your scope is not on the customer that owns the endpoint. Switch scope in the console organisation switcher and retry.
- **The customer cannot see the lifecycle chip change.** The customer console refreshes the endpoint state every 30 seconds. Direct the customer to refresh the page; persistent failure indicates a stale session and requires sign-out and sign-in.

## Audit and compliance
- The RPC `authorize_endpoint_uninstall` writes a row to `public.activity_logs` with `action_type = 'endpoint_decommission_authorized'`, `actor_id = auth.uid()`, the target endpoint identifier, and the supplied justification.
- A second row is written with `action_type = 'endpoint_decommissioned'` when the agent confirms successful uninstall, capturing the agent's reported outcome.
- The justification text and lifecycle history are retained against `public.endpoints` and `public.activity_logs` for 24 months in line with the customer's data retention configuration.
- The released licence allocation is recorded as a `licence_transactions` credit tagged with the decommission identifier for reseller reconciliation.

## Related procedures
- [Bulk-queue an agent upgrade across out-of-date endpoints](/help/sops/partner/push-agent-update)
- [Provision a new customer organisation](/help/sops/partner/add-customer)
- [Install the Mithras agent on a Windows endpoint](/help/sops/customer_admin/install-agent-on-endpoint)
