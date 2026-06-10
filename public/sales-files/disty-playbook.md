# Mithras Distributor Playbook

The operational manual for running a Mithras distribution. Covers
billing, credit management, reseller onboarding, support escalation,
and the contracts/commercials you need to know. Read this in order
once; refer back to specific sections as questions come up.

---

## How the credit model works

**1 credit = 1 endpoint protected for 1 calendar month.**

That's the only unit. Everything else is a multiple.

- Sell 1 endpoint for 12 months to a reseller → cut **12 credits** to them
- Sell 50 endpoints for 12 months → cut **600 credits**
- Sell unlimited (monthly only) → cut whatever pool size you both agreed on, top up monthly

**The flow:**

1. **You buy credits from Mithras.** Email channel@mithras.com.au with a pack size. Volume tiers (in `/admin/credits`) reduce the per-credit cost.
2. **You cut credits to your resellers** via `/distributor/credits`. Set the price you charge them — it's recorded but private. The reseller only sees the quantity, not the price you paid Mithras.
3. **Resellers spend credits** as their customers' endpoints enrol.
4. **On the 1st of each month**, a cron deducts 1 credit per active endpoint per reseller. If the reseller's pool goes negative, they get warnings and (eventually) endpoint deactivation.
5. **You top up your pool** whenever a reseller asks for more.

**Rule of thumb on inventory carrying:** keep about 2× your monthly burn on hand. If you cut 500 credits/mo across your channel, have 1,000 in your pool. Top up monthly.

---

## How billing works

**Three-layer billing:**

1. **Mithras → You.** When you buy a credit pack, Mithras invoices you. Net 14 days, direct deposit. Distributor pricing currently:
   - 1–499 credits: $6.00 / credit (standard rate)
   - 500+: $5.85 (2.5% off)
   - 1,000+: $5.70 (5% off)
   - 10,000+: $5.40 (10% off)

2. **You → Resellers.** You set the price you charge resellers per credit. **$8/credit is the standard rate we recommend.** Some distributors charge less to high-volume resellers; some charge more for tiny customers. Your call. Record the price in the "Cut credits" dialog so you have receipts.

3. **Resellers → Customers.** Resellers charge their end customers $11/endpoint/month retail (our suggested figure). They keep the margin between $8 and $11 — $3/seat recurring.

**Margins, when everything sits where it should:**

- Mithras keeps $6/credit (or less, at volume tiers)
- You keep $2/credit ($8 − $6)
- Reseller keeps $3/credit ($11 − $8)

**A 50-seat customer through your channel:**

| Party | Per month | Annual |
|---|---|---|
| Customer pays reseller | $550 | $6,600 |
| Reseller pays you | $400 | $4,800 |
| You pay Mithras | $300 | $3,600 |
| **Your margin** | **$100** | **$1,200** |

Scale that across 30 resellers × 4 customers each × 50 seats average = **~$12,000/month recurring to you**.

---

## How to onboard a reseller

Time to first revenue: 5 business days if you stay on it.

### Day 1 — Sign them up
1. `/distributor/resellers` → Add reseller
2. Send them the enrolment URL the dialog generates
3. Email them the welcome pack (see template below)

### Day 2 — They sign in, sales kit walkthrough
- Get them to read the one-pager + pitch deck + demo script (all in `/partner/resources`)
- Block out 30 minutes on a call to walk through the demo together

### Day 3 — First credit cut
- `/distributor/credits` → Cut credits → start with 50–100 credits as a "starter pack" so they can sign 1–2 small customers and get familiar
- Don't over-allocate early — you want them to come back and ask for more once they've got real customers

### Day 4 — Their first customer
- Walk them through `/my-customers → Add customer` together
- Then `/deploy` for the agent install command
- First endpoint should appear in their dashboard within 5 minutes

### Day 5 — Debrief + cadence
- Set a regular monthly check-in
- Agree on a "low-credit threshold" they'll alert you at (recommend < 50% of their monthly burn) so you can ship more credits proactively

### Welcome email template

```
Subject: Welcome to {Distributor Name} × Mithras

Hi {name},

Quick onboarding map:

1. Click the enrolment URL I sent yesterday to set your password
2. Read the one-pager and demo script under "Sales kit" in the portal
3. Reply with your first prospect — we'll book a joint demo
4. You've got 50 credits to start. Add a customer, enrol an endpoint,
   tell me how it goes.

Anything you need: reply to this email.

— {Your name}
```

---

## Support escalation matrix

Your job is L1 sales support. Mithras handles L2 technical and L1 security.

| Issue | Where it goes |
|---|---|
| Reseller needs more credits | You — through `/distributor/credits` |
| Reseller has a sales question / battle card request | You — refer to `/distributor/resources` first |
| Reseller's customer agent won't install | Reseller's tech team first, then Mithras `support@mithras.com.au` if blocked |
| Reseller's customer reports a missed threat | Mithras SOC — `soc@mithras.com.au`, target 1 hour 24/7 |
| Reseller's billing dispute with you | You |
| Distributor billing dispute with Mithras | `billing@mithras.com.au` |
| Strategic / channel growth conversation | `channel@mithras.com.au` |

---

## Reading your dashboard

`/distributor` is your daily-driver. Watch these signals:

- **Your pool dropping fast** = signal you're growing. Reorder before it hits 2× current burn.
- **A reseller's runway < 1 month** = they'll be calling. Reach out first — proactive top-up beats firefighting.
- **A reseller with 0 customers after 30 days** = onboarding stalled. Get on a call before they ghost.
- **A reseller suddenly cutting big customers** = they're scaling. Have a volume conversation now.

The "Recent activity" panel on `/admin` (Mithras-side) shows new channel partners signed. You won't see it from the disty portal — your view is your own resellers only.

---

## Contracts & MDF

**Standard distribution agreement covers:**

- Mithras grants you non-exclusive rights to distribute in your region
- You undertake to not undercut the suggested retail to your resellers' customers
- 30-day exit either side
- IP, brand, confidentiality, audit rights — standard SaaS contract terms

**No MDF program at this stage.** Mithras is still small enough that co-marketing happens case-by-case via the channel team — pitch us a specific opportunity and we'll talk.

**Anti-poaching:** Mithras commits to not selling direct in your territory while you're the active distributor. If a customer comes to us directly, we refer them to you.

---

## What you don't need to think about

Mithras handles the platform end-to-end. You're not on the hook for:

- Platform uptime (99.5% SLA from us)
- Agent updates (auto-update, signed)
- Threat intel feeds + AI SOC infrastructure
- M365 integration maintenance
- Stripe + payment processing for any home-user channel

Your focus is **growing your reseller base** and **keeping them stocked with credits**. Everything else is our problem.

---

## Quick reference — keyboard shortcuts in the portal

- `g d` — Distributor dashboard
- `g r` — My resellers
- `g c` — Credits
- `g b` — Billing
- `g i` — Invoices
- `?` — Show this list

*(Shortcuts not implemented yet — coming Q3.)*

---

## Need help?

- **Channel / commercial:** channel@mithras.com.au
- **Technical:** support@mithras.com.au
- **Security incident (your or a reseller's customer):** soc@mithras.com.au
- **Billing:** billing@mithras.com.au

All emails respond within 1 business day during AU hours. SOC responds within 1 hour 24/7 for confirmed active incidents.
