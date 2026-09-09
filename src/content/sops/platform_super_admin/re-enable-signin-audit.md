---
title: Re-enable Microsoft 365 sign-in and directory audit polling
audience: platform_super_admin
description: After a customer activates Entra ID Premium, guide them through the standard reconnect flow so the ITDR poller resumes sign-in and directory audit ingestion.
order: 5
estimated_minutes: 10
updated_at: 2026-06-12
tags: m365, itdr, entra
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

> **STATUS: PENDING AZURE AD APP REGISTRATION.** The ITDR sign-in and directory audit pipeline is implemented but cannot be activated by customers until the Mithras Azure AD multi-tenant application is registered and admin-consented for ITDR scopes. Until that registration completes, the reconnect flow described below will not surface sign-in or directory-audit data. The mailbox sweep and outbound-rule monitoring described in the email-security SOPs operate on a different Graph scope and are unaffected.

## Purpose
This procedure restores Microsoft 365 sign-in and directory audit ingestion for a customer tenant after the customer has activated an Entra ID Premium P1 or P2 entitlement on their Microsoft 365 tenant. Without Premium, the Identity Threat Detection and Response (ITDR) poller records `no_premium` against the `auditLogs/signIns` and `auditLogs/directoryAudits` Microsoft Graph endpoints and skips ingestion. The procedure ensures the customer reconnects through the standard tenant authorisation flow so the poller picks up the elevated scopes on the next cycle.

## Audience and authority
The operator executing this procedure is a Mithras platform operator whose `user_id` is present in `public.super_admins`. The route `/m365` is gated by `is_super_admin(auth.uid())` for cross-tenant visibility. The reconnect flow itself is executed by the customer's Microsoft 365 administrator, not by the operator; Mithras platform operators do not perform admin consent on a customer tenant.

## Prerequisites
- The customer's Microsoft 365 administrator has confirmed in writing that the tenant has been upgraded to a SKU that includes Entra ID Premium P1 or P2, such as Microsoft 365 Business Premium, Enterprise Mobility and Security E3, or Microsoft 365 E3 or E5.
- The tenant exists in `public.m365_tenants` with a populated `tenant_id` and a prior successful connection state.
- The customer's primary administrator can sign in to the Mithras console and reach `/m365` with `customer_admin` scope.
- The operator has confirmed there are no open findings on `/admin/health` related to the customer's existing OAuth credential.

## Procedure

1. Navigate to `/m365` and locate the customer's tenant row. The row displays the current values of `signin_audit_supported` and `directory_audit_supported` derived from `public.m365_tenants`.
2. Select the tenant. The Tenant Detail view renders the connection state, the most recent poll timestamp, and the capability flag history.
3. Confirm that `signin_audit_supported` and `directory_audit_supported` are `false`. If either flag is already `true`, the tenant is already configured for Premium ingestion and no action is required.
4. Instruct the customer's primary administrator to sign in to the Mithras console and navigate to `/m365`.
5. Direct the customer to select `Reconnect tenant`. The control initiates the standard Microsoft 365 authorisation flow, where the customer's Entra ID administrator grants admin consent for the elevated Graph scopes `AuditLog.Read.All` and `Directory.Read.All`.
6. The reconnect flow updates the row in `public.m365_tenants` with the refreshed OAuth credential, the consented scope list, and a new `last_authorised_at` timestamp. The ITDR poller's capability probe runs on the next polling cycle — every five minutes — and persists the resulting capability flags.
7. Confirm with the customer that the reconnect flow completed without an authorisation error. Common error returns include `AADSTS65001` for incomplete admin consent and `AADSTS50020` for cross-tenant guest sign-in.

## Verification
- The Tenant Detail view on `/m365` reports `signin_audit_supported = true` and `directory_audit_supported = true` within five minutes of the customer's reconnect.
- The poll history shows the most recent `signins_polled` and `directory_audits_polled` counts as positive integers; the prior `no_premium` skip state no longer appears.
- The customer's `/m365/posture` view renders the `Recent sign-ins` and `Directory changes` cards with current data.
- `/activity` records a row with `action_type = 'm365_tenant_reconnected'` attributed to the customer's primary administrator, and a follow-on row with `action_type = 'm365_capability_flag_changed'` attributed to the ITDR poller service identity.

## Troubleshooting
- **The reconnect flow returns `AADSTS65001` to the customer.** Admin consent was not granted. The customer's Entra ID administrator must complete admin consent on the application registration for the consented scopes to take effect. Re-initiating the reconnect after admin consent is granted resolves the failure.
- **The capability flags remain `false` after a successful reconnect.** The capability probe fetches against `auditLogs/signIns` and observed a `403`. This indicates the application registration is missing the `AuditLog.Read.All` Graph permission with admin consent. The customer's Microsoft 365 administrator must add the permission and grant admin consent before the next probe cycle.
- **The capability flags flip to `true` but `signins_polled` remains zero across multiple cycles.** The OAuth token is valid but the elevated scopes were not included in the token. Direct the customer to re-run the reconnect flow; mid-session consent does not retroactively elevate an existing token.
- **The Tenant Detail view does not refresh after the customer reconnects.** The edge function caches tenant configuration for five minutes. Wait for the cache window to elapse or restart the `peritus-edge-functions` container for an immediate refresh.

## Audit and compliance
- The customer reconnect writes a row to `public.activity_logs` with `action_type = 'm365_tenant_reconnected'` attributed to the customer's administrator.
- Each capability flag transition writes a row to `public.activity_logs` with `action_type = 'm365_capability_flag_changed'`, the prior and new flag values, and the service identity that performed the transition.
- Persistent capability-probe failures write findings to `public.platform_health_findings` with category `m365_capability` for retention of 12 months and surface on `/admin/health`.
- Sign-in and directory audit data ingested through these capabilities is retained in accordance with the customer's data retention configuration and supports incident response under the customer's regulatory framework, including the Essential Eight Maturity Level requirements for monitoring of privileged access.

## Related procedures
- [Onboard a new reseller organisation](/help/sops/platform_super_admin/onboard-distributor)
- [Force-rollback an AI Triage Agent response](/help/sops/platform_super_admin/force-rollback-ai-response)
- [Respond to an AI cost-budget alert](/help/sops/platform_super_admin/respond-to-ai-budget-alert)
