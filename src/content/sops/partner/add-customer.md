---
title: Provision a new customer organisation
audience: partner
description: Create a customer organisation, debit your credit pool, and confirm the customer administrator can enrol their first endpoint.
order: 1
estimated_minutes: 10
updated_at: 2026-06-12
tags: onboarding, customer, provisioning
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure provisions a new customer organisation under your reseller account, debits the appropriate allocation from your credit pool, and dispatches the activation link to the customer's primary administrator. Until the procedure completes, the customer cannot sign in, deploy agents, or consume protection.

## Audience and authority
Reseller staff whose user record carries a `partner` role on the partner organisation. The action is gated by the existence of a positive balance on your reseller credit pool and, where the customer originated from a registered opportunity, by an approved `deal_registrations` row in stage `closed_won`.

## Prerequisites
- Your reseller credit pool, visible at `/partner/credits`, holds at least one month of allocation for every endpoint the customer intends to deploy.
- You hold the customer's primary administrator email and the customer's registered legal entity name.
- Where the customer was registered as a deal, the matching row at `/partner/deals` is in stage `closed_won`.
- You have confirmed the customer's chosen tier (`essential`, `standard`, or `eol_protected`) and the initial endpoint quota.

## Procedure

1. Open `/my-customers` in the Mithras console.
2. Select `Add customer` in the page header.
3. Complete the provisioning form:
   - `Customer organisation name` — the customer's registered legal entity. Trading names cause downstream conflicts with `deal_registrations`.
   - `Primary administrator email` — the customer's IT contact, not a reseller mailbox.
   - `Initial endpoint quota` — the count of devices the customer expects to enrol in the first 30 days.
   - `Plan tier` — `essential`, `standard`, or `eol_protected`. Tier drives feature gating and wholesale cost.
4. Select `Create`. The platform writes the customer organisation, debits your pool through a `licence_transactions` row tagged with `transaction_type = 'pool_debit'`, and dispatches the activation email.
5. Confirm the success toast names the new customer and shows the post-debit pool balance.

## Verification
- The customer is listed at `/my-customers` with status `Active` and your reseller name on the row.
- The corresponding `licence_transactions` entry is visible in your transaction history at `/partner/credits` with the expected debit amount.
- After the customer administrator activates their account and enrols an endpoint, the endpoint surfaces at `/endpoints` filtered by the customer organisation within the agent heartbeat window of 30 seconds.
- The customer organisation is selectable in your global organisation switcher in the console header.

## Troubleshooting
- **`Add customer` is disabled.** Your credit pool balance is at or below zero. Top up at `/partner/credits` or escalate to your distributor before retrying.
- **The form rejects the organisation name with `deal_conflict`.** A `deal_registrations` row exists for this entity under another reseller or under a different stage. Resolve the conflict with your distributor before reattempting provisioning.
- **The activation email is not received within 15 minutes.** Direct the customer administrator to the password reset flow at `/login` using the registered email address. Persistent failure indicates an SMTP issue; escalate to the Mithras SOC.
- **The first endpoint fails to enrol.** Confirm the customer administrator generated a fresh installer command at `/deploy` after activation. Enrolment tokens are single-use and expire within 24 hours.

## Audit and compliance
- A row is written to `public.licence_transactions` with `transaction_type = 'pool_debit'`, `actor_id = auth.uid()`, and the originating reseller organisation identifier.
- An entry is written to `public.activity_logs` with `action_type = 'customer_provisioned'` recording the actor, the new organisation identifier, and the selected tier.
- Records in `public.licence_transactions` are retained for seven years to support reseller commercial reconciliation and end-of-financial-year audit.

## Related procedures
- [Register a deal](/help/sops/partner/register-deal)
- [Push an agent update to your customers](/help/sops/partner/push-agent-update)
- [Install the Mithras agent on a Windows endpoint](/help/sops/customer_admin/install-agent-on-endpoint)
