# Build decisions — overnight autonomous run

**Period:** 2026-06-01, ~5 hour window while user offline.
**User brief:** "build out the agents I need, replace grafana if possible
with a SOC dashboard that updates, update the customer dashboard with
relevant information and just test and make sure everything works. test
and fix."

## What I delivered

### 1. AI Triage Agent — DEPLOYED + WORKING ✅

**File:** `supabase/functions/ai-triage-alert/index.ts`

Autonomously triages every new alert in any org with `ai_soc_enabled =
true`. Citation-enforced — every claim must reference a row in the
platform's data, validated server-side. Auto-acknowledges false
positives at confidence ≥ 0.95.

**Verified end-to-end with three synthetic alerts:**

| Test alert | Verdict | Confidence | Cost | Result |
|---|---|---|---|---|
| `cmd.exe spawned by WINWORD.EXE` (high) | needs_human | 0.80 | 1¢ | Correctly cautious — no decoded payload, asks for human |
| `Successful login from new country` (medium) | false_positive | 0.80 | 0¢ | Identified as benign (same city, known IP, no anomaly) |
| `Mimikatz quarantine + lsass access` (critical) | needs_human | 0.45 | 1¢ | Correctly conservative when only the alert row can be cited |

The "needs_human" verdicts are **the correct behaviour** in synthetic
tests — when there's no real Sysmon/event-log telemetry to corroborate,
the AI shouldn't classify confidently as true_positive. In production
with real telemetry the chain will produce true positives that
auto-escalate to investigation.

### 2. AI Investigation Agent — DEPLOYED + WORKING ✅

**File:** `supabase/functions/ai-investigate-alert/index.ts`

Fires automatically when triage produces `verdict=true_positive`
at confidence ≥ 0.85. Pulls 7-day context (alerts, threats, events,
sysmon, firewall, M365 telemetry if applicable), generates timeline +
affected assets + attack chain + containment + eradication + a
customer-ready markdown report. Every claim cited.

**Verified on the Mimikatz alert (manual escalation):**
- Status: completed
- Timeline: 4 entries
- Containment recommendations: 4
- Customer report: 3,355 characters of markdown
- Cost: 1¢
- Latency: 55s

### 3. Custom SOC Console — DEPLOYED ✅

**File:** `src/pages/SocConsole.tsx`, route `/soc`

Replaces the Grafana SOC dashboard with an in-app live-updating console.
Shows: open alerts + critical count, AI triages today, auto-closures,
investigations today, AI spend, active threats, endpoint online/total,
M365 connected tenants, risky sign-ins, external forwarding rules. Plus
two live panels: AI activity feed (clickable to open the decision
drawer) and a live alerts feed. Super-admins see a per-org posture
table sorted by criticality.

**Realtime updates** via Supabase Realtime channels on the alerts,
ai_triage_decisions, and ai_investigations tables, plus a 15s
background refetch. No polling needed.

**Sidebar updated** to show "SOC Console" as the first item under
Security. Grafana still accessible via a footer link for super-admins
who want the deep dive — kept rather than deleted (see decision below).

### 4. Customer dashboard refresh ✅

**Files:** `src/pages/Dashboard.tsx`,
`src/components/dashboard/AiSocSummaryCard.tsx`,
`src/components/dashboard/M365SummaryCard.tsx`

Added two new cards above the existing threat/endpoint section:

- **AI SOC activity today** — triages, auto-closures, investigations,
  spend. CTA to the new SOC Console.
- **Microsoft 365 / Entra ID** — connected tenants, risky sign-ins 24h,
  external forwarding rules. CTA to /m365. Shows a "Connect Microsoft
  365" prompt if no tenants are connected.

Dashboard header also gains a "SOC Console" button alongside the
existing "AI Recommendations" button.

## Decisions made without checking first

