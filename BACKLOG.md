# Mithras Threat Defence — Backlog

Open work items deferred from prior sessions. Add to this list whenever
something is surfaced but parked. When you ask me for "the backlog" I'll
read this file.

For the broader product roadmap (Phases 2-5 of agent modernisation, SOC 2,
backups, HA/DR, customer portal, incident workflow) see the canonical entry
in `CLAUDE.md` and the design docs under `docs/superpowers/`.

---

## Marketing & SEO

- [ ] **Prerender marketing routes** with `vite-react-ssg` so non-Google
  crawlers (Bing, LinkedIn, Slack, Twitter) see real HTML instead of an
  empty `<div id="root">`. Today the static OG tags in `index.html` are the
  social-preview backstop; that's adequate but not bulletproof.
- [ ] **Wire up analytics** — GA4 or Plausible or Fathom. Right now there's
  no way to measure landing-page conversion or which blog posts pull
  traffic.
- [ ] **Blog cadence** — one new post every 2-3 weeks. Current 4 posts
  are a launch set; long-tail SEO needs ongoing volume. Topic candidates:
  - ASR rules deep-dive (per-rule what-it-blocks + when to leave audit-mode)
  - WDAC for SMBs without an MDM
  - DNS filtering vs full secure-web-gateway
  - "What a monthly security report should actually contain"
  - Incident response checklist for an MSP with no SOC
- [ ] **Social-proof block** — currently deliberately skipped because there
  are no real customers to quote. Reinstate the moment first paying
  customer agrees to be named (logos, testimonials, deployment numbers).
- [ ] **Status page automation** — `/status` is hand-maintained today.
  Replace with a real uptime probe feed (Better Stack, statuspage.io, or a
  self-hosted Upptime).
- [ ] **OG image polish** — current `og:image` is the icon. Build a proper
  1200×630 social card with the wordmark + tagline.
- [ ] **Stripe Checkout for self-serve paid plans** — `/signup` is trial
  only today. Add real card-on-file checkout, webhook-driven
  plan-provisioning, and tax handling.
- [ ] **app.mithras.com.au DNS** — currently not resolving; frontend lives at
  `www.mithras.com.au`. Either point `app.` at the frontend or remove the
  reserved entry from CORS allow-lists.

## M365 ITDR — finish the rollout

Built + deployed 2026-06-01. Spec: `docs/superpowers/specs/2026-06-01-m365-itdr-mvp.md`.

- [ ] **Register the Azure AD multi-tenant app** in your Mithras Azure
  tenant. Full step-by-step in-app at `/guides/m365-itdr-setup`. Once
  done, paste client ID + secret + redirect URI into Settings.
- [ ] **Push the frontend** — `npm run build` + sync `dist/` to
  `/opt/peritus-frontend/` so the new `/m365` and Identity sidebar entry
  go live.
- [ ] **Smoke-test** by connecting your own M365 tenant and clicking
  "Poll now". Optionally create a deliberately-bad forwarding rule or
  high-risk OAuth consent to confirm detections fire.
- [ ] **Build remediation action buttons** — the elevated consent flow
  is wired but the "Disable forwarding rule" / "Revoke OAuth grant" /
  "Force re-MFA" UI buttons aren't. Phase 2.
- [ ] **Per-source alert routing** — m365 alerts currently flow through
  the same notification rules as endpoint alerts. May want separate
  routing eventually.

## SOC SSO & Grafana

- [ ] **OIDC / OAuth2 for Grafana** — current architecture (Caddy
  cookie→header proxy in front of Grafana 13) works end-to-end but is
  unusual. The cleaner long-term architecture is Grafana's native OAuth2
  generic provider against Supabase as the IdP. See
  [[mithras-soc-sso-architecture]] for the current chain.
- [ ] **`accounts@peritusdigital.com.au` provisioning** — account doesn't
  exist in `auth.users` today. Decide whether to create it (and which
  deployment — replica VM only, per the no-cloud-changes constraint) or
  drop it as a stale email reference.

## Security / Hardening — deferred from 2026-06-01 review

- [ ] **A1 — atomic AI SOC budget** — current cap can be raced past by
  concurrent calls. Add `organizations.ai_soc_used_cents_today` and
  decrement-then-call atomically. Advisory-lock RPC
  `ai_soc_try_lock_org` is already in place as a stopgap.
- [ ] **A4 — move AI SOC + M365 secrets to Supabase Vault** — currently
  stored in `platform_settings` and visible in `pg_net._http_request`
  history to any Postgres superuser. Vault-encrypts at rest.
- [ ] **`/soc` super-admin gate revisit** — review of 2026-06-01
  recommended super-admin-only. Kept as any-authenticated for now
  (org admins should see their own SOC data, RLS scopes). Decision
  worth a second look once real customers are on.
- [ ] **Org-switch query cache invalidation** — review flagged that
  TanStack Query serves prior-org data during the ~15s refetch window.
  Mitigation: `TenantContext.switchOrg` should `qc.removeQueries`
  matching `soc-*` / `ai-*` / `m365-*`. Frontend ergonomic improvement.

## Security / Hardening (deferred from review)

- [ ] **Rotate the bridge HMAC secret** on a schedule (currently a static
  env var). Add a `kid`-aware second key so rotation is non-breaking.
- [ ] **Rotate M365_STATE_SECRET and M365_POLL_SECRET** on a schedule
  (state secret rotation invalidates in-flight consents for ≤15 min;
  poll secret needs `.env` + `platform_settings.m365_poller_secret`
  updated together).
- [ ] **Audit other edge functions** for the same CORS hardening
  pattern just applied to soc-bridge (specific origins + credentials only
  for secure contexts).
- [ ] **Audit every public view** for `security_invoker=true`. Default
  Postgres behaviour is `security_definer` which silently bypasses RLS
  on the underlying tables — the M365 view bug 2026-06-01 caught this.
  Any other view created over an RLS-protected table needs the same
  treatment.

## AI-augmented SOC (the path that actually competes with Huntress)

Strategic answer to "why do we need a human SOC when we have AI": we
don't need a full Huntress-style human SOC, but we DO need 1-2 humans on
rotation holding accountability + handling escalations. The wedge is
"AI does 80% of the triage, humans handle judgment + customer relations
+ liability." Materially halves the unit economics of running a SOC.

Build sequence (~10-12 weeks total):

- [ ] **AI Triage Agent** — runs on every new alert. Pulls full context
  (endpoint state, recent telemetry, similar past incidents). Classifies
  real vs FP with a confidence score. Auto-closes FPs > 0.95.
  Escalates everything else.
