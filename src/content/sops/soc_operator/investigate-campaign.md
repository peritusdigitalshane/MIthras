---
title: Investigate a cross-tenant campaign
audience: soc_operator
description: Confirm a cross-tenant indicator pattern, pivot through the SOC console and threat-hunting surface, and coordinate a multi-org response.
order: 4
estimated_minutes: 15
updated_at: 2026-06-12
tags: ai-soc, threat-hunting, campaign, cross-tenant, mitre-attack
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure governs the investigation of an indicator that appears across more than one customer organisation in a short window. A cross-tenant pattern is treated as a campaign and is investigated, documented, and coordinated differently from a single-tenant alert. The operator's task is to confirm that the pattern is real and not commodity noise, scope the affected fleet through threat-hunting queries, attach the investigation to a tracking incident, and drive a coordinated per-organisation response.

## Audience and authority
The operator. Cross-tenant queries require a record in `public.super_admins`, which grants the cross-organisation read scope used by the SOC console and the threat-hunting query engine. Per-organisation response actions follow the same authorisation rules as the single-tenant procedures.

## Prerequisites
- The operator has identified a candidate indicator (file hash, command-and-control IP, malicious URL, mailbox sender, or attacker handle) from a triage decision, customer report, or external threat-intelligence feed.
- The operator can sign in to the SOC console and reach `/soc` and `/threat-hunting`.
- The operator has read-access to `endpoint_event_logs`, `firewall_audit_logs`, `endpoint_threats`, `alerts`, and `incidents` across all organisations in scope.
- A second analyst is available for peer review of any cross-tenant comms or any force-fire executed during the investigation.

## Procedure

### 1. Confirm the pattern

1. Open `/soc`. Enter the candidate indicator in the cross-tenant search box. The console returns matching rows from `alerts`, `ai_triage_decisions`, `endpoint_threats`, and `endpoint_event_logs`.
2. Count the distinct `organization_id` values returned. The threshold for campaign treatment is three or more organisations within a forty-eight-hour window and the indicator is not on the commodity allow-list (generic scanner user agents, Microsoft update telemetry, or public-internet baseline noise).
3. Use the embedded SOC chat panel inside `/soc` to summarise the pattern. The chat panel enforces a citation allowlist; only the cited rows are trustworthy. A typical query is `Across all organisations, summarise activity related to <indicator> in the last seven days. Include endpoint counts, MITRE ATT&CK techniques observed, and the top affected organisations.`
4. Map the indicator and observed behaviour to MITRE ATT&CK techniques. A coherent technique chain (for example `T1566.001` Spearphishing Attachment to `T1059.001` PowerShell to `T1071.001` Web C2) is a strong signal of a real campaign.

### 2. Scope the affected fleet

1. Open `/threat-hunting`. Construct a query that scopes the indicator across the tables that carry the relevant telemetry:
   - For file hashes, query `endpoint_threats` filtered on `indicator_hash` and grouped by `organization_id`.
   - For network indicators, query `firewall_audit_logs` filtered on `remote_address` or `remote_host`.
   - For execution artefacts, query `endpoint_event_logs` filtered on `event_id` and the relevant `process_name` or `command_line` fragment.
2. Cross-reference timestamps. Concentration in a narrow window (under six hours across multiple organisations) is consistent with a coordinated campaign; even distribution over days is more consistent with commodity malware.
3. Save the query. The saved query is retained against the operator's profile and is available from the `Recent` panel for re-use by other analysts on shift.

### 3. Document the investigation

1. The platform does not maintain a dedicated campaign object. The investigation is tracked as an incident with attached notes. Select the highest-severity incident already opened against the indicator, or open a tracking incident manually from `/incidents`.
2. Set the incident title to `campaign-<indicator-short>-<YYYY-MM-DD>` so the tracking incident is discoverable. Example: `campaign-sha256-d41d8c-2026-06-12`.
3. In the incident notes, record the affected `organization_id` values and endpoint counts, the MITRE ATT&CK techniques observed, the link to the saved threat-hunting query, and the source of the original detection.
4. If the campaign matches a publicly disclosed operation, record the threat-actor name and the public reference in the notes. Do not include unverified attribution.

