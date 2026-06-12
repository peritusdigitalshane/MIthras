---
title: Understand an incident detail page
audience: customer_admin
description: How to read /incidents/:id — the AI Commander's summary, the multi-agent verdict, and what the playbook has done.
order: 4
estimated_minutes: 10
updated_at: 2026-06-12
tags: incidents, ai-soc, security
---

## When to use this
You got a "Critical incident opened" email, or you saw an active incident on the dashboard. You want to understand what happened without needing a security degree.

## The cards on the page (in order)

### Header
- **Severity** — the AI Commander's classification. Severe and High auto-open incidents; Moderate and Low are surfaced in `/threats` only.
- **Status** — Open → Triaging → In progress → Resolved / False positive.
- **SLA** — when the SOC team commits to closing the case. Severe/Critical = 1h, High = 4h, Moderate = 1 day, Low = 7 days.
- **Commander kind** — the LLM's specific classification (e.g. `malware`, `credential_compromise`). Friendlier than the legacy 6-value parent.

### AI Commander summary
One-line analyst summary written by the **Incident Commander Agent**. This is what the 24/7 SOC sees at-a-glance. The collapsible **Customer-facing summary** is the friendlier version used in monthly reports.

### Playbook
Step-by-step progress through the response workflow:
1. **forensics_complete** — investigation done, attack chain mapped.
2. **contained** — automated action ran (isolate / kill / quarantine).
3. **customer_notified** — comms agent sent the email to your notification recipients.
4. **review_scheduled** — operator scheduled a post-incident review.
5. **resolved** — threat eradicated, case closed.

If a step shows the current chip, the SOC is actively working it.

### Agent consensus
The **multi-agent verdict trail** card. Three AI agents:
- **Triage** — first-line classifier.
- **Verification** — re-runs with a different model.
- **Adversarial** — tries to *refute* the verdict.

If the three agents agree (verdict + the adversarial says **not_refuted**), the verdict is trustworthy. If they disagree, it gets flagged for human review.

### Autonomous response
What action ran (if anything):
- **action_kind** — `isolate_network`, `kill_process`, `quarantine_file`, etc.
- **status** — `executing`, `executed`, `customer_confirmed`, `rolled_back`.
- **Auto-rollback armed** banner — within 4 hours, the action will be undone automatically unless someone confirms it (you or the SOC).
- **forceFire override** badge — a SOC operator manually skipped the consensus gates. Take that as a high-attention signal.

### Customer notifications
Emails the comms agent sent. If a row is `failed` you'll see the SMTP error. The platform automatically disarms the auto-rollback when this happens, but it's a flag for the SOC to contact you directly.

### Resolution notes (once closed)
The operator's reasoning. These also land in your next monthly customer report.

## When to act
- If the **Auto-rollback armed** banner is showing and you want to **keep** the containment action permanent, click **Confirm action** in the email you received. That cancels the auto-rollback.
- If you believe the response was wrong (legitimate activity was blocked), click the **False positive** link in the email or contact your reseller. The action will be reversed within minutes.
- Otherwise: just wait for the SOC to close it. You'll get a closure email with the resolution notes.

## Related
- [Review threats](/help/sops/customer_admin/review-threats)
- [Set up notification recipients](/help/sops/customer_admin/set-up-notification-recipients)
- [Request emergency unlock](/help/sops/customer_admin/request-emergency-unlock)