- [ ] **AI Investigation Agent** — for escalations, autonomously builds
  the incident timeline + affected-asset list + draft report. CITED
  EVIDENCE ONLY — refuse to claim anything not in the platform data.
  This is the single most important rule for trust and defensibility.
- [ ] **AI Customer Notification drafter** — generates the customer-
  facing email + Slack message in MSP brand voice. Human approve-and-
  send for critical incidents.
- [ ] **AI Hunt Agent** — continuous hypothesis-based hunting per
  tenant. Weekly findings report. Hypotheses derived from current TTPs
  + customer-specific telemetry patterns.
- [ ] **Human-in-the-loop console** — every AI decision needs a review
  surface even if the review is just "approve all." Compliance, audit,
  and the gradual trust-gradient toward more autonomy depend on this.
- [ ] **Hire 1-2 analysts** (or founder-as-analyst initially) — handle
  escalations, sign off on critical containment, talk to customers
  during real incidents, curate signatures from real-world findings,
  hold E&O liability.

**Marketing framing — what to call it:**
- ✓ "AI-augmented analyst team" / "Our AI does the triage your analyst
  would have done by hand" / "Our analysts review every escalation"
- ✗ "Autonomous AI SOC" / "No humans" — sounds like Skynet, scares
  customers, fails insurance/compliance reviews

## Competing with Huntress (strategic gaps)

The three structural gaps that prevent head-to-head competition. See
session-2026-06-01 conversation for full analysis.

- [ ] **Pick a SOC strategy** — without humans-in-the-loop, "compete with
  Huntress" means competing on a different axis (tool vs. service). Three
  paths: (a) build a SOC team, (b) white-label an AU managed-SOC partner,
  (c) stay tool-only and target MSPs with their own SOC capability. Pick
  one explicitly — the current pricing assumes (c) but the marketing
  positioning implies more.
- [ ] **Microsoft 365 / Entra ID threat detection (ITDR)** — single
  highest-ROI new capability. Account takeover, malicious mailbox rules,
  OAuth grant abuse, impossible-travel logins, BEC. Mostly API-driven —
  doesn't need humans. Huntress's fastest-growing line.
- [ ] **Persistent foothold rule pack** — agent already collects
  persistence telemetry via `collect_persistence`. Missing is the curated
  rule library that flags "this scheduled task is a Cobalt Strike beacon"
  / "this registry Run key is suspicious." Content work, not platform.

Next tier (useful, not existential):

- [ ] **Ransomware canary files** — decoy files that alert on touch.
  Cheap to build, great demo, marketing-friendly.
- [ ] **macOS agent** — Huntress has it; we're Windows + Linux only.
  Large lift; defer until customer demand is concrete.
- [ ] **Managed SIEM** — cloud log ingest from M365, Google Workspace,
  network gear; retention; search; alerts. Pairs with ITDR.
- [ ] **External attack surface scan** — exposed RDP, leaked credentials,
  open ports. Pairs well with microsegmentation messaging.
- [ ] **Compliance report templates** — Essential Eight, ACSC ISM,
  ISO 27001 control mapping. Content work — high MSP marketing value.
- [ ] **PSA/RMM integrations** — ConnectWise, HaloPSA, Autotask,
  NinjaOne, Datto RMM. Each is a sprint; prioritise by which MSPs ask.
- [ ] **MSP partner program** — NFR licenses, deal registration,
  co-marketing fund, NFR partner portal. Sales motion, not engineering.
- [ ] **Resell a security-awareness-training product** — don't build,
  white-label (KnowBe4, Curricula, usecure). Bundle into MSP plan.

Don't drop (these are the actual wedge vs. Huntress):

- Microsegmentation at the Windows Firewall layer
- EOL Windows hardening
- WordPress site protection
- AU data residency / built-in-Brisbane positioning
- Lower per-endpoint price

## Competing with paid EPP/EDR (Defender P1/P2, McAfee/Trellix, CrowdStrike, S1, Sophos, Bitdefender, ESET)

Filtered by "would move the needle for Path A (niche dominance) strategy."
The full list (~35 items) was discussed in session-2026-06-01. Items here
are the subset that actually matter if we're NOT trying to be a full EDR.

