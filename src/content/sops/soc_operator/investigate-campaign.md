---
title: Investigate a cross-tenant pattern
audience: soc_operator
description: When you spot the same indicator across multiple customer organisations, how to confirm the pattern, document it, and trigger a coordinated response from the SOC console + threat-hunting surface.
order: 4
estimated_minutes: 15
updated_at: 2026-06-12
tags: ai-soc, hunting, threat-intel
---

## When to use this
You notice the same indicator across multiple customers in a short window — same malicious URL, same hash, same C2 IP, same attacker handle in event logs. This is a **pattern that may span tenants**, not an isolated alert, and the response is different.

## Where to work
Two surfaces, side by side:

- **`/soc`** — the cross-tenant SOC console. Aggregates alerts, triage verdicts, and incidents across every customer organisation you have super-admin scope to. Filterable by org, severity, IOC.
- **`/threat-hunting`** — the manual investigation surface. Lets you run cross-tenant KQL-style queries against `endpoint_event_logs`, `firewall_audit_logs`, and `endpoint_threats`.

The SOC chat panel inside `/soc` is your fastest way to ask cross-tenant questions in natural language ("How many endpoints across all orgs hit this hash in the last 7 days?"). It enforces a citation allowlist — you can trust the chip-referenced rows.

## Steps

### 1. Confirm the pattern is real

Open **`/soc`**. Filter by the suspect indicator (search box). Count distinct organisations.

A pattern is significant when:
- The indicator hits **3+ organisations** within a **48h** window, AND
- The indicator isn't a known commodity (e.g., generic curl UA from a benign scan, public-internet baseline noise).

If unsure, use the SOC chat panel: *"Across all orgs, summarise activity related to `<indicator>` in the last 7 days. Include endpoint counts and the top techniques observed."* Cited rows in the response are linkable to source.

### 2. Pivot in /threat-hunting

For deeper detail, switch to `/threat-hunting`:
- Run a query like `endpoint_threats | where indicator_hash == '<hash>' | summarize count() by organization_id`
- Cross-reference timestamps to spot whether the activity is concentrated in a window or spread.
- Save the query — it shows up in your saved-queries panel for re-use.

### 3. Document the pattern

There's no dedicated campaign object yet — track the investigation as a note attached to an incident. Pick the highest-severity incident already opened against this indicator (or open a manual one via the AdminHealth flow for a meta-tracker), and:

- Title the incident clearly (`'pattern-<indicator>-<date>'`).
- In the resolution notes, list the affected org IDs + endpoint counts.
- Link back to the saved threat-hunting query.

### 4. Push the response

You have three levers:

- **Per-org incidents** — for every affected org, the AI SOC already opened an incident (or you can manually create one via `/incidents`). Each customer's reseller will see it.
- **Update triage prompts** — if this is a pattern the AI missed, add example evidence to the triage prompt history so future alerts are caught early. Open a backlog item.
- **Notify affected resellers** — manually email the channel partner for each affected org with a brief. The platform doesn't auto-fan-out campaign briefings yet.

## Verify
- Affected orgs each have an open incident in their `/incidents` page tied to the indicator.
- Your saved threat-hunting query is in the **Recent** panel.
- The audit log at `/activity` shows your investigation steps.

## When to escalate to Peritus leadership
- The pattern affects **10+ customer orgs**, or
- The indicators match a publicly-disclosed nation-state operation, or
- You've found a **0-day exploitation pattern** (the IOC is associated with a vulnerability with no patch).

→ Direct message the on-call CISO contact and CC the leadership channel. Don't publish to customers until leadership has briefed channel partners.

## Related
- [Triage a new alert](/help/sops/soc_operator/triage-new-alert)
- [Approve auto-response](/help/sops/soc_operator/approve-auto-response)
- [Resolve incident](/help/sops/soc_operator/resolve-incident)
