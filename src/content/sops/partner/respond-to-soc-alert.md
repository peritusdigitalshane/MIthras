---
title: Respond to a SOC alert
audience: partner
description: How to read the AI SOC's multi-agent verdict, decide whether the autonomous action was right, and act if it wasn't.
order: 7
estimated_minutes: 12
updated_at: 2026-06-12
tags: incidents, ai-soc, response
---

## When to use this
You received a "Critical incident opened" or "Severe incident contained" email, or you're glancing at `/incidents` and see an active row.

## The mental model
The AI SOC runs a chain of agents — **Triage → Verification → Adversarial → Investigation → Commander → Comms**. By the time you see an incident, four things have already happened:

1. A Defender (or M365) signal was triaged by an LLM agent.
2. A second LLM agent **verified** the verdict with a different model.
3. A third LLM agent **tried to refute** the verdict (adversarial).
4. If the consensus was strong enough, the **Commander** opened the incident and the autonomous response either ran or is armed to run.

Your job is to confirm the AI got it right — and act if it didn't.

## Steps

1. Open the incident from your email link or from **`/incidents`**.
2. Read the **Commander summary** card — one line.
3. Scan the **Agent consensus** card. Look for:
   - **Triage verdict** + the chip's colour (`malicious` / `suspicious` / `benign`)
   - **Verification** agreed/disagreed
   - **Adversarial** chip showing `not_refuted` (verdict is trustworthy) or `refuted` (flagged for human review)
4. Scan the **Autonomous response** card. If `action_kind` ran:
   - **isolate_network** — the endpoint is now off the LAN and Internet, except for Mithras command channel.
   - **kill_process** — the offending process is dead.
   - **quarantine_file** — the binary is in quarantine.
5. Check the **Auto-rollback armed** banner. If present, the action will reverse in **4 hours** unless someone confirms it. Resolving the incident counts as confirmation.

## When to confirm + close

- All three agents agree.
- The action matches the threat (isolate is right for ransomware indicators; kill is right for a single rogue process).
- The customer's workflow is acceptable to keep contained until next business day.

→ Click **Confirm action** (cancels auto-rollback) and **Resolve** with notes that summarise: what it was, what we did, what we recommend for prevention. Resolution notes flow into the next monthly customer report.

## When to roll back fast

- The adversarial chip says `refuted` — at least one agent thinks this is wrong.
- The customer is a `eol_protected` customer running a legacy LOB app that you know surfaces as suspicious (false positive).
- The endpoint is a domain controller or other tier-0 asset where containment is more damaging than the threat.

→ Click **Rollback now** in the **Autonomous response** card. The action reverses within minutes. Then re-classify the incident as **False positive** and add notes that explain *why* — the next triage will use that as context.

## When to escalate to Peritus SOC

- The verdict is `malicious` but the action is `none` (Commander couldn't pick a safe action).
- The incident shows `Investigation failed` or `Commander failed` chips — the chain didn't complete.
- The action ran but the customer says it broke production and you can't trace why.

→ Click **Escalate** in the incident header. Peritus SOC takes ownership and you stay on as the customer-facing contact.

## Verify
- After **Confirm + Resolve**, the row on `/incidents` moves to status `resolved`.
- The customer receives a closure email with your resolution notes.
- The endpoint's `/endpoints/:id` page shows the action as `customer_confirmed` (or `rolled_back` if you reversed).

## Troubleshooting
- **No autonomous action ran.** Check the customer's `auto_response_policy`. Some customers (eol_protected by default) are configured **notify-only**.
- **The customer says they were never notified.** Open the **Customer notifications** card on the incident. A red `failed` row points to an SMTP failure — the auto-rollback is disarmed in that case so the action is preserved.
- **Adversarial agent refuted but the action still ran.** A SOC operator manually forced it. Look for the **forceFire override** badge — that's the override marker. Ask the operator before reversing.

## Related
- [Decommission endpoint](/help/sops/partner/decommission-endpoint)
- [Customer: understand the incident detail page](/help/sops/customer_admin/understand-incident-detail)
- [SOC operator: resolve incident](/help/sops/soc_operator/resolve-incident)
