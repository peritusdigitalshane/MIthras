---
title: Onboard a new distributor
audience: peritus_super_admin
description: Create the distributor organisation, issue starter credits, and verify they can sign in.
order: 1
estimated_minutes: 15
updated_at: 2026-06-12
tags: onboarding, channel, distributor
---

## When to use this
A new MSP distribution partner has signed the channel agreement and needs portal access.

## Prerequisites
- You're a super-admin (your `user_id` is in `public.super_admins`).
- You have the distributor's primary contact email + their starter credit commitment from the deal.
- For the AU/NZ channel, distributors are usually expected to manage 5+ resellers.

## Steps

1. Go to **`/admin/resellers`**.
2. Click **Add distributor**.
3. Fill in:
   - **Organisation name** — what shows in the distributor's portal hero.
   - **Primary admin email** — gets the activation link.
   - **Display name** for the contact.
   - **Commercial terms** — your standard distributor pricing (this is informational only; pricing is enforced from `platform_pricing` not here).
4. Click **Create**. A row is written to `organizations` with `org_type='distributor'` and the contact is provisioned as the primary admin.
5. Open **`/admin/credits`**.
6. In the **Issue credits to distributor** panel, pick the new distributor and issue the starter pool (typical: 500 credits = 500 endpoints × 1 month for them to fan out to resellers).
7. Add a clear ledger note: `"Founding-channel pool — Q3 2026 commitment per agreement"`.
8. Click **Issue**.
9. Tell the distributor to check their email + sign in at **`https://www.mithras.com.au/login`**.

## Verify
- The distributor row appears in `/admin/resellers` with `Active` status.
- Their credit balance in `/admin/credits` shows what you issued.
- The audit log at `/activity` shows an `org_create` row + a `licence_issue` row signed with your user id.
- After they sign in, their `/distributor` portal renders without errors.

## Troubleshooting
- **Activation email never arrived.** Check `/activity` for a row with `action='invite_user'` and the right email. If the row is there but no email reached the inbox, SMTP failed — re-issue from the audit log row, or have them use **Forgot password** at `/login`.
- **"organisation already exists" error.** Either the distributor was partially created earlier (look in `/admin/resellers` even if inactive) or the email collided with an existing user — a single email can only own one org of a given type.
- **You issued the wrong credit amount.** Write a **correcting transaction** from `/admin/credits` — issue or claw back the delta with a ledger note explaining the correction. The ledger is append-only; an inverse entry is the canonical fix.

## Related
- [Respond to AI budget alert](/help/sops/peritus_super_admin/respond-to-ai-budget-alert)
- [Audit channel margins](/help/sops/peritus_super_admin/audit-channel-margins)
- [Distributor: onboard a reseller](/help/sops/distributor/onboard-reseller)
