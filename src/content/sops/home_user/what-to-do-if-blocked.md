---
title: What to do if Mithras blocked something
audience: home_user
description: When Mithras quarantined a file or blocked an app you actually want — here's how to recover without disabling protection.
order: 2
estimated_minutes: 6
updated_at: 2026-06-12
tags: recovery, false-positive, defender
---

## When to use this
- You tried to install or run something legitimate and Mithras (or Windows Defender) stopped it.
- A file you needed disappeared with a "Threat quarantined" message.
- A game or older app is being killed every time it launches.

## First — is it actually safe?
Stop and check. Most blocks are correct.

- **Did you download it from a search result that wasn't the vendor's site?** Search results for popular software are full of fakes. Go to the *real* vendor page.
- **Was it sent as an email attachment from someone you don't know?** Don't try to recover it. Reply asking them to send a link to a known service instead.
- **Did the file name look weird** — `Invoice123.exe`, `Setup.scr`, double extensions like `report.pdf.exe`? That's a sign it was probably a real threat.

If you're not sure, ask. Mithras Personal includes 24/7 support — go to `/account` → **Contact support** and ask before you bypass anything.

## Recovering a quarantined file

If you're confident the file is legitimate:

1. Open the **Mithras Personal** tray app (system tray, bottom-right of your screen).
2. Click **Recent activity**. Quarantined items show with a yellow shield.
3. Click the item. Click **Restore + add exclusion**.
4. Mithras restores the file and adds an exclusion so it won't be quarantined again.

Or — if the file came from an installer that Defender flagged:

1. Re-download the installer from the *real* vendor site.
2. Right-click → **Properties** → **Unblock** before launching (Windows often quarantines anything downloaded from the web).
3. Launch the installer. If Defender still blocks it, follow the quarantine-recovery steps above.

## Unblocking an app that keeps getting killed

1. In the tray app, click **App rules**.
2. Find the app (Mithras lists everything that's been blocked in the last 7 days).
3. Click **Allow always**.

Mithras adds a per-process exclusion. The app will launch next time you try.

## When to **NOT** restore
- The file came from an unfamiliar email or instant message.
- The block message says **"Trojan"**, **"Ransomware"**, **"Credential stealer"** — these are very rarely false positives.
- The file is a script (`.ps1`, `.vbs`, `.js`) you weren't expecting.
- The vendor's website looks slightly different from how you remember it (typo-squat).

If any of those: leave it quarantined. Email **support@mithras.com.au** with a screenshot and they'll tell you whether to recover.

## Verify
- After **Restore**, the file is back where it was and you can use it.
- The Mithras tray icon is still **green** — restoring a single file doesn't drop overall protection.

## Related
- [Install Mithras Personal](/help/sops/home_user/install-mithras-personal)
- [Change payment method](/help/sops/home_user/change-payment-method)
