---
title: Monthly invoicing — wholesale MRR
audience: distributor
description: Reconcile the wholesale MRR your distributorship owes Peritus, generate the invoice, and send it.
order: 4
estimated_minutes: 20
updated_at: 2026-06-12
tags: invoicing, billing, finance
---

## When to use this
Once per month — typically on the **3rd business day** of the new month. You're billing your resellers; Peritus is billing you for the wholesale-tier consumption across your channel.

## The flow at a glance
1. The platform auto-drafts an invoice in `/distributor/invoices` on the 1st of the month based on credit consumption for the prior month.
2. You review it, mark it **Sent**, and either pay Peritus from the link in the email, or wait for the Peritus-side direct-debit if you've set one up.
3. You separately invoice your resellers from this same page (or your own accounting system).

## Steps — reviewing your wholesale invoice

1. Go to **`/distributor/invoices`**.
2. The current month's row will show status **draft** (auto-generated) until you mark it sent.
3. Click the row. The detail panel shows:
   - **Line items** — one row per reseller, showing endpoints they consumed × wholesale rate × duration
   - **Subtotal**
   - **Credits applied** — any prior-period overpayments or deal-conversion credits
   - **Total due to Peritus**
4. Cross-check against `/distributor/credits` — total cuts to resellers this month should match the subtotal.
5. If the numbers look right, click **Mark as sent**. This locks the invoice (no further line-item changes) and emails a copy to your billing contact + Peritus accounts.

## Steps — invoicing your resellers

If you bill your resellers through Mithras:

1. Same page, click **Generate reseller invoices**.
2. The platform creates one invoice per reseller using the reseller-tier rate (which you control on `/distributor/billing` → pricing override).
3. Review each invoice — adjust line items only for one-off credits.
4. Click **Send** on each. The reseller gets an email with payment instructions.

If you bill outside Mithras (Xero / QuickBooks / etc.), just export the consumption CSV from the same panel and import it into your tooling.

## Verify
- Your draft invoice closes the month: `/distributor` MRR card matches `subtotal` on the invoice.
- After **Mark as sent**, the audit log at `/activity` (super-admin view) shows `invoice_sent` with your user id.
- Reseller-side: open one of your resellers' `/partner/invoices` and confirm the invoice shows up there.

## Troubleshooting
- **A reseller's line items look wrong.** Most commonly because a customer was decommissioned mid-month — the system pro-rates credits to the day of decommissioning. Verify in `/distributor/resellers` → reseller detail → activity.
- **Credits applied feels wrong.** Open the credit-transaction ledger in `/distributor/credits`. Any transaction with `category='credit_refund'` flows back into the next invoice.
- **You sent the wrong invoice.** Within **24 hours**, click **Void & re-draft** — it reverses the send and re-opens for editing. Beyond 24h, contact Peritus accounts to issue a credit note.

## Related
- [Top up reseller credits](/help/sops/distributor/top-up-credits)
- [Review deal pipeline](/help/sops/distributor/review-deal-pipeline)
- [Peritus: audit channel margins](/help/sops/peritus_super_admin/audit-channel-margins)
