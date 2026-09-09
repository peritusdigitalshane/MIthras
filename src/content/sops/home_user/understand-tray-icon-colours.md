---
title: What the Mithras tray icon colours mean
audience: home_user
description: A reference for the five colours the Mithras tray icon can display, what each one means, what you should do (if anything), and when to contact support.
order: 5
estimated_minutes: 5
updated_at: 2026-06-12
tags: tray-icon, status, troubleshooting, home-user
owner: Mithras Customer Operations
classification: Reference guide
review_cadence: Quarterly
---

## What is the tray icon?
Mithras runs in the background and shows a small shield icon in the bottom-right corner of your screen, next to the clock. The icon is your one-glance indicator that Mithras is protecting your computer. Hover the icon to see a short status message. Right-click for the menu.

If you do not see the icon, it may be hidden behind the **^** arrow next to the clock — click that arrow to reveal hidden icons. If it is still missing, the agent service may not be running; see the **No icon at all** section at the end.

## The five colours

### Green shield — protected
- **What it means:** Mithras is healthy. Real-time protection is on, signatures are up to date, and your computer is reporting in normally.
- **What to do:** Nothing. This is the normal state.

### Blue shield — busy
- **What it means:** Mithras is performing a routine task — usually downloading a signature update, running a scheduled scan, or applying a policy change.
- **What to do:** Nothing. You can keep using your computer normally; Mithras throttles its own work to avoid slowing you down. The icon returns to green when the task finishes, usually within fifteen minutes.

### Yellow shield with exclamation — attention needed
- **What it means:** Something is not quite right. The most common reasons are: signature updates are more than 24 hours old, the most recent scan was more than 7 days ago, a non-blocking threat was detected and is awaiting your acknowledgement, or your subscription renewal date is within seven days.
- **What to do:** Hover over the icon to read the specific reason. Right-click and choose **Open Mithras** to see the full detail. Most yellow states clear on their own once the underlying task completes (for example, the next scheduled signature update). If you see yellow for more than 24 hours, open Mithras and follow the on-screen guidance.

### Red shield — threat detected or protection disabled
- **What it means:** Either a threat was found and either blocked or quarantined, or a critical protection component (real-time protection, behaviour monitoring, or firewall) has been turned off and Mithras cannot turn it back on automatically.
- **What to do:** Open Mithras straight away. If a threat was detected, the detail page tells you what was found, where, and what was done with it. The threat was almost certainly already neutralised; the red icon is your prompt to acknowledge it and decide whether you need to take any further action (for example, change a password if the threat was a credential stealer). If a protection component is disabled, the detail page tells you which one and offers a **Re-enable** button. If re-enable does not stick, see the **What to do if it stays red** section.

### Grey shield — offline
- **What it means:** Mithras cannot reach the Mithras cloud. Your computer is still protected locally — the agent continues to detect and block threats — but it cannot ship telemetry, receive policy updates, or check for signature updates from the cloud.
- **What to do:** If you are on a mobile hotspot, train Wi-Fi, hotel network, or other restricted connection, this is expected and resolves when you return to a normal network. If you are on your usual home network, check that the internet itself is working (try loading a normal website). If the internet works but the icon stays grey for more than fifteen minutes, see the **What to do if it stays grey** section.

## What to do if it stays red

If the red icon does not clear after you have followed the on-screen guidance, the most likely cause is a recent Windows update has reset Defender settings, or a third-party security tool you installed has displaced Mithras's protection. Follow these steps in order:

1. Restart your computer. A Windows update often requires a reboot to finalise; the red icon may clear on the first boot after the reboot.
2. Open the Windows Settings app and go to **Privacy and Security → Windows Security → Virus & threat protection**. Confirm that **Microsoft Defender Antivirus** is the active provider. If a third-party tool is listed instead, uninstalling that tool typically restores Defender (and clears the red icon).
3. If both steps above leave the icon red, open Mithras, take a screenshot of the detail page, and follow the steps in the **Getting support** section below.

## What to do if it stays grey

The grey icon means the agent cannot reach the cloud. The most common causes are: your router or modem needs a power cycle, a parental-control device on your network is blocking Mithras, or your home internet provider has an outage. Follow these steps in order:

1. Confirm normal internet works by visiting a website you use regularly. If no website loads, the issue is your internet connection, not Mithras — resolve the internet issue and the icon clears on its own.
2. If normal internet works, restart your computer once. Some networks reset their device-trust list after a power cycle and require a fresh connection from the agent.
3. If you use a parental-control device (Circle, Disney+ Circle, eero Secure Plus, or similar), check that domain `mithras.com.au` is allowed. The agent connects only to that domain; if it is on a category block-list, allow-list it.
4. If you have a corporate VPN or filtering tool on your home computer (sometimes installed by a workplace that lets you use the computer for personal use), check that domain `mithras.com.au` is not blocked.
5. If none of the above clears the icon after twenty minutes of normal internet usage, follow the **Getting support** section below.

## What to do if it stays yellow

Yellow icons almost always clear on their own within 24 hours. If yours has been yellow longer than that:

1. Hover the icon to read the specific reason. The reason is the most useful piece of information for resolving the issue.
2. If the reason mentions **signatures are out of date** or **last scan was more than 7 days ago**, open Mithras and choose **Update now** or **Run scan now** from the menu. Both actions trigger the relevant task immediately and the icon returns to green within minutes once it completes.
3. If the reason mentions **a threat is awaiting acknowledgement**, open Mithras to the threat detail, review the action that was taken (almost always: blocked or quarantined), and select **Acknowledge**.
4. If the reason mentions **subscription renews in N days**, open the **Account** tab in Mithras and review your subscription. If the payment card on file is still valid, the renewal will succeed automatically; if not, update it through the Account tab.

## No icon at all

If the icon does not appear in the system tray (and is not hidden behind the **^** arrow), the Mithras service may not be running. To check:

1. Press the Windows key, type **Services**, and open the Services app.
2. Scroll to **MithrasAgent** in the list. The Status column should read **Running**.
3. If the status is blank or **Stopped**, right-click the row and select **Start**. The icon appears in the tray within thirty seconds.
4. If the **Start** option is greyed out, or if starting it fails, restart your computer. The service is configured to start automatically on boot; a one-time hiccup usually clears on the next boot.
5. If the service is still not running after a restart, follow the **Getting support** section below.

## Getting support

If any of the above steps did not resolve the issue, contact us through your usual support channel. The fastest path to a resolution is to include:

- A screenshot of the tray icon and what colour it is.
- A screenshot of the Mithras window if you can open it.
- A one-line description of what changed before the issue started (a Windows update, installing or removing software, a network change).

For home users, the support email is `support@mithras.com.au`. The platform also offers an in-app contact form at the **Help** menu in Mithras.

## Quick reference card

| Colour | Meaning | Action |
|--------|---------|--------|
| Green | Protected | None |
| Blue | Busy with a routine task | None — wait |
| Yellow | Attention needed | Open Mithras, follow on-screen guidance |
| Red | Threat detected or protection disabled | Open Mithras now |
| Grey | Cannot reach the cloud (still protected locally) | Check internet; reboot if persists |

## Related guides

- [Install Mithras Personal](/help/sops/home_user/install-mithras-personal)
- [What to do if you are blocked from running a program](/help/sops/home_user/what-to-do-if-blocked)
- [Change payment method](/help/sops/home_user/change-payment-method)
- [Cancel subscription](/help/sops/home_user/cancel-subscription)
