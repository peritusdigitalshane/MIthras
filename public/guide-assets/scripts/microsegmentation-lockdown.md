# Microsegmentation — Lock down a port in one click

**Target length:** 78 seconds
**Slug:** `microsegmentation-lockdown`

## Setup before recording

1. Sign in as the super-admin
2. Switch to a tenant that has 2-3 endpoints reporting firewall audit logs
3. Make sure at least one rule has hits — RDP usually has some
4. Have the Microsegmentation page open at `/microsegmentation`

## Shot list & voiceover

### [00:00 – 00:06]
**SHOW:** Microsegmentation dashboard, full page. Three rule cards visible
in Audit mode at the top (RDP, WinRM, HTTP/S), summary stats at the top.

**SAY:** "Microsegmentation in Mithras starts with a learn-mode rule. The
agent watches every inbound connection to that service and sends it back to
the platform."

### [00:06 – 00:14]
**SHOW:** Hover over the RDP rule card. Highlight the stat grid — 24h
hits, 7d hits, unique sources, endpoints. Linger on the sparkline.

**SAY:** "Each rule card shows the last 24 hours and 7 days of traffic,
the unique sources, and which endpoints are reporting in."

### [00:14 – 00:22]
**SHOW:** Scroll down to the "Top sources" badges. Click one of the IP
badges — the "Allow this source" popover opens. Don't click the button
yet; let it sit briefly.

**SAY:** "Top sources are listed at the bottom — click a source to whitelist
it before you lock the port down."

### [00:22 – 00:32]
**SHOW:** Close the popover. Click the "Lock Down" button at the top right
of the RDP card. The confirmation dialog opens, showing the protocol,
port, and group it'll apply to plus the whitelisted IP.

**SAY:** "When you're happy with what you see, click Lock Down. The
platform pushes a Windows Firewall block rule plus an allow-rule scoped to
your whitelisted sources."

### [00:32 – 00:44]
**SHOW:** Click confirm in the dialog. The RDP card animates to the bottom
of the page into the "Locked Down" section. The badge changes from amber
"Audit" to green "Enforce".

**SAY:** "Every endpoint in the assigned group picks it up on the next
policy pass — usually under fifteen minutes."

### [00:44 – 00:56]
**SHOW:** Open a terminal or PowerShell window on a test endpoint. Run
`Get-NetFirewallRule -DisplayName 'Mithras-*'`. Two rules show up — the
RDP block rule and the allow-whitelist rule.

**SAY:** "The rule moves to the Locked Down section, the sparkline keeps
recording attempts, and you can revert at any time with one click."

### [00:56 – 01:18]
**SHOW:** Switch back to the dashboard. Show the locked-down card with
its green badge. Mouse over the "Revert" button briefly, then back to the
full dashboard view.

**SAY:** "That's a complete kill chain for any inbound service —
observe, decide, enforce. Without buying CrowdStrike, without writing GPO
scripts, without learning a new firewall."

### END

Optional outro graphic: Mithras logo, tagline, `/signup` CTA.
