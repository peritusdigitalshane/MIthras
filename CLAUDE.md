# Peritus Endpoint Guardian — Project Context

This file is the canonical context for any AI agent or new engineer working on this codebase. Read it before doing anything substantive.

## What this is

**Peritus Endpoint Guardian** is a multi-tenant MSP endpoint-security platform. Peritus (the MSP) manages many customer organisations; each customer has many Windows endpoints; each endpoint runs an agent that reports Defender posture, threats, vulnerability findings, firewall traffic, and software inventory back to the platform. SOC operators at Peritus log in to manage policies, respond to threats, and (eventually) drive incident workflows across the fleet.

It is **not** a single-tenant security tool. The hierarchy is:

```
Peritus (operator / super-admin)
  └── Customer Organisation
        ├── Members (admins, members, viewers)
        └── Endpoints
              ├── Defender posture
              ├── Threats
              ├── Event logs
              ├── Firewall audit logs
              ├── Software inventory + vulnerability findings
              └── Network devices (routers)
```

## Stack

- **Frontend:** Vite + React + TypeScript + shadcn/ui + Tailwind + TanStack Query. Hosted via Docker + Nginx behind Caddy.
- **Backend:** Supabase (Postgres + GoTrue auth + Storage + Edge Functions on Deno + Realtime).
- **Agent:** PowerShell scripts today (legacy), .NET 8 service in roadmap (see Phase 1-4 of agent modernisation).
- **Observability:** Grafana SOC dashboard reading directly from the replica Postgres via a `grafana_reader` role with `BYPASSRLS`.
- **Reverse proxy:** Caddy on the VM serves three vhosts.
- **Cloud project:** `njdcyjxgtckgtzgzoctw.supabase.co` (production data).
- **Replica VM:** `192.168.99.143` (development/staging, snapshotted from cloud via pg_dump on 2026-05-12).

## Deployment topology

There are **two parallel deployments** of the same codebase:

| Deployment | Where | URL | Purpose |
|---|---|---|---|
| Cloud (production) | Supabase cloud | (production hostname TBD) | Live customer traffic |
| Replica (dev/staging) | Proxmox VM `peritus-supabase`, IP `192.168.99.143` | `appdev / apidev / socdev .peritusdigital.com.au` | All new development; data snapshot from cloud |

Public DNS for the `*dev.peritusdigital.com.au` hostnames currently resolves to `144.6.39.181`, which serves a different (openresty) host that **does not forward to the replica VM**. Workstations on the Peritus network reach the replica via a hosts-file entry pointing those hostnames to `192.168.99.143`. The Caddyfile on the VM is configured to serve the three vhosts; once the public routing is fixed, no Caddy change is needed.

Edge functions on the replica live at `/opt/peritus-functions/<name>/index.ts` and are mounted into the `supabase-edge-functions` container. Restart that container after changing function source. The Supabase stack itself is at `/opt/peritus-supabase/`.

## Data model — the tables that matter

Read `supabase/migrations/20260122031742_*.sql` and `20260122032845_*.sql` first — they define the foundation. Key tables:

- `organizations` — customers. `organization_memberships` joins users to orgs with a `role org_role` enum (`owner | admin | member`).
- `profiles` mirrors `auth.users` for app-level metadata.
- `super_admins` — Peritus operators with cross-tenant access (gates the `/admin` route).
- `endpoints` — registered Windows machines. Legacy `agent_token` column for the old PowerShell agent; Phase 1 added `agent_secret`, `enrolled_via`, `runtime`, `update_channel`, `is_active`.
- `endpoint_status` — Defender posture snapshots (RTP, AV, behavior monitor) keyed by `endpoint_id` + `collected_at`. Use `DISTINCT ON (endpoint_id) ... ORDER BY collected_at DESC` for "latest."
- `endpoint_threats` — Defender threat detections. Severity is `Severe | High | Moderate | Low`.
- `endpoint_event_logs` — Windows Event Log entries forwarded by the agent. Single source today (`Microsoft-Windows-Windows Defender/Operational`); will diversify with Phase 2 agent.
- `firewall_audit_logs` — Windows Firewall traffic events. Currently 12.8M rows in the replica — needs partitioning and a retention job before production.
- `vulnerability_findings` — CVE findings per endpoint+software. Has `status open|mitigated`, `cvss_score`, `created_at`, `resolved_at`.
- `activity_logs` — audit trail. **Currently writable by any org member — must be fixed before production.** See production readiness review.
- `alerts` — derived from threats. Currently empty.
- `defender_policies`, `windows_update_policies` — config that gets pushed to endpoints.
- `routers`, `router_tunnels`, `router_enrollment_tokens`, `router_uptime_logs` — network device side of the product.
- `enrollment_tokens`, `agent_versions` — Phase 1 additions; one-time enrolment tokens and signed binary manifest.

