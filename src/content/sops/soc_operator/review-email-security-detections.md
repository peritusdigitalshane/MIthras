---
title: Review and tune email security detections across the customer fleet
audience: soc_operator
description: SOC operator workflow for monitoring the AI-driven email security pipeline across every Mithras customer, triaging high-confidence detections that customer admins haven't actioned, hunting for novel campaigns, and tuning the classifier when false-positive or false-negative patterns emerge.
order: 5
estimated_minutes: 30
updated_at: 2026-06-15
tags: email, security, soc, phishing, bec, ai, tuning
owner: Mithras SOC Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose

This procedure defines the SOC-side workflow for the email security service. While the customer-admin SOPs describe per-tenant action on a single message, this document describes the Mithras-wide responsibilities: cross-tenant monitoring, escalation of un-actioned high-severity detections, threat-hunting for novel phishing campaigns hitting multiple customers, and feedback into the AI classifier when its accuracy degrades.

The procedure is the canonical reference for the question "what does the SOC do about email security every shift?"

## Audience and authority

Mithras SOC operators with `super_admin` membership. Access to cross-tenant `email_threats` data is gated by `is_super_admin(auth.uid())` in the row-level security policies; non-super-admin sessions cannot see other organisations' data.

The procedure assumes the operator has the tenant-impersonation capability via the **Switch tenant** control in the console header, which is required to action a flagged message inside a specific customer's tenant scope.

## Prerequisites

- Console super-admin session with MFA enrolled.
- Familiarity with the customer-admin SOPs `enable-email-security.md` and `action-flagged-email.md` so the operator can guide a customer admin through onboarding or remediation if needed.
- Read access to the `ai_llm_calls` ledger for cost monitoring and to `email_threats` / `email_sweep_runs` / `email_digest_runs` for state inspection.
- Slack / on-call channel for SOC alerts; the `event_outbox` trigger on high-severity rows will reach the channel via any operator destination already wired up there.

## Shift workflow

### 1. Open shift — verify the pipeline is healthy

Within the first ten minutes of every shift:

1. From the console choose **Admin → Email security overview** (cross-tenant view). The page shows:
    - Sweep runs in the last hour across every tenant.
    - Detections in the last 24 hours by classification.
    - The `Mail.Read` and `Mail.ReadWrite` scope coverage per tenant.
    - Any tenant whose `last_swept_at` is older than 15 minutes — that's a stuck sweep.
2. Confirm:
    - Sweep activity in the last hour is non-zero (allowing for tenants with no inbound mail).
    - No tenant shows `last_error` in `email_sweep_runs` indicating token expiry or Graph throttling.
    - The classifier cost per hour from `ai_llm_calls` filtered to `feature='email_security'` is within the per-hour budget (see Cost monitoring below).
3. If any tenant has a stuck sweep, run the playbook in section 6.

### 2. Triage un-actioned high-severity detections

The customer-admin workflow assumes a competent admin checking the console every business day. In practice many will not. The SOC's job is to catch the gaps.

1. Filter `email_threats` to rows where:
    - `severity IN ('high','critical')`
    - `action_taken = 'flagged'`
    - `created_at > now() - interval '24 hours'`
2. For each row, judgement-call escalate:
    - **Confirmed BEC against an exec target:** Slack the partner channel + the customer's named technical contact. If the partner is offline, action the quarantine from the SOC console after impersonating the customer tenant via the tenant switcher.
    - **Confirmed phishing against multiple recipients in the same tenant:** treat as a campaign. Quarantine all (use the bulk action in section 3) and warn each recipient.
    - **Confirmed phishing against a single user:** queue for the morning digest; customer admin will see it.
3. Record each escalation in the SOC shift log with the threat id, action taken, and the contact person notified.

### 3. Bulk-handling a confirmed phishing campaign

When the same sender domain or AI reasoning pattern appears in five or more flagged rows across the same tenant in under an hour, treat as an active campaign:

1. In the console, filter by `sender_domain` to see the spread.
2. Tick **Select all visible** in the flagged-messages card (or per-row checkboxes if you only want a subset), then click **Quarantine (N)** in the bulk action bar at the bottom of the page. The action runs through `m365-email-action` with the array of threat ids and reports per-row outcomes.
3. Send a single explanatory email to the customer admin describing the campaign, the indicator (typically the sender domain), and what Mithras quarantined.
4. Add the sender domain to the per-tenant block list via the **Block rules** tab on the customer's email security page (or via the "Block domain" button on any flagged row from the campaign). New mail matching the rule skips the AI classifier and applies the configured action automatically, ending the campaign at the source for that tenant. Document the indicator in the SOC campaign log too — other tenants benefit from the same rule.

### 4. Cross-tenant campaign hunting

Phishing campaigns frequently hit multiple Mithras customers within minutes of each other. The cross-tenant view exists specifically to catch this.

1. Twice per shift, query `email_threats` grouped by `sender_domain` across all organisations.
2. Any sender domain producing detections in three or more distinct organisations within a 4-hour window is a tracked campaign. Tracking it means:
    - Logging the domain in the SOC campaign log with first-seen and last-seen timestamps.
    - Pinging the on-call SOC analyst at the partner level (if the customers belong to different partners, ping each partner channel).
    - Considering whether a Mithras-wide threat-intel update is justified — typically yes if it's the second cross-customer campaign from the same domain or its NS-record neighbours.
