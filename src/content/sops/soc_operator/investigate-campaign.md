---
title: Investigate a cross-tenant campaign
audience: soc_operator
description: When you spot a pattern that might span multiple customer organisations, how to confirm, document, and respond from the SOC console.
order: 4
estimated_minutes: 15
updated_at: 2026-06-12
tags: ai-soc, hunting, threat-intel
---

## When to use this
You notice the same indicator across multiple customers in a short window — same malicious URL, same hash, same C2 IP, same attacker handle in event logs. This is a **campaign**, not an isolated alert, and the response is different.

## The SOC console view
**`/soc`** is the cross-tenant operator console. Unlike the regular `/incidents` page (per-org), `/soc` aggregates across every customer organisation you have super-admin scope to.

Useful columns:
- **Org** — which customer the row belongs to.
- **Indicator** — the IOC the agent flagged.
- **First seen / last seen** — timing per row.
- **Agent verdict** + **operator verdict** — current state.

## Steps

1. Open **`/soc`**.
2. Filter to the suspect indicator (URL, hash, IP) using the search box. The platform indexes IOCs across `endpoint_threats`, `firewall_audit_logs`, `vulnerability_findings`, and AI verdict trails.
3. Group the matches by **organisation** — you want to see how many customers and how many endpoints in each.

### Confirm the campaign

A campaign is real when:
- The indicator hits **3+ organisations** within a **48h** window, AND
- The indicator isn't a known commodity (e.g., generic curl UA from a benign scan).

Use the AI SOC chat panel (`/soc/chat`) to ask: *"Across all orgs, summarise activity related to <indicator> in the last 7 days. Include endpoint counts and the top techniques observed."* The chat agent will return citations to the underlying rows.

### Document the campaign

For each campaign you confirm:

1. Open **`/soc/threat-intel`** → **New campaign**.
2. Fill:
   - **Name** — short and memorable (`'Operation Brassiere'`, `'CookieStuff April'`).
   - **First confirmed at** — when you spotted it.
   - **Primary indicator** — IOC type + value.
   - **TTPs observed** — MITRE ATT&CK technique IDs (T1190, T1059, etc.).
   - **Affected orgs** — pre-populated; deselect any false positives.
3. **Save**. The platform creates a campaign record and links every related alert.

### Push the response

You have three levers:

- **Add IOC to global blocklist** — adds the IOC to the platform-wide IOC list. Every customer's agent gets it on next heartbeat. Use for confirmed-malicious IOCs only.
- **Open per-org incidents** — bulk-creates incidents in each affected org's `/incidents`. Forces the SOC + reseller to triage.
- **Notify affected resellers** — sends a campaign briefing email to the channel partner for each affected org. They handle customer comms.

For high-confidence campaigns, all three. For medium-confidence, just bulk-create incidents and skip the global blocklist.

## Verify
- `/soc/threat-intel` shows your campaign with the correct affected-org count.
- For each affected org, a new row appears in their `/incidents` page tagged with the campaign id.
- The agent audit log shows global IOC adds with your user id.

## When to escalate to Peritus leadership
- The campaign affects **10+ customer orgs**, or
- The campaign indicators match a publicly-disclosed nation-state operation, or
- You've found a **0-day exploitation pattern** (the IOC is associated with a vulnerability with no patch).

→ Direct message the on-call CISO contact (`/admin/contacts`) and CC the leadership Slack channel. Don't publish to customers until leadership has briefed channel partners.

## Related
- [Triage new alert](/help/sops/soc_operator/triage-new-alert)
- [Approve auto-response](/help/sops/soc_operator/approve-auto-response)
- [Resolve incident](/help/sops/soc_operator/resolve-incident)