### Multi-tenancy enforcement

Every public table should have RLS enabled and policies that use one of these helper functions (all `STABLE SECURITY DEFINER`, defined in `20260122031742_*.sql`):

```sql
public.is_member_of_org(user_id uuid, org_id uuid) → boolean
public.is_admin_of_org(user_id uuid, org_id uuid)  → boolean  -- role IN ('admin','owner')
public.is_super_admin(user_id uuid)                → boolean
public.get_user_org_ids(user_id uuid)              → SETOF uuid
```

**Use these in policies — do not write raw subqueries against `organization_memberships` (the table name is `organization_memberships`, plural, with an "s" — a recurring confusion).**

## Authentication flows

Two parallel agent-auth paths exist; they will coexist until the legacy agents are migrated:

| Path | Header | Function | Status |
|---|---|---|---|
| Legacy bearer token | `x-agent-token: <long random>` | `/functions/v1/agent-api` | Used by deployed PowerShell agents today |
| HMAC (Phase 1) | `x-agent-id`, `x-timestamp`, `x-signature` | `/functions/v1/agent-enroll`, `agent-heartbeat`, `agent-version-check` | New flow, will be used by Phase 2 agents |

The HMAC signing canonicalisation is documented at `agent/contracts/hmac-canonicalization.md`. Reference implementation lives in `supabase/functions/_shared/hmac.ts`.