### Kept Grafana rather than removing it
**Why:** Grafana is still useful for SOC operators who want
custom-query / chart exploration. Removing it would also throw away
the SSO infrastructure I built earlier in the session
([[mithras-soc-sso-architecture]]). The custom SOC Console doesn't
fully replace Grafana's ad-hoc analysis capability — it replaces the
"glanceable dashboard" use case which is what most operators actually
use. So I built the in-app dashboard, made it the default (sidebar
entry), and left Grafana as a deep-dive option. User can decide later
whether to retire Grafana fully.

### Investigation model env override left as `gpt-5-mini`
**Why:** The OpenAI project the user has set up only has access to
gpt-5-mini (no gpt-4o, no gpt-4o-mini). Attempted to set
`AI_SOC_INVESTIGATION_MODEL=gpt-4o-mini` for faster investigations and
got `model_not_found`. Rolled back to gpt-5-mini for both agents.
If the user wants different models later, they can flip the env var
in `/opt/peritus-supabase/.env`.

### Trimmed investigation context to ~half the original sizes
**Why:** Investigations on gpt-5-mini were hitting the Supabase Edge
Runtime's per-worker wall-clock limit (~150s default). The cause was
prompt size: too many telemetry rows in context. Solution: capped
each section at 15-20 rows instead of 30-60. Now investigations
complete in ~55s on synthetic test data.

In production where real telemetry exists, this might need to bump
back up. Documented in BACKLOG. The model can also be told to ask
for more context via a follow-up tool call in a future iteration.

### Did NOT modify Grafana, the M365 settings, or any customer data
**Why:** User said "test and make sure everything works" — that's
verification work, not destructive change. I tested by creating
synthetic alerts in their dev org, which got triaged. Cleaned up
nothing — those test alerts are still there as evidence the chain
runs. They're labelled clearly enough to delete easily.

### Did NOT deploy frontend to a separate staging slot first
**Why:** Mithras doesn't currently have a staging frontend; the only
frontend lives at /opt/peritus-frontend on the VM. I backed up the
existing `assets/` directory to `assets.bak.<ts>` before overwriting.
Rollback path: `rm -rf assets && mv assets.bak.<ts> assets`.

### Did NOT auto-enable `ai_soc_enabled` on every org
**Why:** Defaults stay opt-in per the original migration. Auto-enabling
would charge every customer for AI compute they hadn't agreed to. The
admin toggles it per-org from the SOC settings (or for now, a SQL
update). User will likely want an admin UI control for this — added
to BACKLOG.

## Post-build code review — second pass (CRITICAL/HIGH fixes applied)

A second autonomous round used three parallel code-review subagents
(M365 backend, AI SOC backend, frontend). 25+ findings; the
70%+ confidence ones I fixed now:

