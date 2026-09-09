# Mithras Identity Defence (MID) — design spec

**Status:** Draft for review
**Author:** Mithras platform engineering
**Date:** 2026-06-17

---

## 1. Problem

SMB customers want the outcomes Conditional Access (CA) delivers — block sign-ins from risky locations, kill compromised sessions, require strong device posture before granting M365 access — but a meaningful fraction won't pay for the Entra ID P1 licence ($9/user/month) that gates CA. We need a coherent platform feature that delivers most of those outcomes using signals and controls Mithras already owns, with honest disclosure about the tradeoff vs real CA.

The trigger for this spec was a customer push-back during the Conditional Access (Phase 1) rollout: they liked the AI gap analysis but pushed on *"can you also enforce the gaps, not just tell us about them?"* The answer is partially yes, and this spec defines how.

---

## 2. Goals

1. Allow operators to declare access rules in plain English: *"Block sessions from outside Australia"*, *"Force re-MFA daily for users in role X"*, *"Revoke any session from a device Mithras doesn't manage"*.
2. Detect violations of those rules within **five minutes of occurrence** (bounded by existing poll cadences).
3. Apply enforcement actions — revoke sessions, disable account, force MFA re-registration, alert SOC — via Graph endpoints we already have consented scopes for.
4. Surface a per-user **identity risk score** built from the broad signal set Mithras already collects (endpoint posture, vuln state, email behaviour, network telemetry, mailbox-rule changes, OAuth grants, geo deviation) — richer than what Microsoft's own Identity Protection sees because we have endpoint visibility they don't.
5. Be **honest** about the tradeoff in the UI. Every rule shows: *"Enforced within ~5 minutes (detect + response). Conditional Access would enforce this at sign-in (0 seconds). Choose."*
6. Be **safe**. Auto-revocation cannot lock the customer's tenant out of itself. Break-glass account exclusion + rate-limits + a report-only mode are first-class.

## 3. Non-goals

1. **We are not a preventive identity control.** We cannot block a sign-in at Microsoft's identity stack. Anyone who tells a customer Mithras "replaces" Conditional Access is misrepresenting the product. The product replaces the *outcomes* CA delivers, not the *mechanism* CA delivers them.
2. **We do not build a forward proxy / CASB.** Real CA App Control / Defender for Cloud Apps inline-DLP is out of scope.
3. **No claim of equivalence to P1 Identity Protection's risk scoring.** Our score is a different model with different signals; we surface ours as "Mithras risk", never as "sign-in risk" or "user risk" (Microsoft terms).
4. **No re-implementing MFA.** We piggyback the customer's existing MFA (Security Defaults, per-user MFA, or any CA they do have). Our enforcement primitive is *kill the session*, which forces the customer's existing MFA on next sign-in.

## 4. Architecture

### 4.1 Data flow

```
   [signals]                  [evaluation]                    [action]
   ─────────                  ─────────────                   ────────
   M365 audit poll  ┐
   Endpoint events  │
   Mail send headers│   ───►  rule evaluator   ───►   revoke session
   OAuth grants     │         (every 5 min)            disable account
   Mailbox rules    │                                  force MFA
   Vuln state       │                                  notify SOC
   Network telemetry┘                                  log decision
```

### 4.2 New tables

- `identity_access_rules` — declarative rule definitions (one row per rule per org).
- `identity_signals` — denormalised signal store keyed by `(organization_id, user_principal_name, signal_kind, ts)`. Lives 90 days for trend computation.
- `identity_risk_scores` — current and historical risk score per user, recomputed every poll cycle.
- `identity_actions` — append-only ledger of every enforcement action (revoke, disable, MFA-reset, notify), with rule reference, signal evidence, operator-or-AI attribution, and outcome.

### 4.3 Edge functions

- `identity-poll` — runs every 5 min, harvests signals from all input sources, writes to `identity_signals` + recomputes `identity_risk_scores`. Self-overlap mutex.
- `identity-evaluate-rules` — runs immediately after `identity-poll`, walks active rules, decides actions, writes pending actions to `identity_actions` with status `pending`.
- `identity-enforce` — runs immediately after `identity-evaluate-rules`, executes pending actions against Graph (with safety guardrails — see §10). Writes outcome.
- `identity-rule-test` — operator-triggered. Runs a rule in *report-only* mode against the current signal set and shows what would have happened — never enforces.

### 4.4 Cadence

- Standard cycle: every 5 minutes (aligned with existing `m365-poll-tenants`).
- For rules tagged "critical" (e.g. revoke on impossible-travel), an opt-in 60-second loop runs against the subset of signals it depends on. Trades cost for latency.

## 5. Detection signals catalogue

