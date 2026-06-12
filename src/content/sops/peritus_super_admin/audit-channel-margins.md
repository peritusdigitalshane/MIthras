---
title: Audit channel margins
audience: peritus_super_admin
description: Reconcile distributor pricing vs. reseller pricing vs. customer MRR across the whole channel, monthly.
order: 2
estimated_minutes: 25
updated_at: 2026-06-12
tags: finance, channel, audit
---

## When to use this
- Monthly close — the **5th business day** of the new month, after distributor invoices have been marked sent.
- After a pricing change at any layer (default tier prices, per-org overrides, deal margin locks).
- When a distributor reports their numbers don't match what we billed them.

## What "margin" means here
For every active customer there's a three-layer pricing stack:

| Layer | Price source | Whose revenue |
|---|---|---|
| **Customer MRR** | `platform_pricing.default_<tier>_price` or `organizations.price_override_cents` | Reseller's revenue |
| **Reseller cost** | `platform_pricing.default_<tier>_wholesale` or `distributor_pricing_override` per disty | Distributor's revenue |
| **Distributor cost** | `platform_pricing.default_<tier>_floor` | Peritus revenue |

For each customer: **Customer MRR – Reseller cost = Reseller margin.** **Reseller cost – Distributor cost = Distributor margin.**

## Where to look
**`/admin/pricing`** is the rate authority. **`/admin/channel`** rolls up actual revenue vs. expected.

## Steps

1. Open **`/admin/channel`**.
2. Filter to **current month**.
3. Check the three rollup tiles:
   - **Customer MRR (charged)** — what resellers will bill customers.
   - **Reseller wholesale (charged)** — what distys will bill resellers.
   - **Distributor floor (charged to Peritus)** — our revenue.
4. The **Margin variance** column highlights any customer whose actual MRR doesn't match expected (deal-margin-lock applied, or per-org override).
5. Click through any flagged row to see the override chain.

## Per-distributor reconciliation

For each distributor:

1. Open `/admin/distributors`, pick the disty.
2. Compare their `/distributor/invoices` total this month vs. our `/admin/invoices` total billed to them.
3. The two should match within rounding (sub-$1 difference is OK; rounding inside per-customer pro-rating).

If they differ by **more than $5**:
- Open the invoice line items panel. Find the customer rows that don't match.
- Most common cause: a deal-margin-lock was applied mid-period and one side of the system didn't refresh. Force-recalculate via the **Recalculate invoice** button (super-admin only).
- Second most common: a customer was decommissioned mid-month and pro-rating differs. The system uses 30-day months; if your disty uses calendar days, expect small drift.

## Steps for a pricing change retro

If you changed default tier prices mid-month:

1. Open `/admin/pricing` → **Change history**.
2. Find the row for the change. Note the effective date.
3. On `/admin/channel`, filter to the affected tier and **before/after** the effective date.
4. Verify the new price propagated to all new customer subscriptions after that date (`subscription_started_at >= effective_date`).
5. Customers on contracts before the date keep the old price until renewal.

## Verify
- Customer MRR + Reseller wholesale + Distributor floor sums match on `/admin/channel`.
- No unexpected zero-MRR rows (decommissioned but not closed customers).
- Total revenue line matches Stripe revenue for the period.

## When to escalate
- **Total channel revenue is more than 2% off Stripe revenue.** Don't fix in-app — get accounts involved.
- A distributor reports a discrepancy you can't explain in 15 minutes.
- A deal-margin lock looks like it was registered after the deal closed (potential margin-protection abuse).

## Related
- [Onboard distributor](/help/sops/peritus_super_admin/onboard-distributor)
- [Distributor: monthly invoicing](/help/sops/distributor/monthly-invoicing)
- [Respond to AI budget alert](/help/sops/peritus_super_admin/respond-to-ai-budget-alert)
