# Supabase self-host migration + Lovable detachment + subagent workflow

**Date:** 2026-05-12
**Status:** Design (awaiting user approval before plan)
**Scope:** Detach this repo from Lovable, stand up a self-hosted Supabase stack as a test/staging environment, build a validation test suite, and document the project plus its development workflow in a single `CLAUDE.md`. Defer the actual production cutover to a later design once the validation gate passes.

---

## 1. Context & current state

- **Frontend:** Vite + React + TypeScript + shadcn/ui + Tailwind. Source under `src/`. Routing in `src/pages/`. Supabase client at `src/integrations/supabase/client.ts` with the cloud URL hardcoded.
- **Backend:** Supabase **cloud** project `njdcyjxgtckgtzgzoctw`. Owns Postgres + Auth + Storage + 10 edge functions (`agent-api`, `agent-script`, `ai-security-advisor`, `check-openai-models`, `cleanup-old-data`, `cve-auto-protect`, `cve-mitigation-advisor`, `router-checkin`, `virustotal-lookup`, `vulnerability-scan`).
- **Migrations:** 20+ SQL files under `supabase/migrations/` (dated 2026-01 onward). Source of truth for schema.
- **Deployment:** `Dockerfile` + `docker-compose.yml` build the frontend as a static site served by Nginx on port `9988`. No backend services in compose.
- **Lovable artefacts to remove:** `lovable-tagger` devDependency + Vite plugin call, Lovable-branded `README.md`, project ID literals.

## 2. Goals (in order)

1. Detach the repo from Lovable cleanly. No functional change to the app.
2. Make the frontend's Supabase target **env-configurable** so the same codebase can build against cloud (prod, unchanged) or a self-hosted instance (staging).
3. Stand up a self-hosted Supabase stack on a Linux host, isolated from cloud.
4. Replay schema migrations and seed synthetic test data into self-hosted.
5. Build a six-category integration test suite that validates the self-hosted instance is functionally equivalent.
6. Document everything in a top-level `CLAUDE.md` so future sessions have full context.
7. Establish a subagent-driven workflow for ongoing development.
8. **Out of scope for this spec:** the production data migration / cutover from cloud to self-hosted. That gets its own design once the test gate passes.

## 3. Non-goals

- Touching the cloud Supabase project in any way during this phase.
- Migrating real production data, users, or storage objects.
- Changing application features or UI.
- Choosing the eventual cutover strategy (staged copy + flip, shadow / dual-write, tenant-by-tenant). Deferred — listed in §10.

## 4. Architecture

### Current
```
[ User ] --> [ Frontend (Nginx :9988, prod-built, cloud URL baked in) ] --> [ Supabase cloud (njdcyjxgtckgtzgzoctw) ]
```

### Target (during validation phase)
```
[ User ]    --> [ Frontend prod  (Nginx :9988, .env.production = cloud)    ] --> [ Supabase cloud   ]   (unchanged, live)
[ Tester ]  --> [ Frontend stage (Nginx :9989, .env.staging   = self-host) ] --> [ Supabase self-hosted on Linux host ] (new, isolated)
```

Two parallel environments. Cloud is untouched. Self-hosted is for testing only.

### Repo layout impact
```
peritus-endpoint-guardian/
├── CLAUDE.md                      (new, top-level docs)
├── README.md                      (rewritten, Lovable removed)
├── .env.example                   (new)
├── docs/
│   └── superpowers/specs/         (this design doc lives here)
├── infra/
│   └── supabase/                  (new — vendored upstream Supabase docker stack + overrides)
├── src/                           (largely unchanged)
│   └── integrations/supabase/client.ts  (env-driven, no hardcoded URL)
├── supabase/                      (unchanged shape)
│   ├── config.toml
│   ├── migrations/                (source of truth, never edit existing files)
│   └── functions/                 (10 edge functions)
├── tests/
│   └── integration/               (new — six-category integration test suite)
├── package.json                   (lovable-tagger removed; new staging build script)
├── vite.config.ts                 (lovable-tagger removed)
├── Dockerfile                     (build args for VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
└── docker-compose.yml             (gains a staging service)
```

## 5. Two-track build with subagents

### Track A — code / docs (this repo)
Lovable detachment, env-configurable Supabase client, CLAUDE.md drafting, build pipeline for staging.

