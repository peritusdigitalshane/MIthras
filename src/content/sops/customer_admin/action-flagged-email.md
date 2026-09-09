---
title: Action a flagged email — quarantine, warn, or release
audience: customer_admin
description: Triage a message Mithras has classified as phishing, BEC, malware, spam, or suspicious; move it to the recipient's Junk folder, notify the recipient with a release link, or release it back to the Inbox when it's a false positive.
order: 11
estimated_minutes: 12
updated_at: 2026-06-15
tags: email, security, quarantine, phishing, false-positive
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose

This procedure defines the controlled way to act on a single flagged message from the **Operations → Email security** page. The actions are visible to the recipient (their message moves between Inbox and Junk Email folders, or they receive a Mithras-branded warning email), so the procedure ensures the operator has the context to make the right call before any action is taken. It is the canonical reference for the question "Mithras flagged this — what do I do?"

## Audience and authority

Customer administrators whose `organization_memberships.role` is `admin` or `owner`. Partner administrators with admin-level access to the customer organisation can also action threats on behalf of the customer. Mithras super-administrators retain the same authority across every customer.

Members without admin role can view the flagged email list but cannot quarantine, warn, or release. The action buttons are hidden from non-admin sessions and the underlying `m365-email-action` edge function rejects unauthorised callers at the edge.

## Prerequisites

- Email security enabled for the tenant per `enable-email-security.md`. The page header shows a "Last sweep" badge with a recent timestamp.
- The tenant's M365 consent includes the `Mail.ReadWrite` scope (the remediation upgrade in step 3 of the enable procedure). Without it, quarantine and release return `missing_scope` and only the "Send warning" action is available.
- An understanding of which mailboxes the action affects. Mithras shows the recipient email in the threat row — confirm it is the intended user before acting.

## Procedure

### 1. Open the flagged message in the console

1. Sign in to `https://www.mithras.com.au` and choose **Operations → Email security**.
2. The list shows messages newest-first. Each row carries a classification badge (Phishing / BEC / Malware / Spam / Suspicious), a severity, the AI's confidence, the sender, the recipient, the subject, and how recently it was received.
3. Click the row to expand it. The expanded view shows:
    - **AI reasoning** — a one-sentence explanation of why the classifier reached the verdict (sender-domain mismatch, urgent payment request, lookalike domain, etc.).
    - **Suspicious domains / Suspicious links** — extracted indicators of compromise.
    - **Likely impersonating** — populated for BEC where the model identified a target exec or vendor.
    - **Attachments** — file names where present. Mithras does not inspect attachment binaries.

### 2. Decide which action applies

Pick the action from this table. Do not act blind — the AI reasoning is the input to your decision.

| Situation | Action | Effect |
|---|---|---|
| Confirmed phishing / BEC / malware. Recipient should never have seen it. | **Quarantine** | Mithras moves the message from the recipient's Inbox to the Junk Email folder via Graph. Recipient sees the message disappear from Inbox; no Mithras email is sent. |
| Confirmed phishing / BEC, and you want the recipient to know they were targeted (training moment, BEC awareness). | **Send warning** then **Quarantine** | Mithras emails the recipient a Mithras-branded warning with the sender, subject, AI reason, and a release magic link. The message is also moved to Junk. The recipient learns what happened and has a self-service release path if it was a false positive. |
| Looks suspicious in the AI reasoning, but the recipient could legitimately have expected it (e.g. a freight tracking email with an unusual sender, a transactional email from a tool the recipient uses). | **Send warning** only | Recipient is told what was flagged and why. They decide whether to release. Message stays where Mithras left it (in Junk) until the recipient acts. |
| False positive. Reasoning cites a property the AI misread. Recipient is expecting this message. | **Release** | Mithras moves the message back to the Inbox via Graph. No email is sent. Marker on the threat row turns to `released` so the dashboard reflects the outcome. |
| Genuine spam (newsletter, marketing, low-skill spam). | **No action** | Spam is low priority. The classifier already separates it from phishing/BEC. Leaving it flagged is fine; the recipient's own M365 Junk filter usually handles it on the next cycle. |

### 3. Execute the action

1. With the threat row expanded, click the relevant action button.
2. The toast at the top of the screen reports the outcome:
    - "Moved to the recipient's Junk Email folder" — quarantine succeeded.
    - "Warning email sent to the recipient with a release link" — warning sent.
    - "Released back to the recipient's Inbox" — release succeeded.
3. The row's "Current state" footer updates to the new state (`quarantined`, `user_warned`, or `released`).
4. The action_taken_by column on the underlying row is set to the operator who clicked. This is the audit trail; never click on a colleague's behalf.

### 4. Record the verdict (optional but recommended)

