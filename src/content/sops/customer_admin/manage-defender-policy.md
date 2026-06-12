---
title: Manage the Microsoft Defender policy applied to your endpoints
audience: customer_admin
description: Review the active Defender policy, assign a different policy to one or more endpoints, and verify the change has been applied at the agent.
order: 5
estimated_minutes: 10
updated_at: 2026-06-12
tags: defender, policy, posture
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure assigns a Microsoft Defender policy to one or more endpoints in your organisation and confirms that the agent has applied the new configuration. A Defender policy bundles real-time protection, cloud-delivered protection, automatic sample submission, the scan schedule, controlled folder access, Attack Surface Reduction (ASR) rules, and exclusions. Changing the assigned policy alters the security posture of every endpoint targeted; this document defines the controlled way to do it.

## Audience and authority
Customer administrators whose `organization_memberships.role` is `admin` or `owner`. Policy assignment writes to `public.defender_policies` and queues an `update_defender_policy` command to each targeted endpoint. The platform does not permit customer administrators to author or edit policy definitions; new policies are authored by your reseller.

## Prerequisites
- At least one Defender policy is visible to your organisation. The default policy is auto-assigned at organisation creation. Custom policies are created by your reseller.
- The endpoints you intend to target are enrolled and have reported a heartbeat within the last 24 hours.
- You are signed in to the Mithras console at `https://www.mithras.com.au/login`.
- You have a documented change reason. Defender policy changes alter posture; record the reason in your own change-management system before you proceed.

## Procedure

1. Open `/policies`. The page lists every policy visible to your organisation, distinguished by:
   - **System default** — the policy auto-assigned to new endpoints at enrolment.
   - **Custom** — policies authored by your reseller for your tier.
2. Select the policy you intend to assign. The detail view exposes the configuration:
   - **Real-time protection** — the on/off state of Defender real-time scanning.
   - **Tamper protection** — locks Defender configuration against local administrator changes.
   - **Controlled folder access** — anti-ransomware control that restricts write access to protected paths.
   - **Attack Surface Reduction rules** — each rule's mode is `block`, `audit`, or `off`.
   - **Exclusions** — paths and processes Defender will ignore.
3. Review every section before assignment. If an inherited exclusion is unrecognised, contact your reseller before proceeding.
4. Select **Assign to endpoints**.
5. In the assignment dialog, choose the scope:
   - A single endpoint by hostname.
   - A subset of endpoints by multi-select.
   - All endpoints in the organisation.
6. Select **Push**. The platform writes the assignment to `public.defender_policies` and queues an `update_defender_policy` command for each targeted endpoint.
7. Monitor the per-endpoint status chip on the assignment dialog. Each endpoint progresses through `queued`, `executed`, `confirmed`. The expected end-to-end time is under five minutes from a healthy heartbeat.

To revert a policy change, repeat the procedure with the previously assigned policy and the same endpoint scope. The replacement supersedes the prior assignment on the next heartbeat.

## Verification
- The endpoint detail page at `/endpoints/:id` lists the new policy name and the assignment timestamp under the **Defender posture** card.
- The **Defender posture** card on `/endpoints/:id` shows `Real-time protection` set to the value defined in the new policy.
- The endpoint's most recent `update_defender_policy` command in **Command history** shows the status `confirmed`.
- The audit log at `/activity` contains a row with `action_type = 'policy_assigned'`, the policy identifier, and your user identifier.

## Troubleshooting
- **A targeted endpoint remains in `queued` status for more than 30 minutes.** Open `/endpoints/:id` and inspect **Last seen**. If the timestamp is older than the heartbeat interval, the endpoint is offline; the command will be delivered at the next heartbeat. If the endpoint is online, request your reseller investigate the agent command queue.
- **An endpoint reports `tamper_protection_blocked` after the push.** The currently applied policy has tamper protection enabled and the incoming policy modifies a protected setting. Request your reseller revise the new policy to stage tamper-protection changes ahead of the protected settings.
- **An Attack Surface Reduction rule is blocking a legitimate line-of-business application.** Capture the blocked process path from the endpoint's threat history at `/endpoints/:id` and request your reseller add an exclusion to the policy or change the rule mode to `audit` for evaluation.
- **The policy you require is not listed on `/policies`.** Custom policies are authored by your reseller. Contact them with the configuration delta you require.

## Audit and compliance
- The assignment record is written to `public.defender_policies` with the actor identifier and the targeted endpoint scope.
- An entry is written to `public.activity_logs` with `action_type = 'policy_assigned'` and `actor_id = auth.uid()`. Reversions are written with `action_type = 'policy_reverted'`.
- Posture changes resulting from the new policy are captured in `public.endpoint_status` on the next collection cycle and are retained for 24 months.
- Policy changes affecting Defender configuration are summarised in the monthly customer report distributed via `public.customer_reports`.

## Related procedures
- [Request an emergency unlock for an endpoint](/help/sops/customer_admin/request-emergency-unlock)
- [Review threats detected on your endpoints](/help/sops/customer_admin/review-threats)
- [Read and act on an incident detail page](/help/sops/customer_admin/understand-incident-detail)