### 4. Coordinate the per-organisation response

1. For every affected organisation, locate the open incident on its `/incidents` page. If the AI Triage chain has not already opened an incident, open one manually and run `Force-fire response` with an explicit `force_reason` that names the campaign tracking incident.
2. For organisations whose risk profile or business hours require operator-confirmed action, confirm the autonomous response from `/incidents/:id` and follow the approve-auto-response procedure.
3. For organisations where the action ran but the customer reports operational impact, follow the rollback path in the approve-auto-response procedure and record the rollback rationale in the tracking incident notes.
4. Notify each affected channel partner directly. The platform does not auto-distribute campaign briefings; the operator is responsible for partner comms during an active investigation.
5. If the triage prompt missed the pattern, raise a backlog item against the Mithras SOC prompt-tuning programme with the indicator, the technique chain, and a representative citation set.

## Verification
- Every affected organisation has an open incident on its `/incidents` page linked to the indicator.
- The tracking incident on the highest-severity organisation contains the saved threat-hunting query link, the affected organisation list, and the MITRE ATT&CK technique chain.
- The saved threat-hunting query appears in the operator's `Recent` panel on `/threat-hunting`.
- The `activity_logs` table contains rows with `action_type = 'campaign_investigation_started'` and one row per affected organisation as the operator dispositions each incident.

## Troubleshooting
- **The cross-tenant search returns zero rows for a known indicator.** The indicator format is non-canonical (for example, uppercased hash or a URL with a trailing slash). Re-enter the indicator in the canonical form recorded in `endpoint_threats.indicator_hash` (lowercase hex) or `firewall_audit_logs.remote_host` (lowercase, no scheme).
- **The SOC chat panel returns a summary with no citation chips.** The model produced an ungrounded answer and the orchestrator suppressed delivery. Re-issue the query with explicit scope (`in the last 24 hours`, `for organisations with active EOL hardening`). Ungrounded answers are never trusted.
- **A threat-hunting query times out.** The query touches `firewall_audit_logs`, which is large and partitioned by day. Restrict the time range to a forty-eight-hour window and re-run. If the timeout persists, narrow the query to a single organisation and union the results.
- **An affected organisation has no open incident.** The AI Triage chain produced a `benign` verdict on the original alert. Open an incident manually from `/incidents`, attach the indicator and the tracking incident reference, and force-fire the appropriate response under the four-eyes rule.
- **Escalation is required.** The pattern affects ten or more customer organisations, the indicators match a publicly disclosed nation-state operation, or the indicator is associated with an unpatched vulnerability. Notify the Mithras on-call duty officer and the leadership channel before any cross-customer comms. Do not publish the briefing externally until leadership has authorised partner distribution.

## Audit and compliance
- The tracking incident is retained in `public.incidents` for the lifetime of the customer organisation that owns it. Notes, attached query links, and resolution text are retained for seven years in accordance with the Mithras SOC evidentiary standard.
- Every per-organisation disposition writes a row to `public.activity_logs` with the relevant `action_type` and `actor_id = auth.uid()`.
- Force-fire actions executed during a campaign investigation are flagged in each affected customer's monthly report and surfaced to the channel partner.
- The saved threat-hunting query is retained against the operator's profile for thirty days; promotion to a permanent hunting pack requires a peer review and a separate procedure.

## Related procedures
- [Triage a new alert in the SOC console](/help/sops/soc_operator/triage-new-alert)
- [Approve or override an autonomous response](/help/sops/soc_operator/approve-auto-response)
- [Resolve an incident](/help/sops/soc_operator/resolve-incident)