What we collect and where it comes from. The full catalogue feeds both the rule evaluator and the risk score.

| Signal | Source | Update freq | Available without P1? |
|---|---|---|---|
| Geographic sign-in source | M365 sign-in audit if P1, OR endpoint Windows event 4624 source IP geo-lookup, OR email send headers (Received-From IP) | 5 min | Yes (degraded — endpoint + mail only) |
| Mailbox forwarding rule creation | `m365-poll-tenants` MailboxSettings.Read | 5 min | Yes |
| OAuth grant change | Application.Read.All | 5 min | Yes |
| Mailbox-send anomaly (volume / unusual recipients) | `m365-email-sweep` send-side scan | 2 min | Yes |
| Endpoint posture state | Agent heartbeat | 30 sec | Yes |
| Vuln state (open critical CVEs) | `cve-auto-scan` | nightly | Yes |
| Defender posture (RTP off, sig age) | Agent | 30 sec | Yes |
| Network telemetry (firewall, microseg) | Agent | 30 sec | Yes |
| Risky sign-in (Microsoft signal) | Identity Protection API | 5 min | **No — P2 only** |
| Sign-in audit (raw events) | `auditLogs/signIns` | 5 min | **No — P1 only** |

**Honest UX implication:** rules that depend on signals only available with P1/P2 show a "requires P1" badge in the rule builder. Without the licence we can't see the signal — we don't pretend.

## 6. Response action catalogue

What we can actually do when a rule fires. Every action requires the `REMEDIATION_SCOPES` consent — opt-in by the customer's M365 admin.

| Action | Graph call | Required scope | Reversible? |
|---|---|---|---|
| Revoke all sessions | `POST /users/{id}/revokeSignInSessions` | `User.RevokeSessions.All` | Yes (user re-MFAs) |
| Disable account | `PATCH /users/{id} {accountEnabled: false}` | `Directory.ReadWrite.All` | Yes (re-enable) |
| Force MFA re-registration | Delete MFA methods then alert admin to set up again | `UserAuthenticationMethod.ReadWrite.All` *(needs adding)* | Disruptive |
| Disable mailbox forwarding rule | `PATCH /users/{id}/mailFolders/inbox/messageRules/{ruleId}` | `MailboxSettings.ReadWrite` | Yes |
| Revoke OAuth app grant | `DELETE /servicePrincipals/{id}/oauth2PermissionGrants/{grantId}` | `Application.ReadWrite.All` | Yes |
| Quarantine endpoint (network isolation) | Mithras agent command (`isolate_network`) | Mithras agent | Yes |
| Notify SOC | Internal — no Graph | n/a | n/a |

## 7. Access Rules — language and UX

### 7.1 Rule shape

A rule is a row in `identity_access_rules`:

```json
{
  "id": "uuid",
  "organization_id": "uuid",
  "name": "Block Belarus sessions",
  "description": "Sessions from countries we don't operate in are killed within 5 minutes.",
  "enabled": true,
  "mode": "enforce" | "report_only" | "off",
  "applies_to": {
    "users": "all" | { "include": ["alice@..."], "exclude": ["break-glass@..."] },
    "roles": [],
    "device_compliance": "any" | "managed" | "unmanaged"
  },
  "conditions": [
    { "kind": "geo_outside",       "value": ["AU", "NZ"] },
    { "kind": "mailbox_rule_added","value": { "destination": "external" } }
    /* combined with AND */
  ],
  "actions": [
    { "kind": "revoke_sessions" },
    { "kind": "notify_soc", "severity": "high" }
  ],
  "rate_limit_per_user_per_day": 3,
  "created_at": "...",
  "created_by": "uuid"
}
```

### 7.2 Rule modes

- `off` — rule exists but does nothing
- `report_only` — rule evaluates, decisions are logged to `identity_actions` with status `would_have_fired`, no Graph calls are made
- `enforce` — full enforcement

Mirrors Microsoft's `enabledForReportingNotEnforced` state from CA. Operators are strongly encouraged to spend 7 days in `report_only` before flipping to `enforce`, with a "Promote to enforce" CTA after the first week of clean dry-run.

### 7.3 Rule library — pre-built templates

Operators don't start from scratch. We ship a curated template library:

- **Block sessions from outside [region]** — geo restriction
- **Kill sessions from unmanaged devices** — require Mithras-agent compliance
- **Revoke on suspicious mailbox rule creation** — classic post-compromise tell
- **Daily re-auth for privileged roles** — equivalent of CA sign-in frequency
- **Revoke on impossible travel** — sign-in from two countries within an impossible time window
- **Auto-isolate endpoint + revoke session on Defender critical** — joint endpoint + identity action
- **Revoke on first sign-in to a sensitive app from new device** — needs sign-in audit (P1+)

