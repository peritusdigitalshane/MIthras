---
title: Decommission a retired endpoint
audience: partner
description: Use the Decommission button on the endpoint detail page to tear down Mithras cleanly on a device that's been retired or returned.
order: 3
estimated_minutes: 5
updated_at: 2026-06-12
tags: agent, uninstall, lifecycle
---

## When to use this
- A staff laptop has been returned to IT and is being re-imaged or sold.
- An endpoint has been replaced by a new device.
- A customer is offboarding and you need every endpoint cleanly removed.

This is the **tamper-protected** uninstall path — it works even when the agent's normal "Add or Remove Programs" entry has been hardened. Use this **before** wiping the device so the audit trail is complete.

## Prerequisites
- You're signed in as org admin or super-admin (members don't see the button).
- The endpoint is currently online or expected to be online within the next 30 minutes (the agent picks up the command on its next heartbeat — typically under 60 seconds).
- You've written down the device's hostname (you'll be asked for a justification reason that mentions it).

## Steps

1. Go to **`/endpoints`**, click the endpoint you want to decommission.
2. On the endpoint detail page, look at the quick-launch row near the top — you'll see one of:
   - **"Decommission"** button (red outline) — click it.
   - **"Decommissioning… X ago"** chip — already in flight, see Verify below.
   - **"Uninstalled X ago"** chip — already done.
3. The confirmation dialog opens. Enter a clear reason — at least 10 characters. Examples:
   - `"Laptop returned to IT — replaced by NEW-DEV-04."`
   - `"Customer ACME offboarded 2026-06-12 per ticket #4421"`
4. Click **Decommission**. A toast confirms the command was queued.

## What happens next
Within ~60 seconds the agent:
1. Disables its own tamper-protection watchdog so the cleanup doesn't get reverted.
2. Resets the service DACL so `sc.exe delete` will succeed.
3. Schedules `Force-Remove.ps1` to run as SYSTEM 60 seconds later.
4. Reports success to the platform.
5. Then SYSTEM nukes the service + install directory and the endpoint stops reporting.

## Verify
- The endpoint detail page chip changes to **Uninstalled X ago** (within 2–3 minutes).
- The endpoint stops appearing online; eventually it will move to `Offline` on the list page.
- Run `Get-Service MithrasAgent` on the device (or via remote access) — should return "Cannot find any service…".

## Troubleshooting
- **"Decommission stuck — agent offline?"** banner after 30 minutes. The agent never reported back. Either it was already offline when you clicked, or the cleanup script failed. If you can still reach the device, run the one-liner break-glass cleanup: `iwr https://api.mithras.com.au/storage/v1/object/public/agent-bundles/force-remove-mithras.ps1 -OutFile $env:TEMP\frm.ps1; powershell -ExecutionPolicy Bypass -File $env:TEMP\frm.ps1` from an elevated shell.
- **You decommissioned the wrong endpoint.** You can't recall the command once it's in flight. Re-install the agent on the device using your customer's `/deploy` one-liner — it'll re-enrol fresh.
- **Customer doesn't see the chip change.** They probably need a hard refresh — the React query refresh interval is 30 seconds.

## Related
- [Customer admin: install the agent](/help/sops/customer_admin/install-agent-on-endpoint)
- [Bulk-push agent updates](/help/sops/partner/push-agent-update)