**Subagent use:**
- `Explore` — inventory hardcoded `njdcyjxgtckgtzgzoctw` references and Lovable references.
- `general-purpose` — research current upstream Supabase self-hosted env-var contract so `.env.example` is correct.
- `feature-dev:code-reviewer` — review each commit-sized chunk.
- Main session — does all edits to shared files (`vite.config.ts`, `client.ts`, `CLAUDE.md`).

### Track B — infra / data (Linux host)
Stand up self-hosted Supabase, replay schema, seed synthetic data, deploy edge functions.

**Subagent use:**
- `general-purpose` — pull and summarise upstream `supabase/supabase` docker reference (env vars, version pins).
- `feature-dev:code-architect` — design the `infra/supabase/` layout (what to vendor, what to override).
- Main session — writes the runbook; user executes commands on the Linux host.

### Convergence
- Once both tracks land: build the integration test suite (uses outputs from both — env-configurable client from A, running self-hosted from B).
- After tests pass: design the migration / cutover in a separate spec.

## 6. Lovable detachment (Track A)

Concrete changes, each as a separate commit:

1. **README.md** — full rewrite. Project name, what it is (Peritus endpoint security platform), local dev steps, Docker run, link to `CLAUDE.md`. No Lovable references.
2. **package.json** — remove `lovable-tagger` from `devDependencies`. Add `"build:staging": "vite build --mode staging"` to scripts.
3. **vite.config.ts** — remove `import { componentTagger } from "lovable-tagger"` and its plugin call. Keep everything else.
4. **src/integrations/supabase/client.ts** — replace the two hardcoded constants:
   ```ts
   const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
   const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
   if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
     throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
   }
   ```
   Remove the "automatically generated" comment.
5. **.env.example** — at repo root. Lists `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, plus commented placeholders for edge-function secrets (`OPENAI_API_KEY`, `VIRUSTOTAL_API_KEY`, etc.) so they're discoverable.
6. **supabase/config.toml** — drop the `project_id = "njdcyjxgtckgtzgzoctw"` line. The Supabase CLI works against self-hosted via `--db-url`.
7. **Dockerfile** — accept `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as `ARG`s, expose them as `ENV` during `npm run build` so they bake into the static bundle.
8. **docker-compose.yml** — add a `peritus-secure-staging` service that builds with the staging args and publishes on `:9989`. Existing prod service stays untouched.

Acceptance for Track A:
- `npm run build` still produces the cloud-pointed bundle byte-equivalent to before (modulo the missing Lovable tagger comments injected into JSX).
- `npm run build:staging` produces a bundle pointed at the self-hosted URL.
- Both Docker images build and serve.
- No grep hit for `lovable` in the repo (except this design doc and the changelog).

## 7. Self-hosted Supabase stack (Track B)

### Base
Vendor the upstream `supabase/supabase` repo's `docker/` directory into `infra/supabase/` in this repo. Pinned versions; one git pull updates the whole stack.

### Services (single Docker Compose stack on the Linux host)
- `db` — Postgres 15 (`supabase/postgres` image), data on bind mount `/var/lib/peritus-supabase/db`
- `auth` — GoTrue
- `rest` — PostgREST
- `realtime` — Realtime server
- `storage` — Storage API + files on bind mount `/var/lib/peritus-supabase/storage`
- `imgproxy` — image transforms (keep — cheap)
- `meta` — pg-meta (Studio dependency)
- `studio` — Supabase Studio, bound to `127.0.0.1:3000` only
- `kong` — single public entry point on `:8000` internally
- `functions` — Edge Runtime (Deno) for the 10 edge functions
- `vector` — log collector (default in upstream compose, keep)

### TLS & access
- Caddy in front of Kong, automatic Let's Encrypt, public DNS like `supabase.peritus.<your-domain>`.
- Studio reachable via SSH tunnel only — never expose port 3000 publicly.