User auth uses Supabase GoTrue. The frontend stores the JWT in `localStorage` (a known issue per the production review — see #9 in the critical list).

## Conventions

### Frontend

- **Routing & guards:** routes that require auth go inside `<ProtectedRoute>` (`src/components/auth/ProtectedRoute.tsx`). Admin-only routes also need `isSuperAdmin` from `useTenant()`. Always defense-in-depth — don't trust RLS alone.
- **Tenant scoping:** queries should read `currentOrganization.id` from `useTenant()` and add `.eq("organization_id", orgId)` even though RLS would catch a miss. Belt + braces.
- **Mutations:** use TanStack Query mutations with `onSuccess` invalidating relevant query keys. Log to `activity_logs` for anything an auditor would care about.
- **Components:** shadcn primitives in `src/components/ui/`; feature components grouped by area (`endpoints/`, `policies/`, `network/`, `gpo/`, `hunting/`, `security/`).
- **State:** TanStack Query for server state; React contexts (`AuthContext`, `TenantContext`) for app-level state. Avoid Redux/Zustand — they're not in the stack.

### Backend (edge functions)

- Each function is a single `index.ts` in `supabase/functions/<name>/`. Bootstrap with `Deno.serve(async (request) => {...})`.
- Shared helpers in `supabase/functions/_shared/` — currently `hmac.ts` and `cors.ts`.
- Imports use `https://esm.sh/...` (already-resolved Deno modules).
- Env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, plus function-specific (e.g., `OPENAI_API_KEY`). Don't hardcode the project URL — use `Deno.env.get`.
- All functions must verify the caller's authority. Agent functions use HMAC; user-facing functions should `await supabase.auth.getUser(jwt)` — several today don't (see production review #7, #14).
- Register every new function in `supabase/config.toml` with `verify_jwt = false` only if you've added a compensating auth control (HMAC).

### Database

- New migrations: `supabase/migrations/YYYYMMDDHHMMSS_descriptive_slug.sql`. Apply via `scripts/phase1/deploy-to-vm.sh` (idempotent for what we've added so far).
- Use `IF NOT EXISTS` on schema-modifying statements to keep migrations re-runnable.
- Every new table needs `ENABLE ROW LEVEL SECURITY` + explicit policies. Default-deny is the only acceptable starting position.
- Use the helper functions (above) in policies. Avoid `WITH CHECK (true)` — see production review #8.

### Commits

- Conventional Commits prefix (`feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `build`).
- Scope helps: `feat(edge): ...`, `feat(db): ...`, `fix(grafana): ...`.
- Co-authored-by line for AI-assisted commits.

## In-progress and roadmap

Design specs and implementation plans live at:
- `docs/superpowers/specs/` — design documents (one per major feature)
- `docs/superpowers/plans/` — implementation plans with bite-sized tasks

Current state of major work:

| Workstream | Status | Doc |
|---|---|---|
| Plan 1: Lovable detach + env config | Done on `feat/plan-1-lovable-detach` branch; push deferred pending Lovable disconnect | `docs/superpowers/plans/2026-05-12-01-lovable-detach-env-config.md` |
| Plan 2: Self-hosted Supabase standup | Done; replica running at `192.168.99.143` | `docs/superpowers/plans/2026-05-12-02-selfhosted-supabase-standup.md` |
| Plan 3: Validation gate + CLAUDE.md | In progress | `docs/superpowers/plans/2026-05-12-03-validation-gate-and-claude-md.md` |
| Agent modernisation design (Phases 1-4) | Spec approved | `docs/superpowers/specs/2026-05-13-agent-modernization-design.md` |
| Agent Phase 1 — security plumbing (HMAC + enrolment + signed updates) | **Done** on `agent/phase-1-security-plumbing` branch | `docs/superpowers/plans/2026-05-13-agent-modernization-phase-1-security-plumbing.md` |
| Agent Phase 2 — service runtimes (NSSM PowerShell + .NET 8) | Not started — write plan when ready | (TBD) |
| Agent Phase 3 — realtime command channel | Not started | (TBD) |
| Agent Phase 4 — logging + tray UX | Not started | (TBD) |
| Agent Phase 5 — code signing + EDR-grade telemetry | Deferred | — |
| SOC Grafana dashboard | Deployed | `scripts/phase1/build-soc-dashboard.py` |
| Production-readiness review | Complete, 15 critical items identified | `docs/superpowers/specs/2026-05-14-production-readiness-review.md` |
| Phase A: prod-hardening (critical fixes) | Not started | (TBD) |

## Operational quirks (things that will bite you)

- **Hosts file workaround:** `appdev / apidev / socdev .peritusdigital.com.au` must point to `192.168.99.143` from any workstation that wants to reach the replica through the browser. Public DNS routes to a different host that returns 404. Fix is out of scope until external routing is sorted.
- **VM access:** SSH passwordless to `itadmin@192.168.99.143` (key set up). Passwordless sudo on the VM. Don't commit any session passwords — there's a known `Coopermaxwill21!` literal in transcripts but it should not be in code.
- **Grafana datasource quirk:** Grafana 13 moved `database` into `jsonData.database`. Don't put it at the top level of the datasource YAML or it silently fails ("no default database configured").
- **Grafana `$org` variable:** Multi-select variables in SQL `IN ()` clauses need `${org:singlequote}` interpolation. Plain `$org` produces `{val}` syntax that's invalid SQL. Don't set `allValue: "all"` — let `$__all` expand to the actual UUIDs.
- **Table name confusion:** It's `public.organization_memberships` (plural, "s"). I've burned cycles on `organization_members` typos. Use the helper functions to avoid touching the table directly.
- **Postgres version pin:** Cloud is 17, replica is 17 (we had to use `postgres:17` for pg_dump version match — the earlier `postgres:15` failed).
- **Edge function reload:** Edits to `/opt/peritus-functions/*` don't auto-reload. `docker compose ... restart functions` after every change.
- **The hosts file already had wrong IPs.** If `socdev` doesn't work, check `C:\Windows\System32\drivers\etc\hosts` — old entries pointed to `192.168.99.26` (a different VM that no longer exists for this purpose).

## What this platform is *not* (yet)

- **Not multi-region.** Single Postgres, single VM.
- **Not HA.** One node, no replica, no DR plan.
- **Not customer-facing yet.** Customers can't log in to a portal — they need a SOC-operator account.
- **No incident workflow.** Threats are detected but there's no case management, no SLA timer, no assign-to-analyst.
- **No code signing on agents.** Phase 5 work.
- **No formal compliance posture.** SOC 2 / ISO 27001 work hasn't started.
- **No backups.** Top item on the production readiness list.

See the production-readiness review for the full gap analysis.
