---
title: Review your deal pipeline
audience: distributor
description: Walk the pipeline rollup across your resellers, accept or reject deal registrations, and triage stalled deals.
order: 3
estimated_minutes: 10
updated_at: 2026-06-12
tags: deals, pipeline, channel
---

## When to use this
Weekly (or more often during a push) — to know what your resellers have in flight, who needs help, and what's at risk.

## Where to look
**`/distributor/deals`** is the single source of truth. It rolls up every deal registration across every reseller in your channel.

## What the columns mean
- **Stage** — `registered` → `qualified` → `proposal` → `closed_won` / `closed_lost`. Resellers move the chips themselves; you can override.
- **Margin lock** — the protected reseller margin captured when the deal was registered. This is enforced when the deal converts.
- **Days in stage** — anything over 30 days is amber, 60 days is red. Use this column to find stalled deals.
- **Expiry** — registrations auto-expire after 90 days unless extended. The system sends the reseller a 14-day warning; you get a copy at 7 days.

## Steps for a weekly review

1. Open **`/distributor/deals`**.
2. Sort by **Days in stage** descending. Anything red is your first call.
3. For each stalled deal: click into the detail panel, look at the last-update note. If it's stale, ping the reseller's account manager.
4. Filter to **Pending approval** — these are new registrations awaiting your sign-off. Click **Approve** (you accept the margin lock) or **Reject** with a reason.
5. Scan **closed_won this month** to validate your forecast — those convert into MRR via the customer-create flow.

## Acting on a deal

- **Approve a registration:** Click **Approve**. The margin is locked at the percentage the reseller registered. The reseller can now sell at that protection.
- **Reject:** Provide a reason (free text). The reseller is notified by email and can re-submit with adjusted terms.
- **Extend an expiring deal:** Click **Extend 30 days** in the detail panel. Use sparingly — the deal-registration system exists to drive urgency.
- **Reassign account manager:** From the deal detail, change the **Owner** dropdown to another disty rep.

## Verify
- Your forecast on `/distributor` matches the sum of `closed_won` deals this month.
- The activity feed under the deal shows your approve / reject / extend action with your user id.

## Troubleshooting
- **A deal's margin locked at the wrong percentage.** This is by design — registrations capture the % at the moment of submission. Reject the registration and ask the reseller to re-register with the correct margin.
- **Reseller can't see their deal after registration.** Check that you haven't accidentally rejected it — rejected deals are hidden from the reseller's `/partner/deals` view but still appear under your **Rejected** filter.
- **The "Convert to customer" button is greyed out for a closed_won deal.** The reseller needs to have at least 1 credit in their pool before they can convert. Top them up first.

## Related
- [Top up reseller credits](/help/sops/distributor/top-up-credits)
- [Monthly invoicing](/help/sops/distributor/monthly-invoicing)
- [Reseller: register a deal](/help/sops/partner/register-deal)
