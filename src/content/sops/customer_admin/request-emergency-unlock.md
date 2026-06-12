---
title: Request emergency unlock for an endpoint
audience: customer_admin
description: When Defender lockdown is stopping legitimate work, request a time-bounded unlock so the user can keep working without weakening posture for everyone else.
order: 6
estimated_minutes: 5
updated_at: 2026-06-12
tags: defender, emergency, unblock
---

## When to use this
A staff member is blocked from doing legitimate work because Mithras / Defender quarantined or blocked something — for example:
- A line-of-business app's installer was quarantined as a false positive.
- Controlled folder access is blocking a legitimate save.
- An attack-surface-reduction rule is killing a script you need to run.

This SOP is the **right path** for genuine blockers. The wrong path is asking IT to disable Defender — that disables tamper protection too, kills your posture chip, and is loud in the next monthly report.

## Prerequisites
- You're the customer admin (your `organization_memberships` row has `role IN ('admin','owner')`).
- You know which endpoint is affected (hostname or the device the user is on).
- You can describe the blocked action in one sentence.

## Steps

1. Go to **`/endpoints`**.
2. Find the affected endpoint by hostname; click into the detail page.
3. Click **Emergency unlock** (top right of the Response actions card).
4. Fill the dialog:
   - **Reason** (required, ≥ 20 chars) — what's blocked. Be specific. *"User can't install QuickBooks 2024 update — Defender quarantined `qbinstall.exe`"*. This text lands in the audit log and the next monthly report.
   - **Duration** — `15min` / `30min` / `60min` / `4h`. Pick the shortest that gets the user unblocked.
   - **Confirm** by ticking the acknowledgement box.
5. Click **Unlock**.

The platform queues an `emergency_unlock` command. The agent picks it up within a heartbeat and disables tamper protection + the specific Defender control you flagged, for exactly the duration you set. It auto-re-arms when the timer fires.

## What the user sees on their endpoint
- A tray notification: **"Mithras emergency unlock active for 30 minutes."**
- Defender real-time protection chip in their system tray drops from green to amber.
- After the timer fires, RTP returns to green and tamper protection re-locks.

## Verify
- The endpoint's `/endpoints/:id` page → **Defender posture** card shows the **emergency unlock** banner with the expiry timestamp.
- Activity log on the same page shows the `emergency_unlock` event with your user id and reason.
- After the timer expires, the banner disappears and the posture chip is back to green.

## Troubleshooting
- **Unlock didn't take effect.** Check the agent is online (heartbeat fresh). If yes, look at the command result on the endpoint detail — failed commands show a reason. Most common cause is **agent below v0.7.5**, which doesn't support `emergency_unlock`. Push an agent upgrade first.
- **User says they're still blocked.** Emergency unlock disables Defender's runtime controls, but not policies like App Whitelisting (if your tier has it on). Open the App-whitelist tab on the endpoint and check the blocked binary.
- **The 4-hour option is greyed out.** Your reseller has capped the maximum duration at your tier. Ask them to raise it or request a per-incident exemption.

## Related
- [Manage Defender policy](/help/sops/customer_admin/manage-defender-policy)
- [Review threats](/help/sops/customer_admin/review-threats)