For BEC and high-confidence phishing, capture the operator review for compliance:

1. Use the **Add review** field on the expanded threat row (or update via the API if you script this).
2. Enter one of: `confirmed_phishing`, `confirmed_bec`, `confirmed_malware`, `false_positive_release`, `intentional_quarantine`, or a custom string up to 200 chars.
3. Save. The `reviewer_verdict` column is populated and your user id is recorded against `reviewed_by`.

### 5. (When quarantining) Tell the recipient if the action is sensitive

For BEC attempts impersonating an exec / vendor / partner, the recipient often needs to know. Two paths:

- **Use the "Send warning" action** — Mithras-branded email goes via SMTP; the recipient sees Mithras as the sender and decides.
- **Send your own message** — manual email from your IT team account if you want to avoid third-party branding or if the situation calls for direct human contact.

Don't do both. Recipients confused by two emails about the same message will assume one of them is phishing itself.

### 6. Bulk action when a campaign hits multiple recipients

When a phishing or BEC campaign hits multiple mailboxes — same sender, same lure, several rows appearing within minutes — the per-row workflow above is too slow. The console has a bulk-action workflow for this case.

1. On the flagged-messages list, tick the checkbox at the left of each row that belongs to the campaign. Use the **Select all visible** checkbox in the card header if the campaign accounts for everything on the page.
2. The bulk action bar appears at the bottom of the page once one or more rows are selected. It shows the selection count and three action buttons:
    - **Quarantine (N)** — moves every selected message to its recipient's Junk Email folder.
    - **Send warning (N)** — emails each selected recipient the Mithras-branded warning with a release magic link.
    - **Release (N)** — moves the selected messages back to their recipients' Inboxes (use only for confirmed false-positive batches).
3. The action count in parentheses reflects only the rows that are still actionable for that action — already-quarantined rows are excluded from Quarantine, already-warned rows from Send warning, and so on. Disabled buttons mean no selected row is eligible.
4. Click the desired bulk action. The toast at the top of the screen reports the outcome:
    - "N messages quarantined." — every row succeeded.
    - "N succeeded, M failed." — partial success; expand the relevant rows to see why specific messages didn't action (typically `missing_scope` on tenants that haven't consented to `Mail.ReadWrite`, or `threat_not_found_or_forbidden` for rows that have already been actioned in another tab).
5. After the action completes, the selection clears automatically and each affected row's "Current state" footer updates to the new state.

The bulk action runs through the same `m365-email-action` edge function, the same authorisation gates, and the same per-row audit trail (`action_taken`, `action_taken_at`, `action_taken_by`) as the per-row workflow. A bulk action is not a special operation — it is the same operation applied to many rows in one request.

Bulk action is capped at 200 messages per request. If you have more than that to action at once, repeat the workflow with the next page. In practice that is enough headroom for the largest campaigns we have observed.

### 7. Auto-quarantine future mail with a block rule

When you have decided that a sender domain, sender address, or subject pattern is always bad for your organisation, add a block rule. From the next sweep onwards Mithras will short-circuit the AI classifier and apply your rule's action automatically — saving the per-message AI cost and giving you predictable, deterministic behaviour for known-bad senders.

Two paths add a rule:

**From a flagged message.** When you action a row and want to stop future mail from the same sender, click the **Block domain** button in the action row. The current message's sender domain is added as a `quarantine` rule with the subject of the message recorded as the reason. This is the fastest path for "kill this campaign at the source."

**From the Block rules tab.**

1. Click the **Block rules** tab at the top of the email security page.
2. Click **New rule**. Choose a match kind:
    - **Sender domain** — matches the domain exactly and any subdomain. Example: `evilcorp.com` matches `mail.evilcorp.com` and `support.evilcorp.com`. Use this for known-malicious infrastructure.
    - **Sender address** — exact-match on the From address (case-insensitive). Example: `accounts@evilcorp.com`. Use this when the domain itself is legitimate but one specific mailbox is compromised.
    - **Subject regex** — JavaScript regex tested against the subject line, case-insensitive. Example: `^(URGENT|Wire transfer)` matches phishing subject patterns. Use this sparingly — broad regexes catch legitimate mail.
3. Choose an action:
    - **Quarantine silently** (default) — move to Junk Email, no recipient notification. Best for known-bad senders the user does not need to learn about.
    - **Quarantine + warn recipient** — move to Junk AND email the recipient the standard Mithras warning with a release link. Best when impersonation is the risk and you want the recipient to recognise the pattern.
    - **Record only** — no inbox change. The message still arrives normally; Mithras only logs it on the dashboard. Useful for telemetry on a sender you want to track but not block.
4. Add a free-text reason (recommended — future operators will read it).
5. Save.

