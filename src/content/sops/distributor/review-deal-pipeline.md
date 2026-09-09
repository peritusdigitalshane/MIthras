---
title: Review the channel deal pipeline
audience: distributor
description: Walk the rolled-up reseller deal pipeline, action pending registrations, and triage stalled or expiring opportunities.
order: 3
estimated_minutes: 10
updated_at: 2026-06-12
tags: deals, pipeline, channel, forecasting
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure provides a structured weekly review of every deal registration across your reseller partners. The output is an actioned pipeline: pending registrations are approved or rejected, stalled deals are escalated to the responsible account manager, and expiring registrations are either extended or allowed to lapse. The procedure underpins forecast accuracy and protects registered reseller margin.

## Audience and authority
Distribution operations staff whose home organisation has `organizations.org_type = 'distributor'` and whose `organization_memberships.role` is `admin` or `owner`. Approval of a deal registration commits your distributorship to the margin lock captured at registration; the operator must hold commercial authority for that commitment.

## Prerequisites
- Your reseller portfolio is active in `/distributor/resellers`.
- The previous weekly review is complete and documented, or this is the first review of the quarter.
- You are signed in to the Mithras console at `https://www.mithras.com.au/login`.

## Procedure

The distributor pipeline view is **read-only**. Distributors do not approve, reject, or extend deals — resellers manage their own pipeline directly. Your role is portfolio coordination: spot stalled deals, surface conflicts, and drive close-cycle hygiene through direct conversations with resellers.

1. Navigate to `/distributor/deals`. The view rolls up every row in `deal_registrations` for resellers in your channel.
2. Familiarise yourself with the column semantics before acting.
   - `Stage` progresses through `qualified` → `demo` → `poc` → `quote` → `won` or `lost` (and `expired` if the protection window lapses). Resellers advance the stage themselves.
   - `Wholesale price` shows the locked reseller wholesale rate captured at registration and enforced at conversion.
   - `Days in stage` is amber from thirty days and red from sixty days.
   - `Expiry` reflects the per-stage protection window (qualified/demo: 60 days, poc: 90 days, quote: 30 days; see `public.deal_stage_window`). A fourteen-day warning is dispatched to the reseller.
3. Sort by `Days in stage` descending and review every red row. Open the detail panel, read the most recent entry in the `Activity` timeline, and contact the responsible reseller if the deal is materially stalled.
4. Apply the filter `Stage = qualified` to surface freshly-registered deals. For each row, confirm there is no channel conflict with another reseller in your portfolio; if there is, mediate directly with the resellers.
5. Apply the filter `Expiry <= 14 days` to surface expiring registrations. Contact the reseller and confirm whether they intend to advance the stage (which resets the window) or let the registration lapse.
6. Apply the filter `Stage = won` and date range `This month` to confirm the wins that will convert into monthly recurring revenue through the customer-create flow. Cross-check the count against the `Won (MTD)` tile on `/distributor`.

## Verification
- Every row with `Days in stage > 30` has either an `Activity` entry dated within the last seven days, or you have logged a follow-up with the responsible reseller.
- No two active rows in your portfolio target the same prospect (channel conflict check).
- The `Won (MTD)` tile on `/distributor` matches the row count produced by the `Stage = won` filter for the current month.

## Troubleshooting
- **A deal registration locked the wholesale price at an incorrect figure.** Locks are captured at the moment of registration from the reseller's pricing record and are immutable. Ask the reseller to `Mark lost` and re-register the deal at the corrected price; the prior row is retained for audit.
- **A reseller reports that a registration is no longer visible to them.** Confirm the registration has not been marked `lost` or `expired` by checking the `Stage` filter for those values. Both are terminal states from the reseller's portal.
- **The `Convert to customer` action is unavailable on a `won` deal.** The receiving reseller's pool holds fewer than one credit. Top up the reseller's pool through [Top up a reseller's credit pool](/help/sops/distributor/top-up-credits) before the reseller retries the conversion.
- **A deal in `won` has not converted within thirty days.** Open the detail panel and confirm the reseller has provisioned the customer at `/partner`. If provisioning has stalled, contact the reseller directly; the platform does not auto-expire `won` rows.

## Audit and compliance
- Every reseller-driven stage advance, conversion, or loss writes a row to `public.activity_logs` keyed against the affected `deal_registrations.id`.
- Wholesale-price locks are captured at registration on the `deal_registrations` row and are retained for the life of the resulting customer relationship plus seven years.

## Related procedures
- [Onboard a new reseller partner](/help/sops/distributor/onboard-reseller)
- [Top up a reseller's credit pool](/help/sops/distributor/top-up-credits)
- [Monthly invoicing](/help/sops/distributor/monthly-invoicing)