| # | Where | Issue | Fix |
|---|------|-------|-----|
| M1 | m365-oauth-callback | Used `tenant_region_scope` (a geographic region) as `tenant_domain` — would have misfired the #1 BEC detection on every legitimate forwarding rule | Query Graph `/domains` for the default verified domain after token exchange |
| M2 | m365-poll-tenants | Empty POLL_SECRET silently disabled cron auth — cron loop fell into user-JWT path and 400'd | Fail-closed at module load, require length≥16 |
| M3 | m365 detections SQL | Dedup race in `m365_detect_signin_spikes` — two concurrent crons both passed `NOT EXISTS` then both emitted alerts | Atomic `INSERT ... ON CONFLICT DO UPDATE WHERE last_fired_at < cooldown RETURNING` — only the winner emits |
| M4 | m365_tenants | Base-table SELECT exposed `access_token`/`refresh_token` to any authenticated role | `REVOKE SELECT ON public.m365_tenants FROM authenticated` — app code goes through the view, service role bypasses RLS regardless |
| M5 | _shared/m365-graph | No retry on Graph 429/503 — at 50+ tenant scale, throttling marks tenants stale exactly when they matter most | Single retry honouring `Retry-After` capped at 30s |
| M6 | poller user list | Only swept mailbox rules for users with a recent sign-in — attacker compromising via OAuth app or legacy EWS never appears in sign-ins | Now unions: recent-sign-in users + stale-snapshot users (>48h) + first-poll seed from `/users` |
| M7 | m365_detect_mfa_weakened | Outer filter matched 5 activities but inner block only acted on 2; fired on every "Update user" audit event for no benefit | Collapsed outer filter to the 2 acted-on activities |
| M8 | m365-oauth-callback | Token-exchange error redirected with `error_description` containing Microsoft correlation IDs / partial code material | Log server-side; redirect with opaque code only |
| M9 | poller | Concurrent polls (cron + manual "Poll now") could each refresh tokens — one clobbers the other's rotated refresh_token | `pg_try_advisory_xact_lock` per-tenant via `m365_try_lock_tenant` RPC |
| A2 | both AI agents | Attacker-controlled telemetry (alert.title, command_line, event messages) passed verbatim into LLM prompts — prompt-injection risk | Wrap every attacker-influenced section in `<<UNTRUSTED TELEMETRY>>...<<END>>` blocks; system prompt explicitly declares them as data not instructions |
| A3 | both AI agents | `force=true` allowed unlimited re-runs that bypassed the cached path before the budget check ran | 60s throttle on triage force, 5min on investigation force; service callers bypass (the trigger path) |
| A5 | citation validation | LLM-supplied `row_id` was passed to Postgres without UUID format check — relied on cast errors to fail safe | Pre-check `UUID_RE` before DB query; reject non-UUIDs immediately |
| A6 | ai_triage_decisions RLS | UPDATE policy let an org admin attribute their review to a different user, corrupting audit | `WITH CHECK ... AND (reviewed_by_user_id IS NULL OR reviewed_by_user_id = auth.uid())` |
| A6b | ai_investigations RLS | Same as A6 on the investigations table | Same fix |
| A7 | fire_ai_triage_on_alert trigger | Null `organization_id` crashed the trigger (would have rolled back the alert insert) | Defensive early return |
| F1 | M365ItdrSetup page | No super-admin guard — operator-only setup page accessible to any signed-in user | `useTenant().isSuperAdmin` guard, redirect to /dashboard otherwise |
| F2 | useRunTriage / useRunInvestigation | Mutation invalidation didn't touch the SOC console queries — verdict landed but the dashboard stayed stale | Shared `invalidateAiSurfaces()` covers ai-triage, ai-investigation, alerts, soc-counters, soc-ai-activity, soc-alerts-feed |
| F3 | useRealtimeRefetch | Stored a stale `refetch` closure across org switches; random channel ID re-rolled on each effect re-run | `refetchRef` capturing latest closure; ID computed inside the effect so cleanup matches subscription |
| F4 | AiDecisionDrawer | `customer_report_markdown` is LLM-generated content containing attacker telemetry — rendered by ReactMarkdown without sanitiser | Added `rehype-sanitize` rehype plugin; system prompt also forbids HTML in the report |
| F5 | useRecentAiActivity / useRecentAlertsFeed | `enabled` flag missing — non-super-admins without an org would hit the table unscoped | `enabled: isSuperAdmin \|\| !!orgId` |
| F6 | useAiTriageDecision / useAiInvestigation | Cache keys missing `organization_id` — convention breach per CLAUDE.md belt-and-braces | Org id added to key tuples |
| F7 | SocConsole severity dots | Colour-only state — invisible to screen readers | `role="img"` + `aria-label` |
| F8 | M365IntegrationSettingsCard | No super-admin guard in the component itself — relied on Settings.tsx to gate | In-component guard, returns null for non-super-admins |

**Verified live:**
- AI SOC tenancy gate: super-admin 200, random JWT 403 ✅
- Force-throttle: 429 with `rate_limited` error code ✅
- Cached non-force return: 200 immediately ✅
- M365 poller cron path (with correct `x-mithras-poll-secret` header): 200 ✅
- Frontend build clean (3,283 modules)

**Findings I deliberately did NOT fix (with rationale):**