3. The `/intel` page on the public site is the channel for the threat-intel update; tile updates feed the public radar.

### 5. Tune the AI classifier when accuracy degrades

The classifier emits structured outputs into `email_threats`. Patterns that indicate tuning is needed:

- **False positives rising:** the `reviewer_verdict` column shows `false_positive_release` more than 5% of all reviewed rows in a 7-day window. Capture 10–20 representative false positives and queue them for the next prompt revision.
- **False negatives reported:** a customer admin reports a clear phishing email that Mithras classified as `legitimate`. Pull the message metadata + headers from `email_threats` (it will exist as a `legitimate` row), capture the gap, and queue for prompt revision.
- **Confidence drift:** the 7-day rolling mean confidence on `phishing` classifications drops below 70%. Indicates the prompt or the model has lost calibration; escalate to the engineering team.

The prompt lives in `supabase/functions/m365-email-sweep/index.ts` (`SYSTEM_PROMPT` constant). Changes to the prompt are routine but every change must:

1. Be made in a draft branch and tested with the captured false-positive corpus.
2. Demonstrate that no previously-correct classification regresses.
3. Bump the `feature` attribution if the change is structurally significant so cost-monitoring trends remain comparable.
4. Be deployed via the standard edge-function deploy path. The next sweep (runs every two minutes) picks up the new prompt automatically.

### 6. Recover a stuck sweep

`email_sweep_runs.last_error` is the diagnostic. Common causes:

| Error pattern | Cause | Recovery |
|---|---|---|
| `token_refresh_failed:401` | Refresh token revoked by tenant admin or expired | Ask the customer admin to re-consent the M365 integration per `enable-email-security.md` step 2 |
| `token_refresh_failed:403:insufficient_privileges` | Azure AD app was modified or admin consent was withdrawn | Same recovery as above |
| `graph_429` | Microsoft Graph throttling | Sweep auto-recovers on the next cycle; if persistent for more than 1 hour, reduce `MAX_MAILBOXES_PER_RUN` for that tenant via per-tenant override |
| `m365_credentials_missing` | Azure app client id/secret rotated and platform setting not updated | Update `m365_azure_client_id` and `m365_azure_client_secret` in **Admin → Platform settings**. Every tenant resumes on the next sweep. |

If the sweep is stuck and the issue is platform-side (credentials, edge-function deploy failure), open a P2 incident and notify the engineering on-call.

### 7. End of shift — handover note

Capture in the SOC shift log:

- Detection totals for the shift by classification.
- Any campaign promoted to tracked status, with domain + customers affected.
- Any classifier-tuning corpus collected.
- Any tenant in degraded state (stuck sweep, missing scope, scope rolled back).
- Any operator action taken on behalf of a customer (with `action_taken_by = <soc operator>` correlatable in the audit trail).

## Verification

The shift's email-security workload is complete when:

- The cross-tenant view shows no tenant with `last_swept_at` older than 15 minutes (or each stuck tenant has been documented and queued for recovery).
- Every `severity IN ('high','critical')` row from the last 24 hours has either been actioned or has an explanatory note in the shift log.
- Any campaign promoted in the shift is documented with first/last-seen timestamps and affected customers.
- Classifier cost is within budget for the shift; any breach is documented.

## Cost monitoring

The classifier runs per-message and bills per 1k tokens. At a typical 50-mailbox customer with 20 messages/mailbox/day, the daily cost lands at roughly $1/customer. The hourly per-customer envelope under steady state is:

- 50 mailboxes × (20 / 24) messages/hour ≈ 42 messages/hour
- ~$0.001/classification = ~$0.04/hour/customer

If the per-hour cost exceeds 5× this envelope for a single customer, investigate before approving further sweeps. Likely causes: a mail-bomb / DDoS via a forwarded list, or a misconfigured rule importing huge external archives into an Inbox.

## Related procedures

- `customer_admin/enable-email-security.md` — onboarding flow operators escalate to when a customer asks for the service.
- `customer_admin/action-flagged-email.md` — per-message workflow operators can run on the customer's behalf via tenant impersonation.
- `platform_super_admin/restore-from-backup.md` — restore `email_threats` from backup in the event of accidental data loss.

## Compliance notes

The SOC operates under the platform's stated data-handling commitments: full bodies are never persisted, only a 2 KB excerpt is sent to the AI model per message, attachment binaries are never inspected, and tenant access tokens are stored under organisation-scoped RLS. Operator actions taken via tenant impersonation are recorded with the operator's user id in `email_threats.action_taken_by`, distinguishing operator-initiated and customer-initiated actions in any subsequent compliance audit.

The classifier ledger (`ai_llm_calls`) is the authoritative log of every classification request, including the prompt version (`feature='email_security'`), model, token counts, and cost in cents. The ledger is retained indefinitely and is the source for any later accuracy or cost analysis. The SOC must not delete or modify `ai_llm_calls` rows; corrections to classification outcomes are made via the `reviewer_verdict` column on the corresponding `email_threats` row, not by retroactively altering the ledger.

Cross-tenant data access is exercised under the SOC's super-admin authority. Operators must not export or persist cross-tenant data outside the platform. Any export for incident response purposes (e.g. delivering a sample to a law-enforcement agency under lawful request) follows the platform's incident-response procedure and is authorised by the SOC lead, not the on-shift operator.
