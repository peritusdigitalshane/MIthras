---
title: Onboard a new distributor organisation
audience: platform_super_admin
description: Provision a distributor organisation, issue the founding credit pool, and confirm portal access for the head of the channel.
order: 1
estimated_minutes: 20
updated_at: 2026-06-12
tags: onboarding, channel, distributor
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure provisions a new distributor organisation, issues the founding credit pool agreed under the signed distribution agreement, and verifies that the distributor's primary administrator can sign in to the distributor portal. A distributor sits at the top of the channel hierarchy; until this procedure completes, the distributor cannot recruit resellers, sub-allocate credits, or transact through the platform.

## Audience and authority
The operator is a Mithras platform operator whose `user_id` is present in `public.super_admins`. The route `/admin/resellers` is gated by the `is_super_admin(auth.uid())` helper. Credit issuance writes to `public.licence_transactions` under the operator's identity for downstream audit reconstruction.

## Prerequisites
- A signed distribution agreement specifying the founding credit pool, the commercial tier, and any agreed override pricing.
- The distributor's legal organisation name, primary administrator email, contact display name, and the agreed billing email.
- Confirmation that the primary administrator email is not already bound to an existing organisation in `public.organizations`.
- The operator is signed in to `https://www.mithras.com.au` and `/admin` renders without error.

## Procedure

1. Navigate to `/admin/resellers`. The roster of distributor and reseller organisations renders, sorted by `created_at` descending. The view is shared because both org types are channel partners; the `Type` column distinguishes them.
2. Select `Add organisation`. The provisioning dialog opens.
3. Populate the dialog fields:
   - `Organisation type` — select `distributor`.
   - `Organisation name` — the legal entity name displayed in the distributor portal header.
   - `Primary admin email` — the address that receives the activation link.
   - `Display name` — the human-readable contact label.
   - `Commercial terms` — the agreed wholesale tier label. This field is informational; effective pricing is enforced from `public.platform_pricing` and any per-org override rows, not from this input.
4. Select `Create`. A row is inserted into `public.organizations` with `organization_type = 'distributor'`. The primary administrator is provisioned in `public.profiles` and bound to the organisation through `public.organization_memberships` with `role = 'owner'`. An activation email is dispatched by the auth service.
5. Navigate to `/admin/credits`.
6. In the `Issue credits to distributor` panel, select the newly created distributor from the organisation selector.
7. Enter the agreed founding credit quantity. One credit equals one endpoint-month of entitlement at the distributor's commercial tier. Founding pools are typically 500 to 2000 credits.
8. Record a ledger note in the `Reason` field. Use the format `"Founding distributor pool — Q3 2026 commitment per signed agreement"`. The note is persisted to `public.licence_transactions` and surfaced in downstream invoices.
9. Select `Issue`. The credit transaction is written under the operator's `user_id`. The ledger is append-only; subsequent corrections require an inverse transaction.
10. Notify the distributor's primary administrator that the activation email has been sent and that initial sign-in occurs at `https://www.mithras.com.au/login`. After authentication, the distributor is routed to the distributor portal at `/distributor`.

## Verification
- The distributor appears in `/admin/resellers` with `Active` status, `Type = distributor`, and the correct `created_at` timestamp.
- The credit balance for the distributor in `/admin/credits` matches the quantity issued.
- `/admin/audit-logs` records one row with `action = 'organization_created'` and `resource_type = 'organization'`, plus one row with `action = 'credits_issued'` and the credit quantity in `details`. Both rows are attributed to the operator's `user_id`.
- The primary administrator confirms successful sign-in. The distributor portal at `/distributor` renders without error and the credit balance card displays the issued amount.

## Troubleshooting
- **The activation email is not received within ten minutes.** Inspect `/admin/audit-logs` for an `action = 'invite_user'` row matching the administrator's email. If the row exists, the auth service dispatched the message and the failure is downstream; instruct the administrator to use the `Forgot password` flow at `/login`. If the row is absent, re-issue the invitation from the distributor detail page.
- **The provisioning dialog returns `organisation already exists`.** The primary administrator email is already bound to an organisation of the same `organization_type`. Search `/admin/resellers` for an inactive row, or request a different administrator email. A single user may not own two organisations of the same type.
- **The founding credit quantity was entered incorrectly.** The credit ledger is append-only. Write a correcting inverse transaction from `/admin/credits` with a ledger note that references the original transaction identifier and explains the correction.
- **The distributor signs in but the portal renders empty.** Confirm the `organization_memberships` row was created with `role = 'owner'`. A missing membership row indicates the dialog failed mid-transaction; re-create the membership directly via support or re-run step 4 against the existing organisation.

## Audit and compliance
- A row is written to `public.organizations` with `organization_type = 'distributor'` and the operator recorded as the creator.
- An entry is written to `public.activity_logs` with `action = 'organization_created'`, `resource_type = 'organization'`, and `user_id = auth.uid()`.
- The credit issuance writes a row to `public.licence_transactions` with `kind = 'peritus_to_disty'` and a second `public.activity_logs` row with `action = 'credits_issued'`. Both records carry the ledger note and credit quantity.
- Activity rows are retained for seven years in accordance with the Mithras financial records retention policy and are available to external auditors through `/admin/audit-logs` under super-admin scope.

## Related procedures
- [Audit channel margins](/help/sops/platform_super_admin/audit-channel-margins)
- [Respond to an AI cost-budget alert](/help/sops/platform_super_admin/respond-to-ai-budget-alert)
- [Distributor: onboard a new reseller partner](/help/sops/distributor/onboard-reseller)