Table-stakes gaps to close (won't survive RFPs without these):

- [ ] **macOS agent** — ~25% of AU SMB fleets have a Mac. Currently
  disqualifying for mixed-platform deals. Largest single capability gap.
- [ ] **Behavioural detection engine** — not just Defender's. Our own
  ruleset for tradecraft (LOLBins, suspicious PowerShell, credential
  dumping). Pairs with the [persistent foothold rule pack] from the
  Huntress section.
- [ ] **EDR-grade telemetry retention** — 30 days of process trees,
  network connections, file events, queryable. Today we collect some,
  storage and search aren't there.
- [ ] **Advanced hunting query language** — KQL-style query over
  endpoint telemetry. Without it, no SOC analyst adopts the tool.
- [ ] **Ransomware rollback** — VSS-based or driver-based file recovery
  after behavioural detection. SentinelOne's entire valuation rests on
  this single feature. Strong demo material.
- [ ] **Disk encryption management (BitLocker key escrow)** — auditors
  will ask. Small implementation lift.
- [ ] **USB / device control policy** — Defender has primitives, we
  don't yet expose policy management for it.
- [ ] **URL-level web filtering** — we have DNS filtering; URL category
  blocking is the natural next layer.

Premium-tier (only if pricing moves up):

- [ ] Automated investigation & response (AIR)
- [ ] Sandbox / detonation for unknown files
- [ ] DLP (Data Loss Prevention)
- [ ] Mobile threat defense (iOS / Android)
- [ ] Cloud workload protection (CWPP) for AWS/Azure VMs
- [ ] Identity threat detection for on-prem AD (separate from M365 ITDR
  in the Huntress section)
- [ ] Third-party patch management (Adobe, Chrome, Firefox, Java)
- [ ] Threat intelligence enrichment (VirusTotal / AbuseIPDB / OTX)
- [ ] Real-time response shell into endpoints

Operational maturity (gates enterprise deals):

- [ ] **SOC 2 Type II** — already in CLAUDE.md roadmap; surface earlier
- [ ] **ISO 27001** — required for AU government / regulated SMB
- [ ] **HIPAA / PCI-DSS attestation** — depends on customer base
- [ ] **24/7 support** with documented SLAs
- [ ] **Customer Success program** — named CSM over $X account size
- [ ] **Implementation services** — paid onboarding for 500+ endpoint deals

The wedge — these are why anyone chooses us over the above:

- Microsegmentation at the Windows Firewall layer (no paid EDR does this)
- EOL Windows hardening (every paid EDR dropped Win7/8.1)
- WordPress site protection (not in any EDR)
- AU sovereignty / on-prem deployment option (CrowdStrike won't deploy
  to your DC; we will)
- Sub-$5/endpoint pricing on a real multi-tenant platform

## AI SOC operational state

**Rollout strategy (decided 2026-06-01):** Option C — leave AI SOC dark
by default, enable per-customer as they sign onto the AI add-on tier.
Code is production; only `organizations.ai_soc_enabled = true` orgs are
auto-triaged. Defaults: cap = $5/day per org.

**Enable a customer:**
```sql
UPDATE organizations
   SET ai_soc_enabled = true,
       ai_soc_daily_cap_cents = 500
 WHERE name = '<Customer Name>';
```

**Currently enabled orgs:** Peritus Digital (test, $50/day cap). All
9 other production orgs are dark.

**Pre-enable checklist (per customer):**
1. Written notification + reference to privacy policy
2. Decide daily cap based on expected alert volume
3. Run the SQL above
4. Watch first 24h on /soc before committing to scale

## AI SOC follow-ups (from 2026-06-01 build)

The AI Triage + Investigation agents shipped MVP. Items here are the
known limitations and next-step polish, captured at handover.

- [ ] **Admin UI toggle for `ai_soc_enabled`** — currently set via SQL.
  Per-org card in Settings → Org management or in the admin → org
  detail view. Higher priority now that Option C is the rollout
  strategy — manual SQL gets tedious past 5-10 customers.
- [ ] **Per-org model selection** — `openai_model` is platform-wide.
  An MSP with mixed customers may want different models per org for
  cost or capability reasons.
- [ ] **Investigation prompt pagination** — when real customers have
  heavy telemetry the 7-day window × 20 rows/section cap will hit the
  edge-runtime worker wall-clock limit. Either trim further, paginate,
  or move to a tool-use flow where the LLM asks for the rows it wants.
- [ ] **Cost precision** — `cost_cents` is INTEGER. A single triage on
  gpt-5-mini rounds to 0¢. Move to millicents or numeric to make
  per-decision costs visible.
- [ ] **AI cost-spend reporting** — super-admin view of total AI spend
  per org per day/month with a graph. Right now the per-org cap exists
  but the operator has no consolidated view.
- [ ] **Wake-on-critical webhook** — when AI Investigation produces a
  critical verdict, send a webhook (Slack / PagerDuty / generic). Today
  AI verdicts only update the in-app feed; existing email
  notifications fire on alert creation before the AI weighs in.
- [ ] **AI-classified true positives bypass acknowledgement** — today
  the alerts table acknowledgement is separate from the AI verdict.
  Consider auto-marking AI true positives as "investigating" until a
  human closes them.
- [ ] **Decide Grafana fate** — custom SOC Console covers the
  "glanceable" use case. Grafana is still there for ad-hoc query +
  custom charts. Either retire fully or formally keep as the deep-dive
  surface. Current state: both exist; sidebar points at /soc, footer
  has Grafana link for super-admins.

## Tech debt

- [ ] **2.3 MB main JS bundle** — split via `manualChunks` or route-level
  `React.lazy()`. Affects landing TTI on slow networks.
- [ ] **`postcss` / browserslist data is 12 months old** — `npx
  update-browserslist-db@latest` next time the toolchain is touched.

---

## Remote Desktop / MeshCentral (Phase A shipped 2026-06-04)

- [ ] **Agent populates `endpoints.mesh_node_id` automatically.** Today it's
  set manually via SQL after MeshAgent enrols (see migration
  20260604000000). Need a small agent module that reads MeshAgent's
  node identity (registry: `HKLM\SOFTWARE\Open Source\MeshAgent` or the
  MeshAgent.db file) on each heartbeat and ships it in the payload;
  `agent-heartbeat` stamps it onto the row. Until shipped, operators
  land on the MeshCentral home page and pick the device by hostname
  instead of deep-linking to the desktop tab.
- [ ] **MeshCentral SSO from SOC console.** Today operators log in to
  MeshCentral once per browser session with their MeshCentral account.
  Phase B: `mesh-session-start` calls `meshctrl GenerateLoginCookie`
  via a sidecar service on docker02 and returns a single-use
  `?login=<cookie>` URL. Requires:
    1. Per-operator MeshCentral accounts auto-provisioned (currently a
       shared `mithras_admin`).
    2. Tiny Express sidecar in the meshcentral compose that wraps
       meshctrl behind a shared-secret HTTP endpoint.
- [ ] **`ignoreAgentHashCheck: true` is set in MeshCentral config.** This
  disables MeshAgent's pinning of the server cert hash — necessary
  because NPM presents an LE cert that MeshCentral can't see. The
  proper fix is either to pass through TLS to MeshCentral (NPM in
  passthrough mode) or to programmatically configure MeshCentral with
  the LE cert hash on every LE renewal. Low-risk today (we still get
  TLS; just no cert pinning), but worth fixing before this becomes the
  remote-access path for non-Peritus tenants.
- [x] **MeshAgent install removes existing tunnel commands.** Done
  2026-06-04. `open_remote_tunnel` / `close_remote_tunnel` dropped from
  CommandExecutor in v0.7.3; agent_commands queue checked at teardown
  time - zero queued/dispatched of those types, so nothing to cancel.
- [x] **Tear down stale Guacamole + chisel stacks on docker02.** Done
  2026-06-04. All 4 containers stopped + removed
  (`peritus-guacamole`, `peritus-guacd`, `peritus-guac-pg`,
  `peritus-chisel`), orphan `peritus-guacamole_guacnet` network removed,
  `/opt/peritus-guacamole` and `/opt/peritus-chisel` renamed to
  `.removed.<ts>` (recoverable for 14d, then delete).
  `infra/peritus-guacamole/` and `infra/peritus-chisel/` removed from
  repo. Dead `supabase/functions/remote-desktop-start/` (never deployed,
  not in config.toml) also deleted.
- [ ] **`remote_desktop_sessions.status` lifecycle.** Today the row is
  inserted as `initiated` and never transitions. Either:
    1. Add a `mesh-session-end` edge function the frontend calls when
       the operator closes the MeshCentral tab (clean), OR
    2. Run a cron that marks `initiated` rows older than
       `duration_seconds` as `expired` (sloppy but zero-frontend).
  Without one of these the active-session index is meaningless.

---

## Batch 11c — surfaced but not auto-fixed (2026-06-07)

Ten /loop iterations on 2026-06-07 (early-morning UTC) found a stack of
small-but-real issues. Most got fixed and verified live; the items below
are the ones I deliberately deferred because they need a product call,
bigger scope, or a manual deploy.

- [ ] **AI triage timeout rate — pick model + budget**. With `gpt-5-mini`
  the average successful triage takes 38s, max 44.9s, against a 45s
  `AbortSignal.timeout` inside a 60s edge-runtime wall-clock. Result:
  52% of triages fail with `Signal timed out`. Two cheap fixes, both
  product calls: switch the default in `platform_settings.openai_model`
  to `gpt-4.1-mini` (faster but lower reasoning quality), or raise
  `EDGE_RUNTIME_REQUEST_TIMEOUT_MS` on the `supabase-edge-functions`
  container and bump `timeoutMs` in `ai-triage-alert/index.ts` to 90s.
  Stuck-row reaper is already in place — see migration
  `20260607030000_expire_stuck_ai_triages.sql`.
- [ ] **Agent upgrade nudge → bulk action**. 7 of 10 active endpoints are
  on 0.4.5–0.7.9 even though current is 0.7.10, because v0.6.6
  deliberately removed self-upgrade and there's no UI/cron to push
  `upgrade_agent` to "everyone < latest". Either auto-issue from a
  daily cron (security trade-off — surprise rollouts) or add a "Push
  upgrade to all out-of-date" bulk button to `/admin/endpoints`.
- [ ] **WDAC policy XML schema fix needs new agent bundle**. Fixed in
  `agent/runtime-powershell/lib/WdacEnforcer.psm1` lines 122 & 129
  (added `<CertRoot Type="Wellknown" Value="06" />` before
  `<CertPublisher>`). Without this the WDAC apply hangs with
  `invalid child element 'CertPublisher'` and no endpoint can ever
  enforce. Requires: build new agent ZIP, bump `agent_versions`,
  push `upgrade_agent` commands to the 3 audit-assigned endpoints.
- [ ] **WordPress brute-force detection wiring**. 60 `login_failed`
  events on `dev6.peritusdigital.com.au` in last 24h generated 0
  alerts. No trigger or cron converts site events into alerts. Build:
  threshold rule (e.g. ≥10 fails/hour from one site), new
  `alert_type = 'wp_brute_force'`, hook into the existing
  `notify-alert` pipeline.
- [ ] **Customer-report retry-send cron**. The pipeline now works
  end-to-end (PDF generation + email delivery verified on report
  `99a715e6-…`), but if `send-customer-report` fails after
  `generate-customer-report` marked the row `ready`, nothing retries.
  Add: a cron that picks up `status='ready' AND sent_at IS NULL`
  rows older than N minutes and re-fires the send.
- [ ] **Customer-report missed window (Jun 1–6) — backfill?** The
  weekly/monthly enqueue crons failed silently for 6 days before
  `20260607020000_customer_reports_enqueue_fix.sql`. Customers got no
  reports for that window. Backfilling would deliver PDFs with stale
  dates; explicit non-backfill is also a fine choice. Decide.
- [ ] **PDF builder failures investigation**. 6 of 7 `ready` reports
  pre-fix had no `pdf_storage_path` — `buildReportPdf` silently
  errored, log was just `console.error("pdf render failed:", …)`.
  Test fresh-queue verified the path works post-fix-deploy, but the
  earlier failures' root cause (likely a font/asset load that the
  deno isolate's sandbox blocked at some point) wasn't traced.
- [ ] **Linux agent on docker02 still v0.1.0**. Heartbeats are now
  clean (edge-function coercion handles its uptime float +
  protocol-key mismatch + wildcard bind addr), but the runtime is
  pre-Mithras and won't pick up new modules. Either upgrade or
  decommission.
- [x] ~~**m365 ITDR Premium-licence polling silencing**~~. Shipped
  2026-06-12: `m365_tenants.signin_audit_supported` column +
  poller catches `NonPremiumTenant` 403 and flips the flag, future
  cycles skip both `/auditLogs/signIns` and `/directoryAudits`
  entirely. Flag flipped on the one connected non-premium tenant
  on first poll after deploy. Operator can flip it back to `true`
  to re-probe after a Premium upgrade.
- [ ] **Agent .exe Mithras brand (task #131)**. Still pending — needs
  the C# launcher work to embed the icon + signature.

### What was fixed in this batch (already live)

For trail purposes — these are now in production and don't need follow-up:
- M365 Posture admin page error UI; AdminResellers error UI
- Login forgot-password double-submit guard
- SMTP test-recipient field clear on success
- Landing copy: "Real-time AV" honesty / Linux parity honesty / microseg
  cadence honesty / Defender FAQ
- Stylised landing mockups with synthetic data (no customer leaks)
- Linux heartbeat: `uptime_seconds` float→bigint coercion +
  `linux_listening_ports` protocol/port/bind_addr normalisation
- `agent-api` WDAC RPC `.catch()` TypeError swallow
- `organizations.stripe_subscription_id` + `home_user_email` partial
  UNIQUE indexes (Stripe webhook idempotency under concurrent delivery)
- `enqueue_customer_reports()` ON CONFLICT predicate + partial unique
  index — weekly/monthly enqueue crons now fire successfully
- `maybeSendReport` kind→column mapping (weekly/quarterly subscribers
  no longer silently ignored)
- `generate-customer-report` → `send-customer-report` URL prefix
  (was missing `/functions/v1`, 401'd at Kong)
- `mithras-expire-stuck-ai-analysis` reaper cron (5 min) for
  `ai_triage_decisions` + `ai_investigations`
- M365 `tenant_display_name` + `tenant_domain` populated via
  `/organization` at consent time and refreshed every poll
- M365 `last_poll_error` doubled-prefix (`signins:signins:…`) cleaned
- Hardening profiles trigger + backfill (57 profiles across 19 orgs)

---

## Platform-wide review wave (2026-06-08)

Multi-dimensional parallel review surfaced 100+ findings across frontend, edge
functions, database, and copy. The high-confidence subset was triaged and
shipped in waves (1–7). The items below were deferred for one of three reasons:
they're feature-additions rather than bugs, they need careful per-function
testing that doesn't fit a bulk pass, or the reviewer's claim was a false
positive that needs more nuanced handling.

### Deferred for safety / scope

- [ ] **Route remaining LLM callers through `ai_llm_calls` ledger**. The 3
  callers using `callLlmStructured` (triage, investigation, posture_advisor)
  log to the ledger. The 5 remaining callers (`cve-auto-scan`,
  `cve-mitigation-advisor`, `cve-auto-protect`, `ai-security-advisor`,
  `ai-triage-incident`, and `generate-customer-report`'s two exec-summary
  helpers) use raw `fetch()` to OpenAI or the Lovable AI gateway and bypass
  the ledger entirely. Migrating each one needs: choosing a `feature` tag,
  threading `organizationId`, and verifying the response-shape is compatible
  with `callLlmStructured`'s strict JSON-schema path (some use `json_object`,
  not `json_schema`). Pure scope, no risk in the gap.
- [ ] **CORS shared lib for cve-* + vulnerability-scan**. Currently use
  wildcard `Access-Control-Allow-Origin: *`. Works fine because they're
  only called via `supabase.functions.invoke` which mediates CORS — but
  switching to `_shared/cors.ts` would match the project's documented
  credentialled-CORS policy. Mechanical change; not urgent.
- [ ] **`ai-triage-incident` + `generate-customer-report` exec-summary
  paths missing AbortSignal.timeout**. Hung OpenAI connections will burn
  the edge-function wall-clock budget. Add `signal: AbortSignal.timeout(45_000)`.
- [ ] **`ai-security-advisor` service-key misuse**. Function creates a
  service-role client for both `auth.getUser(token)` and downstream data
  reads. Should create a second user-scoped client for the reads so RLS
  applies. Privilege-escalation risk if the org-membership check is ever
  removed.
- [ ] **`ai-triage-incident` and `generate-customer-report` accept
  `token === SUPABASE_SERVICE_KEY` as a service-call check**. Service key
  becomes a second bearer token; a leaked key from another context can
  call these as a "service" call. Use a dedicated `x-mithras-cron-secret`
  header per the `m365-poll-tenants` pattern.
- [ ] **`notify-alert` recipient filter bug**. Lines 148–151 have two
  consecutive `if (emails.length === 0) return` checks with different
  skip messages. The second is unreachable. The intent (filter by
  severity first, validate emails second) is inverted.
- [ ] **`agent-heartbeat` queued-commands filter skips null-expiry**.
  `.gt("expires_at", now)` silently skips commands where `expires_at IS
  NULL`. Legacy `agent-api/index.ts` uses
  `.or("expires_at.is.null,expires_at.gt....")` — copy that.
- [ ] **`agent-api` + `agent-heartbeat` fire-and-forget DB writes**.
  Three `supabase.from(...).update(...)` calls aren't awaited. Errors
  vanish.
- [ ] **`vulnerability-scan` SELECT-then-INSERT race**. Concurrent scans
  can duplicate findings. Switch to `.upsert(..., { onConflict: ... })`.
- [ ] **`enrollment_codes.expires_at` nullable + no retention job**.
  Codes with no expiry accumulate as valid signup entry points.
- [ ] **`next_invoice_number()` count-based**. Concurrent invoice
  generation collides on the unique constraint; raises 23505 to caller.
  Switch to `nextval()` with per-issuer sequence.
- [ ] **`return_licence` not called on endpoint delete**. Reseller's
  licence pool is never credited back when an endpoint is removed.
- [ ] **Date formats scattered across admin tables**. `Users`,
  `PartnersSection`, `EnrollmentCodesSection`, `DirectCustomersSection`,
  `PartnerDeals`, `MyCustomers`, `DistributorResellers`, `DistributorDashboard`,
  `BootstrapResultDialog` all use `.toLocaleDateString()` with no locale
  — browser-dependent output. Standardise on `format(d, "d MMM yyyy")`
  from `date-fns`.
- [ ] ~~**Glossary entries reveal RLS / HMAC implementation
  details**~~. Shipped in Wave 18 — rewrote 5 entries in plain
  English. Tab-gating to super-admin not done; can revisit if
  customers ask for less technical detail.

### Wins shipped in this wave (2026-06-08, already live)

For trail purposes — these are done:

**Critical bugs:**
- `handle_new_user()` was referencing non-existent columns `code` /
  `uses_count` on `enrollment_tokens`. Every channel-only signup since
  2026-05-31 was raising an exception at trigger time. Fixed to the
  real column names (`token`, `use_count`).
- `m365-posture-advisor` was reading `result.value` instead of
  `result.data` (the actual field on `LlmResult`). The TypeError
  meant fix-plan advice never persisted; `m365_posture_advice` was
  empty platform-wide.
- 3 views in `public` (`endpoints_live`, `distributor_reseller_credits`,
  `organization_pricing`) lacked `security_invoker = true`. Worst:
  `endpoints_live` exposed `agent_secret` + `agent_token` cross-tenant
  to any authenticated user. Migration flipped the flag on all three.

**Customer-facing copy & brand:**
- Welcome email + `Personal.tsx` said "your PC reports to Peritus" —
  swapped to "Mithras" (Peritus is the company, Mithras is the product).
- "14-day free trial" copy removed from `Landing.tsx` SEO,
  `legal/Terms.tsx` § 2, and `BlogPost.tsx` CTA. Product is
  channel-only; trial copy was actively misleading.
- `Guides.tsx` "Book a demo" → `/contact-sales` instead of `/signup`
  (which renders the Login page).
- `Personal.tsx` "Microsegmentation + WDAC (operator-grade features)"
  → "Network lockdown + application allow-listing (business-grade
  features)" — consumer page now jargon-free.
- `ReportDocument.tsx` switched from `en-US` to `en-AU` locale, wrapped
  in `bg-white` canvas so dark-mode preview stays readable, wrapped
  date in `<time>` element for a11y.
- `generate-customer-report` switched HTML report dates from
  `.toUTCString()` ("Sun, 01 Jun 2026 00:00:00 GMT") to clean
  `Intl.DateTimeFormat("en-AU", ...)` ("1 Jun 2026").

**Missing error states (9 pages):**
Created `<QueryError>` shared component. Wired into `Threats`,
`Dashboard` (via `useDashboardStats` exposing `error`), `Alerts`,
`EndpointDetail`, `Reports`, `PartnerBilling`, `DistributorBilling`,
`PortalInvoices`, `CustomerThreats`. RPC failure now shows a
destructive Alert with Try-again button instead of an infinite skeleton.

**Mutation safety / double-submit:**
- `AdminInvoices` per-row pending state via `pendingInvoiceId` —
  previously every row's Email button locked when any one was sending.
- `AdminAiCosts` Save-budget button now disables + shows spinner
  during `upsertBudget.isPending`.
- `AdminPricing` inline-edit save buttons disabled while pending.
- `Vulnerabilities` bulk-status buttons (Mark Mitigated / Resolved /
  Accept Risk) disabled while `bulkStatus.isPending`.

**Currency + dead routes:**
- AI cost numbers labeled `US$` on `SocConsole`, `AiActivity`, and
  the `AdminAiCosts` page subtitle now reads "AI cost & budgets
  (USD)" with a body note explaining "OpenAI bills in USD".
- `PartnerDashboard` and `DistributorDashboard` "Open sales kit"
  links now go to `/partner/resources` and `/distributor/resources`
  respectively instead of the public `/guides` route.

**A11y:**
- aria-labels added to icon-only ghost buttons in
  `IocLibraryManager`, `UacPoliciesManager`, `EndpointGroupsManager`,
  `Vulnerabilities` row menu, `Users` member menu, and
  `AdminPricing` inline save/cancel buttons.

**Code hygiene:**
- Removed duplicate imports in `AdminOverview.tsx` (Table set
  imported twice) and `DistributorResellers.tsx` (Briefcase imported
  twice). TypeScript was tolerating both but it was code smell.

### Wave 9 — second-pass deep review (2026-06-08 evening)

A second focused review pass dug into RPC quality, query-builder
chains, and cache invalidation. High-confidence wins:

- `ai-cost-monitor` per-org filter was broken — `q.eq(...)` return
  value was discarded so PostgREST never applied the filter. Every
  per-org budget evaluated against the global spend total. Symptom:
  any new per-org budget would falsely fire 100% alerts as soon as
  the global spend exceeded the per-org threshold. Verified with a
  per-org budget insert + cleanup.
- `useIncidents` applied `.eq("organization_id", orgId)` twice. The
  second was unconditional, silently pinning super-admins to a single
  org when context had one selected. Now only non-super-admins are
  scoped.
- `generate_peritus_invoice()` was `SECURITY DEFINER GRANT EXECUTE TO
  authenticated` with no caller check. Any logged-in user who knew a
  distributor/partner UUID could mint a Peritus invoice. Added a
  super-admin gate at function entry. Verified — non-super-admin call
  now raises `forbidden_not_super_admin`.
- `get_reseller_billing_snapshot()` had the same SECURITY DEFINER
  shape with no caller check — cross-org leak of customer names,
  endpoint counts, pricing for any reseller UUID. Added a member-or-
  super-admin gate.
- `ai-cost-monitor` cron schedule made idempotent: now guarded by
  `cron.unschedule()` so re-running the migration on a fresh replica
  no longer raises `unique_violation`.
- `usePatchDevice` + `useBulkPatchDevices`: the patch-device button
  was writing to the legacy `endpoint_commands` table with
  `command_type="install_updates"`, which the agent doesn't read AND
  isn't in the `agent_commands` CHECK constraint. Confirmed the
  end-to-end flow has never worked. Toast copy now reads "Patch
  request recorded — auto-patching from this page is a v0.7 roadmap
  item — for now we log the intent" and a `FIXME(backlog)` comment
  documents what wiring it would take. Listed below.

### Deferred from Wave 9 review (still TODO)

- [ ] **Patch-device end-to-end flow**. `usePatchDevice` and
  `useBulkPatchDevices` record intent to `endpoint_commands` but
  nothing executes. Wiring requires: (1) extend
  `agent_commands_command_type_check` to include `install_updates`,
  (2) implement `install_updates` handler in
  `agent/runtime-powershell/lib/CommandExecutor.psm1` (likely
  `Get-WindowsUpdate -Install -AcceptAll -IgnoreReboot` via
  `PSWindowsUpdate` module, with fallback to `wuauclt`), (3) point
  the hooks at `agent_commands`, (4) reflect status back to
  `vulnerability_findings.status` when the patch succeeds.
- [ ] **`ai-cost-monitor` GET request acceptance**. Function still
  accepts GET as well as POST. Means an unauthenticated browser hit
  (function URL is HTTPS-public) triggers a full budget eval loop
  with no auth gate. Restrict to POST only. Low-risk because the
  function uses `SUPABASE_SERVICE_ROLE_KEY` for all DB ops and the
  only side effects are alert inserts (which an attacker could
  trigger anyway by waiting for the cron) — but tightening is cheap.
- [ ] **`get_latest_endpoint_status_ids()` missing `pg_temp`**. Has
  `SET search_path = public` but not `pg_temp` at the end. Other
  SECURITY DEFINER functions in the codebase consistently use
  `public, pg_temp`. Inconsistent + theoretical temp-table hijack
  risk.
- [ ] **Cache-invalidation gaps** (medium severity, all in
  `src/hooks/`):
  - `useIncidents.useUpdateIncidentStatus` and `.useResolveIncident`
    don't invalidate `["soc-counters"]`. SOC counter strip shows
    stale active-threat count until the 15s poll.
  - `useAISoc.useReviewTriageDecision` doesn't invalidate
    `["ai-activity"]`. Operator approves/overrides a decision, the
    AI Activity page keeps showing the old reviewer state.
  - `useM365.usePollM365Tenant.onSettled` doesn't invalidate
    `["soc-counters"]`. Manual "Poll now" that surfaces risky
    sign-ins doesn't refresh the counter strip.
  - `useRouters.useDeleteRouter` invalidates `["routers"]` but not
    `["router-tunnels"]` or `["router-fw-rules"]`. Stale junction
    data after a router delete.
  - `useHardening.useUpdateOrganizationHardeningModule` doesn't
    invalidate `["endpoint-hardening-status"]` after first enable
    which seeds status rows via trigger.
- [ ] **`useSocDashboard.ts` pendingCount under-counts null-expiry
  commands** (line 783 area). Same `.gt("expires_at", now)` issue
  that `agent-heartbeat` had — copy the
  `.or("expires_at.is.null,...")` pattern.
- [ ] **`cve-auto-scan` parallel OpenAI calls**. Default batch
  spawns 30 concurrent OpenAI requests, max 60. With 10 orgs in the
  same cron tick that's 600 parallel calls — well above OpenAI's
  500 RPM limit for `gpt-4.1-mini`. Add a per-batch concurrency
  cap (5–10 parallel) or sequential chunking.
- [ ] **`m365-poll-tenants` mailbox sweep**. Polls up to 100 users
  per tenant per cycle, sequential but no inter-call delay. At
  Graph's 5 RPS default cap that's a 20s tail per large tenant.
  Cap to 20 users per cycle or add a small inter-call sleep.
- [ ] **`useAiActivity` missing `investigation` join**. Type
  declares `investigation?: { id, status }` but the PostgREST
  select string never includes it — frontend code reading
  investigation status from this hook always sees `undefined`.
  Either add the join or remove the type field.
- [ ] **Licence-pool migration never applied to prod docker02**.
  Task ledger #246-252 list as Done, but `licence_transactions`
  table and `organizations.licence_balance` column do not exist
  on the prod DB. The reseller licence-pool feature is non-
  functional on prod. Apply `20260606050000_licence_pool.sql`
  and verify the seed data; then re-introduce the
  Wave 15 licence-return trigger.

- [ ] **`ai_cost_setting` backfill not idempotent**. The migration
  ends with INSERT-from-SELECT into `ai_llm_calls` for triage /
  investigation / posture rows. Re-running creates duplicates. Add
  `WHERE NOT EXISTS (SELECT 1 FROM ai_llm_calls lc WHERE ...)`
  predicates. Forward-only concern (migration already applied).

### Wave 10 — cache invalidation + concurrency (2026-06-08 evening)

Shipped + verified live on prod:

- **5 cache-invalidation gaps closed:**
  - `useAISoc.AI_AFFECTED_KEYS` now includes `ai-activity` so
    the `/admin/ai-activity` feed refreshes on reviewer
    approve/override.
  - `useIncidents.useUpdateIncidentStatus` and `.useResolveIncident`
    invalidate `["soc-counters"]` — SOC counter strip stays
    accurate after a status change instead of waiting 15s for
    the next poll.
  - `useM365.usePollM365Tenant.onSettled` invalidates
    `["soc-counters"]` so manual "Poll now" refreshes the
    risky-sign-ins counter immediately.
  - `useRouters.useDeleteRouter.onSuccess` invalidates
    `["router-tunnels"]`, `["router-fw-rules"]`, `["dns-zones"]`
    — stale junction data after delete cleared.
  - `useHardening.useUpdateOrganizationHardeningModule.onSuccess`
    invalidates `["endpoint-hardening-status"]` so the status
    list reflects newly-seeded rows immediately on first enable.

- **`cve-auto-scan` OpenAI concurrency cap**: replaced unlimited
  `Promise.allSettled(thisBatch.map(...))` with a 5-worker pool.
  Now bounds per-invocation burst regardless of `batch_size`.
  With 10 orgs in the same cron tick that's 50 concurrent
  requests max instead of 300 — comfortably below OpenAI's
  500 RPM cap for `gpt-4.1-mini`.

- **`ai-cost-monitor` GET acceptance closed**: function now
  returns 405 to GET; only POST triggers the budget loop.
  Verified — GET returns `{"error":"method_not_allowed"}`,
  POST still returns the budget eval.

- **`useAiActivity.AiActivityRow.investigation` field removed**:
  declared type field had no PostgREST join feeding it, no
  caller in the codebase reads it. Removed instead of adding
  the join because the data was never used.

### Deferred from Wave 10 (still TODO)

- [ ] **`useSocDashboard.ts` null-expiry pendingCount**: reviewer
  flagged line 783 but file is only 271 lines — no such path.
  False positive, marked verified. Original null-expiry concern
  was on `agent-heartbeat` which was fixed in Wave 8.

### Wave 18 — glossary plain-English pass (2026-06-08 evening)

Shipped + verified (frontend bundle deployed):

Rewrote 5 glossary entries on `/glossary` to remove
implementation-detail leaks while keeping the substance accessible
to non-engineer customer admins:

- **Microsegmentation** — dropped `system:microseg:<endpoint-id>`
  group naming, swapped for "each endpoint gets its own private
  rule set".
- **Tenant (organisation)** — dropped `RLS-scoped on
  organization_id`, swapped for "Mithras refuses every
  cross-tenant read at the data layer". Conveys the same
  guarantee without exposing the mechanism.
- **Impersonation** — dropped `impersonation_start /
  impersonation_end` + `activity_logs` table references, kept
  the audit trail message (customer admins benefit from
  knowing this).
- **HMAC vs bearer-token** — renamed to plain "Modern vs
  legacy agent auth". Dropped `x-agent-token` header name,
  `/agent-legacy-upgrade` route, "DB tables" jargon. Kept
  the security framing (signed vs simple) and the auto-upgrade
  promise.
- **WDAC** — dropped "CI (Code Integrity) policy engine"
  Microsoft-internal phrasing, swapped for "code-integrity
  engine" with the key invariant ("a user-mode program can't
  switch it off, even with admin rights").

Removes the open glossary item from the backlog.

### Wave 17 — date format standardisation (2026-06-08 evening)

Shipped + verified live (frontend rebuild + deploy):

Replaced every `new Date(x).toLocaleDateString()` site across
the admin / portal surfaces with `format(new Date(x), "d MMM yyyy")`
from date-fns for stable, deterministic output regardless of
the visitor's browser locale. Touched 14 files:

- `pages/Users.tsx` — member created date
- `components/admin/PartnersSection.tsx` — partner created
- `components/admin/EnrollmentCodesSection.tsx` — code expiry
- `components/admin/DirectCustomersSection.tsx` — customer created
- `components/admin/BootstrapResultDialog.tsx` — token expiry
- `pages/MyCustomers.tsx` — customer created
- `pages/DistributorResellers.tsx` — reseller since
- `pages/DistributorDashboard.tsx` — reseller since
- `pages/Admin.tsx` — org created
- `pages/AdminPricing.tsx` — last updated
- `pages/AdminInvoices.tsx` — paid date
- `pages/AdminCredits.tsx` — txn date
- `pages/AdminHomeUsers.tsx` — subscription period end
- `pages/AdminResellers.tsx` — reseller since
- `pages/PartnerDeals.tsx` — deal close date
- `components/settings/MfaSettings.tsx` — MFA factor added
- `components/security/WdacPolicies.tsx` — policy created
- `components/reports/ReportPreview.tsx` — generated date

(Date strings like "stripe_current_period_end" handled with
nullable guard preserved.)

### Wave 16 — endpoints_log_delete cast fix (2026-06-08 evening)

Shipped + verified end-to-end on prod:

- **`endpoints_log_delete` trigger uuid cast added**: the JWT
  `sub` claim (text) was being inserted into `activity_logs.user_id`
  (uuid) without an explicit cast, raising
  `column "user_id" is of type uuid but expression is of type text`
  on every hard-delete attempt — even when the operator
  correctly opted in via `mithras.allow_endpoint_hard_delete='true'`.
  Fix: `NULLIF(..., '')::uuid` with two layers of NULLIF so
  missing OR empty claims become NULL cleanly. Verified by
  hard-deleting the wave15-test-endpoint leftovers — DELETE
  succeeded, audit row written with action='endpoint_hard_deleted'.

### Wave 15 — invoice race + licence-return audit (2026-06-08 evening)

Shipped + verified live:

- **`next_invoice_number()` advisory lock**: the count-based
  sequence was rewritten to take a per-(issuer, period)
  transaction-scoped advisory lock via `pg_advisory_xact_lock(
  hashtextextended(issuer || ':' || yyyymm))`. Two concurrent
  generate_peritus_invoice calls for the same issuer+month
  now serialize on the lock rather than racing past the same
  count and tripping the unique constraint. Verified function
  body now contains the lock call.

Discovered but NOT shipped:

- **Licence-return trigger reverted**: the planned AFTER DELETE
  trigger on `endpoints` to credit the reseller pool was
  authored and applied — but smoke-test revealed that the
  prod database does NOT have the `licence_transactions` table
  or `organizations.licence_balance` column. The licence-pool
  migration (`20260606050000_licence_pool.sql`) was never
  applied to prod docker02 despite being listed as Done in
  the task ledger (tasks #246-252). Trigger + helper function
  were dropped from prod immediately. Both the licence-pool
  rollout AND the return-trigger remain TODO.

### Wave 14 — cron-secret header (2026-06-08 evening)

Shipped + verified live with the full request matrix:

- **`ai-triage-incident` dead service-key-as-bearer path removed**:
  function is only invoked from the SOC console via user JWT (no
  cron caller exists). The `isServiceCall = token === SUPABASE_SERVICE_KEY`
  branch was unused attack surface. Now auth requires a real user
  JWT.
- **`generate-customer-report` cron auth swapped from service-key
  bearer to `x-mithras-cron-secret` header**: dedicated secret
  generated by migration into `platform_settings.mithras_cron_secret`,
  exposed to the edge runtime as `MITHRAS_CRON_SECRET` via compose
  override, and sent by `process_queued_customer_reports()` cron
  function on every drain tick. Service-key-bearer path kept
  transitionally as a fallback. Verified:
  - Wrong secret → 401 `missing_token`
  - Correct secret → `{processed: 0, results: []}` (reached batch
    logic, empty because nothing queued)
  - Container env now includes `MITHRAS_CRON_SECRET`
- **Follow-up planned**: once the next two customer-report-drain
  ticks succeed on prod via the new header, remove the legacy
  service-key-bearer fallback path in
  `generate-customer-report/index.ts`.

### Wave 13 — CORS shared lib + audit (2026-06-08 evening)

Shipped + verified live with real CORS request matrix:

- **`vulnerability-scan`, `cve-auto-protect`, `cve-mitigation-advisor`
  switched to `_shared/cors.ts`**: replaced the wildcard
  `Access-Control-Allow-Origin: *` constant with per-request
  origin-aware headers via `buildCorsHeaders()`. OPTIONS preflight
  uses the shared `handlePreflight()` allow-list. Verified:
  - `Origin: https://www.mithras.com.au` → 204 with
    `access-control-allow-origin` set + `access-control-allow-credentials: true`
  - `Origin: https://evil.example.com` → 403 from preflight
  - No-origin POST → reaches normal auth path (returns auth error
    as expected, not a CORS error)
- **ai-triage-incident + generate-customer-report `AbortSignal.timeout`
  audit**: backlog entry was stale — both functions already have
  45s / 30s timeouts in place. Verified live. Removing from the
  open-items list.

### Wave 12 — vuln-scan race + service-key split (2026-06-08 evening)

Shipped + verified live (both functions reload cleanly, smoke
test reached the auth path with no bootstrap errors):

- **`vulnerability-scan` SELECT-then-INSERT race closed**: replaced
  the per-item check-then-insert pattern with
  `.upsert(..., { onConflict: "endpoint_id,cve_id,affected_software",
  ignoreDuplicates: true }).select("id")`. Two concurrent NVD scans
  for the same org no longer produce duplicate findings — the unique
  constraint already on the table is now the source of truth, and
  the second writer gets a no-op instead of racing past a stale
  SELECT. Re-open semantics for resolved/mitigated findings are
  preserved via a fall-through update path that runs only when
  upsert returns empty.
- **`ai-security-advisor` service-role-everywhere fixed**: function
  now uses a service-role client for `auth.getUser()`, super_admins
  lookup, and platform_settings (admin-RLS reads), and a separate
  user-scoped client (anon key + `Authorization: Bearer <user-jwt>`
  header override) for endpoints / endpoint_threats / endpoint_status
  reads. If the `is_member_of_org` membership check ever silently
  passes due to an RLS-helper regression, RLS on the data tables
  still enforces the org boundary. Pattern matches existing
  `virustotal-lookup`, `m365-posture-*` functions.

### Wave 11 — m365 throttle + small migrations (2026-06-08 evening)

Shipped + verified live:

- **`m365-poll-tenants` mailbox sweep tightened**: per-tenant cap
  reduced 100 → 25 users with a 60ms inter-call breather between
  Graph requests. Was a ~20s sequential tail per large tenant
  stacked across all polled tenants; now bounded to ~4s plus 1.5s
  of breather time. Stale-mailbox feeder rotates users in over
  4 cycles, still covering 100-user tenants weekly.
- **`get_latest_endpoint_status_ids()` pg_temp fix**: added
  `pg_temp` to its `SET search_path` so it now matches every
  other SECURITY DEFINER function. Verified via pg_proc: config
  now reads `search_path=public, pg_temp`.
- **Enrollment-token retention cron**: new
  `purge_expired_enrollment_tokens()` SECURITY DEFINER helper +
  daily `mithras-enrollment-token-cleanup` cron at 04:15 local.
  Purges tokens whose `expires_at < now() - 7d` AND `use_count = 0`
  AND `used_at IS NULL` — i.e. dead tokens that no installer
  ever used. Kept used tokens for audit. First run purged 3
  stale tokens. Reviewer's claim that `expires_at` is nullable
  was inaccurate (column is `NOT NULL DEFAULT now() + 7 days`),
  but accumulation of expired-and-unused tokens was a real noise
  source for admins viewing the token list.

---

## Adding to this backlog

Append items under the right heading. Keep entries short — one line for
WHAT, one line for WHY if it's not obvious. Move completed items to a
`## Done` section at the bottom if you want a trail; otherwise just delete
them.
