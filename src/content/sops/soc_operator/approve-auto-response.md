---
title: Approve an autonomous response — or override it
audience: soc_operator
description: When the AI SOC has armed (or run) an autonomous action, how to confirm it, when to roll back, and when to force-fire one yourself.
order: 3
estimated_minutes: 8
updated_at: 2026-06-12
tags: ai-soc, response, override
---

## When to use this
You're working from `/soc` (the cross-tenant console) and an alert needs an operator decision — either to confirm an autonomous action that ran, or to authorise one the AI declined to take.

## The default flow (no operator action needed)
For most alerts:
1. Triage agent classifies → Verification agrees → Adversarial doesn't refute.
2. Commander opens incident + queues the action (e.g., `isolate_network`).
3. Comms agent notifies the customer's recipients.
4. Action auto-fires.
5. Auto-rollback is armed for **4 hours** unless the customer confirms.

You only step in when something is off-pattern.

## When to **confirm** an action that ran

Open the incident from `/incidents` (or directly from `/soc`).

Confirm when:
- All three agents agree.
- The action proportionate to the classification.
- The endpoint isn't tier-0 (no domain controller, no critical line-of-business server).

→ Click **Confirm action** in the Autonomous response card. The auto-rollback is cancelled. You'll typically resolve the incident in the same flow — click **Resolve** with notes.

## When to **roll back** an action

Roll back when:
- The Adversarial agent chip says `refuted` (red).
- The customer reached out saying the endpoint going off the LAN broke production.
- The classification looks like a known false-positive pattern (e.g., a vendor LOB app on `eol_protected` tier customers).
- The action ran on the wrong endpoint (rare but possible if hostname collided).

→ Click **Rollback now**. The action reverses within minutes. Then:
1. Re-classify the incident as **False positive** (sets `triage_decision.verdict = 'benign'`).
2. Add detailed reasoning notes. Future triage uses your notes as context.
3. Open a follow-up if the customer needs more help.

## When to **force-fire** an action the AI declined

Sometimes the consensus didn't reach the threshold (Verification disagreed, or Adversarial refuted), but you know from operator experience this is real. Examples: a pattern of low-signal events that together form a credential-stuffing campaign; intel from another customer in the same vertical you've been watching.

To override:
1. Open the alert from `/soc/alerts` (or `/alerts`).
2. Click **Force-fire response** in the AI verdict card.
3. The platform requires:
   - You must be a **super-admin** (or have the `soc_operator` role).
   - **Force reason** (≥ 8 chars). This text lands in `ai_agent_actions.override_reason` and the audit log.
4. Pick the action kind explicitly (the AI didn't pick one for you, so you must).
5. Click **Fire**.

The action runs immediately and the incident is stamped with a **forceFire override** badge — visible to the customer, the reseller, and on every reporting surface.

## Verify
- After **Confirm**: the action shows `customer_confirmed` on the endpoint detail page; auto-rollback chip is gone.
- After **Rollback**: the action shows `rolled_back` with your user id; the endpoint is back online (or process restarted, depending on action kind).
- After **Force-fire**: the action shows the **forceFire** badge with your override reason in tooltip; `ai_agent_actions.force_fired = true` in the row.

## Hardening notes
- **Never force-fire `kill_process` against a tier-0 system process.** Use `isolate_network` instead.
- **Always include a customer-visible reason** when force-firing. The customer will see the incident page and the trust hit is bigger than the threat in many cases.
- **If you find yourself force-firing the same pattern repeatedly**, that's a signal to tune the triage prompt or add a new playbook. Open a backlog item.

## Related
- [Triage a new alert](/help/sops/soc_operator/triage-new-alert)
- [Resolve an incident](/help/sops/soc_operator/resolve-incident)
- [Peritus: force rollback AI response](/help/sops/peritus_super_admin/force-rollback-ai-response)
