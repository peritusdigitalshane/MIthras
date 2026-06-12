---
title: Review a monthly customer report
audience: partner
description: Walk the auto-drafted PDF for one of your customers, add commentary, and release it to the customer.
order: 6
estimated_minutes: 12
updated_at: 2026-06-12
tags: reports, msp-workflow, customer-comms
---

## When to use this
On the **1st of every month** the platform auto-drafts a report for each of your customers covering the prior month. You walk it, add commentary that reflects your relationship with the customer, then release it.

A report you haven't reviewed is still automatically released **5 business days** after draft — better to be slightly opinionated than to miss the window.

## Where to look
**`/reports`** lists every report across every customer you manage. The current month sits at the top.

## What's in the report (auto-populated)
- Endpoint count + uptime
- Threats blocked (severity breakdown)
- Active incidents + resolutions
- Defender posture summary (real-time protection, behavior monitor, AV signature freshness)
- EOL Windows hardening status (for `eol_protected` tier customers)
- Vulnerability open/closed deltas
- M365 ITDR signals (for tenants you've connected)
- AI SOC autonomous actions taken
- Subscription notes (credit balance, renewal date)

## Steps for review

1. Open **`/reports`**.
2. Click a customer's `draft` row.
3. Scroll through the report. Common things to add:
   - **Exec summary** — one or two sentences in plain English. This is what their executives will read.
   - **What we did this month** — manual actions you took outside the platform (e.g., on-site work, after-hours escalations).
   - **What we recommend next month** — anything you want them to approve. This becomes their renewal hook.
4. Click **Preview** to see the rendered PDF.
5. If happy, click **Release**. The customer receives an email with the PDF attached + a link to `/customer/reports`.
6. If not happy, click **Save draft** and come back. The auto-release timer pauses while you have unsaved changes.

## When to NOT release without changes
- The customer had a **critical incident** — the auto-narrative is factual but not relational. Add context about what was happening on their side.
- The customer's **endpoint count dropped sharply** — explain why (offboarded staff vs. agent failure).
- The customer's tier just changed — flag it explicitly so they don't see surprise pricing.

## Verify
- The report row turns from `draft` → `released`.
- The customer's `/customer/reports` view shows the new row.
- The PDF emailed to them matches what you saw in **Preview**.

## Troubleshooting
- **PDF render fails on Preview.** Most often a markdown table issue in your commentary. Strip the commentary, preview, and re-add piece by piece.
- **Customer says they didn't receive the email.** Check `/activity` (have a super-admin do this if you can't) for `report_email_sent` with their address. SMTP failures are surfaced there.
- **Numbers in the report don't match what you remember.** The report locks to a **snapshot** at the moment of draft creation. Live `/customer/threats` numbers will drift higher; the report is historical.

## Related
- [Decommission an endpoint](/help/sops/partner/decommission-endpoint)
- [Customer: read the monthly report](/help/sops/customer_member/read-monthly-report)
