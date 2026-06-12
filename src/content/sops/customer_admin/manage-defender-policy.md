---
title: Manage your Defender policy
audience: customer_admin
description: Assign or change the Microsoft Defender policy applied to your endpoints, and push it out to the fleet.
order: 5
estimated_minutes: 10
updated_at: 2026-06-12
tags: defender, policy, posture
---

## When to use this
- You want stricter (or laxer) Defender settings for some or all of your endpoints.
- Your reseller has built a tailored policy for you and asked you to assign it.
- You need to roll back a policy change because something broke.

## What "policy" means here
A Defender policy bundles all the Microsoft Defender for Endpoint config that flows out to your agents — real-time protection, cloud-delivered protection, automatic sample submission, scan schedule, controlled folder access, attack-surface-reduction rules, and exclusions.

Policies are versioned. When you assign a new one, the next agent heartbeat picks it up (typically within 5 minutes).

## Steps

1. Go to **`/policies`**.
2. The list shows every policy available to your organisation:
   - **System default** (set by your reseller) — applied to new endpoints automatically
   - **Custom policies** — created by your reseller for your tier
3. Click a policy to see its full contents. Notable sections:
   - **Real-time protection** — should normally be on; off is a major posture downgrade
   - **Tamper protection** — locks Defender settings against local admin changes
   - **Controlled folder access** — anti-ransomware; can break legacy LOB apps
   - **ASR rules** — attack-surface reduction; some are noisy in audit mode first
   - **Exclusions** — paths/processes Defender should ignore. Audit any inherited exclusion you don't recognise.

## Assigning a policy

1. Open the policy detail.
2. Click **Assign to endpoints**.
3. Pick endpoints individually, by group, or all-of-the-org.
4. Click **Push**. The platform queues a `update_defender_policy` command for each endpoint.
5. Watch the progress chip per endpoint — `queued` → `executed` → `confirmed`.

## Rolling back

If the new policy breaks something (a LOB app stops launching, Outlook can't save attachments, etc.):

1. Open **`/policies`** and click the **previous policy** you had assigned.
2. Click **Assign to endpoints** → pick the affected endpoints.
3. Click **Push** again. The new (rollback) policy supersedes the broken one at the next heartbeat.
4. Open a thread in your reseller's contact channel describing what broke — they may need to adjust the policy template for everyone in your tier.

## Verify
- The endpoint's `/endpoints/:id` page → **Defender posture** card shows the new policy name + applied-at timestamp.
- The endpoint's **Defender real-time protection** chip is **green** (or matches whatever your policy specifies).
- The endpoint's last `update_defender_policy` command in agent history shows `executed`.

## Troubleshooting
- **Policy stuck on `queued` for over 30 minutes.** The endpoint may be offline. Open the endpoint detail — if `last_seen` is fresh, the agent is alive; if not, the next heartbeat will pick it up.
- **Endpoint shows `tamper_protection_blocked` after policy push.** The current policy has tamper protection on and the new policy is changing protected settings without disabling tamper first. Ask your reseller to add a tamper-protection toggle step.
- **A specific ASR rule keeps blocking a legitimate process.** Add an exclusion path in the policy → re-assign → push. Or contact your reseller to adjust the rule's mode (`block` → `audit`).

## Related
- [Request emergency unlock](/help/sops/customer_admin/request-emergency-unlock)
- [Review threats](/help/sops/customer_admin/review-threats)
