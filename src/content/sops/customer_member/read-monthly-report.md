---
title: Read your monthly Mithras report
audience: customer_member
description: Where to find your monthly report, how to interpret what it tells you, and what's worth flagging to your IT lead.
order: 1
estimated_minutes: 6
updated_at: 2026-06-12
tags: reports, security-hygiene
---

## When to use this
On the **first week of each month** when you get the "Your Mithras report is ready" email — or any time you want a snapshot of how your organisation is going.

## Where to find it
- **Email** — the PDF is attached to the monthly email from your reseller.
- **Web** — go to `/customer/reports`. You can read the latest report rendered in the browser and download any prior month.

You don't need admin access; any member of the organisation can read the report.

## What you'll see (in order)

### Executive summary
One or two paragraphs your reseller wrote about your specific situation. Read this first — if anything sounds urgent or unusual, message your IT lead.

### Endpoint coverage
- **Total endpoints** — laptops + desktops + servers being monitored.
- **Uptime %** — the agent should be running ~all the time. Anything below 95% is worth a question.
- **New endpoints this month** — confirm they're real machines, not someone setting up a personal device.

### Threats handled
- **Severe / High** — things Mithras stopped that *could* have caused real harm.
- **Moderate / Low** — common stuff. The number going up isn't always bad; sometimes it means the agent is just doing its job.
- If you see a **named incident** with a description, that's worth knowing the story behind. Ask your IT lead.

### Defender posture
A health chip for each major Defender control. **All-green is normal**. Any amber/red chip means a control was off for part of the month.

### Vulnerability findings
Open CVEs (Common Vulnerabilities and Exposures) on your endpoints' software. A reducing count over months is good.

### What we recommend next month
This is your reseller's "ask" — usually approval to roll a Defender policy change, upgrade an EOL Windows machine, or close out a vulnerability.

## When to flag something to your IT lead
- The executive summary mentions a **critical** incident.
- The number of severe threats stopped is suddenly much higher (or much lower) than prior months.
- A Defender posture chip is red.
- Vulnerability count is climbing.
- The "we recommend" section mentions anything that needs **your** action.

## Verify
- The report on `/customer/reports` matches the PDF in your email — same numbers, same date stamp.
- The report covers the **prior** month (May report is published in June).

## Related
- [Escalate a concern](/help/sops/customer_member/escalate-a-concern)
