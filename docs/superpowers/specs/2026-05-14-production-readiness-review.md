# Peritus Endpoint Guardian — Production-Readiness Review

**Date:** 2026-05-14
**Scope:** Full-stack review — frontend, edge functions, database, operations.
**Reviewers:** 4 parallel code-review subagents (frontend, backend, db, ops).
**Codebase size:** 205 TS/TSX files (~43k LOC), 14 edge functions, 61 migrations, 1 VM.

## Executive summary

The platform has a solid skeleton and is well-architected for what it is: a single-tenant MSP SOC platform with multi-customer organisations layered on top. The core multi-tenancy model (org membership + SECURITY DEFINER helper functions) is correct.

**It is not production-ready.** There are 15 critical issues that range from "anyone on the LAN can enrol endpoints into any tenant" to ".env.production with live credentials is committed to git." None are architectural and most are fixable in days, not months. The "missing for production" list is larger and represents real roadmap work — incident workflow, customer portal, code signing, compliance posture.

Verdict: with 1–2 weeks of focused remediation work on the critical list, the platform is ready for **internal beta** with the existing Peritus tenants. To take real paying customers, add another 4–6 weeks on the important list and start the missing-capabilities backlog.

---

## 🔴 Critical — block production until fixed

These are exploitable today or guarantee catastrophic data loss. Fix order roughly matches blast radius.

### Secrets & credentials

1. **`.env.production` is committed to git** containing the cloud project ID and a long-lived anon JWT (exp 2084). Same JWT is hard-coded as a fallback in `docker-compose.yml`. `scripts/phase1/smoke-test.sh:16` embeds the replica VM anon key. → Add to `.gitignore`, rotate keys, remove literal defaults from compose.
2. **`platform_settings` stores OpenAI + VirusTotal keys as plaintext `TEXT`**. Any Postgres dump or RLS bug exposes them. Migration `20260127101320`. → Move to `supabase_vault`, or encrypt with pgcrypto.
3. **`endpoints.agent_secret` and `enrollment_tokens.token` are plaintext** — these are HMAC shared secrets, equivalent to passwords. → Store SHA-256 hash; compare on verify.

### Authentication & authorisation

4. **`agent-api` registration uses the raw organisation UUID as the enrolment token** (`agent-api/index.ts:345-357`). Any agent that knows or guesses an org UUID can enrol into that tenant. The legacy registration path is wide open. → Reuse the new `enrollment_tokens` flow.
5. **`vulnerability-scan` has no authentication at all** (`vulnerability-scan/index.ts:137-158`). Unauthenticated POST triggers a 5-minute scan against any org, writes to that org's findings, burns NVD quota, and DoSes the function. → Add `supabase.auth.getUser` guard + org membership check.
6. **`cve-auto-protect` lets the LLM choose which DB column to write** (`cve-auto-protect/index.ts:179-213`). Returned `setting_key` is used directly as a dynamic key in an UPDATE on `defender_policies`. A prompt injection writes arbitrary columns across every policy. → Hardcode the allowed key whitelist; reject any other key.
7. **EndpointDetail page has no org filter** (`src/pages/EndpointDetail.tsx:42-113`). Navigating to `/endpoints/<uuid-from-another-tenant>` shows that endpoint's threats, status, and event logs (RLS dependent — if RLS is loose anywhere, this leaks). → Add `.eq("organization_id", currentOrganization.id)` to all four queries.
8. **5 RLS policies use `WITH CHECK (true)` on INSERT/UPDATE** allowing any authenticated user to write rows to any org:
    - `alerts` (`20260408095546`)
    - `policy_audit_findings` (`20260408100252`)
    - `hardening_recommendations` and `endpoint_hardening_status` (`20260408101810`)
    - `activity_logs` INSERT (audit-trail poisoning — `20260122043921`)

    → Replace with `is_member_of_org(auth.uid(), organization_id)` checks or restrict to service_role only.

### Frontend

9. **JWT stored in `localStorage`** (`src/integrations/supabase/client.ts:17`). XSS-exposable. → Switch to default cookie storage or at minimum `sessionStorage`.
10. **`document.write` + `innerHTML` injection** in `ReportPreview.tsx:25,54` and `ReportGenerator.tsx:106,135`. Any unsanitised hostname/org name in a generated report becomes XSS in the print window. → Use a real PDF library (`jsPDF`, `react-pdf`).
11. **VirusTotal API key returned plaintext to authenticated browser sessions** (`usePlatformSettings.ts:18` + permissive RLS on `platform_settings`). → Lock RLS to super-admin; never return raw secret values to the client.

### Infrastructure

