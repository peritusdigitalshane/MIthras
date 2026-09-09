---
title: Reconcile and issue monthly invoices
audience: distributor
description: Interim invoicing procedure. Self-service invoice generation in the distributor portal is not yet shipped; use the offline reconciliation below until it lands.
order: 4
estimated_minutes: 20
updated_at: 2026-06-17
tags: invoicing, billing, finance, month-end
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

> **STATUS: INTERIM PROCEDURE.** Self-service distributor invoicing at `/distributor/invoices` is on the platform roadmap but not yet shipped. Until it ships, distributor invoices are reconciled off-platform using the platform's licence ledger as the source of truth. Mithras accounts receivable issues the wholesale invoice to the distributor manually.

## Purpose
This procedure closes the monthly billing cycle for your distributorship: reconcile credit consumption for the prior month against the platform ledger, invoice your resellers from your own accounting system, and confirm receipt of the wholesale invoice from Mithras.

## Audience and authority
Distribution operations staff with finance responsibility, whose home organisation has `organizations.org_type = 'distributor'` and whose `organization_memberships.role` is `admin` or `owner`. The operator must hold authority to commit the distributorship to the wholesale charge issued by Mithras.

## Prerequisites
- The calendar month has closed.
- All credit cuts intended for the prior period are posted in `/distributor/credits` with status `posted`.
- Any prior-period adjustments are recorded against the `licence_transactions` ledger for the prior month.
- You are signed in to the Mithras console at `https://www.mithras.com.au/login`.

## Procedure

1. Navigate to `/distributor/credits` and apply the date filter to the prior calendar month. The view lists every `licence_transactions` row affecting your distributorship for the period — credit issuances, cuts to resellers, refunds, and contras.
2. Export the filtered ledger to CSV (the standard browser print-to-CSV pattern; a native export button is on the roadmap). This export is your authoritative source for reconciling reseller billing.
3. Group the export by reseller. For each reseller, sum the rows with `kind = 'disty_to_reseller'`; the result is the endpoint-months chargeable for the period at the wholesale rate captured on each row.
4. In your accounting system, raise one invoice per reseller using the per-row wholesale price. Email the invoice to the reseller's billing contact; the reseller will reconcile against `/partner/licences`.
5. Mithras accounts receivable will email you a wholesale invoice for the prior period within five business days of month-end. Cross-check the total against the sum of `licence_transactions` rows with `kind = 'platform_to_disty'` for the period in your export. Reply with any variance before remitting.

## Verification
- Every reseller in your portfolio has been billed for the prior period in your accounting system.
- The sum of your reseller invoices for the period equals the sum of `kind = 'disty_to_reseller'` rows in the platform export, minus any refunds or contras.
- The Mithras wholesale invoice received by email matches the sum of `kind = 'platform_to_disty'` rows in your export for the period.

## Troubleshooting
- **A reseller's chargeable endpoint-months show fewer than expected.** The platform pro-rates credit consumption to the day a customer or endpoint is decommissioned. Open `/distributor/resellers`, select the reseller, and review their customer + endpoint history for the period.
- **A row in the ledger looks wrong.** `licence_transactions` rows are immutable. If a cut was issued in error, post a contra entry through `/distributor/credits` → `Cut credits` with a negative amount and a note explaining the correction.
- **The wholesale invoice from Mithras did not arrive.** Email `accounts@mithras.com.au` referencing your distributor organisation and the affected period.

## Audit and compliance
- The `licence_transactions` ledger is the platform's authoritative record of credit movements between Mithras, your distributorship, and your resellers. Rows are append-only and retained for the lifetime of the platform.
- An entry is written to `public.activity_logs` for each credit cut, with `action_type = 'credits_issued'` and the issuing user. Activity records are retained for seven years.
- Your accounting system holds the canonical record of money invoiced and received; the platform ledger underpins the quantum but does not replace your finance system of record.

## Related procedures
- [Top up a reseller's credit pool](/help/sops/distributor/top-up-credits)
- [Onboard a new reseller](/help/sops/distributor/onboard-reseller)