Rules apply only to your organisation. Disabling a rule with the **Enabled** switch keeps it on file but stops it matching new mail. Deleting a rule is permanent; the audit trail of every message it matched remains in `email_threats` with the row's `matched_rule_id` reference, but the rule itself is gone.

**Auditing rule hits.** Each rule shows a hit count and last-hit timestamp. A rule that has matched 0 times in 30 days is a candidate for removal. A rule matching hundreds of messages per day is doing its job, but check the underlying flagged-messages list to confirm none of the matches are false positives — the AI never saw them, so its judgement is not in the loop.

**Avoid these mistakes:**

- Blocking a generic provider domain (e.g. `gmail.com`, `outlook.com`) — you will quarantine every Gmail user who emails your staff. Block specific addresses on those providers instead.
- Writing a subject regex that anchors only on common words. `urgent` matches every customer-service email; `^URGENT[:!]` is much safer.
- Setting `Quarantine + warn recipient` for high-volume known-spam. Every match sends an email; the recipient's inbox fills with Mithras warnings.

### 8. Handle a self-service release

When you've sent a warning email, the recipient can release the message back to their Inbox themselves by clicking the magic link. There's nothing for you to do — Mithras processes the release, moves the message in Graph, and updates the threat row. The row's `reviewer_verdict` becomes `user_self_release` and `released_at` is set.

If a user reports they clicked the link and "nothing happened":

1. Confirm the link includes a `?token=` query parameter. Old or truncated emails sometimes have the link broken across lines.
2. Check the threat row's `warning_sent_at` timestamp. If it's older than 14 days, the link has expired. Click **Release** in the console on the user's behalf.
3. If `warning_sent_at` is recent but the recipient sees `Couldn't release the email` on the release page, screenshot the page and contact Mithras support — the error reason field on that page is diagnostic.

## Verification

The action is complete when all of the following are true:

- The threat row's "Current state" footer reflects the new state (`quarantined`, `user_warned`, or `released`).
- For quarantine: the message no longer appears in the recipient's Inbox in Outlook. (Allow up to 30 seconds for Outlook to refresh; the Graph move is instantaneous.)
- For release: the message reappears in the recipient's Inbox.
- For warning: the recipient confirms receipt of a Mithras-branded email with the correct sender + subject + reasoning fields.
- The `action_taken_by` column on the threat row matches the operator who clicked.

## Common mistakes

- **Acting on stale rows.** The threat list orders newest-first. If you sort the list and then act on an old row that was already quarantined yesterday, the action buttons are correctly disabled — but if you script the action via the API and bypass the disabled state, you'll get `412 Precondition Failed` with `already_actioned` from the edge function.
- **Quarantining a BEC payload without considering Reply-All blast radius.** Confirm the recipient didn't already forward the message internally. If they did, quarantine the original AND search for the forwarded chain — the chain isn't in Mithras yet but is in M365 Defender's compromised-account workflow.
- **Releasing a true positive because the user is asking.** Recipients sometimes lobby IT to release a phishing email because they believe it's real. The Mithras AI reasoning is your defence. If the reasoning cites a real impersonation indicator, do not release; instead arrange a 5-minute call with the recipient to explain what was caught.

## Rollback

Every action is reversible:

- Quarantine → click **Release** on the same row. Message moves back to Inbox.
- Release → click **Quarantine** on the same row. Message moves to Junk again.
- Warning email sent → the email cannot be unsent, but you can call the recipient and tell them to ignore the magic link. The link expires after 14 days regardless.

There is no "undo last action" button. Every action is durable and logged.

## Related procedures

- `customer_admin/enable-email-security.md` — connect the tenant before any of this works.
- `customer_admin/connect-siem-forwarding.md` — forward `email_threats` events to your SIEM in parallel with the console workflow.
- `customer_admin/set-up-notification-recipients.md` — manage who receives the daily digest summary.

## Compliance notes

Every action writes `action_taken`, `action_taken_at`, and `action_taken_by` to the `email_threats` row, producing a permanent audit trail. Operator-initiated quarantine and release transit Microsoft Graph using the tenant's `Mail.ReadWrite` scope and are visible in the M365 Unified Audit Log alongside any native admin action; correlation across both audit trails is supported during incident response.

Warning emails are sent from the Mithras platform SMTP relay. The release magic link contains a single-use UUID (`release_token`) valid for 14 days. The token is treated as a bearer credential — anyone who possesses it can release that specific message, which is why the warning email is delivered only to the original recipient address and is not BCC'd or forwarded by the platform.

Releases initiated by the recipient via the magic link are recorded with `reviewer_verdict = user_self_release` so operators reviewing the audit trail can distinguish operator-initiated and user-initiated releases.
