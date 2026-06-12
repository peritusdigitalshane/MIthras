---
title: Review threats on your endpoints
audience: customer_admin
description: Open the Threats page, understand severity classes, and decide what to action.
order: 2
estimated_minutes: 10
updated_at: 2026-06-12
tags: threats, defender, security
---

## When to use this
You got a "Critical threat detected" email, the dashboard tile shows Active Threats > 0, or you're doing a weekly security review.

## Prerequisites
- Org-admin or owner role (members can see threats but not act on them).
- Familiarity with the severity language Microsoft Defender uses (Severe, High, Moderate, Low).

## Steps

1. Open **`/threats`**.
2. Use the filter chips at the top:
   - **Active** — threats Defender hasn't finished cleaning (top priority).
   - **High+** — only Severe and High severity (the ones that auto-open incidents).
3. Click a row to drill into the threat:
   - The endpoint hostname links to that device's detail page.
   - The Defender threat name + category tells you what was detected.
   - The status tells you whether it's been cleaned, quarantined, or is still active.
4. For an **Active** threat:
   - Open the endpoint detail page.
   - Look at the **Defender posture** card — confirm Real-Time Protection is enabled. If it's off, the threat can re-execute.
   - If an incident has been auto-opened (Severe or High), open `/incidents/:id` to see what the AI SOC team has done about it.
5. For a **Cleaned** threat: no action needed, but check the same endpoint hasn't had multiple of the same threat — repeated detections suggest a persistence mechanism or an infected file that keeps being re-introduced.

## What each severity means

| Severity | What it usually is | Typical action |
|---|---|---|
| **Severe** | Confirmed malware (ransomware family, RAT, credential stealer) | Investigate immediately; auto-incident opens |
| **High** | Hacktools, exploit kits, suspicious binaries | Review the source; consider isolating the endpoint |
| **Moderate** | PUA, adware, low-confidence detections | Investigate at next opportunity |
| **Low** | Misleading apps, very low-confidence | Background acknowledgement; no immediate action |
| **Unknown** | Defender hasn't classified yet | Triage manually — usually new variant |

## Verify
- After Defender finishes cleanup the threat row moves from **Active** to **Cleaned**.
- The Defender posture card on the endpoint shows the threat count drops.
- If you opened an incident, its `/incidents/:id` page shows the AI Commander summary + the playbook step it's on.

## Troubleshooting
- **A threat keeps coming back.** Almost always a file that re-downloads from the internet (browser cache, email attachment) or a persistence mechanism (scheduled task, Run key). Open the endpoint detail page → Event Logs tab and look for the timing — what process executed just before each detection?
- **Defender is disabled on the endpoint.** Mithras can manage Defender but not force-enable it if Group Policy is overriding. Check the endpoint's group policy.
- **The "Active threats" number on the dashboard doesn't match the threats page.** The dashboard tile counts threats in `Active`, `Cleaning`, `Allowed`, and `Executing` states; the threats page filter is configurable.

## Related
- [Manage Defender policy](/help/sops/customer_admin/manage-defender-policy)
- [Understand an incident](/help/sops/customer_admin/understand-incident-detail)
- [Request emergency unlock](/help/sops/customer_admin/request-emergency-unlock)
