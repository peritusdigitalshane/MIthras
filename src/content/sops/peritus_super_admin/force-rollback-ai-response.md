---
title: Force-rollback a misfired AI response
audience: peritus_super_admin
description: Operator override when the AI SOC ran an autonomous action that shouldn't have. Reverses the action, logs an audit row, and feeds the triage prompt for next time.
order: 4
estimated_minutes: 8
updated_at: 2026-06-12
tags: ai-soc, override, incident-response
---

## When to use this
The AI SOC ran an autonomous action — typically `isolate_network`, `kill_process`, or `quarantine_file` — and it's now clear it shouldn't have. Common triggers:

- The customer / reseller called: "Why is my server off the network?"
- A SOC operator reviewed the verdict trail and flagged `refuted` on the adversarial agent — but the system fired anyway (look for `force_fired = true`).
- A correlated batch of false-positive alerts hit multiple customers at once.

The customer-self-service "Confirm action" flow is the soft path. **Force-rollback** is the operator override for when waiting isn't safe.

## Steps

1. Open the incident from `/incidents` or directly via the alert detail.
2. In the **Autonomous response** card, click **Force rollback** (super-admin button, distinct from the customer's "Rollback now").
3. The dialog requires:
   - **Reason** (≥ 20 chars) — what makes the action wrong. *"False-positive on Contoso Healthcare's NAV ERP installer; same signature flagged on 3 other tier customers in last 60min"*. Lands in `ai_agent_actions.rollback_reason` and the audit log.
   - **Adjust verdict?** — checkbox. If ticked, also reclassifies the triage decision from the original verdict (e.g., `malicious`) to `benign`. Pick this if the underlying decision is wrong, not just the action.
   - **Notify customer?** — checkbox. Defaults on. Sends the customer-facing "We've reversed action X" email immediately, ahead of the next monthly report.
4. Click **Rollback now**.

The platform issues the inverse command (`unisolate_network`, `restart_process`, `restore_file`) on the next agent heartbeat (typically under 30 seconds).

## When also to reclassify

Always reclassify when the underlying verdict was wrong, not just the action choice. A correct `malicious` verdict + wrong action choice → roll back without reclassify (the verdict is still useful for context). A wrong `malicious` verdict → roll back **and** reclassify (so future triage doesn't use it as positive history).

## When to escalate the rollback

If a force-rollback affects **3+ customers in 60 minutes** with the same root cause, that's a model-quality or prompt regression. Open a high-priority incident on `/admin/health` (manual create) with severity `high` and tag with `ai_soc_regression`. The team needs to inspect:

- Recent prompt changes (`git log _shared/prompts/`)
- Recent model swaps (`ai_model_rates` history)
- Specific customers in scope (is one customer's data poisoning others' triage?)

## Verify
- The action chip on the incident shows `force_rolled_back` with your user id + reason.
- The endpoint detail page shows the inverse command queued and executed.
- The customer received the rollback email (check audit log).
- The triage decision's `operator_verdict` column is set if you reclassified.
- The audit log at `/admin/audit-logs` shows `force_rollback` with full context.

## Troubleshooting
- **Force-rollback dialog is greyed out.** Action is already in `customer_confirmed` state — the customer accepted it. Talk to them first.
- **Inverse command didn't execute.** The endpoint may be offline. Look at `endpoints.last_seen`. If offline, the rollback is queued — it'll fire on next heartbeat. Don't double-issue.
- **Customer received the email but says the endpoint is still isolated.** Check `endpoint_status.is_isolated`. The agent may have raced — try `restart_agent_service` from the endpoint detail.

## Related
- [Approve auto-response](/help/sops/soc_operator/approve-auto-response)
- [Respond to AI budget alert](/help/sops/peritus_super_admin/respond-to-ai-budget-alert)
