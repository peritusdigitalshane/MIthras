---
title: Onboard a new reseller organisation
audience: peritus_super_admin
description: Provision a reseller organisation, issue the starter credit pool, and confirm portal sign-in across the channel hierarchy.
order: 1
estimated_minutes: 15
updated_at: 2026-06-12
tags: onboarding, channel, reseller
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure provisions a new reseller organisation, issues the starter credit pool agreed under the channel agreement, and verifies that the reseller's primary administrator can sign in to the Mithras console. Until the procedure completes, the reseller cannot transact, sub-allocate credits, or onboard downstream customers.

## Audience and authority
The operator executing this procedure is a Peritus platform operator whose `user_id` is present in `public.super_admins`. The route `/admin/resellers` is gated by the `is_super_admin(auth.uid())` helper, and all credit-issue transactions are written under the operator's identity for downstream audit reconstruction.

## Prerequisites
- A signed channel agreement specifying the starter credit pool and any agreed override pricing.
- The reseller's legal organisation name, primary administrator email, and contact display name.
- Confirmation that the primary administrator email is not already bound to an existing organisation in `public.organizations`.
- The operator is signed in to `https://www.mithras.com.au` and has reached `/admin` without error.

## Procedure

1. Navigate to `/admin/resellers`. The roster of existing reseller organisations renders, sorted by `created_at` descending.
2. Select `Add reseller`. The provisioning dialog opens.
3. Populate the dialog fields:
   - `Organisation name` — the legal entity name displayed in the reseller portal header.
   - `Primary admin email` — the address that receives the activation link.
   - `Display name` — the human-readable contact label.
   - `Commercial terms` — the agreed pricing tier label. This field is informational; effective pricing is enforced from `public.platform_pricing` and any override rows, not from this input.
4. Select `Create`. A row is inserted into `public.organizations` with `org_type = 'reseller'`. The primary administrator is provisioned in `public.profiles` and bound to the organisation through `public.organization_memberships` with `role = 'owner'`. An activation email is dispatched by the auth service.
5. Navigate to `/admin/credits`.
6. In the `Issue credits to reseller` panel, select the newly created reseller from the organisation selector.
7. Enter the agreed starter credit quantity. One credit equals one endpoint-month of entitlement at the reseller's commercial tier.
8. Record a ledger note in the `Reason` field. Use the format `"Founding-channel pool — Q3 2026 commitment per signed agreement"`. The note is persisted to the credit ledger and surfaced in downstream reseller invoices.
9. Select `Issue`. A credit transaction is written under the operator's `user_id`. The ledger is append-only; subsequent corrections require an inverse transaction.
10. Notify the reseller's primary administrator that the activation email has been sent and that initial sign-in occurs at `https://www.mithras.com.au/login`.

## Verification
- The reseller appears in `/admin/resellers` with `Active` status and the correct `created_at` timestamp.
- The credit balance for the reseller in `/admin/credits` matches the quantity issued.
- `/activity` records one row with `action_type = 'organization_created'` and one row with `action_type = 'credits_issued'`, both attributed to the operator's `user_id`.
- The primary administrator confirms successful sign-in and the reseller portal renders without error.

## Troubleshooting
- **The activation email is not received within ten minutes.** Inspect `/activity` for an `action_type = 'invite_user'` row matching the administrator's email. If the row exists, the auth service dispatched the message and the failure is downstream; instruct the administrator to use the `Forgot password` flow at `/login`. If the row is absent, re-issue the invitation from the reseller detail page.
- **The provisioning dialog returns `organisation already exists`.** The primary administrator email is already bound to an organisation of the same `org_type`. Search `/admin/resellers` for an inactive row, or request a different administrator email. A single user may not own two organisations of the same type.
- **The starter credit quantity was entered incorrectly.** The credit ledger is append-only. Write a correcting inverse transaction from `/admin/credits` with a ledger note that references the original transaction identifier and explains the correction.
- **The reseller signs in but the portal renders empty.** Confirm the `organization_memberships` row was created with `role = 'owner'`. A missing membership row indicates the dialog failed mid-transaction; re-run step 4 against the existing organisation.

## Audit and compliance
- A row is written to `public.organizations` with `org_type = 'reseller'` and `created_by = auth.uid()`.
- An activity row is written to `public.activity_logs` with `action_type = 'organization_created'` and the operator's `user_id`.
- The credit-issue transaction writes a second row to `public.activity_logs` with `action_type = 'credits_issued'`, the credit quantity, and the ledger note.
- Activity rows are retained for seven years in accordance with the Peritus financial records retention policy and are available to external auditors through `/activity` with super-admin scope.

## Related procedures
- [Audit channel margins](/help/sops/peritus_super_admin/audit-channel-margins)
- [Respond to an AI cost-budget alert](/help/sops/peritus_super_admin/respond-to-ai-budget-alert)
- [Force-rollback an AI Triage Agent response](/help/sops/peritus_super_admin/force-rollback-ai-response)
