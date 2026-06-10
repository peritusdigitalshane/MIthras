# Reports — Send your customer a polished monthly report

**Target length:** 66 seconds
**Slug:** `monthly-pdf-report`

## Setup

1. A customer organisation with at least one report already generated
2. SMTP configured in Settings (a test M365 send works)
3. At least one recipient added to `org_report_recipients` for the customer
4. Have the PDF file open in a separate browser tab so you can cut to it

## Shot list & voiceover

### [00:00 – 00:08]
**SHOW:** Customer Reports page with the reports table populated. Highlight
the cron schedule comment in the page header (or briefly show the migration
file).

**SAY:** "Monthly reports auto-generate on the first of every month. The
cron pulls the prior month's posture data and produces both an HTML version
and a PDF."

### [00:08 – 00:20]
**SHOW:** Click the PDF download button on the most recent report. The PDF
opens. Pan slowly: brand header, executive summary block, KPI grid.

**SAY:** "The PDF starts with an AI-written executive summary tuned for a
non-technical reader. Then a KPI grid: endpoints, threats, incidents,
critical vulnerabilities."

### [00:20 – 00:32]
**SHOW:** Scroll down the PDF. Show the Incidents table, then the Top
software table.

**SAY:** "Incidents are listed with severity and status. Top software in
the fleet shows what your customer is actually running."

### [00:32 – 00:44]
**SHOW:** Switch back to Customer Reports page. Scroll to the Recipients
card. Mouse over an existing recipient. Show the kind-toggle chips —
monthly, weekly, quarterly.

**SAY:** "Recipients are managed per customer. Add the owner, IT manager,
and compliance lead — each one opts into monthly, weekly, or quarterly
delivery."

### [00:44 – 00:56]
**SHOW:** Click "Send" on the most recent report row. The toast confirms
"Sent to X recipients." Cut briefly to an inbox showing the received email
with the PDF attachment.

**SAY:** "When the report finishes generating, the platform ships it via
SMTP to every recipient as a PDF attachment. Branded, dated, professional."

### [00:56 – 01:06]
**SHOW:** Back on Customer Reports. Click "Generate ad-hoc (last 30 days)".
The button spins, then a new row appears at the top with status=ready.

**SAY:** "You can also generate ad-hoc reports for any custom period, or
hit the Send button to re-deliver an existing report on demand."

### END
