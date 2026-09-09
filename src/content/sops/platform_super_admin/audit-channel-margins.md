---
title: Audit channel margins across the reseller hierarchy
audience: platform_super_admin
description: Reconcile reseller wholesale pricing, customer monthly recurring revenue, and Platform floor pricing across the full channel for a billing period.
order: 2
estimated_minutes: 25
updated_at: 2026-06-12
tags: finance, channel, audit
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure reconciles the three-layer pricing stack — customer monthly recurring revenue (MRR), reseller wholesale cost, and Platform floor — for every active customer in the channel. It identifies pricing drift caused by per-organisation overrides, deal-margin locks, and mid-period rate changes, and confirms that aggregate channel revenue ties to Stripe revenue for the period. Margin discrepancies that surface here are corrected before distributor invoices are dispatched.

## Audience and authority
The operator executing this procedure is a Mithras platform operator whose `user_id` is present in `public.super_admins`. Read access to `/admin/channel`, `/admin/pricing`, and `/admin/invoices` is gated by `is_super_admin(auth.uid())`. Recalculation operations write to the invoice ledger and are recorded against the operator's identity.

## Prerequisites
- The billing period is closed. The procedure is scheduled for the fifth business day of the new month, after reseller invoices have been marked `sent` in `/admin/invoices`.
- The most recent rate change in `public.platform_pricing` is at least 24 hours old, allowing nightly rollups to settle.
- The operator has confirmed that the Stripe period close has run and that Stripe revenue totals are available for cross-reference.
- The operator has reviewed the deal-margin-lock register on `/admin/deals` for any locks registered during the period.

## Procedure

1. Navigate to `/admin/channel`. The channel rollup view renders.
2. Filter the period selector to the closing month. Three rollup tiles render:
   - `Customer MRR (charged)` — the aggregate revenue resellers will bill to their customers.
   - `Reseller wholesale (charged)` — the aggregate revenue Mithras will bill to resellers.
   - `Platform floor (recognised)` — the revenue Mithras recognises from the channel.
3. Inspect the `Margin variance` column in the customer roll-up table. Variance is computed as the delta between the expected price derived from `public.platform_pricing` and the actual charged price after any `price_override_cents` on `public.organizations` or active deal-margin lock.
4. For every flagged row, select the customer to expand the override chain. The chain enumerates each rule applied, in priority order, with the row identifier and the effective timestamp.
5. Navigate to `/admin/resellers`. For each reseller, perform the per-reseller reconciliation in steps 6 through 8.
6. Open the reseller detail page. Compare the reseller's invoiced total for the period against the value billed to the reseller on `/admin/invoices`. The two values must match within one Australian dollar; sub-dollar drift is acceptable rounding from per-customer pro-rating.
7. For any reseller with variance greater than five Australian dollars, open the invoice line items panel and identify the customer rows that do not tie. The most common root cause is a deal-margin lock registered mid-period where one side of the invoice ledger has not refreshed; select `Recalculate invoice` to force a rebuild from `public.platform_pricing` and the override chain.
8. The second most common root cause is a customer decommissioned mid-period where the reseller's accounting system uses calendar days while the Mithras ledger uses a 30-day month. Document the drift in the reconciliation note; no platform action is required.
9. If a rate change was applied to `public.platform_pricing` during the period, navigate to `/admin/pricing` and open `Change history`. Note the effective timestamp of the change.
10. Return to `/admin/channel`, filter to the affected tier, and compare aggregates before and after the effective timestamp. Confirm that new subscriptions with `subscription_started_at >= effective_date` are billed at the new rate and that pre-existing subscriptions retain the prior rate until renewal.
11. Cross-reference the `Platform floor (recognised)` total against Stripe revenue for the period. The two values must agree within two percent.

## Verification
- The sum of `Customer MRR (charged)`, the reseller-margin column, and the platform-floor column reconciles end-to-end across `/admin/channel`.
- No customer row reports zero MRR while remaining in `Active` state on `/admin/resellers`. Zero-MRR active rows indicate a decommission that did not close the subscription correctly.
- The Stripe revenue total for the period agrees with `Platform floor (recognised)` within two percent.
- Every reseller invoice on `/admin/invoices` is marked `sent` and ties to its corresponding entry on the reseller's `/distributor/invoices` view within rounding.
- An entry is present in `/activity` for each `invoice_recalculated` action executed during the audit.

## Troubleshooting
- **Aggregate channel revenue diverges from Stripe revenue by more than two percent.** Do not attempt in-product correction. Open a finance escalation with the Mithras accounts team and pause distributor-invoice dispatch for the affected period.
- **A reseller reports a discrepancy that cannot be reconciled within fifteen minutes of investigation.** Capture the reseller identifier, the disputed customer rows, and the override chain output, then open a high-severity finding on `/admin/health` with the tag `channel_pricing_dispute`.
- **A deal-margin lock has an `applied_at` timestamp later than the corresponding deal `closed_at`.** This indicates potential margin-protection abuse. Flag the deal on `/admin/deals` for review and do not invoice the affected customer rows until the lock is validated.
- **The `Recalculate invoice` control returns `recalculation_locked`.** A prior recalculation is still in flight. Wait sixty seconds and retry. Persistent locking indicates a stuck background job and warrants a finding on `/admin/health`.

## Audit and compliance
- Each invoice recalculation writes a row to `public.activity_logs` with `action_type = 'invoice_recalculated'`, the invoice identifier, and the operator's `user_id`.
- Deal-margin-lock validations write a row to `public.activity_logs` with `action_type = 'deal_lock_reviewed'`.
- The channel reconciliation report is retained in `/admin/channel` snapshots for seven years in accordance with the Mithras financial records retention policy and supports Australian Taxation Office and external audit review.
- Discrepancies escalated to finance are tracked outside this system; the in-product audit trail records only the platform actions taken by the operator.

## Related procedures
- [Onboard a new reseller organisation](/help/sops/platform_super_admin/onboard-distributor)
- [Respond to an AI cost-budget alert](/help/sops/platform_super_admin/respond-to-ai-budget-alert)
- [Force-rollback an AI Triage Agent response](/help/sops/platform_super_admin/force-rollback-ai-response)
