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

1. Navigate to `/distributor/deals`. The view rolls up every row in `deal_registrations` for resellers in your channel.
2. Familiarise yourself with the column semantics before acting.
   - `Stage` progresses through `registered`, `qualified`, `proposal`, `closed_won`, and `closed_lost`. Resellers advance the stage; you may override.
   - `Margin lock` shows the protected reseller margin captured at registration and enforced at conversion.
   - `Days in stage` is amber from thirty days and red from sixty days.
   - `Expiry` reflects the ninety-day registration window. A fourteen-day warning is dispatched to the reseller; a seven-day warning is copied to the account manager on file.
3. Sort by `Days in stage` descending and review every red row. Open the detail panel, read the most recent entry in the `Activity` timeline, and contact the responsible account manager if the deal is materially stalled.
4. Apply the filter `Stage = registered` and `Approval = pending` to surface registrations awaiting your decision. For each row, open the detail panel and select either `Approve registration` or `Reject registration` with a written reason. Approval locks the margin at the registered percentage; rejection notifies the reseller by email and permits resubmission with revised terms.
5. Apply the filter `Expiry <= 14 days` to surface expiring registrations. For each row, select `Extend by 30 days` only where commercial circumstances justify the extension. The deal-registration mechanism is designed to drive close-cycle urgency; routine extensions undermine it.
6. Apply the filter `Stage = closed_won` and date range `This month` to confirm the wins that will convert into monthly recurring revenue through the customer-create flow. Cross-check the count against the `Closed won (MTD)` tile on `/distributor`.

## Verification
- Every row with `Days in stage > 30` has either an `Activity` entry dated within the last seven days or an open follow-up assigned to the account manager on file.
- The `Pending approval` filter returns zero rows on completion of the review.
- The `Closed won (MTD)` tile on `/distributor` matches the row count produced by the `Stage = closed_won` filter for the current month.
- The `Activity` timeline on each actioned deal records your `approve`, `reject`, or `extend` action with `actor_id = auth.uid()` and the current timestamp.

## Troubleshooting
- **A deal registration locked margin at an incorrect percentage.** Registrations capture the margin at the moment of submission and the lock is immutable. Reject the registration with a written reason and instruct the reseller to resubmit at the correct percentage. Do not edit historical registrations.
- **A reseller reports that an approved deal is no longer visible to them.** Confirm the registration has not been rejected under your `Rejected` filter; rejected registrations are hidden from the reseller's `/partner/deals` view. If the registration was rejected in error, contact Peritus channel operations to restore the row, since rejection is terminal from your console.
- **The `Convert to customer` action is unavailable on a `closed_won` deal.** The receiving reseller's pool holds fewer than one credit. Top up the reseller's pool through [Top up a reseller's credit pool](/help/sops/distributor/top-up-credits) before the reseller retries the conversion.
- **A deal in `closed_won` has not converted within thirty days.** Open the detail panel and confirm the reseller has provisioned the customer. If provisioning has stalled, contact the reseller's account manager directly; the platform does not auto-expire `closed_won` rows.

## Audit and compliance
- Every approve, reject, and extend action writes a row to `public.activity_logs` with `action_type` set to `deal_approved`, `deal_rejected`, or `deal_extended`, `actor_id = auth.uid()`, and the affected `deal_registrations.id`.
- Margin locks are captured at registration on the `deal_registrations` row and are retained for the life of the resulting customer relationship plus seven years.
- Rejection reasons are stored verbatim on the `deal_registrations` row and surfaced to the reseller through their portal and through an email to the addresses configured in `org_report_recipients` for category `deals`.

## Related procedures
- [Onboard a new reseller partner](/help/sops/distributor/onboard-reseller)
- [Top up a reseller's credit pool](/help/sops/distributor/top-up-credits)
- [Monthly invoicing](/help/sops/distributor/monthly-invoicing)
