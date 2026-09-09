---
title: Top up a reseller's credit pool
audience: distributor
description: Cut additional credits from the distributor pool to a reseller partner against a signed commercial commitment.
order: 2
estimated_minutes: 5
updated_at: 2026-06-12
tags: credits, billing, channel, resellers
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure transfers credits from your distributor pool to a reseller partner's pool. Credits fund endpoint protection at the rate of one credit per endpoint per month. The procedure is executed when a reseller has consumed their pool, is forecast to consume it within the current billing cycle, or has submitted a commercial commitment for additional capacity.

## Audience and authority
Distribution operations staff whose home organisation has `organizations.org_type = 'distributor'` and whose `organization_memberships.role` is `admin` or `owner`. The operator must hold commercial authority to commit the top-up against the reseller's signed agreement or against a written purchase order.

## Prerequisites
- The reseller is active in `/distributor/resellers` with no commercial hold.
- A signed commercial commitment, purchase order, or standing agreement covers the top-up amount.
- Your distributor `Available balance` on `/distributor/credits` is equal to or greater than the top-up amount.
- You are signed in to the Mithras console at `https://www.mithras.com.au/login`.

## Procedure

1. Navigate to `/distributor/credits`.
2. In the `Reseller health` table, locate the reseller and review the following columns before proceeding.
   - `Available balance` shows current capacity in credits.
   - `Runway` shows projected months of cover based on the trailing thirty-day consumption rate; the chip displays `Healthy`, `At risk`, or `Overdrawn`.
   - `Last cut` shows the date of the most recent transfer from your pool.
3. In the `Cut credits to reseller` panel, select the reseller from the `Reseller` dropdown, enter the agreed quantity in the `Amount` field, and record the commercial justification in the `Note` field, for example `Q3 commitment top-up — PO 2026-118 — 200 endpoint-months`.
4. Select `Cut credits`. The console writes a row to `licence_transactions` with `kind = 'disty_to_reseller'`, decrements your distributor pool, and increments the reseller's pool atomically.
5. Confirm the new transaction appears at the top of the ledger on `/distributor/credits` with status `posted`, the amount entered, and the reseller's name in the `To` column.

## Verification
- Your distributor `Available balance` has decreased by the amount transferred.
- The reseller's `Available balance` in `Reseller health` has increased by the same amount.
- The reseller's `Runway` chip recolours to `Healthy` once projected cover exceeds one month.
- A row exists in `public.licence_transactions` with `kind = 'disty_to_reseller'`, `status = 'posted'`, your distributor organisation as `from_organization_id`, and the reseller as `to_organization_id`.

## Troubleshooting
- **The cut fails with `insufficient_balance`.** Your distributor pool is below the requested amount. Open `/distributor/credits`, select `Request top-up from Mithras`, and submit the required quantity. Resume the reseller cut once the Platform credit posts.
- **The reseller does not see the new balance within sixty seconds.** The reseller portal refreshes the credit panel on a thirty-second interval. Instruct the reseller to reload `/partner/credits` or to sign out and back in. The ledger row on your side is the source of truth.
- **The top-up was posted to the wrong reseller.** The ledger is append-only. Open `/distributor/credits`, select the incorrect transaction, and use `Reverse with contra entry` to record a compensating `licence_transactions` row of equal magnitude in the opposite direction with a reference to the original transaction identifier. Then post a fresh cut to the intended reseller. Contact Mithras channel operations if the incorrect reseller has already consumed the credits against customer endpoints.
- **The reseller is suspended.** A commercial or compliance hold is present. Resolve the hold in `/distributor/resellers` under the reseller's detail panel before retrying the cut.

## Audit and compliance
- A row is written to `public.licence_transactions` with `kind = 'disty_to_reseller'` and `actor_id = auth.uid()`.
- An entry is written to `public.activity_logs` with `action_type = 'credits_cut'` and the source and destination organisation identifiers.
- The transaction is retained for the life of the channel agreement plus seven years in support of financial audit obligations.
- An email is dispatched to the addresses configured in `org_report_recipients` for category `billing` on both your distributor organisation and the receiving reseller organisation.

## Related procedures
- [Onboard a new reseller partner](/help/sops/distributor/onboard-reseller)
- [Review your deal pipeline](/help/sops/distributor/review-deal-pipeline)
- [Monthly invoicing](/help/sops/distributor/monthly-invoicing)
