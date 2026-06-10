# Mithras Channel Pricing Sheet

*All prices AUD ex-GST. Per-endpoint per-month. Billed monthly. Annual prepay discount: 10%. Effective 2026-06-06 until further notice.*

---

## The whole pricing model on one page

| Tier | Pays | Per endpoint / month | Margin / seat | Margin % |
|---|---|---|---|---|
| **End customer** | Reseller | **$11** | — | — |
| **Reseller** | Distributor (or Mithras direct) | **$8** | $3 | 27% |
| **Distributor** | Mithras | **$6** | $2 | 25% |

> Every feature is included at every tier — there are no "Starter" / "Pro" / "Enterprise" tiers
> within Mithras. One product, one price band, channel-sold.

## Worked examples

### 50-seat customer through full chain

| Party | Charges | Margin / mo |
|---|---|---|
| Customer pays Reseller | $550/mo | — |
| Reseller pays Distributor | $400/mo | **$150/mo recurring** |
| Distributor pays Mithras | $300/mo | **$100/mo recurring** |
| Mithras retains | $300/mo | — |

### 8-seat SMB dental clinic through full chain

| Party | Charges | Margin / mo |
|---|---|---|
| Customer pays Reseller | $88/mo | — |
| Reseller pays Distributor | $64/mo | **$24/mo recurring** |
| Distributor pays Mithras | $48/mo | **$16/mo recurring** |

> Small but real. A reseller closing 10 of these per month is on $240/mo recurring margin
> after month one, $2,880 recurring after a year of new acquisitions.

### Distributor portfolio snapshot

> Indicative: 30 resellers × 4 customers each × 50 seats average = 6,000 endpoints.
> Distributor recurring margin: ~$12,000/month. Reseller pool recurring margin: ~$18,000/month
> shared across 30 resellers (~$600/month/reseller). Scales linearly with new wins.

---

## Reseller signed direct (no distributor)

If you're a reseller signed up directly by Mithras with no distributor in between, you pay the
**distributor wholesale price of $6** and keep the **full $5/seat margin** ($11 − $6, 45%).

This is the original go-to-market — distributors come in when you want a channel partner
recruiting, supporting, and billing other resellers on your behalf.

---

## Volume tiers — direct from Mithras

| Distributor's active endpoint count | Discount on $6 wholesale |
|---|---|
| 1,000 – 4,999 | 0% (standard) |
| 5,000 – 14,999 | 7% (effective $5.58) |
| 15,000 – 49,999 | 12% (effective $5.28) |
| 50,000+ | Custom — let's talk |

Volume tiers apply at the distributor level. Resellers under a distributor get pricing
the distributor sets, which may itself reflect a volume discount the distributor passes on.

---

## What's included at the $11 retail price

- **Multi-tenant Mithras console** for the reseller's operators
- **Read-only customer portal** so each end customer can see their own posture
- **Modular Windows agent** + auto-update + tamper protection
- **Defender posture monitoring** + threat ingest + AI SOC triage
- **Microsegmentation** (audit + lockdown modes)
- **Application whitelisting** (WDAC)
- **EOL Windows hardening** (Win 7 / Server 2008 / 2012)
- **M365 ITDR** — sign-ins, mailbox rules, OAuth grants
- **Embedded remote desktop** (MeshCentral)
- **Vulnerability scanning** + AI mitigation advice
- **Monthly customer reports** (PDF)
- **24/7 platform availability** (99.5% SLA from 2026-09)
- **Email support** during AU business hours
- **Free agent re-installs**
- **Access to the full sales kit** + demo tenant

## What's NOT included at $11

- White-label (Mithras stays Mithras — single-brand channel model)
- 24/7 phone support (paid add-on, $POA)
- On-site incident response (paid add-on, $POA)
- Custom integrations (paid project, $POA)
- Dedicated success engineer (Distributor tier perk if your portfolio exceeds 5,000 endpoints)

---

## Billing terms

- **Monthly in arrears.** Invoices issue on the 1st of each month for the previous month.
- **Net 14 day terms.** Extendable to net 30 by agreement for distributors with >12 months track record.
- **Currency:** AUD. NZD / USD on request.
- **Payment:** direct deposit (Stripe coming Q3 2026).
- **Disputed line items:** notify within 14 days of invoice receipt. Credits processed within 5 business days.

## Suspension policy

- **30 days overdue:** account flagged "at-risk", emails sent.
- **60 days overdue:** new endpoint provisioning blocked. Existing endpoints continue reporting.
- **90 days overdue:** account suspended. Endpoints stop ingesting telemetry. Data retained for 90 days; restored on payment.

---

## How to update this sheet

Pricing in the platform is set under **Admin → Pricing**. Tier defaults live in
`platform_pricing_defaults` and currently read $6 / $8 / $11. Per-org overrides for special
deals (volume discounts, anchor accounts, charity pricing) are set per-org in the same UI.

A super-admin can also set an org's `wholesale_price_cents = 0` to grant a complimentary
licence — used for proof-of-value pilots, internal eat-your-own-dogfood tenants, and the
occasional strategic freebie. Track these in /admin/overview → At-risk so they stay visible.

The numbers above are what we'd quote to a brand-new distributor today. Negotiate from here —
anchor high, drop only with multi-year commitments or volume.
