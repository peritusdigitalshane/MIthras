---
title: Enable Mithras email security for your Microsoft 365 tenant
audience: customer_admin
description: Connect Mithras to your Microsoft 365 tenant for AI-driven phishing, BEC, malware, and spam detection on every user's inbox, and grant the additional Graph permissions needed to quarantine or release messages on the operator's behalf.
order: 10
estimated_minutes: 20
updated_at: 2026-06-15
tags: email, security, m365, phishing, bec, onboarding
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose

This procedure enables the Mithras email security service for a Microsoft 365 tenant. Once enabled, Mithras polls every connected mailbox every two minutes, classifies inbound messages using an AI model trained for phishing / business email compromise (BEC) / malware / spam detection, and writes the verdicts to the Mithras console. Operators can then quarantine, warn, or release flagged messages from the console; recipients can self-release a message back to their Inbox via a tokenised magic link in a Mithras warning email.

The procedure is the only sanctioned method of authorising Mithras to read mailbox content. Without completion, no email security telemetry exists for the tenant and the `/email-security` page in the console remains empty.

## Audience and authority

Customer administrators whose `organization_memberships.role` is `admin` or `owner`, and who hold a Global Administrator or Privileged Role Administrator role in the target Microsoft 365 tenant. The Microsoft consent dialog will refuse the application permissions request without one of these tenant-side roles.

## Prerequisites

- An active Microsoft 365 tenant. Free / personal Outlook accounts are not supported because they do not expose the required Graph endpoints under application permissions.
- Tenant-side Global Administrator or Privileged Role Administrator privilege to grant admin consent for application permissions.
- The Mithras console URL (`https://www.mithras.com.au`) reachable from the consenting admin's browser session.
- An SMTP integration already configured on the Mithras platform side. Warning emails and the daily digest depend on SMTP; the sweep and console actions do not. Confirm with your Mithras operations contact if uncertain.
- A planned communications message to your end users (template below) so the first day of warning emails is not the first they hear about Mithras email security being on.

## Procedure

### 1. Open the M365 integration page

1. Sign in to `https://www.mithras.com.au` as a customer administrator.
2. From the left sidebar choose **Operations → Identity (M365)**. The page lists every Microsoft 365 tenant the organisation has previously connected, with the current consent state for each.
3. If no tenant is connected, click **Connect a tenant** and proceed to step 2. If a tenant is connected but its consent state is `read_only`, proceed to step 3 to upgrade to remediation consent.

### 2. First-time tenant connection (read-only baseline)

The baseline consent grants Mithras the permissions needed to read sign-in events, mailbox rules, OAuth grants, posture indicators, and message metadata + bodies for AI scoring. It does not grant the permissions needed to act on those messages — that's step 3.

1. Click **Connect a tenant**.
2. The button opens a Microsoft consent dialog in a new tab. Sign in as the Global Administrator of the target M365 tenant.
3. Review the requested permissions. The baseline set includes `Mail.Read` (the permission that allows AI scoring to inspect message content). Mithras never sees attachment binaries, message bodies longer than the first 2 KB, or any messages outside the Inbox folder.
4. Tick **Consent on behalf of your organisation** so the permissions apply tenant-wide rather than only to the consenting admin.
5. Click **Accept**.
6. Microsoft redirects back to the Mithras console. The tenant row should now show `consent_state: granted` and a non-empty `scopes` array including `Mail.Read`.

### 3. Upgrade to remediation consent (required for quarantine / release)

Without remediation consent, Mithras can flag a message but cannot move it between folders. The quarantine and release actions in the console will return `missing_scope`. To enable them:

1. On the same Identity (M365) page, locate the tenant row from step 2.
2. Click **Upgrade consent → Enable remediation actions**.
3. The button opens a second Microsoft consent dialog requesting the remediation scope set. The relevant new permission for email security is `Mail.ReadWrite`. The other remediation scopes (`MailboxSettings.ReadWrite`, `Directory.ReadWrite.All`, etc.) cover earlier features such as disabling forwarding rules and revoking OAuth grants and are not specific to email security.
4. Sign in as Global Administrator, tick **Consent on behalf of your organisation**, click **Accept**.
5. Back in the Mithras console, the tenant row should show `remediation_enabled: true` and the `scopes` array should include `Mail.ReadWrite`.

### 4. Communicate the change to your end users

The first time Mithras ships a warning email to a user, they will see a Mithras-branded message in their Inbox saying "we flagged a suspicious email and moved it to Junk." Without prior communication this looks like a phishing attempt itself. Send the following template (or a localised equivalent) to every user covered by the integration, ideally the same business day you complete step 3:

> Hi team,
>
> We have enabled an extra layer of email security across our Microsoft 365 mailboxes. The service is run by Mithras Threat Defence and uses AI to detect phishing, scams, and business email compromise.
>
> If Mithras catches a suspicious message in your inbox, you will receive a separate email from Mithras (sender: support@mithras.com.au) telling you what was caught and why. The original message will have been moved to your Junk Email folder.
>
> If the message was something you were expecting, the Mithras email contains a "Release to my Inbox" button that puts it back. If not, leave it alone.
>
> Nothing changes about how you use Outlook. The service runs in the background.
>
> Any questions, reply to this email.

### 5. Confirm the first sweep ran

The sweep cron fires every two minutes on the top of the minute (UTC). Within ten minutes of completing step 3:

1. Open **Operations → Email security** in the Mithras console.
2. The "Last sweep" badge in the page header should read "Last sweep a few minutes ago" — that's the sweep cron completing one cycle.
3. If you have any internal phishing simulation tooling (KnowBe4, Hoxhunt, etc.), trigger one targeted phishing simulation to a test mailbox so Mithras has something to classify. Real phishing volume is unpredictable on day one.
4. Within the next five-minute sweep cycle, the simulation should appear in the threat list with `classification = phishing` and a non-empty `ai_reasoning` field. If it does not, see Troubleshooting below.

### 6. (Optional) Configure who receives the daily digest

The daily digest emails arrive at 07:00 UTC (≈17:00 AEST). The recipient list is shared with the rest of the Mithras alert system — the `org_alert_recipients` table populated via **Settings → Notification recipients** in the console. To customise:

1. Open **Settings → Notification recipients**.
2. Add the email addresses you want to receive the email security digest. Typical recipients are the IT manager, security lead, and any helpdesk staff who triage end-user reports.
3. Save. The next 07:00 UTC cron run will send to the updated list.
4. If you don't want a daily digest, leave the recipient list empty. The digest function will skip the org silently. Operators still see every flagged message in the console.

## Verification

The procedure is complete when all of the following are true:

- The tenant row on **Operations → Identity (M365)** shows `consent_state: granted`, `remediation_enabled: true`, and `Mail.ReadWrite` in the scopes list.
- The "Last sweep" badge on **Operations → Email security** updates within ten minutes and continues updating thereafter.
- A test phishing simulation (or a real flagged message) appears in the threat list with non-empty classification, severity, and AI reasoning fields.
- Quarantining a flagged test message moves it from the recipient's Inbox to their Junk Email folder within ten seconds, observable directly in Outlook.
- Releasing the same message via the console moves it back to the Inbox, again within ten seconds.
- Sending a warning email via the console delivers a Mithras-branded message to the recipient with a working "Release to my Inbox" button.
- Clicking the release button from inside the warning email lands on `https://www.mithras.com.au/email-release` with a success state and moves the message back to the Inbox.

## Troubleshooting

| Symptom | Cause | Resolution |
|---|---|---|
| Tenant row shows `consent_state: pending` after redirect | Consent dialog was closed or admin lacked tenant-side privilege | Repeat step 2 with a Global Administrator account |
| `scopes` array missing `Mail.Read` | Old consent grant predates the email security release | Repeat step 2; the existing tenant row will be updated in place |
| `scopes` array missing `Mail.ReadWrite` | Remediation consent not completed | Repeat step 3 |
| Sweep completes but no threats appear after a phishing simulation | Simulation tool spoofed the From address in a way that perfectly mimics legitimate internal mail | Send a more obvious test — e.g. EICAR-style URL in the body |
| Quarantine action returns `missing_scope` | Remediation consent not complete or the tenant row's `scopes` array is stale | Repeat step 3, then retry the action |
| Quarantine action returns `folder_not_found:Junk Email` | The mailbox is on a non-English Microsoft 365 SKU and the Junk Email folder is named locally | Mithras currently expects the English folder name. Contact your Mithras operations contact to enable locale-aware folder lookup for the tenant. |
| Daily digest never arrives | `org_alert_recipients` is empty, or platform SMTP is not configured | Confirm step 6 was completed and platform SMTP is healthy |
| Warning email arrives but the "Release" button returns `token_expired` | The release link is older than 14 days | Operator releases the message from the console; user does not need to re-action |

## Rollback

The procedure is reversible at every stage:

1. To stop AI scoring but keep the integration: from **Operations → Identity (M365)**, click **Disable email security** on the tenant row. The sweep will skip this tenant on the next cycle. Already-classified threats remain in the console for historical review.
2. To fully revoke Mithras access: in the M365 admin centre, navigate to **Identity → Applications → Enterprise applications**, find the Mithras Threat Defence application, and click **Delete**. Microsoft revokes every granted permission immediately. The Mithras tenant row will move to `consent_state: revoked` on the next attempted poll.
3. Historical `email_threats` rows are retained for 90 days by default. To request earlier deletion, contact your Mithras operations contact.

## Related procedures

- `customer_admin/set-up-notification-recipients.md` — manage who receives the daily digest.
- `customer_admin/connect-siem-forwarding.md` — also forward every flagged email event to your customer-owned SIEM (Splunk, Sentinel, Elastic, etc.). The event_outbox trigger on `email_threats` does this automatically once a destination is configured.
- `customer_admin/review-threats.md` — equivalent procedure for Defender threats on the endpoint side.

## Compliance notes

Mithras processes message metadata + a 2 KB body excerpt inside the AI classification call. Full bodies, attachments, and recipient lists beyond the message envelope are never persisted to the Mithras database. The classification call is logged to the `ai_llm_calls` ledger with feature attribution `email_security` and per-tenant cost accounting, supporting transparency requirements under the Australian Privacy Act 1988 (Cth) and the Australian Privacy Principles.

Tenant access tokens and refresh tokens are stored in `m365_tenants` under row-level security limited to organisation administrators, partner administrators, and Mithras super-administrators. Rotating the underlying Azure AD application credentials invalidates every stored refresh token; re-consent through this procedure is required.

The daily digest, warning emails, and release magic links all use the platform SMTP configuration. End-to-end TLS is enforced via STARTTLS; non-TLS sends are refused at the SMTP layer. Release tokens are single-use UUIDs valid for 14 days from the warning send timestamp; expired tokens cannot be reused even if the recipient's mailbox is later compromised.