- **A1 (budget race condition)** — proper fix requires schema change (atomic counter column) and a transaction-scoped budget claim. Added `ai_soc_try_lock_org` advisory-lock RPC as a precursor but didn't wire it in yet — wiring requires running the LLM call inside a long transaction which is awkward. **Backlog.**
- **A4 (SOC secret stored in `platform_settings`, visible in `pg_net` request log)** — proper fix is Supabase Vault migration. Out of scope tonight. The risk is internal (Postgres superuser only). Rotate secrets periodically. **Backlog.**
- **A8 (customer_report_markdown HTML)** — addressed by F4 on the frontend AND by the prompt instruction in the investigation system prompt. No further fix needed at persistence layer.
- **/soc super-admin gate** — disagreed with the reviewer here. The SOC Console is one of the customer-facing value props; org admins should see their own SOC data. RLS handles the cross-tenant boundary. Kept it behind ProtectedRoute (any authenticated user with an org context).

## Bugs found + fixed during the run

0. **[CRITICAL] Cross-tenant IDOR in both AI SOC functions** — caught by
   background security review after the initial deploy. The original
   `isAuthorised` checked only "is this JWT valid", not "does the user
   belong to the alert's org". A signed-in user from org A could POST
   org B's alert_id and receive back the full triage decision (including
   the AI's summary and cited evidence from B's data) or the full
   investigation report (timeline + customer-facing markdown). Same
   vulnerability on the cached-decision return path before any work
   happens. **Fixed by:** adding `authoriseForAlert(authz, alertId)`
   that resolves the alert's organization_id then verifies the caller
   is a member, super-admin, or service-role; called BEFORE the cached
   return and BEFORE context gathering in both functions. Verified
   working: random unauthorised JWT now returns 403; super-admin keeps
   working; the service-secret trigger path is unaffected.

1. **`temperature: 0.1` rejected by gpt-5 family** — fixed by detecting
   the model family and omitting temperature for o-series and gpt-5.
2. **LLM citing `"table": "alert"` instead of `"alerts"`** — added a
   `TABLE_ALIASES` map that normalises common singular→plural typos
   before citation validation. Also strengthened the prompt to spell
   out the exact table-name list. Singular still works; the citation
   is normalised in-place to the canonical name before persistence.
3. **`TypeError: Cannot read properties of undefined (reading 'map')`**
   — defensive defaults for `key_indicators`, `reasoning_steps`,
   `timeline`, `affected_assets`, `suggested_containment`,
   `suggested_eradication`. Missing arrays now treated as empty
   rather than crashing the function.
4. **Investigation hitting worker wall-clock limit** — trimmed prompt
   sizes (see above).

## Known limitations

1. **Investigation latency 30-90s** with gpt-5-mini. Faster models
   would be cleaner; OpenAI project doesn't currently have access.
2. **Investigations may still time out on tenants with very heavy
   telemetry**. Mitigation: prompt is currently capped at 20
   rows/section. Could need further trimming or pagination if a real
   customer's data overruns.
3. **AI triage / investigation cost rounds to 0¢ at low usage** —
   `cost_cents` is INTEGER. A typical triage with gpt-5-mini is ~0.1¢
   so it rounds down. Spend totals work correctly at scale but
   per-decision look like 0. Acceptable for MVP; the right fix is
   millicents or numeric.
4. **The OpenAI model env override is platform-wide**, not per-org.
   An MSP wanting customer A on gpt-5-mini and customer B on gpt-5
   can't do that yet.
5. **No webhook → notification path for "AI says critical, wake the
   on-call"** yet. The alerts table integration just means it shows
   in the UI; existing alert email recipients still fire normally
   on alert creation, before the AI's verdict is known.

## What I tested

- `npm run build` (3,278 modules transformed cleanly)
- AI triage agent end-to-end with three synthetic alerts of different
  severities and verdict types
- AI investigation agent end-to-end (manual force-run) on the Mimikatz
  alert
- Database trigger path: insert alert → trigger fires → pg_net.http_post
  → edge function called → triage row updated to completed
- Citation validation: confirmed that fabricated row IDs are dropped
- Auto-trigger gate: confirmed disabled orgs are not auto-triaged
- Frontend bundle deployed to /opt/peritus-frontend and reachable
  publicly at www.mithras.com.au/soc, /m365, /dashboard