Each template is a `report_only` rule the operator just needs to flip to `enforce` after review.

## 8. Identity Risk Score

### 8.1 Model

Per-user score 0–100, recomputed every 5 min. Inputs:

- **Sign-in context** (30%): geo deviation from baseline, time-of-day deviation, device deviation
- **Mailbox behaviour** (20%): forwarding rule creation rate, send-volume anomaly, recipient-pattern anomaly
- **Endpoint posture** (20%): Defender state, threat count, microseg compliance, agent health
- **Vulnerability exposure** (15%): open critical CVEs on the user's primary device
- **Identity hygiene** (10%): MFA registration state, password age, role membership
- **OAuth surface** (5%): grants made in the last 30 days

Weights are a default; operators can tune them per-org. AI inference is used for the *anomaly* sub-scores (e.g. "is this geographic source a deviation for this user?") because the raw distance / time-bucket signals are noisy.

### 8.2 Surfacing

- Per-user current score on `/m365/identity-defence/users/{upn}`
- 30-day score sparkline + which signals drove changes
- A "high-risk users" tile on the SOC console + `/m365/identity-defence`
- Per-org rollup: average score, distribution, count of high-risk users

### 8.3 Rule integration

Rules can reference the score: *"if risk_score >= 75 then revoke_sessions"*. This is how operators tune their own behavioural enforcement without writing complex condition trees.

## 9. UI shape

### 9.1 New routes

- `/m365/identity-defence` — overview: total rules, mode breakdown, recent enforcement actions, high-risk users
- `/m365/identity-defence/rules` — rule list + builder
- `/m365/identity-defence/rules/new` — rule builder (template picker first, then customisation)
- `/m365/identity-defence/users` — per-user risk view
- `/m365/identity-defence/users/{upn}` — single-user drill-down
- `/m365/identity-defence/actions` — append-only enforcement ledger

### 9.2 Rule builder

Plain-language first. Operator picks a template ("Block sessions from outside our region"), the builder fills in conditions + actions, then exposes per-rule tweaks (which users to apply, which to exclude, rate-limit per day, mode).

### 9.3 Honest disclosure

Every rule card shows a tradeoff strip:

```
  Enforced ~5 minutes after detection.       │ CA equivalent: blocked at sign-in (0 s).
  Bounded by Mithras poll cadence.           │ Requires Entra P1 + custom CA policy.
```

Tooltip on hover explains *what specifically* gives the worst-case 5-minute latency.

## 10. Safety + threat model

### 10.1 What can go wrong

The single biggest risk is **catastrophic false positive** — Mithras revokes everyone's session at 9am Monday because of a buggy rule or a misread signal, and the customer's business stops. We have to design against this.

### 10.2 Guardrails

1. **Break-glass account exclusion** — required, enforced at rule-evaluator level. Every rule has an implicit exclude for any user tagged `break_glass: true` on the M365 tenant config. Operator can't disable this guardrail from the UI.
2. **Per-rule rate limit** — `rate_limit_per_user_per_day` defaults to 1 for new rules. Prevents a rule from revoking the same user 50 times in an hour.
3. **Per-org rate limit** — no rule may revoke more than 10% of the org's users in a single evaluation cycle. Hit the cap → all further actions in that cycle are downgraded to `notify_soc` and an emergency alert is raised.
4. **First-time rule cooldown** — when a rule is flipped from `report_only` to `enforce`, the first 24h has a global org-wide cap of N actions (configurable, default 5). Operator can lift after observation.
5. **Mandatory report-only-first for novel rule types** — operator can't create an `enforce`-mode rule for a condition kind never used in their org before; they get a forced 24h `report_only` window with a "Promote" CTA.
6. **Two-person rule for privileged-role rules** — rules that target the Global Admin role require approval by a second org admin before going live. Mirrors how CA's own admin-targeting rules need extra care.
7. **Kill-switch** — `/m365/identity-defence` has a big red "Pause all enforcement" button that flips every rule to `report_only` in one click. Logged + audited.
8. **Dry-run mode for the whole tenant** — admin can put the entire MID system in `report_only` indefinitely. Useful during initial rollout.

### 10.3 Audit

Every enforcement action writes to `identity_actions` with: rule id, evidence (which signals fired), action taken, operator/AI attribution, Graph response, outcome. Append-only, retained for 12 months.

## 11. Cost analysis

### 11.1 LLM cost

