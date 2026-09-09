---
title: Revoke a user's access to your Mithras tenant
audience: customer_admin
description: Remove a user's access to your customer tenant when an employee leaves, changes role, or no longer requires Mithras access — covering session termination, audit-log preservation, and recovery if revocation was performed in error.
order: 7
estimated_minutes: 10
updated_at: 2026-06-12
tags: access, offboarding, security, user-management
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure removes a user's access to your Mithras customer tenant when the user has left the organisation, changed role, or otherwise no longer requires access. It applies to all roles within your tenant: `owner`, `admin`, `member`. The procedure preserves the audit trail of every action the user took while they had access — revocation does not delete history. Re-grant after revocation is straightforward provided you have the user's email address.

## Audience and authority
The operator executing this procedure is a customer administrator whose role on your organisation is `owner` or `admin`. The `/customer/users` route is gated by `is_admin_of_org(auth.uid(), :org_id)`. A user with the `member` role can see the user list but cannot revoke access. The `owner` role is the only role that can revoke another `owner`; if your tenant has a single `owner`, you must promote a second `owner` (or contact your partner's support team) before removing the existing `owner`.

## Prerequisites
- You have signed in to the Mithras console at `https://www.mithras.com.au` and selected the correct customer tenant in the organisation switcher in the top-left of the console.
- You know the exact email address of the user to revoke. The user list shows display name and email; if the user is one of several with similar names, confirm the email matches the user you intend to revoke. Revoking the wrong user immediately disconnects them from a live session and creates an audit-trail entry; recovery is straightforward but the audit entry persists.
- You have decided whether to retain the user's account for re-enabling later. Revocation removes their membership but preserves their `auth.users` record; if the user returns, you re-invite them with the same email and their existing record is reactivated.
- Before revoking an `owner`, confirm at least one other `owner` exists. The system blocks the revocation of the last `owner` to prevent the tenant from becoming unmanageable; if you encounter the block, promote a second `owner` first.

## Procedure

### 1. Locate the user

1. Navigate to `/customer/users`. The user list displays every member of your tenant with their display name, email, role, last sign-in timestamp, and any active sessions.
2. Confirm the email of the user to revoke against the list. Use the email column to disambiguate users with similar display names; the email is the unique key, the display name is not.
3. Select the user's row to open their detail panel. The panel displays the user's full activity timeline within your tenant: when they were invited, who invited them, every sign-in event with source IP and device, and every administrative action they performed.

### 2. Decide the revocation mode

There are three revocation modes, distinguished by what they leave behind:

- **Suspend.** Disables sign-in but preserves the membership row and audit trail. Choose this when the revocation is temporary or under investigation; restoration is one click. The user's existing sessions are terminated within 60 seconds, but their account row in `auth.users` is preserved.
- **Revoke.** Removes the membership row. The user can no longer sign in or access tenant data; if they have access to other tenants (rare for your customers; common for distributors and partners), those other memberships are preserved. The audit trail of their past actions is fully preserved against the now-orphaned user reference.
- **Hard-delete account.** Removes the user record from `auth.users` entirely. Use this only when legally required (subject access request under a data-protection regime such as Australian Privacy Act, GDPR, or equivalent). Hard-delete preserves the audit trail of their actions but replaces their user reference with a tombstone; the audit row now reads `(deleted user)` instead of their name.

For employee offboarding, **Revoke** is the right choice. For a user under investigation pending HR decision, **Suspend** is the right choice. For a data-protection deletion request, **Hard-delete account**.

### 3. Execute the revocation

1. From the user's detail panel, select **Revoke access**. A confirmation dialog displays the user's email, role, and the number of audit-log entries that will be preserved.
2. Enter the user's email address as confirmation. The console requires this step to prevent accidental revocation; the input is case-insensitive.
3. Optionally, enter a reason in the **Reason** field. The reason is recorded in the activity log and is visible to your partner (if you have one) and to Mithras support staff during any future ticket on the user's account. The field accepts up to 500 characters of free text. Useful reason patterns include `employee_offboarded:2026-06-12`, `role_change:moved_to_finance_team`, or `policy:annual_access_review`.
4. Select **Revoke**. The dialog reports `Access revoked` and the user's row is removed from the active list. If the user had active sessions at the time of revocation, those sessions are terminated within 60 seconds — the user's browser displays a `Sign-in expired` notice on their next interaction.

### 4. Verify the revocation took effect

1. The user's row no longer appears under `/customer/users` in the active list. Toggle the list filter to **Show revoked** to confirm the user appears there with a `Revoked` badge and the timestamp of revocation.
2. The user's email address no longer appears in the `Assigned to` selector on any open SOC alert or scheduled report. If the user had open assignments at the time of revocation, those assignments are returned to the unassigned pool — review them under `/customer/threats` and reassign before they age out.
3. Navigate to `/customer/audit` and confirm the most recent activity log entry reads `user_revoked` with your `user_id`, the revoked user's email, and the reason you entered. The activity log is the canonical record; if the entry is missing, the revocation did not complete and should be repeated.

### 5. Notify the revoked user (when appropriate)

Mithras does not send an automatic notification to the revoked user. Notification is a customer decision — your HR and security policies define whether and when the user is informed.

If you elect to notify, the standard pattern is an email from your administrative address containing:

- The fact that their Mithras access has been removed effective immediately.
- The reason in plain language (consistent with the reason you recorded in step 3.3).
- A point of contact for any data-access requests they may wish to make against records associated with their use of the platform.

Do not notify the user that they have been suspended (mode 1 above) if the suspension is under investigation; notification can compromise the investigation. The decision to notify suspended users is an HR matter, not a Mithras matter.

## Verification

- The user does not appear in `/customer/users` active list, and appears in the revoked list with the correct timestamp.
- `/customer/audit` shows the `user_revoked` action with your `user_id`, the revoked user's email, and the reason.
- Any prior assignments to the revoked user (threats, alerts, scheduled reports) have been reassigned, or appear in the unassigned pool for action.
- An attempt to sign in by the revoked user at `https://www.mithras.com.au` returns the standard `Sign-in failed` message; the message does not disclose whether the account is suspended, revoked, or never existed.

## Troubleshooting

- **`cannot_revoke_last_owner`.** Your tenant has only one `owner` and revoking would leave the tenant unmanageable. Promote a second user to `owner` first (their detail panel, **Change role**), then repeat the revocation.
- **`access_denied`.** Your role on the tenant is `member` or you have lost organisation context. Confirm in the top-left organisation switcher that the correct tenant is selected, sign out and back in if the role badge in the header reads `member`, and have an `admin` or `owner` perform the revocation if your role is not elevated.
- **The user is still in the list two minutes after the revocation.** Refresh the page; the list does not auto-update on revocation. If the user still appears after refresh, the revocation did not complete — return to step 3 and repeat. Confirm the activity log shows the `user_revoked` entry; if the log entry is also absent, contact your partner's support team with the user's email and the timestamp of your revocation attempt.
- **The revoked user reports they can still sign in.** Sessions established before the revocation are terminated within 60 seconds. If the user is still active after that window, force-terminate their sessions from their detail panel: **Show revoked** → user → **Force-terminate sessions**. This is rare and indicates the revocation did not propagate to the session store; capture the user's email and the timestamp and open a support ticket.
- **You revoked the wrong user.** Open **Show revoked**, select the user, and choose **Restore access**. The user's membership row is reinstated immediately; their next sign-in succeeds. The original revocation and the restore are both preserved in the audit trail.

## Audit and compliance

- Revocation writes `user_revoked` to `public.activity_logs` with your `user_id`, the revoked user's email and prior role, the reason text, and the revocation mode (suspend, revoke, hard-delete).
- Session termination writes `session_terminated_by_revocation` for each session that was active at the time of revocation.
- The user's prior actions in your tenant are preserved verbatim in `public.activity_logs`. A revoked user's audit footprint is identical to that of a non-revoked user — revocation does not retroactively delete or pseudonymise actions.
- Hard-delete (mode 3 in step 2) is the only mode that pseudonymises the user reference in past audit log rows; the user's display name and email are replaced with `(deleted user)` and a tombstone id is recorded. Hard-delete is irreversible and should be reserved for legally compelled deletion.
- Mithras retains revoked-membership records for the lifetime of your tenant's relationship with Mithras records retention plus seven years in accordance with the records retention schedule, unless a hard-delete is performed.

## Related procedures

- [Set up notification recipients](/help/sops/customer_admin/set-up-notification-recipients)
- [Manage Defender policy](/help/sops/customer_admin/manage-defender-policy)
- [Request an emergency unlock](/help/sops/customer_admin/request-emergency-unlock)
- [Install the agent on a new endpoint](/help/sops/customer_admin/install-agent-on-endpoint)
