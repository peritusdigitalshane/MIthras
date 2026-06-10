# Mithras 15-minute Demo Script

For sales reps. Follow this verbatim until you've run it 10 times. Then
improvise — but never skip the EOL Windows or AI SOC moments. Those are
the close.

---

## Before the demo (3 minutes)

- Make sure you're logged in as the **demo tenant** (not your own). Demo tenant url + creds in `/distributor/resources`.
- Open three browser tabs in advance:
  1. `/dashboard` (the main SOC view, pre-pivoted into the demo customer)
  2. `/endpoints/<demo-endpoint-id>` (a richly populated endpoint with threats + posture)
  3. `/admin/health` (only if their tech lead is in the room)
- Mute notifications. Close Slack/Teams.
- Have a glass of water. Have `pricing-sheet.md` open in a second window.

---

## Beat 1 — The MSP problem (1 min)

*[Open `/dashboard`. Show the fleet panel: ~25 endpoints across 3 customers, mix of healthy + warnings.]*

> "Before I show you anything fancy, look at this view. One MSP, three customer tenants, 25 endpoints. Every box you see has Defender posture, threats, software inventory, M365 identity — flowing into one console. No agent rollouts. No client-by-client logins. Hold that thought."

**What to point at**:
- Total endpoint count (top-right)
- The "online/offline" split
- The customer pivot dropdown (top-left of header)

---

## Beat 2 — Per-customer pivot (1 min)

*[Click into one customer tenant. Show the customer dashboard.]*

> "When I pivot into a customer, I see only their stuff. Strict multi-tenant — your customers never see each other's data, you can't accidentally cross the wires, and the audit log records every pivot."

**What to point at**:
- "Active threats" tile (real number, not zero)
- "Endpoints needing attention"
- The audit trail icon

---

## Beat 3 — An endpoint up close (3 min) ⭐ THE EDR MOMENT

*[Click into the most-populated endpoint. Threats tab.]*

> "This is one Windows 11 box. Defender is on, posture is healthy, but look — three threats in the last 30 days, all auto-resolved. No second agent. This is the Defender that ships in every Windows install, finally talking to a console you control."

**What to point at**:
- The threat list (severity colours)
- Click a threat → category, file, action taken
- Tab over to "Defender state" → real-time signature version, RTP, behaviour monitor

> "Every customer endpoint they enrol becomes immediately visible here. Sub-60-second telemetry."

---

## Beat 4 — EOL Windows hardening (2 min) ⭐ THE DIFFERENTIATOR

*[Navigate to Legacy Hardening tab — show a Win7 or Server 2012 box.]*

> "Now the part that nobody else has. This box is Windows 7. CrowdStrike won't touch it. Defender for Endpoint Plan 2 doesn't support it. The MSP's choice is normally — replace it, leave it bare, or get sued. Watch what Mithras does."

**What to point at**:
- The hardening profile assigned (Sysmon + GPO + Defender forced update)
- "Last applied" timestamp
- The audit log showing the policy hit

> "This is the conversation that gets you in the door at every SMB. Every dental practice, every accounting firm, every regional law office has at least one of these. We turn them from a liability into an auditor-acceptable risk."

---

## Beat 5 — AI SOC triage (3 min) ⭐ THE WOW MOMENT

*[Navigate to /ai-activity. Pick a recent AI triage decision.]*

> "Every alert that fires hits an AI triage step before it ever wakes up an analyst. Look at this one."

**Read aloud, slowly**:
- The summary
- The "is this real?" verdict
- The citation chain (click one → highlights the actual log line that led to the conclusion)

> "The AI doesn't get to make claims without citations. If it lies, the citation chain breaks. Our own SOC team's false-positive load dropped 60% the week we shipped this."

> "Most platforms slap 'AI' on a label. This actually rewrites the operator's day."

---

## Beat 6 — M365 identity (2 min)

*[Navigate to /m365. Show the most-recent risky sign-in or mailbox-rule injection event.]*

> "If your customer uses Microsoft 365 — and 95% do — Mithras watches the identity layer too. Risky sign-ins, mailbox-rule injection, OAuth grants to suspicious apps. The Business Email Compromise stuff that wipes out small accounting firms."

**What to point at**:
- The event list
- Click one → which user, which country, which app
- Activity log on the right

---

## Beat 7 — Remote desktop (1 min)

*[Back to an endpoint. Click "Remote desktop" button. Show the embedded session.]*

> "And when your tech needs to fix something, one click from the endpoint into a remote session. No Chrome extension. No second tab. No Guacamole login. Embedded in the platform you're already logged into."

> "RMM and EDR in one console means your tech doesn't context-switch."

---

## Beat 8 — Customer reports (1 min)

*[Navigate to /customer-reports. Show a generated report.]*

> "Once a month, every customer gets a PDF report with their posture summary, threats actioned, vulnerabilities mitigated. Branded for you, sent automatically. Compliance teams love these. Your customers' insurance underwriters love them more."

---

## Beat 9 — The close (1 min)

*[Close all tabs. Pull up `pricing-sheet.md` or your slide.]*

> "OK. That's the platform. Three questions and we're done."

1. *"Of your customer book, how many SMBs have at least one Windows 7, 2008, or 2012 box still in production?"* (They'll say a lot. That's the wedge.)
2. *"How many seats total across your book?"* (Now you know the rough deal size.)
3. *"If we set up a pilot tenant for your biggest customer this week, can you have your tech run the agent install on Monday?"*

If the answer is yes — that's a closed deal, you just haven't signed paperwork yet.
If the answer is no — *"What would have to be true for it to be yes?"*

---

## Anti-patterns

- Don't show every feature. They'll forget.
- Don't read the slides. They read faster.
- Don't try to handle every objection mid-demo. Park them, return at the end.
- Don't quote prices you haven't checked in `pricing-sheet.md` today.
