---
title: Register a deal — lock in margin protection
audience: partner
description: Register an opportunity before the prospect is in contract so the wholesale margin you quoted is protected against undercutting.
order: 2
estimated_minutes: 8
updated_at: 2026-06-12
tags: deals, margin, channel
---

## When to use this
The moment a prospect is past the "interest" stage — discovery has happened, they've named a likely endpoint count, you've started crafting a quote. Register **before** you submit the quote.

Deal registration is what stops two resellers walking the same opportunity into a price war.

## Why this matters
- The margin you quote is locked in by Mithras for **90 days** from registration.
- Your distributor gets first refusal on any conflict (two resellers registering the same customer org name + domain).
- If you don't register, your sale converts at the default wholesale margin — not the protected one.

## Prerequisites
- The prospect is a real organisation (a registered company name + primary contact email + estimated endpoint count).
- You've done discovery enough to know what they need (number of endpoints, EOL Windows boxes if any, M365 ITDR yes/no).

## Steps

1. Go to **`/partner/deals`**.
2. Click **Register deal** (top right).
3. Fill in:
   - **Customer organisation name** — the legal name. Avoid trading names; they cause conflict false-positives.
   - **Primary contact email** — at the prospect, not your team.
   - **Estimated endpoints** — your best honest count.
   - **Tier** — `essential`, `standard`, or `eol_protected`. Affects the wholesale cost.
   - **Margin %** — the protection you're asking for. Default is the channel-program standard; you can ask for more if there's a strategic reason.
   - **Notes** — anything your disty should know (referral source, deadline pressure, competitor in play).
4. Click **Submit for approval**.
5. The disty receives an email and decides within their stated SLA (typically 2 business days).
6. You'll see the row in **Pending approval** until they decide.

## After approval
- The deal moves to **Registered**. The margin is locked.
- Move the deal through stages as it progresses: `qualified` → `proposal` → `closed_won` (or `closed_lost`).
- When `closed_won` and the prospect signs, click **Convert to customer** in the deal detail panel. This creates the customer org and consumes the right number of credits from your pool at the protected margin.

## Verify
- Your registered deal shows on `/partner/deals` with status **registered** + a margin lock chip showing the percentage.
- The expiry date is **90 days** from registration.
- After conversion, the new customer org appears in `/my-customers` with the protected pricing reflected in their MRR row.

## Troubleshooting
- **"Customer already registered."** Another reseller (or you, previously) has registered the same org. Contact your disty for mediation — they have visibility across the channel.
- **Disty rejected with no reason.** Look at the rejection note in the deal detail; if the note is missing, ping your disty — typically the rejection is about a conflict, not the price.
- **Deal expired before you closed.** Click **Re-register** in the detail panel. The disty will re-approve, but the 90-day clock starts again. Don't make a habit of this.

## Related
- [Add a customer](/help/sops/partner/add-customer)
- [Distributor: review deal pipeline](/help/sops/distributor/review-deal-pipeline)
