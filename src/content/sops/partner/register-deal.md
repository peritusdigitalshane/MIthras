---
title: Register a sales opportunity for margin protection
audience: partner
description: Lodge a deal registration so the wholesale margin is locked for the registration window and channel conflict is resolved by the distributor.
order: 2
estimated_minutes: 8
updated_at: 2026-06-17
tags: deals, margin, channel, registration
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure lodges a deal registration against a prospective customer, securing margin protection for the registration window (default 60 days at `qualified` stage; see `public.deal_stage_window` for the exact mapping). Registration is the mechanism that resolves channel conflict when multiple resellers pursue the same prospect and is the only path to a protected wholesale rate.

## Audience and authority
Reseller staff whose user record carries a `partner` role on the partner organisation. Registration creates a `deal_registrations` row owned by your reseller; the row is immediately active — there is no distributor approval gate. The distributor has read-only pipeline visibility across their resellers.

## Prerequisites
- The prospect is a registered legal entity with a verifiable primary contact email.
- Discovery is complete: confirmed endpoint count and identified end-of-life Windows estate.
- The opportunity has not yet been quoted to the prospect; register before issuing pricing to preserve margin protection.
- Your reseller organisation holds a positive credit balance at `/partner/licences`; conversion of a won deal will debit a licence from the pool.

## Procedure

1. Open `/partner/deals` in the Mithras console.
2. Select `Register deal` in the page header.
3. Complete the registration form:
   - `Prospect name` — the prospect's registered legal entity, not a trading name.
   - `Primary contact email` — at the prospect organisation.
   - `Estimated endpoints` — your honest forecast for the first contract year.
   - `Expected close date` — your target signed-contract date.
   - `Industry` and `Region` (optional) — for distributor visibility.
   - `Notes` — referral source, competitive context, decision timeline, and any material constraint.
4. Select `Register`. The deal is created in `deal_registrations` at stage `qualified` with status `active` and the protection window opens immediately. Margin is locked to the per-reseller pricing record at the moment of registration.
5. Advance the stage as the opportunity progresses at `/partner/deals`. Stages are `qualified` → `demo` → `poc` → `quote` → `won` or `lost`. The protection window resets per-stage according to the matrix in `public.deal_stage_window` (qualified/demo: 60 days, poc: 90 days, quote: 30 days).

## Verification
- The registration is visible at `/partner/deals` with status `active`, stage `qualified`, and a protection-expiry countdown.
- The matching `deal_registrations` row carries `status = 'active'`, `stage = 'qualified'`, and the locked `wholesale_price_cents` from your reseller's pricing record.
- On conversion through `Convert to customer`, the resulting customer at `/partner` reflects the protected wholesale rate and the `licence_transactions` debit applies the locked margin.

## Troubleshooting
- **Submission fails with `customer_already_registered`.** Another reseller, or a prior registration of your own, exists against this entity. Contact your distributor; the distributor has cross-channel visibility at `/distributor/deals` and can confirm which reseller holds the registration.
- **The registration expired before contract close.** Re-register the deal — the protection window restarts. Repeated re-registration on the same opportunity is visible to your distributor and may be queried.
- **The margin is incorrect after registration.** Margin is locked at the moment of registration from the reseller pricing record. If your pricing has changed since, cancel the registration (`Mark lost`) and re-register; the prior row is retained for audit.

## Audit and compliance
- A row is written to `public.deal_registrations` with `reseller_org_id`, the registering user, and the locked wholesale price.
- An entry is written to `public.activity_logs` with `action_type = 'deal_registered'` capturing the registration identifier and the requesting reseller.
- On stage advance, conversion, expiry, or loss, a further `activity_logs` entry records the state transition.
- Records in `public.deal_registrations` are retained for seven years to support channel commercial reconciliation.

## Related procedures
- [Provision a new customer organisation](/help/sops/partner/add-customer)
- [Review a monthly customer report](/help/sops/partner/review-monthly-customer-report)
