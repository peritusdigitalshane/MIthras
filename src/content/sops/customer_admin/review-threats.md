---
title: Review threats detected on your endpoints
audience: customer_admin
description: Open the threats register, interpret severity, and confirm Mithras handled each detection as expected.
order: 2
estimated_minutes: 10
updated_at: 2026-06-12
tags: threats, defender, posture
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure walks through the threats detected by Mithras across your fleet, interprets the severity classification, and confirms that the automated response was appropriate. Routine review of this register is the primary lagging indicator of endpoint hygiene and policy effectiveness.

## Audience and authority
Customer administrators and members. Customer members have read-only access; only administrators can change policy in response to a finding.

## Prerequisites
- The Mithras agent is installed on at least one endpoint and has reported at least one heartbeat.
- You are signed in to the Mithras console at `https://www.mithras.com.au/login`.

## Procedure

1. Open **`/threats`**. The page lists every threat detected across your endpoints in the last 30 days, sorted by detection time descending.
2. Apply filters as required:
   - **Severity** — `Severe`, `High`, `Moderate`, `Low`. Severe and High threats automatically generate incidents at `/incidents`; Moderate and Low are visible here but do not trigger automated response.
   - **Status** — `active`, `quarantined`, `remediated`, `allowed`. Active findings require attention.
   - **Endpoint** — filter to a single device for targeted review.
3. For each entry, expand the row to read:
   - **Threat name** — the Microsoft Defender or Mithras detection identifier.
   - **File path or process** — the artefact that triggered the detection.
   - **Action taken** — the automated response Defender or Mithras applied.
   - **AI verdict** — if the AI Triage Agent reviewed the threat, its classification and confidence appear here.
4. Where the AI Triage Agent has marked a threat **suspicious** or **malicious**, follow the link to the associated incident at `/incidents/:id` for the full multi-agent verdict trail and any autonomous response.

## Verification
- Every Severe or High row in **active** status has a linked incident at `/incidents`. If a row is **active** with no incident, the AI Triage Agent has not yet completed; expected latency is under two minutes.
- The endpoint detail page at `/endpoints/:id` shows the same threat count under **Threat history** as the per-endpoint filter on `/threats`.
- The threat counts visible to you match the latest monthly report at `/customer/reports`. Snapshot drift indicates the report was generated before the most recent activity.

## Troubleshooting
- **A threat shows status `active` but the underlying file no longer exists.** The threat record is retained for audit. The endpoint's next inventory pass will mark it `remediated`. Manual confirmation is not required.
- **A threat is classified `Severe` but you believe it is a false positive.** Open the linked incident and use the **Rollback now** action on the Autonomous response card. Provide a written reason of at least 20 characters; the reason is recorded in the audit trail and included in the next monthly customer report.
- **The AI verdict column is empty for recent rows.** The AI Triage Agent processes threats in priority order. Severe and High threats are processed first; Moderate and Low rows may have a delay of up to ten minutes during high-volume periods.
- **The page shows no threats and you expect some.** Verify the filter chips are not unintentionally excluding records. Clear all filters with **Reset** at the top right of the page.

## Audit and compliance
- Threat records are stored in `public.endpoint_threats` and are retained for 24 months.
- Operator actions on a threat (rollback, mark false positive, reclassify) are written to `public.activity_logs` with `action_type = 'threat_review'` and the operator identifier.
- Threat metrics roll up into the monthly customer report distributed via `public.customer_reports`.

## Related procedures
- [Understand the incident detail page](/help/sops/customer_admin/understand-incident-detail)
- [Manage your Defender policy](/help/sops/customer_admin/manage-defender-policy)
- [Request emergency unlock for an endpoint](/help/sops/customer_admin/request-emergency-unlock)
