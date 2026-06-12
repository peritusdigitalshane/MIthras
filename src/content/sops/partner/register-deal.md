---
title: Register a sales opportunity for margin protection
audience: partner
description: Lodge a deal registration so the wholesale margin is locked for the registration window and channel conflict is resolved by the distributor.
order: 2
estimated_minutes: 8
updated_at: 2026-06-12
tags: deals, margin, channel, registration
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure lodges a deal registration against a prospective customer, securing margin protection for 90 days and notifying the distributor of the opportunity. Registration is the mechanism that resolves channel conflict when multiple resellers pursue the same prospect and is the only path to a protected wholesale rate.

## Audience and authority
Reseller staff whose user record carries a `partner` role on the partner organisation. Registration creates a `deal_registrations` row owned by your reseller; the distributor approves, rejects, or mediates the registration.

## Prerequisites
- The prospect is a registered legal entity with a verifiable primary contact email.
- Discovery is complete: confirmed endpoint count, identified end-of-life Windows estate, and a decision on M365 Identity Threat Detection and Response (ITDR) scope.
- The opportunity has not yet been quoted to the prospect; register before issuing pricing to preserve margin protection.
- You have determined the appropriate tier (`essential`, `standard`, or `eol_protected`) and the requested margin percentage.

## Procedure

1. Open `/partner/deals` in the Mithras console.
2. Select `Register deal` in the page header.
3. Complete the registration form:
   - `Customer organisation name` — the prospect's registered legal entity, not a trading name.
   - `Primary contact email` — at the prospect organisation.
   - `Estimated endpoints` — your honest forecast for the first contract year.
   - `Tier` — `essential`, `standard`, or `eol_protected`.
   - `Requested margin %` — the protection you require. The default is the program standard; deviations require justification in `Notes`.
   - `Notes` — referral source, competitive context, decision timeline, and any material constraint.
4. Select `Submit for approval`. The row is created in `deal_registrations` with status `pending_approval` and your distributor is notified.
5. Monitor the row at `/partner/deals`. The distributor responds within their published service level, typically two business days.

## Verification
- The registration is visible at `/partner/deals` with status `registered` and a margin chip displaying the approved percentage.
- The `Expires at` column shows a date 90 days from the approval timestamp.
- The matching `deal_registrations` row carries `status = 'approved'`, `approved_at`, and the locked margin value.
- On conversion through `Convert to customer`, the resulting customer at `/my-customers` reflects the protected wholesale rate and the `licence_transactions` debit applies the approved margin.

## Troubleshooting
- **Submission is rejected with `customer_already_registered`.** Another reseller, or a prior registration of your own, exists against this entity. Contact your distributor for mediation; the distributor has cross-channel visibility.
- **The distributor rejects without a rejection note.** Open the row at `/partner/deals` and read the audit trail in the detail panel. Where no reason is captured, request clarification from your distributor before resubmission.
- **The registration expired before contract close.** Select `Re-register` in the deal detail panel. Approval restarts the 90-day window; repeated re-registration on the same opportunity is escalated by the distributor.
- **The tier or margin is incorrect after approval.** Approved registrations are immutable. Cancel the registration and submit a new one; the prior row is retained for audit.

## Audit and compliance
- A row is written to `public.deal_registrations` with `actor_id = auth.uid()`, `partner_org_id`, the requested tier, and the requested margin.
- An entry is written to `public.activity_logs` with `action_type = 'deal_registered'` capturing the registration identifier and the requesting reseller.
- On approval, conversion, expiry, or rejection, a further `activity_logs` entry records the state transition and the acting party.
- Records in `public.deal_registrations` are retained for seven years to support channel commercial reconciliation.

## Related procedures
- [Provision a new customer organisation](/help/sops/partner/add-customer)
- [Review a monthly customer report](/help/sops/partner/review-monthly-customer-report)
