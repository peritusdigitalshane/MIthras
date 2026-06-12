---
title: Triage a new alert
audience: soc_operator
description: Walk the multi-agent verdict trail, judge whether to trust auto-actions, and decide what to escalate.
order: 1
estimated_minutes: 10
updated_at: 2026-06-12
tags: triage, ai-soc, alerts
---

## When to use this
You're on shift and a new alert has landed. The AI SOC has already auto-triaged it — your job is to confirm the verdict is sane, not redo the analysis.

## Prerequisites
- Super-admin or operator role.
- Familiarity with the multi-agent design (Triage → Verify → Adversarial → Investigate → Commander) — see `/glossary#multi-agent`.

## Steps

1. Open **`/soc`** (the live SOC console).
2. In the **AI agent activity** panel on the left, click any decision row to open the **AI decision drawer**.
3. At the top of the drawer you'll see the **Multi-agent verdict trail** card. Read it in this order:
   - **Final verdict** chip + confidence — the consensus.
   - The three agent cards below: Triage, Verification, Adversarial.
   - If two of three agree and the third didn't refute, you can usually trust the verdict.
4. Open **`/incidents/:id`** if an incident has been auto-opened:
   - Read the **AI Commander summary** card. This is the one-line explanation for an analyst.
   - Check the **Playbook** card — what's already been done. Common steps: `forensics_complete`, `contained`, `customer_notified`.
   - Look at the **Autonomous response** card — what action ran. If the **forceFire override** badge appears, an operator manually overrode the gates; treat it as a high-attention review.
5. Decide:
   - **Trust + close**: Verdict is true_positive, response fired, customer notified → mark **Resolved** with brief notes.
   - **Override**: Verdict looks wrong → open `/alerts/:id`, override the verdict (Approve / Override / Dismiss buttons in the drawer), document why.
   - **Escalate**: Cross-tenant pattern or unusual evidence → run the `Investigate` re-fire, or open a manual deep-dive.

## When to be suspicious of the AI verdict
- **All three agents agreed too quickly** (latencies < 1s each) — may indicate the LLM hit cache; re-run the triage with `force=true` from the drawer.
- **Confidence ≥ 0.95 on a brand-new alert type** — high confidence on an unfamiliar pattern is suspicious; check the citations land on real rows.
- **Citations count is zero** — the LLM hallucinated. The platform auto-downgrades these to `needs_human` but verify the verdict isn't being trusted upstream.
- **An autonomous response fired but customer notification failed** — the playbook is `customer_notified` but `ai_agent_comms.status='failed'`. The auto-rollback timer was disarmed for you (see the alert banner). Contact the customer manually before letting the action stand.

## Verify
- After you close an incident the `/incidents` list moves it to the **Closed** tab.
- Your override (if any) is reflected on the alert's triage decision row — `review_action` column shows your action.
- The customer report for the next cycle will include the incident with your notes inline.

## Troubleshooting
- **Verification agent shows "failed"** — the LLM provider timed out or returned malformed JSON. The orchestrator already downgraded the verdict for safety. Re-run from the drawer; if it fails again, switch the org's `ai_verification_model` setting to a different provider.
- **Investigation is blank but verdict is true_positive** — investigation only fires for confirmed TPs at the orchestrator's threshold. Run it manually from the **Manual re-run** section of the drawer.
- **You can't find the alert that triggered an incident.** The incident detail page shows `incident.alert_id` — click the "View full AI analysis" button there to land on the drawer.

## Related
- [Resolve an incident](/help/sops/soc_operator/resolve-incident)
- [Approve an auto-response](/help/sops/soc_operator/approve-auto-response)
- [Customer-facing incident review](/help/sops/customer_admin/understand-incident-detail)