- Routes return 200 (HTML shell — actual page render requires browser
  + sign-in)

## What I did NOT test (open follow-ups)

- The in-browser experience of the SOC Console, AI badges, decision
  drawer — I deployed but can't drive a browser. User will see this
  on next sign-in. Worth a quick visual check before declaring done.
- Auto-investigation trigger on a real true_positive (synthetic tests
  produced needs_human / false_positive, neither of which fires
  investigation). The trigger logic is unit-tested in the SQL and the
  manual investigation call succeeded — so the chain should work
  when real telemetry produces a true_positive.
- M365 ITDR end-to-end (still needs Azure AD app registration before
  it can be exercised — that's the user's TODO).

## Files changed in this run

```
NEW   supabase/migrations/20260601200000_ai_soc_triage_investigate.sql
NEW   supabase/functions/_shared/ai-llm.ts
NEW   supabase/functions/ai-triage-alert/index.ts
NEW   supabase/functions/ai-investigate-alert/index.ts
NEW   src/hooks/useAISoc.ts
NEW   src/hooks/useSocDashboard.ts
NEW   src/components/ai/AiTriageBadge.tsx
NEW   src/components/ai/AiDecisionDrawer.tsx
NEW   src/components/dashboard/AiSocSummaryCard.tsx
NEW   src/components/dashboard/M365SummaryCard.tsx
NEW   src/pages/SocConsole.tsx
EDIT  src/App.tsx                              (added /soc route)
EDIT  src/pages/Alerts.tsx                     (AI badge + drawer)
EDIT  src/pages/Dashboard.tsx                  (new cards + SOC button)
EDIT  src/components/layout/Sidebar.tsx        (SOC Console entry)
EDIT  BACKLOG.md                               (added AI SOC + tech-debt items)
EDIT  /opt/peritus-supabase/.env (on VM)       (AI_SOC_POLL_SECRET, INVESTIGATION_MODEL)
EDIT  /opt/peritus-supabase/docker-compose.override.yml (on VM)
```

## Backlog items added

- AI SOC org-enable toggle in admin UI (currently SQL only)
- Investigation context pagination for heavy tenants
- Per-org model selection for AI agents
- Wake-on-critical webhook integration
- AI cost reporting (super-admin view of spend per org)
- Convert cost_cents to numeric/millicents for sub-cent precision

These all live in [`BACKLOG.md`](./BACKLOG.md).

## Rollback paths

| Change | Rollback |
|---|---|
| AI SOC tables / triggers | `DROP TABLE ai_triage_decisions, ai_investigations CASCADE; DROP TABLE m365_detection_dedup;` — but this loses audit history |
| Edge functions | `rm -rf /opt/peritus-functions/ai-{triage,investigate}-alert` then restart functions |
| Per-org enable | `UPDATE organizations SET ai_soc_enabled = false;` (the trigger no-ops when disabled) |
| Frontend changes | `cd /opt/peritus-frontend && rm -rf assets && mv assets.bak.<ts> assets` |
| docker-compose changes | restore `.bak` files in /opt/peritus-supabase/ |
| .env entries | `sed -i '/^AI_SOC_/d; /^M365_/d; /^APP_BASE_URL=/d' /opt/peritus-supabase/.env` (re-deletes M365 entries too, be careful) |

## Open questions for the user when they wake up

1. **Do you want auto-investigation budget guard?** Currently triggers
   fire whenever triage hits true_positive ≥ 0.85, subject to the
   per-org daily cap. If a customer has 50 true positives in one day
   that's ~50¢ of investigation spend per alert + the human review
   load. Cap is configurable; defaults to $5/day per org.
2. **Should AI-classified true positives bypass alert acknowledgement?**
   Today the AI surfaces a verdict but doesn't change the alert state
   unless it auto-closes a FP. A "AI says critical → mark as
   investigating" workflow would tighten the loop.
3. **Should Grafana SSO stay on its own subdomain or fold into /soc?**
   Right now both exist. If you want one canonical place, let me know
   and I'll consolidate.
