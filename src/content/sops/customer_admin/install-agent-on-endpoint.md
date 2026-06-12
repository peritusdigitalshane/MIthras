---
title: Install the Mithras agent on a Windows endpoint
audience: customer_admin
description: Deploy the signed Mithras endpoint agent to a Windows device and verify the device is reporting telemetry.
order: 1
estimated_minutes: 8
updated_at: 2026-06-12
tags: agent, deployment, onboarding
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure installs the Mithras endpoint agent on a single Windows device, registers the device with your organisation, and confirms that telemetry and policy reach the device within the heartbeat window. Until the procedure completes, the device is not protected by Mithras.

## Audience and authority
Customer administrators whose `organization_memberships.role` is `admin` or `owner`. The procedure requires local administrator rights on the target Windows device.

## Prerequisites
- The target device runs Windows 10 22H2 or later, Windows 11, or Windows Server 2019 or later.
- The device has outbound HTTPS connectivity to `api.mithras.com.au` and `www.mithras.com.au`.
- You are signed in to the Mithras console at `https://www.mithras.com.au/login`.
- Your organisation has at least one credit available, visible on `/customer`.
- You have a PowerShell window open with **Run as administrator**.

## Procedure

1. In the Mithras console, open **`/deploy`**.
2. Select **Windows** as the platform and **Stable** as the channel.
3. Copy the single-line installation command shown in **Install command**. It includes a one-time enrolment token bound to your organisation.
4. Paste the command into the elevated PowerShell window on the target device and press **Enter**.
5. Wait for the installer to complete. The script downloads the signed agent bundle, verifies its SHA-256 hash, installs the `MithrasAgent` Windows service, applies tamper protection, and triggers the first heartbeat.
6. The installer prints **Mithras agent v\<version\> installed and reporting** on success. Close the PowerShell window.

## Verification
- The device appears at **`/endpoints`** within two minutes, with a green **Online** indicator and a populated **Last seen** timestamp.
- The endpoint detail page at `/endpoints/:id` shows the **Defender posture** card with **Real-time protection** set to **On**.
- The **Agent version** matches the active version listed on `/admin/home-users` (super-admin) or shown on `/deploy`.
- The endpoint has been assigned the default Defender policy and the default Windows Update policy. Policy chips display **Applied** with a recent timestamp.

## Troubleshooting
- **The installer fails with `enrolment_token_invalid`.** The token expired or was already consumed. Return to `/deploy` and copy the command again; each token is single-use.
- **The device does not appear under `/endpoints` after five minutes.** Confirm outbound TCP 443 to `api.mithras.com.au` is permitted. The installer log at `C:\ProgramData\Mithras\logs\install.log` records the failing request.
- **Service `MithrasAgent` is listed as `Stopped`.** Open the service log at `C:\ProgramData\Mithras\logs\agent.log` and read the most recent **ERROR** lines. Restart from an elevated PowerShell window with `Restart-Service MithrasAgent`. Persistent failure indicates a corrupted bundle; reinstall using a fresh enrolment token.
- **The credit balance is zero.** Contact your reseller. The installer will not register a device when the organisation has no credit available.

## Audit and compliance
- A row is written to `public.endpoints` with `enrolled_via = 'installer_token'` and `enrolled_at = now()`.
- An entry is written to `public.activity_logs` with `action_type = 'endpoint_enrolled'` and the enrolling user's identifier.
- Tamper-protection events are recorded to `public.tamper_events` for the lifetime of the agent. Records are retained for 24 months.

## Related procedures
- [Review threats](/help/sops/customer_admin/review-threats)
- [Set up notification recipients](/help/sops/customer_admin/set-up-notification-recipients)
- [Manage your Defender policy](/help/sops/customer_admin/manage-defender-policy)
