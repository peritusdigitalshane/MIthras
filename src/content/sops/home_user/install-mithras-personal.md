---
title: Install Mithras Personal on your PC
audience: home_user
description: Step-by-step install for the home subscription — one PC.
order: 1
estimated_minutes: 10
updated_at: 2026-06-12
tags: install, deploy, personal
---

## When to use this
You've just paid for Mithras Personal ($6/month) and want to get it onto your computer.

## Prerequisites
- Your PC is running Windows 7 SP1, Windows 8.1, Windows 10, or Windows 11.
- You have administrator access (the install needs to register a security service).
- An internet connection.

## Steps

1. Sign in at **[www.mithras.com.au](https://www.mithras.com.au/login)** with the email you used when subscribing.
2. You'll land on the **Personal** dashboard. Click **Deploy Mithras** in the top-right (or go to **`/deploy`**).
3. The page shows a single command — click **Copy**.
4. On your PC:
   - Press the **Windows key**, type `powershell`, right-click **Windows PowerShell**, and choose **Run as administrator**.
   - Paste the command you copied and press **Enter**.
5. The installer downloads (about 280 KB), verifies its checksum, and installs Mithras as a Windows service.
6. After about a minute, refresh the dashboard. You'll see your PC listed under **Your computers** with a green **Online** dot.

## What Mithras does in the background
- Manages Microsoft Defender's settings so it's properly tuned.
- Watches for suspicious behaviour and can block ransomware before it encrypts your files.
- Sends a once-a-month email report so you can see what was blocked.

It does **not** read your personal files. It looks at security events (logins, process launches, file modifications) and Defender alerts — nothing about the contents of your documents or browser history.

## Verify
- Your dashboard shows the computer as **Online** with green Defender status.
- You can see the agent in **Services** (Win+R, `services.msc`) listed as **MithrasAgent** with **Running** status.

## Troubleshooting
- **"This script cannot be loaded because the execution of scripts is disabled"**. In the admin PowerShell, run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` first, then re-paste the install command.
- **The installer hangs or errors out**. Antivirus on the PC may be blocking it. Whitelist `C:\ProgramData\Mithras` in your existing antivirus, then re-run. (Note: Mithras manages Defender; if you're using a third-party AV alongside, you'll get duplicate scanning.)
- **"You're not subscribed"** when you sign in. Your Stripe subscription may have failed payment — check your email for a payment-failure message and update your card at **`/account`**.

## Related
- [What to do if Mithras blocks something legitimate](/help/sops/home_user/what-to-do-if-blocked)
- [Change your payment method](/help/sops/home_user/change-payment-method)
- [Cancel your subscription](/help/sops/home_user/cancel-subscription)
