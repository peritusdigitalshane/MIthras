---
title: Add a customer organisation
audience: partner
description: Create a customer org, send the signup link, and verify the first agent enrols.
order: 1
estimated_minutes: 10
updated_at: 2026-06-12
tags: onboarding, customer
---

## When to use this
You've sold Mithras to a new MSP customer and need to provision their organisation so an IT admin on their side can deploy the agent.

## Prerequisites
- You have credits in your pool (see `/partner/licences` — at least 1 endpoint × 1 month per device they plan to deploy).
- You have the customer's primary IT contact email.
- For deal-registered customers: the deal in `/partner/deals` must be in stage **won** (otherwise the create-customer button will be greyed out — you can convert it via the **Convert to customer** shortcut on the deals row).

## Steps

1. Go to **`/my-customers`** (or `/partner/customers` — same page).
2. Click **Add customer**.
3. Fill in:
   - Customer org name
   - Primary admin email — they'll receive the activation link
   - Initial endpoint quota (default: 25; raise it for known-larger deployments)
   - Plan tier (Lite / Standard / Pro) — drives feature gates + pricing
4. Click **Create**. A `licence_transactions` row debits your pool by the first month's allocation.
5. The customer admin receives an activation email with a one-time link valid for 7 days.

## Verify
- The customer appears in `/my-customers` with `Active` status and your reseller name on the row.
- After the customer admin signs in and follows the agent deploy guide, the endpoint appears in your customer's `/endpoints` page within ~60 seconds of the first heartbeat.
- Your pool decreased by the expected amount.

## Troubleshooting
- **Customer create button is greyed out.** Check that your reseller balance isn't overdrawn (`/partner/licences`).
- **Activation email didn't arrive.** Have the customer click **Forgot password** at the login page using the email you entered.
- **First endpoint won't enrol.** The customer's first-login wizard generates an enrolment code. Check the customer's `/deploy` page for a fresh one-liner that includes the enrolment code in the URL.

## Related
- [Push an agent update to your customers](/help/sops/partner/push-agent-update)
- [Decommission a retired endpoint](/help/sops/partner/decommission-endpoint)
- [Customer admin: install the agent](/help/sops/customer_admin/install-agent-on-endpoint)