12. **No database backups exist or are scheduled.** Single VM, single Postgres. A failed disk or `DROP TABLE` is total loss. → Daily `pg_dump` to off-VM storage (B2/S3) + tested restore.
13. **UFW disabled on the VM; Kong (8000), Postgres (5432), Studio (3000) are reachable on the LAN with no TLS.** Agent enrolment responses (containing `agent_secret`) traverse cleartext HTTP. → Enable UFW, restrict ports, terminate TLS at Caddy (port-forward fix is a separate concern).
14. **7 of 14 edge functions have `verify_jwt = false`** with no compensating control: `ai-security-advisor`, `virustotal-lookup`, `cleanup-old-data`, `vulnerability-scan` (especially), `cve-auto-protect`, `cve-mitigation-advisor`, `check-openai-models`. Anyone reaching Kong can call them unauthenticated and burn paid API quota. → Re-enable JWT verification on all non-agent functions.
15. **Admin route is client-side guarded only.** `/admin` renders if `isSuperAdmin` is true in TenantContext — but the underlying tables (`platform_settings`, `super_admins`) must have airtight RLS for this to actually mean anything. Combined with #11, this is exploitable. → Add server-side route guard + audit RLS on every admin-touched table.

---

## 🟠 Important — fix before public beta

Real risks but won't catastrophically fail on day 1.

### Backend

- Race condition on `router-checkin` enrolment-token use count — concurrent enrolments bypass `max_uses` limit
- In-memory rate limiter in `agent-api` is per-isolate, not cluster-wide — bypassable by round-robining
- `ai-security-advisor` doesn't verify the authenticated user belongs to the requested `organization_id` — tenant-crossing
- `vulnerability-scan` is synchronous and request-scoped for a 5-10 min workload — will time out under Supabase Edge runtime limits → redesign as background job
- `agent-script` interpolates org UUID into PowerShell without explicit UUID regex check — guard against future code paths that source from user input
- Multiple functions return raw error messages including SQL/PostgREST internals to caller
- N+1 query pattern in `agent-api/handleApps` — 500-app software inventory = 1000+ DB round-trips
- No request-body size limits on agent ingest endpoints

### Database

- `firewall_audit_logs` (12.8M rows) and `endpoint_event_logs` have no partitioning and no retention job. `organizations.event_log_retention_days` is documentation-only — no `pg_cron` job acts on it. Will grow unbounded.
- `vulnerability_findings.severity` / `status` and `endpoint_commands.status` / `command_type` lack CHECK constraints (other tables have them)
- `router_enrollment_tokens` write policy allows any org *member*, not just admins
- Several migrations execute DML outside explicit BEGIN/COMMIT — partial-failure states possible
- Inconsistent timestamp naming (`collected_at` vs `event_time` vs `created_at`) — error-prone for ad-hoc queries

### Frontend

- Minimum password length is 6 chars; MFA is optional, not enforced; no lockout / CAPTCHA on login
- No session timeout / idle logout — SOC workstation left unlocked stays auth'd indefinitely
- Bulk policy assignment + bulk group operations execute on click with no "are you sure?" dialog
- Super admin grant requires a single click — no second-factor, no second-admin approval
- React Query default `retry: 3` causes visible delays on 401s
- No password reset flow visible (Supabase provides but no UI link)
- Activity log query lacks explicit org filter — relies on RLS alone

### Operations

- Container images use floating tags (`nginx:alpine`, `node:20-alpine`)
- No CI/CD — manual `bash scripts/phase1/deploy-to-vm.sh` from the developer workstation
- `nginx.conf` missing `Content-Security-Policy` and `Strict-Transport-Security` headers
- Single VM = single point of failure with no documented failover
- Secrets as plaintext env files on VM with no rotation policy

---

## 🔵 Minor — fix during normal work

- Console.log of firewall audit log objects (`FirewallAuditLogs.tsx:36`)
- VirusTotal / NVD fetches have no timeout — hung upstreams hold function open
- `package.json` `name` still `vite_react_shadcn_ts` (Lovable scaffold)
- Inconsistent edge-function bootstrap (`Deno.serve` vs `import { serve } from std@0.168.0`)
- LLM-fed CVE descriptions / hostnames unsanitised — prompt-injection surface
- `nginx.conf` includes deprecated `X-XSS-Protection` header
- No `npm audit` in any script

---

## 🧱 Missing for "production endpoint security platform"

These are real capability gaps. None block "internal beta," all block "I trust this with my customers."

### Product capabilities

- **No incident / case management workflow** — threats detected, but no assign-to-analyst, status, SLA timer, escalation
- **No customer-facing portal** — customers must have a SOC-operator account to see anything
- **No bulk-actions UX** — bulk operations exist programmatically but have no confirm/audit step
- **No saved searches / favourites / keyboard shortcuts** — power-user features missing
- **No report scheduling** — only on-demand generation, no email/Slack delivery
- **No accessibility audit** — keyboard navigation, screen-reader support, WCAG compliance unknown
- **No dark mode** — SOC operators work in dark environments

### Security & compliance

