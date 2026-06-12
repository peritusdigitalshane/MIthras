---
title: Reconcile and issue monthly invoices
audience: distributor
description: Review the auto-drafted wholesale invoice from Peritus, issue reseller invoices for the prior month, and lock the period.
order: 4
estimated_minutes: 20
updated_at: 2026-06-12
tags: invoicing, billing, finance, month-end
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure closes the monthly billing cycle for your distributorship. The platform auto-drafts the wholesale invoice payable from your distributorship to Peritus and a per-reseller invoice for each reseller in your channel, both based on credit consumption for the prior calendar month. The procedure confirms the draft figures, issues the invoices, and locks the period against further line-item changes.

## Audience and authority
Distribution operations staff with finance responsibility, whose home organisation has `organizations.org_type = 'distributor'` and whose `organization_memberships.role` is `admin` or `owner`. The operator must hold authority to commit the distributorship to the wholesale charge issued by Peritus.

## Prerequisites
- The calendar month has closed. The platform auto-drafts invoices on the first day of the new month at 00:05 UTC.
- All credit cuts intended for the prior period are posted in `/distributor/credits` with status `posted`.
- Any prior-period adjustments, refunds, or contra entries are recorded against `licence_transactions` for the prior month.
- The reseller pricing override on `/distributor/billing` is current for any resellers on bespoke rates.
- You are signed in to the Mithras console at `https://www.mithras.com.au/login`.

## Procedure

1. Navigate to `/distributor/invoices`. The current period's wholesale invoice is listed with status `draft`.
2. Open the draft wholesale invoice. The detail panel renders the following sections.
   - `Line items` lists one row per reseller showing endpoint-months consumed, the wholesale rate, and the line total.
   - `Subtotal` is the sum of line items.
   - `Credits applied` reflects prior-period overpayments, deal-conversion incentives, and any contra entries on `licence_transactions` for the period.
   - `Total payable to Peritus` is the net amount due.
3. Cross-check the subtotal against `/distributor/credits`. The sum of `licence_transactions` rows with `kind = 'disty_to_reseller'` for the prior month must equal the subtotal. Investigate any variance before proceeding.
4. Select `Mark as sent` on the wholesale invoice. The console writes the invoice to `public.invoices` with `status = 'sent'`, locks the line items, and dispatches the invoice to the addresses configured in `org_report_recipients` for category `billing` on your distributor organisation and to Peritus accounts receivable.
5. Return to `/distributor/invoices` and select `Generate reseller invoices`. The platform creates one row in `public.invoices` per reseller, priced at the reseller-tier rate configured under `/distributor/billing`.
6. Open each reseller invoice in turn. Confirm the line items, apply any one-off adjustments through `Add adjustment`, and select `Send invoice`. The reseller's billing contact receives the invoice by email and the invoice becomes visible on the reseller's `/partner/invoices` page.
7. For resellers billed outside the platform, select `Export consumption CSV` on the per-reseller invoice and import the file into your accounting system. Mark the platform invoice `Sent` once the external invoice has been issued, to lock the period.

## Verification
- The `Period status` chip on `/distributor/invoices` for the prior month displays `Locked`.
- The `Total payable to Peritus` matches the value Peritus accounts receivable has on file. A variance email from Peritus is dispatched within two business days where the figures disagree.
- Every reseller in `/distributor/resellers` has an invoice for the prior period in `public.invoices` with `status = 'sent'`.
- The `Monthly recurring revenue` tile on `/distributor` for the closed period equals the sum of `subtotal` across the issued reseller invoices.
- A row exists in `public.activity_logs` with `action_type = 'invoice_sent'` for every invoice issued, with `actor_id = auth.uid()`.

## Troubleshooting
- **A reseller's line items show fewer endpoint-months than expected.** The platform pro-rates credit consumption to the day a customer or endpoint is decommissioned. Confirm the discrepancy by opening `/distributor/resellers`, selecting the reseller, and reviewing the `Endpoint lifecycle` panel for the period. Adjust through a one-off line item on the reseller invoice only where commercial circumstances justify it.
- **The `Credits applied` figure does not reconcile to your records.** Open `/distributor/credits` and filter `licence_transactions` for the prior month with `kind = 'refund'` or `kind = 'contra'`. Each row of these kinds is applied as a credit against the wholesale invoice.
- **An invoice was issued in error.** Within twenty-four hours of `Mark as sent`, select `Void and redraft` on the invoice detail panel. The action writes a `voided` row to `public.invoices` linked to the original through `voided_invoice_id` and reopens the draft for editing. Beyond twenty-four hours, the lock is final; contact Peritus accounts receivable to issue a credit note against the wholesale invoice and issue a credit note from your accounting system to the affected reseller.
- **A draft invoice did not appear on the first of the month.** The auto-draft job failed for your distributorship. Open `/distributor/invoices`, select `Force draft for prior period`, and confirm the resulting invoice carries the expected line items. Notify Peritus support so the underlying job failure can be investigated.

## Audit and compliance
- Every invoice issuance writes a row to `public.invoices` with `status = 'sent'`, `issued_at = now()`, and `issued_by = auth.uid()`. The row is immutable once sent except through a `Void and redraft` action recorded against `voided_invoice_id`.
- A corresponding entry is written to `public.activity_logs` with `action_type = 'invoice_sent'` and `action_type = 'invoice_voided'` where applicable.
- Invoice records are retained for seven years in accordance with financial record-keeping obligations under Australian Taxation Office record-keeping requirements and equivalent jurisdictions.
- An email is dispatched to the addresses configured in `org_report_recipients` for category `billing` on the issuing distributor organisation and on the receiving reseller organisation.

## Related procedures
- [Top up a reseller's credit pool](/help/sops/distributor/top-up-credits)
- [Review the channel deal pipeline](/help/sops/distributor/review-deal-pipeline)
- [Onboard a new reseller partner](/help/sops/distributor/onboard-reseller)
