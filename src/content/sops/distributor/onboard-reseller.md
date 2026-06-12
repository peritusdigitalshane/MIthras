---
title: Onboard a new reseller
audience: distributor
description: Add a reseller organisation, fund their initial credit pool, and verify they can sign in.
order: 1
estimated_minutes: 15
updated_at: 2026-06-12
tags: onboarding, credits, channel
---

## When to use this
A new MSP has signed your channel agreement and needs login access. You're the distributor activating them.

## Prerequisites
- You're signed in as a distributor admin (your org has `org_type='distributor'` and you have the **admin** or **owner** role).
- The reseller has sent you their primary technical-contact email + a billing contact.
- You have a starter credit budget agreed — typical first allocation is **50–100 credits** (1 credit = 1 endpoint × 1 month).

## Steps

1. Go to **`/distributor/resellers`**.
2. Click **Add reseller** (top right).
3. Enter the reseller's:
   - Organisation name (will appear on their portal hero)
   - Primary admin email — they'll receive the activation link
   - Optional: account manager assignment, billing email
4. Click **Create**. The portal redirects you to the new reseller row.
5. Open **`/distributor/licences`** in a new tab.
6. In the **Cut credits to reseller** panel, pick the new reseller from the dropdown, enter the starter amount (e.g. `50`), add a transaction note (`"Onboarding starter pack — 50 endpoints × 1 month"`), and click **Cut**.
7. Confirm the transaction appears in the credit ledger below with status `posted`.
8. Tell the reseller to check their email + sign in at **`https://www.mithras.com.au/login`**.

## Verify
- The reseller appears in `/distributor/resellers` with status **Active**.
- Their credit balance in `/distributor/licences` matches what you cut.
- After they sign in, your reseller-health view shows them as **Connected** (last_login_at populated).

## Troubleshooting
- **Activation email didn't arrive.** Check `/admin/audit-logs` for a row with `action='invite_user'`. If the row is there but the email never landed, the SMTP send failed — re-issue from the row, or have the reseller use **Forgot password** at the login page to set their own password.
- **Credit cut shows "insufficient_balance".** Your own distributor pool is depleted. Open **`/distributor/licences`** → contact-Peritus tile and request a top-up before continuing.
- **Reseller can sign in but sees a blank portal.** They probably logged in to the wrong subdomain. Distributors land at `/distributor`, resellers at `/partner` — the URL after login is the source of truth.

## Related
- [Top up a reseller's credits](/help/sops/distributor/top-up-credits)
- [Review your deal pipeline](/help/sops/distributor/review-deal-pipeline)
