---
title: Install the Mithras agent on an endpoint
audience: customer_admin
description: One-liner install + verifying the first heartbeat arrives.
order: 1
estimated_minutes: 10
updated_at: 2026-06-12
tags: agent, deploy, onboarding
---

## When to use this
You're standing up a new endpoint (workstation, laptop, server) and need it managed by Mithras. This works for every Windows version Mithras supports — including Win 7 SP1, Win 8.1, Server 2008 R2 and Server 2012 R2 — provided the device can reach `https://api.mithras.com.au` outbound.

## Prerequisites
- Administrator access on the target device (the install needs to register a Windows service).
- The device can reach `*.mithras.com.au` on port 443.
- You're signed in to the Mithras portal as an org admin or owner.

## Steps

1. Go to **`/deploy`** in the Mithras portal.
2. The page shows a fresh **one-liner installer command** with a pre-populated enrolment code. Click **Copy**.
3. On the target endpoint:
   - Open **PowerShell as Administrator** (right-click → Run as administrator).
   - Paste the one-liner and press Enter.
   - The installer downloads the agent bundle, verifies its SHA-256, installs the service, and registers the device.
4. Within 60 seconds the device shows up at **`/endpoints`** with a green **Online** dot.

## What the installer does
- Stops + removes any leftover legacy installs (`PeritusSecureAgent`, older Mithras versions).
- Drops the agent files to `C:\ProgramData\Mithras\`.
- Installs `MithrasAgent` as a NSSM-managed Windows service.
- Provisions HMAC credentials (one-time, can't be replayed).
- Starts the service + verifies it can heartbeat against the API.

## Verify
- The endpoint detail page shows:
  - **Status: Online** (green)
  - **Agent version: v0.7.17** (or newer)
  - **Last seen: just now**
  - Defender posture starts populating within 5 minutes of first telemetry collection.
- The local agent log at `C:\ProgramData\Mithras\state\agent.log` shows `heartbeat 200 ok`.

## Troubleshooting
- **"This script cannot be loaded because the execution of scripts is disabled"**. Run in an admin PowerShell: `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` then re-run the one-liner.
- **`Could not resolve api.mithras.com.au`**. The device has no DNS resolution — fix DNS or check the firewall is allowing outbound 443.
- **`agent_secret_provisioning_failed`**. The enrolment code expired (codes are valid 24h). Get a fresh one-liner from `/deploy`.
- **Endpoint shows as Online but Defender posture stays blank.** First telemetry cycle is up to 5 minutes; if it stays empty after 15 min, check the endpoint's Defender is actually enabled — Mithras manages Defender, it doesn't replace it.
- **You see a legacy "PeritusSecure" install lingering.** The new installer cleans it up automatically. If something's stuck, use the break-glass script: `iwr https://api.mithras.com.au/storage/v1/object/public/agent-bundles/force-remove-mithras.ps1 -OutFile $env:TEMP\frm.ps1; powershell -ExecutionPolicy Bypass -File $env:TEMP\frm.ps1` in an elevated shell, then re-run the install.

## Related
- [Set up notification recipients](/help/sops/customer_admin/set-up-notification-recipients)
- [Review threats](/help/sops/customer_admin/review-threats)