- Anomaly sub-scores in the risk model use the LLM. Per-user-per-cycle: ~1k tokens prompt + 200 tokens completion. At gpt-4o-mini list price ≈ $0.0003 per user per cycle.
- Worst case: 1,000 users on 5-min cycle = 288 cycles/day = $86/day per org. Need to **batch** users into multi-user prompts to drop this to ~$5/day per org at 1,000 users. Doable.
- Operator-facing rule-builder validations + natural-language-to-rule translation use an additional ~3k-token call per rule edit. Low volume.

### 11.2 Graph API quota

- `m365-poll-tenants` already exists at 5-min cadence; we piggyback its calls where possible.
- Per-user `mailboxSettings` reads: Microsoft's default throttling is 10k req/10 min per app per tenant. 1,000-user tenant at 5 min = 12k req/hour ≈ 33 req/min. Fine.
- `revokeSignInSessions` is rate-limited at 1 per 10 sec per user — well within our needs.

## 12. Phasing

### Phase A (MVP — 1-2 weeks of focused work)
- Tables: `identity_access_rules`, `identity_actions` (skip signals + risk score for v1; rules evaluate against snapshot polls)
- Three pre-built rule templates: revoke-on-mailbox-rule-add, revoke-on-impossible-travel, revoke-on-unmanaged-device
- Report-only mode for everything
- Rule list + simple builder UI
- Enforcement ledger view
- Kill-switch
- Honest disclosure UI strip

### Phase B (full risk score + signal store — 2-3 weeks)
- `identity_signals` + `identity_risk_scores` tables
- AI-driven risk score computation
- Per-user risk drill-down page
- Rule conditions reference risk score
- Full template library (10+ patterns)
- Two-person rule for privileged-role enforcement

### Phase C (advanced — polish + expansion)
- 60-second loop for "critical" rules
- Natural-language rule builder (operator types *"block Belarus"*, AI fills in the rule)
- MID-as-a-service for partners: distributor can ship a "recommended ruleset" to all their customer tenants in one click
- Identity Defence on the monthly customer report

## 13. Threat model summary

We are vulnerable to:

1. **Bad rule → mass false-positive lockout.** Mitigated by §10 guardrails. Not eliminated.
2. **Compromised M365 admin tampers with rules to disable enforcement.** Mitigated by writing all rule changes to `activity_logs` + SOC alert on rule-disable events. Not eliminated.
3. **Attacker races the 5-minute window.** This is the fundamental limitation. Disclosed clearly.
4. **Microsoft Graph API outage breaks enforcement.** Degrades to alerting. Identity-actions ledger captures the gap. Service status page flagged.
5. **LLM produces a wrong anomaly score, drives a wrong enforcement.** Mitigated by report-only-first + first-time-rule cooldown. Risk score is one input among many to a rule, not the sole gate.

## 14. Open questions for the customer / business owner

Things I want input on before building:

1. **Pricing model.** Is MID part of the $11/seat base, or a separately-priced add-on? Argument for bundled: differentiator vs Huntress/CrowdStrike. Argument for separate: this is a real second product and the LLM cost is material per-customer.

2. **MID-without-M365 connection.** Should we let customers who don't have an M365 tenant connected still see the value prop (educational marketing) or do we hide the page until they connect?

3. **Phase A scope.** Are the three pre-built templates the right three? Other candidates: revoke-on-Defender-critical, revoke-on-OAuth-grant-by-admin, daily-re-auth-for-role.

4. **Risk-score weights.** Defaults are guesses. Do we let resellers ship a per-customer-vertical weight preset (e.g. "professional services" vs "trades")?

5. **Two-person rule for privileged enforcement.** Is this the right friction? Some MSPs are one-person shops; this would block them entirely.

6. **Latency claim.** Worst-case 5 min on a 5-min poll. Is that the right number to put in marketing copy, or do we say "under 10 min" to leave headroom for upstream Graph slowness?

7. **Partner workflow.** Should resellers be able to push rules across their entire customer base in one action, or strictly per-customer? The former is faster; the latter prevents one bad reseller rule from nuking 30 tenants.

8. **Honest disclosure strength.** How prominently do we surface "this is not real CA"? Currently planned as a strip on every rule card and a footer on the page. Stronger? Weaker?

## 15. Naming

Options:

- **Mithras Identity Defence (MID)** — current working name. Clear scope.
- **Adaptive Access** — generic, marketable. Risk of conflating with Microsoft's own "Adaptive Access" branding.
- **Identity Guardrails** — accurate, but sounds smaller than the feature actually is.
- **Mithras Access Control (MAC)** — too close to MAC OS.

Recommendation: **Mithras Identity Defence**, abbreviated MID in code + URLs.

## 16. Decision

This spec stays in draft until the business owner has weighed in on the open questions in §14. Once those are resolved, Phase A goes into the BACKLOG as a single epic with the breakdown in §12.
