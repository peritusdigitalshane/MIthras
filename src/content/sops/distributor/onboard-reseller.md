---
title: Onboard a new reseller partner
audience: distributor
description: Create a reseller organisation, fund its opening credit pool, and confirm the reseller's first administrator can sign in.
order: 1
estimated_minutes: 15
updated_at: 2026-06-12
tags: onboarding, credits, channel, resellers
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure activates a new reseller partner inside your distributorship. It creates the reseller organisation record, issues the first administrator invitation, and cuts the agreed opening credit allocation from your distributor pool to the reseller. On completion the reseller can sign in, provision customers, and consume credits against signed agreements.

## Audience and authority
Distribution operations staff whose home organisation has `organizations.org_type = 'distributor'` and whose `organization_memberships.role` is `admin` or `owner`. The operator must hold commercial authority to commit the opening credit allocation against the signed channel agreement.

## Prerequisites
- A countersigned channel agreement is on file for the new reseller.
- The reseller has supplied a primary administrator email address and a billing contact email address.
- The opening credit allocation is documented in the channel agreement or in a written approval from your finance team. One credit equals one endpoint protected for one month.
- Your distributor pool, visible on `/distributor/credits` under `Available balance`, holds sufficient credits to fund the allocation.
- You are signed in to the Mithras console at `https://www.mithras.com.au/login`.

## Procedure

1. Navigate to `/distributor/resellers` and select `Add reseller` in the page header.
2. Complete the `New reseller` dialog with the following fields.
   - `Organisation name` as it will appear on the reseller's portal and on invoices.
   - `Primary admin email` for the activation invitation.
   - `Billing contact email` for monthly invoices and credit notifications.
   - `Account manager` from the dropdown, if your distributorship operates named accounts.
3. Select `Create reseller`. The console writes a new row to `organizations` with `org_type = 'reseller'`, links your distributor organisation as `parent_organization_id`, and dispatches the activation email through the platform mail transport.
4. Confirm the new reseller row is visible in `/distributor/resellers` with status `Active` and the `Last activity` column showing `Awaiting first sign-in`.
5. Open `/distributor/credits` in a new tab.
6. In the `Cut credits to reseller` panel, select the new reseller from the `Reseller` dropdown, enter the agreed opening allocation in the `Amount` field, and record the commercial justification in the `Note` field, for example `Opening allocation under MSA 2026-06 — 50 endpoint-months`.
7. Select `Cut credits`. The console writes a row to `licence_transactions` with `kind = 'disty_to_reseller'`, decrements your distributor pool, and increments the reseller's pool atomically.
8. Verify the transaction appears at the top of the ledger on `/distributor/credits` with status `posted` and the amount you entered.

## Verification
- The reseller is listed on `/distributor/resellers` with status `Active` and a populated `created_at` timestamp.
- The reseller's `Available balance` on `/distributor/credits` equals the opening allocation.
- After the reseller's primary administrator completes the activation flow, the `Last activity` column on `/distributor/resellers` updates within sixty seconds to show the sign-in timestamp.
- A row exists in `licence_transactions` with `kind = 'disty_to_reseller'`, your distributor organisation as `from_organization_id`, the new reseller as `to_organization_id`, and `status = 'posted'`.

## Troubleshooting
- **The activation email is not received within ten minutes.** Inspect `/distributor/resellers`, open the reseller row, and select `Resend invitation`. If the second attempt also fails to land, direct the reseller's primary administrator to `https://www.mithras.com.au/login` and select `Forgot password` to set their own credential. The mailbox owner must hold the address recorded on the `organizations` row.
- **The credit cut fails with `insufficient_balance`.** Your distributor pool is below the requested amount. Open `/distributor/credits`, select `Request top-up from Peritus`, and submit the required quantity with a commercial justification. Resume the cut once the Peritus credit posts to your pool.
- **The new reseller signs in but lands on a blank dashboard.** The reseller administrator opened the console at the distributor subdomain. Direct them to sign out and sign back in at `https://www.mithras.com.au/login`; reseller members are routed to `/partner` automatically based on `organizations.org_type`.
- **The reseller already exists in the directory.** A row with the supplied organisation name is present in `organizations`. Confirm the reseller is not already onboarded under another distributorship before contacting Peritus channel operations to resolve the conflict.

## Audit and compliance
- A row is written to `public.organizations` with `org_type = 'reseller'` and `parent_organization_id` set to your distributor organisation.
- An entry is written to `public.activity_logs` with `action_type = 'reseller_onboarded'` and `actor_id = auth.uid()`.
- The opening credit cut writes a row to `public.licence_transactions` with `kind = 'disty_to_reseller'` and is retained for the life of the channel agreement plus seven years in support of financial audit obligations.
- An email is dispatched to the activation recipient address and copied to the addresses configured in `org_report_recipients` for category `billing`.

## Related procedures
- [Top up a reseller's credits](/help/sops/distributor/top-up-credits)
- [Review your deal pipeline](/help/sops/distributor/review-deal-pipeline)
- [Monthly invoicing](/help/sops/distributor/monthly-invoicing)
