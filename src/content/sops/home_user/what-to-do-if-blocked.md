---
title: What to do if Mithras blocks a file or application
audience: home_user
description: Decide whether a Mithras detection is a real threat or a legitimate item, then restore safely from the tray application.
order: 2
estimated_minutes: 6
updated_at: 2026-06-12
tags: recovery, false-positive, defender, quarantine
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure guides you through evaluating an item that Mithras Personal or Microsoft Defender has quarantined or blocked, and, when the item is confirmed safe, restoring it and adding an exclusion. The objective is to recover legitimate files without disabling protection or restoring malicious code.

## Audience and authority
The subscriber on a Mithras Personal plan, signed in to the affected Windows computer with local administrator rights. The tray application requires the same Windows user account that installed the agent.

## Prerequisites
- The Mithras Personal agent is installed and the `MithrasAgent` service is `Running`.
- The `Mithras Personal` tray icon is visible in the Windows system tray.
- You are signed in to Windows with an account that has local administrator rights.
- You have read the safety assessment in `Procedure` step 1 before restoring any item.

## Procedure

1. Assess whether the item is safe to restore before taking any action. Treat the detection as a true positive if any of the following apply.
   - The detection name in the tray application contains `Trojan`, `Ransomware`, `CredentialStealer`, `Backdoor`, or `Exploit`.
   - The file arrived as an email attachment from an unknown sender, or via instant messaging, social media, or a download link in an SMS message.
   - The file extension is `.exe`, `.scr`, `.bat`, `.cmd`, `.ps1`, `.vbs`, or `.js`, and you were not actively installing software.
   - The file name uses a double extension such as `invoice.pdf.exe` or `photo.jpg.scr`.
   - The source download page was reached through a sponsored or paid search result rather than the vendor's documented website.
2. If any condition in step 1 applies, do not restore the item. Leave it in quarantine and contact support at `support@mithras.com.au` with the detection name and source.
3. If the item is confirmed safe, open the `Mithras Personal` tray application. Right-click the tray icon and select `Open Mithras Personal`.
4. Select the `Recent activity` tab. Quarantined items are listed with a yellow shield indicator and a `Quarantined` status.
5. Select the relevant entry to expand its detail panel. Confirm the file path, the detection name, and the timestamp match the item you wish to restore.
6. Select the `Restore and exclude` button. Approve the User Account Control prompt.
7. The agent moves the file back to its original location and writes a per-path exclusion to Microsoft Defender. The entry status changes to `Restored` within a few seconds.
8. To allow a previously blocked application to launch in future, select the `Application rules` tab, locate the application by name or executable path, and select `Allow`. The rule is recorded as a per-process exclusion.

## Verification
- The restored file is present at its original path and opens as expected.
- The entry on the `Recent activity` tab shows `Restored` with the timestamp of your action.
- The `Mithras Personal` tray icon remains green with the tooltip `Protected`. Restoring an item does not reduce overall protection.
- On `/personal`, the `Recent activity` card reflects the same `Restored` event within two minutes.

## Troubleshooting
- **The `Restore and exclude` button is greyed out.** The file has been permanently removed by Microsoft Defender because the cloud-delivered protection classification is `high confidence malware`. Restoration is not available. Reinstall the original software from the vendor's documented website if it was legitimate.
- **The application launches once after `Allow` but is blocked on the next launch.** The application updates itself to a new executable path each time. Note the latest path shown in `Recent activity`, then add a folder-level exclusion by selecting `Application rules` and then `Add folder exclusion`.
- **The tray application reports `Cannot reach Mithras Personal`.** Confirm the `MithrasAgent` service is `Running` in the `Services` console, then right-click the tray icon and select `Reconnect`. If the error persists, restart the computer.
- **The detection is for a file inside a software installer that you trust.** Re-download the installer from the vendor's documented website, right-click the file, select `Properties`, then select `Unblock` before running it. If the installer is still quarantined, follow the restore procedure above for that specific file.

## Audit and compliance
- A row is written to `endpoint_threats` for each detection with `severity`, `detection_name`, `file_path`, and `quarantined_at`.
- Restore and allow actions are written to `activity_logs` with `action_type = 'detection_restored'` or `action_type = 'application_allowed'`, including the user account and the rule scope.
- Detection records are retained for 12 months in line with the Mithras Personal data retention policy. You can export your detection history from `/account` at any time.

## Related procedures
- [Install Mithras Personal on your computer](/help/sops/home_user/install-mithras-personal)
- [Change your payment method](/help/sops/home_user/change-payment-method)
- [Cancel your Mithras Personal subscription](/help/sops/home_user/cancel-subscription)