### Secrets (in `/etc/peritus-supabase/.env` on the host, not in git)
- `POSTGRES_PASSWORD` — `openssl rand -hex 24`
- `JWT_SECRET` — `openssl rand -hex 32` (**fresh — do not reuse the cloud project's secret**)
- `ANON_KEY`, `SERVICE_ROLE_KEY` — generated from `JWT_SECRET` using the Supabase CLI / online JWT tool
- `DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD` — for Studio Basic Auth
- `OPENAI_API_KEY`, `VIRUSTOTAL_API_KEY` — **test-tier or stubbed** keys for staging; not the prod keys

### Persistence & backups
- Postgres data: bind mount `/var/lib/peritus-supabase/db`
- Storage objects: bind mount `/var/lib/peritus-supabase/storage`
- Nightly `pg_dump | gzip > /var/backups/peritus-supabase/$(date +%F).sql.gz` cron, 14-day retention.
- Off-host backup destination (S3 / NAS / rsync target): **TBD**, see §10.

### Hardware target
- 4 vCPU / 8 GB RAM / 50 GB SSD, Ubuntu 22.04 LTS or Debian 12.

## 8. Schema replay + edge function deploy (Track B continued)

1. From a workstation with the Supabase CLI installed:
   ```
   supabase db push --db-url postgresql://postgres:<password>@<linux-host>:5432/postgres
   ```
   Replays every file in `supabase/migrations/` in lexicographic order.
2. Apply a new `supabase/seed.sql` (created during this work) with synthetic users, agents, CVE entries — enough to exercise every table.
3. Deploy edge functions:
   ```
   supabase functions deploy <name> --project-ref <self-hosted-ref>
   ```
   for each of the 10 functions, with staging-only secrets configured via `supabase secrets set`.

## 9. Validation gate — the six test categories

Lives in `tests/integration/`. Runnable via `npm run test:integration` against `SUPABASE_TEST_URL` + `SUPABASE_TEST_ANON_KEY`. All six must pass before any production migration design begins.

1. **Schema parity** — `pg_dump --schema-only` from both cloud and self-hosted; assert zero diff (modulo expected differences like extension versions).
2. **Auth flows** — signup, login, password reset, JWT issuance, JWT validation under RLS. Vitest + `@supabase/supabase-js`.
3. **RLS policies** — for every table with RLS enabled, automated positive (owner read/write) + negative (non-owner blocked) test cases. Enumerated from migration files by a `code-explorer` subagent.
4. **Edge functions** — each of the 10 invoked with realistic payloads; response shape and side effects asserted. External APIs (OpenAI, VirusTotal) hit either with test-tier keys or routed to a local mock server.
5. **Storage** — upload, download, list, delete in every bucket the app uses (buckets to be enumerated from migrations).
6. **End-to-end smoke** — Playwright (or similar) drives the staging frontend at `:9989` through the golden-path user flow.

Failures in any category block progression. Re-runnable in CI later.

## 10. Open decisions (living section)

- **Cutover style** — not chosen. Options:
  - *Staged data copy + flip*: bulk dump + delta sync; short maintenance window to flip.
  - *Shadow / dual-write*: app writes to both for a window, compare, then flip reads.
  - *Tenant- or table-by-table*: migrate slices one at a time.
  Decide once tests pass and we know more about data volume + downtime tolerance.
- **Off-host backup destination** for the staging Linux host — not chosen. Likely S3 or an internal NAS rsync target.
- **Linux host details** — actual hostname, IP, OS distribution: TBD at start of Track B.
- **DNS** — staging Supabase hostname and frontend hostname: TBD.
- **External API keys for staging** — whether to use separate test-tier keys for OpenAI / VirusTotal, or to stub them locally: TBD per function, default to stubbing where possible.

## 11. CLAUDE.md structure (single file, repo root)

Sections, in order:

1. **What this is** — one paragraph, the platform's purpose.
2. **Two environments** — table: prod (cloud) vs staging (self-hosted), with hostnames + ports + roles.
3. **Architecture** — terse component list with file pointers (entry points, edge functions one-liners, infra location).
4. **Local dev** — `npm i`, `.env.example` → `.env.local`, `npm run dev`. How to point at staging vs cloud.
5. **Environment variables** — table: name, where used, where to get it.
6. **Schema changes** — workflow: new file in `supabase/migrations/`, `supabase db push` against staging, run integration tests, **never edit existing migrations**.
7. **Edge functions** — workflow + which function hits which external API (so the needed secrets are obvious).
8. **Tests** — `npm run test` (unit), `npm run test:integration` (integration). Brief description of the six categories. Hard rule: integration tests must pass against staging before designing the prod cutover.
9. **Backup & restore** — where backups live, retention, restore command. Updated again once prod is self-hosted.
10. **Subagent workflow** — short pointer + when to use each specialised agent.
11. **What not to do** — rules not derivable from code:
    - Never reuse cloud's JWT secret on self-hosted.
    - Never edit committed migration files; always add a new one.
    - Never run integration tests against prod.
    - Never delete `supabase/config.toml`.
    - Don't reintroduce `lovable-tagger` or Lovable README badges.
12. **Open decisions** — short living list (mirrors §10 of this spec; gets pruned as decisions land).

Excluded from CLAUDE.md: file-tree dumps (repo is the source of truth), secrets (in `.env`), long step-by-step recipes (in scripts / runbooks).

## 12. Subagent workflow

### Principles
- Subagents handle research, exploration, and independent task streams. Main session handles synthesis, shared-file edits, and git operations.
- "Trust but verify" — main session always inspects the actual files before claiming a subagent's work is done.
- Single-file edits stay serial. `CLAUDE.md`, `vite.config.ts`, `src/integrations/supabase/client.ts` belong to the main session.

### Roster
| Agent | Use for |
|---|---|
| `Explore` | Fast read-only lookups: "where is X used", "list every RLS policy" |
| `feature-dev:code-explorer` | Deep architectural analysis of an existing area |
| `feature-dev:code-architect` | Implementation blueprints for new pieces |
| `feature-dev:code-reviewer` | Pre-commit review of non-trivial work |
| `general-purpose` | Open-ended research spanning code + external docs |
| `Plan` | Implementation strategy (via the `writing-plans` skill) |

### Phase-by-phase
- **Phase 0 — bootstrap.** Single `Explore` agent inventories hardcoded URL/Lovable references and RLS-protected tables. Output feeds both tracks.
- **Track A.** Parallel: `Explore` maps detachment surface; `general-purpose` researches upstream Supabase env-var contract. Main session implements. `code-reviewer` per commit chunk.
- **Track B.** Parallel: `general-purpose` summarises upstream docker reference; `code-architect` designs `infra/supabase/` layout. Main session writes runbook; user executes on the Linux host.
- **Phase 2 — test gate.** Parallel: one `code-explorer` enumerates edge function contracts; another enumerates RLS policies. `general-purpose` drafts seed data + fixtures. Main session assembles the suite. `code-reviewer` on the suite before declaring the gate met.

### Skills to layer on
- `superpowers:dispatching-parallel-agents` when launching 2+ independent agents in one message
- `superpowers:test-driven-development` during the test gate
- `superpowers:verification-before-completion` before reporting any phase as done
- `superpowers:requesting-code-review` after major chunks land

### Hard rules
- Never dispatch two subagents that edit the same file.
- Subagents never commit or push. Main session owns git after verifying changes.
- Subagents never run destructive commands against the Linux host or cloud Supabase. Read-only research only against external systems.

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Self-hosted JWT / key configuration mismatch with what the SDK expects | Use upstream `supabase/supabase` docker reference verbatim; test auth flow first |
| RLS policies behave differently against fresh DB (no real user IDs) | Synthetic seed creates the auth users via `auth.admin.createUser` so JWTs are real |
| Edge function external API rate-limiting in tests | Stub external APIs in the integration suite by default; flip to live calls only for explicit smoke tests |
| Forgetting which env a build is pointed at and shipping a cloud-pointed bundle to staging (or vice versa) | The `.env.production` / `.env.staging` separation; CI surfaces the embedded URL in build logs |
| Lovable might push automatic commits to the GitHub repo and re-introduce removed bits | Disconnect the GitHub integration on the Lovable side before merging detachment work |
| Backup retention only on the same host = single point of failure | §10 captures off-host backup as an open decision; resolve before promoting self-hosted to prod |

## 14. Acceptance criteria (this spec is "done" when…)

- Lovable references removed from the repo; `npm run dev` and `npm run build` still work pointed at cloud via env vars.
- Self-hosted Supabase running on the Linux host with all services healthy.
- All 20+ migrations replayed against self-hosted with zero schema diff vs cloud.
- All 10 edge functions deployed against self-hosted.
- Synthetic seed data loaded; six integration test categories implemented and passing.
- `CLAUDE.md` written with all 12 sections filled in.
- Cloud Supabase project untouched throughout.

When all of the above hold, this design is complete and the next design (production cutover) can begin.