- **No code signing for agent binaries** (Phase 5 of the agent modernisation plan)
- **No column-level encryption** on any secret column
- **No SBOM / supply-chain attestation** (`npm sbom`, SLSA provenance)
- **No tenancy isolation at infrastructure level** — single Postgres, RLS-only isolation. A misconfigured policy leaks across customers.
- **No SOC 2 / ISO 27001 mapping documentation**
- **No data residency story** — multi-region is not addressed
- **No DPIA / privacy impact** — endpoint telemetry contains PII (hostnames, usernames, event details)
- **No dependency-update automation** (Dependabot / Renovate)

### Operations & observability

- **No tests on 13 of 14 edge functions** (only `vulnerability-scan` has one)
- **No structured logging** (request ID, tenant ID, latency as JSON fields)
- **No APM / error tracking** — no Sentry, no DataDog, no New Relic
- **No application metrics** — request counts, latencies, error rates per function not exported anywhere
- **No alerting paths** — Grafana Alerting unconfigured, no PagerDuty/Opsgenie
- **No status page** for customer-visible uptime
- **No incident response runbook**
- **No DR plan / tested restore procedure**
- **No formal change management** — no PR gate, no review process
- **No retention jobs** (`pg_cron` not wired)
- **No partitioning** on time-series tables (will hurt at >50M rows)

---

## Recommended remediation roadmap

### Phase A — "before anyone outside Peritus sees this" (3-5 days)

Goal: close the cleartext-credential, audit-tamper, and cross-tenant write holes.

1. Add `.env.production` to `.gitignore`; rotate the cloud anon JWT; purge from history.
2. Enable UFW on the VM — allow only 22/80/443 inbound, and restrict admin ports to known IPs.
3. Fix the 5 `WITH CHECK (true)` RLS policies (#8).
4. Add auth to `vulnerability-scan` (#5) and re-enable `verify_jwt` on all non-agent functions (#14).
5. Whitelist the `setting_key` values in `cve-auto-protect` (#6).
6. Add org-filter to `EndpointDetail` (#7).
7. Switch JWT storage off `localStorage` (#9).
8. Replace agent-api UUID-as-token registration with the new enrollment_tokens flow (#4).
9. Lock down RLS on `platform_settings`; never return raw secrets to client (#11).
10. Stand up daily `pg_dump` → off-VM storage; test one restore (#12).

### Phase B — "before external beta" (2-3 weeks)

1. Hash-at-rest for `agent_secret`, `enrollment_tokens.token` (#3) + secret rotation procedure.
2. Move `platform_settings` API keys to `supabase_vault` (#2).
3. Background-job redesign for `vulnerability-scan` (use `pg_cron` or Supabase Background Tasks).
4. Add retention jobs (`pg_cron`) for the two high-volume tables; partition `firewall_audit_logs` by month.
5. Fix XSS in report generation (#10).
6. Add admin-route server-side guard + second-factor on super-admin grant.
7. Raise password policy to 12 chars; enforce MFA on enrolment; add lockout.
8. Add session timeout.
9. Add CI: `vitest` + `deno check` + smoke-test gates on PR.
10. Pin container image tags; configure Dependabot/Renovate.
11. Add `Content-Security-Policy` + `Strict-Transport-Security` headers.
12. Enable structured logging (request ID, tenant ID) across all edge functions.
13. Stand up Sentry (or equivalent) for both frontend and edge functions.
14. Test suite for the 13 edge functions that have none.
15. Confirm the agent modernisation Phase 1 work (already done) handles the new auth flow.

### Phase C — "production endpoint security platform" (1-2 months)

1. Incident / case management workflow (schema + UI + SLA timers).
2. Customer-facing portal with limited views (read-only for their own org).
3. Code signing for agent binaries (existing Phase 5 of the agent modernisation plan).
4. Tenancy isolation review — consider per-customer Postgres schema or per-customer DB for the largest tenants.
5. Compliance work: SOC 2 mapping, ISO 27001 gap analysis, DPIA.
6. Grafana Alerting wired to PagerDuty/Opsgenie; status page.
7. DR plan: secondary VM, replication, runbook.
8. Bulk actions UX with confirmation + audit.
9. Accessibility audit + dark mode.

---

## Notes

- All numbered findings include file:line refs in the reviewer outputs (preserved in the conversation transcript). Treat this doc as the executive summary; pull individual diff packs from the reviewer transcripts when you actually do the work.
- Phase A items map cleanly onto a single feature branch (`security/phase-a-prod-hardening`). Phase B benefits from being split per concern.
- The agent modernisation plan we just shipped (Phase 1) is independent of this remediation work and can proceed in parallel.
- Recommend tackling Phase A in this order: secrets-and-keys (1-2), then RLS fixes (3), then auth gaps (4-8), then infra (9-10). That order means each commit closes the largest remaining hole.
