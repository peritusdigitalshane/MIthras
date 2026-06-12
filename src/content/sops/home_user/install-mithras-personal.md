---
title: Install Mithras Personal on your computer
audience: home_user
description: Install the Mithras Personal agent on a single Windows computer and confirm it is reporting to your account.
order: 1
estimated_minutes: 10
updated_at: 2026-06-12
tags: install, deployment, personal
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure installs the Mithras Personal agent on the Windows computer covered by your subscription, registers the computer with your account, and confirms that protection is active. Until the procedure completes, the computer is not protected by Mithras.

## Audience and authority
The subscriber on a Mithras Personal plan. The installer must be run from an account with local administrator rights on the target Windows computer. Mithras Personal covers one computer per subscription.

## Prerequisites
- The computer runs Windows 10 22H2, Windows 11, Windows 8.1, or Windows 7 Service Pack 1.
- You are signed in to Windows with an account that has local administrator rights.
- The computer has outbound HTTPS connectivity on TCP 443 to `api.mithras.com.au` and `www.mithras.com.au`.
- Your Mithras Personal subscription is active. Subscription status is shown at `https://www.mithras.com.au/account` under the `Subscription` card.
- You have closed any other endpoint protection product that would conflict with Microsoft Defender management.

## Procedure

1. Open a web browser on the target computer and sign in at `https://www.mithras.com.au/login` with the email address used at sign-up.
2. The browser redirects to `/personal`. Locate the `Install on this computer` card.
3. Select the `Copy install command` button. The command contains a one-time enrolment token bound to your account.
4. Press the `Windows` key, type `powershell`, right-click `Windows PowerShell`, and select `Run as administrator`. Accept the User Account Control prompt.
5. Paste the copied command into the elevated PowerShell window and press `Enter`.
6. The installer downloads the signed agent package, verifies its SHA-256 hash, installs files under `C:\Program Files\Mithras`, creates the data directory `C:\ProgramData\Mithras`, registers the `MithrasAgent` Windows service, and triggers the first heartbeat.
7. Wait for the installer to print `Mithras Personal installed. Service: MithrasAgent (Running).` Close the PowerShell window.
8. Locate the white shield icon for `Mithras Personal` in the Windows system tray, next to the clock. The icon indicates the agent is loaded.

## Verification
- The `Install on this computer` card on `/personal` is replaced by a `Your computer` card showing the device name with a green `Online` indicator within two minutes.
- The `Mithras Personal` tray icon shows a green badge with the tooltip `Protected`.
- In the Windows `Services` console (`services.msc`), the service named `MithrasAgent` shows `Running` with startup type `Automatic`.
- The `Microsoft Defender` posture summary on `/personal` reports `Real-time protection` as `On` and `Tamper protection` as `On`.

## Troubleshooting
- **The installer reports `enrolment_token_invalid` or `enrolment_token_expired`.** The one-time token has been consumed or has timed out. Return to `/personal`, select `Copy install command` again, and rerun the command. Each token is single-use.
- **PowerShell reports `execution of scripts is disabled on this system`.** In the same elevated PowerShell window, run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`, then rerun the install command. The setting applies only to that session.
- **The computer does not appear on `/personal` after five minutes.** Confirm outbound TCP 443 to `api.mithras.com.au` is permitted by your router or third-party firewall. Review the installer log at `C:\ProgramData\Mithras\logs\install.log` for the failing request.
- **The `MithrasAgent` service is listed as `Stopped`.** Open `C:\ProgramData\Mithras\logs\agent.log` and read the most recent `ERROR` lines. Start the service from an elevated PowerShell window with `Start-Service MithrasAgent`. If the service stops again, reinstall using a fresh install command from `/personal`.
- **`/personal` reports `Subscription inactive`.** A payment has failed or the subscription has been cancelled. Open `/account` and review the `Subscription` card before retrying the installer.

## Audit and compliance
- A row is written to `endpoints` for your account with `enrolled_via = 'personal_installer'` and `enrolled_at` set to the install time.
- An entry is written to `activity_logs` with `action_type = 'endpoint_enrolled'` and the email address used at sign-in.
- Subsequent posture snapshots are retained for 12 months in line with the Mithras Personal data retention policy. Telemetry is limited to security events: Microsoft Defender alerts, service start and stop events, and process launches. Document contents and browsing history are not collected.

## Related procedures
- [What to do if Mithras blocks something](/help/sops/home_user/what-to-do-if-blocked)
- [Change your payment method](/help/sops/home_user/change-payment-method)
- [Cancel your Mithras Personal subscription](/help/sops/home_user/cancel-subscription)
