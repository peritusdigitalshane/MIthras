---
title: Top up a reseller's credits
audience: distributor
description: Cut additional credits to a reseller from your pool when their runway gets short.
order: 2
estimated_minutes: 5
updated_at: 2026-06-12
tags: credits, billing, channel
---

## When to use this
A reseller has either run out of credits, will run out within their next billing cycle, or has explicitly requested a top-up.

## Prerequisites
- Your own distributor balance has enough headroom (`/distributor/licences` shows your **available** number).
- You have a commercial agreement with the reseller covering the top-up amount.

## Steps

1. Open **`/distributor/licences`**.
2. Find the reseller in **Reseller health** — pay attention to:
   - Their **runway** chip (green = >1 month, amber = <1 month, red = overdrawn)
   - The **last cut** date
3. In the **Cut credits to reseller** panel, pick the reseller, enter the amount, write a useful note (`"Monthly top-up — Q3 commitment"`).
4. Click **Cut**. A `licence_transactions` row is written with `kind='disty_to_reseller'`.
5. The reseller's pool is now bumped — their `/partner/licences` page refreshes automatically.

## Verify
- The new transaction appears at the top of the ledger with status `posted` and amount you entered.
- Your own balance has decreased by the same amount.
- The reseller's runway chip recolours to green.

## Troubleshooting
- **"insufficient_balance" error.** Your distributor pool is empty. Use the contact-Peritus tile on `/distributor/licences` to request more.
- **Cut succeeded but reseller can't see the change.** They may need to refresh — the React query refresh interval is 30 seconds.
- **Wrong reseller credited.** Open the ledger row, copy the txn id, and contact Peritus support — credits can be reversed via `revoke_licence_transaction(txn_id)` RPC by a super-admin.

## Related
- [Onboard a new reseller](/help/sops/distributor/onboard-reseller)
- [Reseller health monitoring](/help/sops/distributor/review-deal-pipeline)
