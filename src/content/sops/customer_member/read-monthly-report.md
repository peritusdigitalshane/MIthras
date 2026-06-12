---
title: Read your monthly Mithras report
audience: customer_member
description: Locate, interpret, and act on the monthly Mithras security report delivered to your organisation.
order: 1
estimated_minutes: 6
updated_at: 2026-06-12
tags: reports, security-hygiene, customer-member
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure explains how to locate the monthly Mithras Threat Defence report for your organisation, how to read each section in the order it appears, and which observations warrant escalation to your customer administrator. The monthly report is the primary instrument by which non-administrative staff verify that the platform is performing the work it was engaged to perform.

## Audience and authority
Members of a customer organisation whose `organization_memberships.role` is `member`. The procedure is read-only. It does not require the `admin` or `owner` role, and it does not invoke any mutating Remote Procedure Call (RPC) or edge function.

## Prerequisites
- You hold an active membership in the customer organisation, confirmed by a row in `public.organization_memberships` with your `user_id`.
- You are signed in to the Mithras console at `https://www.mithras.com.au/login`.
- Your organisation has been live on the platform for at least one full calendar month, so that a published report exists.
- Your email address is configured on `public.org_report_recipients` for category `monthly_report`, or you have access to a colleague's copy.

## Procedure

1. Open the Mithras console and navigate to `/customer/reports`.
2. The page lists the published reports in reverse chronological order. The most recent entry is labelled with the prior calendar month under the `Reporting period` column. Select the topmost row.
3. The report renders in the browser. Confirm the heading matches the period stated in the email subject `Your Mithras report is ready`.
4. Read the `Executive summary` section. It contains the narrative your reseller has written for the reporting period. Note any sentence flagged with the word `Critical` or `Action required`.
5. Read the `Endpoint coverage` panel. The `Total endpoints` figure is the count of rows in `public.endpoints` with `is_active = true` for the period. The `Uptime` percentage is derived from `public.endpoint_status` heartbeats. A figure below `95%` indicates a device was offline for material time.
6. Read the `Threats handled` panel. Counts are grouped by `endpoint_threats.severity` into `Severe`, `High`, `Moderate`, and `Low`. Named incidents under `Notable events` link to the corresponding entry in `public.incidents`.
7. Read the `Defender posture` panel. Each control (`Real-time protection`, `Antivirus engine`, `Behaviour monitoring`, `Tamper protection`) carries a green, amber, or red indicator. Amber or red means the control was disabled or unhealthy for part of the period.
8. Read the `Vulnerability findings` panel. The figure is the count of open Common Vulnerabilities and Exposures (CVE) records attributed to your endpoints. The trend arrow compares against the prior period.
9. Read the `Recommendations for next month` panel. Each item is an action proposed by your reseller. Items marked `Requires customer approval` need a decision from your administrator.
10. Close the report. To download a Portable Document Format (PDF) copy for records, use the `Download PDF` control in the top right of the report header.

## Verification
- The figures on the rendered `/customer/reports` page match the PDF attached to the monthly email.
- The `Reporting period` field references the prior calendar month, not the current month.
- The `Total endpoints` figure on the report agrees with the count visible at `/customer/endpoints`.
- The `Open vulnerabilities` figure on the report agrees with the open count on the endpoint detail pages at `/customer/endpoints`.

## Troubleshooting
- **No report appears for the most recent month.** Reports are published within the first seven calendar days of the following month. If day eight has passed and no entry exists, ask your customer administrator to confirm delivery with the reseller.
- **The figures in the browser differ from the figures in the PDF.** The PDF is generated at the moment of publication and is immutable. The browser view reflects the same snapshot. A genuine mismatch indicates a delivery error; ask your customer administrator to escalate using `/customer/contact`.
- **The `Recommendations for next month` panel is empty.** This is a valid state when the reseller has no proposed changes. It is not an error.
- **You cannot reach `/customer/reports`.** Confirm with your customer administrator that your membership is active. Membership revocation removes access to the entire `/customer` area without further notice.

## Audit and compliance
- Each report view is recorded to `public.activity_logs` with `action_type = 'customer_report_viewed'` and `actor_id = auth.uid()`.
- Each PDF download is recorded to `public.activity_logs` with `action_type = 'customer_report_downloaded'`.
- Report artefacts are retained in `public.customer_reports` for the duration of your contract and a further 24 months thereafter, in line with the customer's data retention configuration.
- The email distribution list is sourced exclusively from `public.org_report_recipients` for category `monthly_report`. Recipients are not retained elsewhere.

## Related procedures
- [Escalate a security concern](/help/sops/customer_member/escalate-a-concern)
