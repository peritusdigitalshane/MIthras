# Self-Hosted Supabase Stand-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tasks tagged `[Linux host]` execute on the target Linux host via SSH and are typically driven by the user with the assistant providing exact commands.

**Goal:** Stand up a self-hosted Supabase stack on a Linux host (TLS via Caddy, persistent volumes, nightly backups), replay all schema migrations from `supabase/migrations/`, deploy the 10 edge functions, and load synthetic seed data — without touching the cloud Supabase project.

**Architecture:** Vendor the upstream `supabase/supabase` Docker reference into `infra/supabase/upstream/`. Run all services (`db`, `auth`, `rest`, `realtime`, `storage`, `kong`, `studio`, `functions`, `meta`, `imgproxy`, `vector`) in one Docker Compose stack via the upstream `docker-compose.yml` plus our `docker-compose.override.yml` for local customisations. Front Kong with Caddy for automatic TLS. Persist Postgres and Storage to bind-mounted directories. Mount this repo's `supabase/functions/` into the edge runtime so functions are served from source. Schema is applied via `psql` over the Postgres port.

**Tech Stack:** Docker Compose, Postgres 15 (`supabase/postgres`), GoTrue, PostgREST, Realtime, Storage API, Kong, Supabase Edge Runtime (Deno), Caddy, Ubuntu 22.04 LTS or Debian 12.

**Companion design doc:** `docs/superpowers/specs/2026-05-12-supabase-self-host-and-workflow-design.md`

**Depends on:** Plan 1 (specifically `.env.staging.example` and the staging Docker service). Plan 1 should be merged before this plan's final tasks.

---

## File map

| File | Action |
|---|---|
| `infra/supabase/VENDORED.md` | Create — records upstream source + pinned commit |
| `infra/supabase/upstream/*` | Create — vendored upstream `docker/` directory (~30 files) |
| `infra/supabase/docker-compose.override.yml` | Create — our customisations on top of upstream |
| `infra/supabase/.env.template` | Create — env template for the Linux host |
| `infra/supabase/Caddyfile.template` | Create — TLS frontend template |
| `infra/supabase/RUNBOOK.md` | Create — host-side step-by-step |
| `infra/supabase/scripts/replay-migrations.sh` | Create — apply migrations via psql |
| `infra/supabase/scripts/backup.sh` | Create — nightly pg_dump |
| `infra/supabase/scripts/peritus-supabase-backup.service` | Create — systemd unit |
| `infra/supabase/scripts/peritus-supabase-backup.timer` | Create — systemd timer |
| `infra/supabase/scripts/schema-inventory.md` | Create — Explore subagent output |
| `supabase/seed.sql` | Create — synthetic seed data |

---

### Task 0 [User]: Decide and record host details

**Files:** none (this is information-gathering)

Capture the following before starting. These values feed every subsequent task. Write them in a private note — never commit them.

- [ ] **Step 1:** Pick the Linux host: hostname, IP, OS distribution (Ubuntu 22.04 LTS or Debian 12 recommended), SSH user with `sudo`.
- [ ] **Step 2:** Pick a public hostname for the Supabase API: e.g. `supabase.staging.<your-domain>`. DNS A record must point to the host.
- [ ] **Step 3:** Pick a TLS email for Let's Encrypt cert issuance.
- [ ] **Step 4:** Decide port exposure plan. Defaults used in this plan:
  - `80`/`443` — Caddy (public)
  - Kong `:8000` — bound to `127.0.0.1` only, accessed via Caddy
  - Postgres `:5432` — bound to `127.0.0.1` only, accessed via SSH tunnel for `psql`
  - Studio — bound to `127.0.0.1:3000`, SSH tunnel only
- [ ] **Step 5:** Note acceptable for staging: a single bare-metal or VM host, 4 vCPU / 8 GB RAM / 50 GB SSD minimum.

No commit — informational.

---

### Task 1 [Repo]: Create `infra/supabase/` skeleton

**Files:**
- Create: `infra/supabase/VENDORED.md`

- [ ] **Step 1:** Create the directory.

```
mkdir -p infra/supabase
```

- [ ] **Step 2:** Create `infra/supabase/VENDORED.md` with this content:

```markdown
# Vendored Supabase Docker reference

This directory contains a vendored copy of the `docker/` directory from
[`supabase/supabase`](https://github.com/supabase/supabase), used as the base
for our self-hosted stack.

- **Upstream:** https://github.com/supabase/supabase
- **Vendored path:** `docker/` → `infra/supabase/upstream/`
- **Pinned commit:** (filled in by Task 2 below)
- **Vendored at:** (date filled in by Task 2 below)

## Why vendor instead of submodule?

Submodules complicate cloning and create version drift between checkouts. A
flat vendor copy with a recorded commit hash makes the state visible in `git
diff` and easy to update with a single re-vendor pass.

## How to update

```sh
# 1. Pull the latest upstream into a temp dir
git clone --depth 1 https://github.com/supabase/supabase.git /tmp/supabase-upstream

# 2. Note the commit hash
git -C /tmp/supabase-upstream rev-parse HEAD

# 3. Replace our copy
rm -rf infra/supabase/upstream
cp -r /tmp/supabase-upstream/docker infra/supabase/upstream

# 4. Update this file with the new commit hash and date
# 5. Resolve any conflicts in docker-compose.override.yml
# 6. Commit
```

## Customisations (do NOT modify the upstream files)

All our customisations live in `infra/supabase/docker-compose.override.yml`.
This means we can re-vendor upstream cleanly and re-apply our overrides as a
patch.
```

- [ ] **Step 3:** Commit.

```
git add infra/supabase/VENDORED.md
git commit -m "infra: scaffold infra/supabase with vendoring policy"
```

---

### Task 2 [Repo]: Vendor the upstream Supabase Docker reference

**Files:**
- Create: `infra/supabase/upstream/*` (vendored directory contents)
- Modify: `infra/supabase/VENDORED.md`

- [ ] **Step 1:** Clone upstream and capture the commit hash.

```
git clone --depth 1 https://github.com/supabase/supabase.git /tmp/supabase-upstream
git -C /tmp/supabase-upstream rev-parse HEAD
```

Record the commit hash output for Step 3.

- [ ] **Step 2:** Copy the `docker/` directory into our repo.

```
cp -r /tmp/supabase-upstream/docker infra/supabase/upstream
```

- [ ] **Step 3:** Update `infra/supabase/VENDORED.md` — fill in the `Pinned commit` and `Vendored at` lines with the hash from Step 1 and today's date.

- [ ] **Step 4:** Inspect what was vendored.

```
ls infra/supabase/upstream/
```

Expected: includes at minimum `docker-compose.yml`, `.env.example`, and a `volumes/` directory.

- [ ] **Step 5:** Clean up the temp clone.

```
rm -rf /tmp/supabase-upstream
```

- [ ] **Step 6:** Commit.

```
git add infra/supabase/upstream infra/supabase/VENDORED.md
git commit -m "infra(supabase): vendor upstream docker reference"
```

---

### Task 3 [Repo]: Create `docker-compose.override.yml` for our customisations

This file lives at `infra/supabase/docker-compose.override.yml` and is auto-merged by Docker Compose when both files are in the same working directory. It overrides volume mounts, port bindings, and adds the edge functions source mount.

**Files:**
- Create: `infra/supabase/docker-compose.override.yml`

- [ ] **Step 1:** Look at the upstream `docker-compose.yml` to identify exact service names. They typically are: `studio`, `kong`, `auth`, `rest`, `realtime`, `storage`, `imgproxy`, `meta`, `functions`, `analytics` (vector), `db`, `vector`. Note them.

```
grep -E "^\s+[a-z-]+:" infra/supabase/upstream/docker-compose.yml | head -20
```

Use the exact service names from the output below in the override file.

- [ ] **Step 2:** Create `infra/supabase/docker-compose.override.yml`:

```yaml
# Customisations layered on top of the vendored upstream docker-compose.yml.
# Applied automatically when both files are in the same dir.
#
# Run: docker compose -f infra/supabase/upstream/docker-compose.yml \
#                    -f infra/supabase/docker-compose.override.yml up -d

services:

  db:
    # Bind Postgres data to a host directory we control (NOT the upstream
    # default named-volume) so backups, restores, and sizing are explicit.
    volumes:
      - /var/lib/peritus-supabase/db:/var/lib/postgresql/data
    # Bind Postgres to loopback only — psql access is via SSH tunnel.
    ports:
      - "127.0.0.1:5432:5432"

  storage:
    # Bind Storage objects to a host directory for the same reasons.
    volumes:
      - /var/lib/peritus-supabase/storage:/var/lib/storage

  studio:
    # Studio admin UI — loopback only, access via SSH tunnel.
    ports:
      - "127.0.0.1:3000:3000"

  kong:
    # Kong API gateway — loopback only, fronted by Caddy on the host.
    ports:
      - "127.0.0.1:8000:8000"
      - "127.0.0.1:8443:8443"

  functions:
    # Mount this repo's supabase/functions into the edge runtime so deploys
    # are just a git pull + docker compose restart functions.
    # The host path is set via the FUNCTIONS_SOURCE env var (see .env).
    volumes:
      - ${FUNCTIONS_SOURCE}:/home/deno/functions:ro
```

- [ ] **Step 3:** Commit.

```
git add infra/supabase/docker-compose.override.yml
git commit -m "infra(supabase): add docker compose override for our bindings"
```

---

### Task 4 [Repo]: Create `.env.template` for the stack

The upstream ships an `.env.example`. We add our own template that documents the additional vars we need (FUNCTIONS_SOURCE, edge-function secrets) and adds a generation playbook.

**Files:**
- Create: `infra/supabase/.env.template`

- [ ] **Step 1:** Create `infra/supabase/.env.template`:

```bash
# Self-hosted Supabase stack — host-side env file.
# COPY THIS TO /etc/peritus-supabase/.env on the Linux host. Do NOT commit
# the filled-in version.
#
# Generate values:
#   POSTGRES_PASSWORD     openssl rand -hex 24
#   JWT_SECRET            openssl rand -hex 32         (fresh — not cloud's!)
#   ANON_KEY              derived from JWT_SECRET (see RUNBOOK.md)
#   SERVICE_ROLE_KEY      derived from JWT_SECRET (see RUNBOOK.md)
#   DASHBOARD_USERNAME    your choice
#   DASHBOARD_PASSWORD    openssl rand -hex 16

# --- Core Supabase (consumed by upstream compose) ---------------------------
POSTGRES_PASSWORD=
JWT_SECRET=
ANON_KEY=
SERVICE_ROLE_KEY=
DASHBOARD_USERNAME=
DASHBOARD_PASSWORD=

# Database (defaults used by upstream)
POSTGRES_HOST=db
POSTGRES_DB=postgres
POSTGRES_PORT=5432

# API URL (Caddy fronts this — used to construct redirect URIs etc.)
SITE_URL=https://supabase.staging.example
API_EXTERNAL_URL=https://supabase.staging.example
SUPABASE_PUBLIC_URL=https://supabase.staging.example

# Studio
STUDIO_DEFAULT_ORGANIZATION=Peritus
STUDIO_DEFAULT_PROJECT=peritus-staging

# Pooler / additional upstream vars — see infra/supabase/upstream/.env.example
# for the full list. Copy anything else needed from there with sensible
# defaults (most can be left at upstream defaults for staging).

# --- Our customisations -----------------------------------------------------

# Absolute path on the Linux host to this repo's supabase/functions/ dir.
# The compose override mounts this read-only into the edge runtime.
FUNCTIONS_SOURCE=/opt/peritus-endpoint-guardian/supabase/functions

# --- Edge-function secrets (consumed by the functions container) ------------
# These appear inside edge functions as Deno.env.get("OPENAI_API_KEY") etc.
# Use TEST-tier keys here, not production ones.
OPENAI_API_KEY=
VIRUSTOTAL_API_KEY=
```

- [ ] **Step 2:** Commit.

```
git add infra/supabase/.env.template
git commit -m "infra(supabase): add .env.template for the host"
```

---

### Task 5 [Repo]: Create `Caddyfile.template`

**Files:**
- Create: `infra/supabase/Caddyfile.template`

- [ ] **Step 1:** Create `infra/supabase/Caddyfile.template`:

```caddyfile
# /etc/caddy/Caddyfile on the Linux host.
# Replace supabase.staging.example with your real public hostname.

{
    email letsencrypt@your-domain.example
}

supabase.staging.example {
    # All Supabase API traffic (auth, rest, realtime, storage, functions)
    # flows through Kong at 127.0.0.1:8000.
    reverse_proxy 127.0.0.1:8000 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }

    # Sensible logging
    log {
        output file /var/log/caddy/supabase.log {
            roll_size 10mb
            roll_keep 5
        }
    }
}
```

- [ ] **Step 2:** Commit.

```
git add infra/supabase/Caddyfile.template
git commit -m "infra(supabase): add Caddyfile template for TLS termination"
```

---

### Task 6 [Repo]: Create `replay-migrations.sh`

**Files:**
- Create: `infra/supabase/scripts/replay-migrations.sh`

- [ ] **Step 1:** Create the script:

```bash
#!/usr/bin/env bash
# Replays all SQL migrations from supabase/migrations/ against a target DB.
# Run from the repo root, OR pass DB_URL with the full connection string.
#
# Usage:
#   DB_URL=postgresql://postgres:<pass>@127.0.0.1:5432/postgres \
#     ./infra/supabase/scripts/replay-migrations.sh

set -euo pipefail

: "${DB_URL:?Set DB_URL to your self-hosted Supabase Postgres connection string}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"

if [ ! -d "$MIGRATIONS_DIR" ]; then
    echo "ERROR: migrations dir not found at $MIGRATIONS_DIR" >&2
    exit 1
fi

count=0
for f in "$MIGRATIONS_DIR"/*.sql; do
    echo ">>> Applying $(basename "$f")"
    psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$f"
    count=$((count+1))
done

echo
echo "Applied $count migration files."
```

- [ ] **Step 2:** Make executable.

```
chmod +x infra/supabase/scripts/replay-migrations.sh
```

- [ ] **Step 3:** Commit.

```
git add infra/supabase/scripts/replay-migrations.sh
git commit -m "infra(supabase): add migration replay script"
```

---

### Task 7 [Repo]: Create backup script + systemd units

**Files:**
- Create: `infra/supabase/scripts/backup.sh`
- Create: `infra/supabase/scripts/peritus-supabase-backup.service`
- Create: `infra/supabase/scripts/peritus-supabase-backup.timer`

- [ ] **Step 1:** Create `infra/supabase/scripts/backup.sh`:

```bash
#!/usr/bin/env bash
# Nightly pg_dump of the self-hosted Supabase Postgres.
# Run via systemd timer (see peritus-supabase-backup.timer).

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/peritus-supabase}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%F-%H%M)
OUT_FILE="$BACKUP_DIR/$TIMESTAMP.sql.gz"

echo "[$(date -Iseconds)] Starting backup to $OUT_FILE"
docker exec "$DB_CONTAINER" pg_dump -U postgres postgres | gzip > "$OUT_FILE"

echo "[$(date -Iseconds)] Pruning backups older than $RETAIN_DAYS days"
find "$BACKUP_DIR" -name "*.sql.gz" -mtime "+$RETAIN_DAYS" -delete

echo "[$(date -Iseconds)] Backup complete."
```

- [ ] **Step 2:** Create `infra/supabase/scripts/peritus-supabase-backup.service`:

```ini
[Unit]
Description=Peritus Supabase nightly pg_dump
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/opt/peritus-supabase/backup.sh
StandardOutput=journal
StandardError=journal
```

- [ ] **Step 3:** Create `infra/supabase/scripts/peritus-supabase-backup.timer`:

```ini
[Unit]
Description=Run peritus-supabase-backup daily at 03:00

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true
Unit=peritus-supabase-backup.service

[Install]
WantedBy=timers.target
```

- [ ] **Step 4:** Make the shell script executable.

```
chmod +x infra/supabase/scripts/backup.sh
```

- [ ] **Step 5:** Commit.

```
git add infra/supabase/scripts/backup.sh \
        infra/supabase/scripts/peritus-supabase-backup.service \
        infra/supabase/scripts/peritus-supabase-backup.timer
git commit -m "infra(supabase): add nightly backup script + systemd timer"
```

---

### Task 8 [Repo]: Inventory tables, RLS policies, buckets, and edge-function secrets

Dispatch an `Explore` subagent to read the full migration history and the edge function sources, producing an inventory file that informs both `seed.sql` and the integration tests in plan 3.

**Files:**
- Create: `infra/supabase/scripts/schema-inventory.md`

- [ ] **Step 1:** Dispatch an Explore subagent with this prompt:

```
Read every file in supabase/migrations/ in order, plus the README of each
supabase/functions/<name>/ directory and any index.ts therein. Produce a
markdown report saved to infra/supabase/scripts/schema-inventory.md with these
sections:

1. **Tables** — every CREATE TABLE in public schema. For each: name, columns
   with types, whether RLS is enabled, and which CREATE POLICY statements
   target it.
2. **RLS policies** — list each policy by (table, name, op, using/with-check
   expression).
3. **Storage buckets** — every INSERT INTO storage.buckets, with bucket id +
   public flag.
4. **Edge function inventory** — for each of the 10 functions
   (agent-api, agent-script, ai-security-advisor, check-openai-models,
    cleanup-old-data, cve-auto-protect, cve-mitigation-advisor,
    router-checkin, virustotal-lookup, vulnerability-scan):
   a. HTTP method(s) accepted
   b. Expected request body shape (TypeScript-style)
   c. Response shape on success
   d. External APIs called (OpenAI, VirusTotal, ...) and which env vars they
      need
5. **Roles / extensions** — any CREATE ROLE, CREATE EXTENSION not in default
   Supabase stack.

Be exhaustive. Don't summarise — list every item. Output a single markdown
file, no commentary.
```

- [ ] **Step 2:** Inspect the output file. Confirm at minimum:
  - At least the major tables are listed (profiles, agents, scan_results, etc — whatever the migrations create)
  - At least 10 edge function entries
  - At least one storage bucket reference (or "no storage buckets defined" stated explicitly)

If anything looks thin, re-dispatch the subagent with a more specific re-read instruction.

- [ ] **Step 3:** Commit.

```
git add infra/supabase/scripts/schema-inventory.md
git commit -m "infra(supabase): inventory schema + edge-function contracts"
```

---

### Task 9 [Repo]: Write `supabase/seed.sql`

Synthetic seed data covering every table from the inventory. Designed so RLS-aware tests can run end-to-end without real production data.

**Files:**
- Create: `supabase/seed.sql`

- [ ] **Step 1:** Open `infra/supabase/scripts/schema-inventory.md`. For each public table, plan one or two synthetic rows.

- [ ] **Step 2:** Create `supabase/seed.sql` following this structure (adapt rows to the actual columns from the inventory):

```sql
-- Synthetic seed data for the self-hosted Supabase staging instance.
-- This file is loaded AFTER all schema migrations have been applied.
--
-- Conventions:
--   * Test user IDs are stable UUIDs starting with 11111111-...
--   * No production-shaped data is used.
--   * Foreign keys are resolved in row order.

-- ---------------------------------------------------------------------------
-- 1. Auth users (use auth.admin equivalent: insert directly into auth.users
--    with a deterministic id; GoTrue will accept this since we control the DB.)
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data,
    raw_user_meta_data, is_super_admin
) VALUES
    ('00000000-0000-0000-0000-000000000000',
     '11111111-1111-1111-1111-111111111111',
     'authenticated', 'authenticated',
     'owner-a@test.peritus.local',
     -- bcrypt hash for "test-password-a" — generated with htpasswd -bnBC 10 ...
     '$2a$10$REPLACE_ME_WITH_BCRYPT_HASH_GENERATED_BY_RUNBOOK_STEP',
     NOW(), NOW(), NOW(),
     '{"provider":"email","providers":["email"]}',
     '{}',
     false),
    ('00000000-0000-0000-0000-000000000000',
     '22222222-2222-2222-2222-222222222222',
     'authenticated', 'authenticated',
     'owner-b@test.peritus.local',
     '$2a$10$REPLACE_ME_WITH_BCRYPT_HASH_GENERATED_BY_RUNBOOK_STEP',
     NOW(), NOW(), NOW(),
     '{"provider":"email","providers":["email"]}',
     '{}',
     false)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Application tables (FILL FROM INVENTORY)
--
-- For each table listed in infra/supabase/scripts/schema-inventory.md, add
-- INSERTs here. Resolve FKs by referring to the user UUIDs above where
-- appropriate. Use ON CONFLICT (id) DO NOTHING so the seed is idempotent.
--
-- Example template per table:
--
-- INSERT INTO public.<table_name> (id, user_id, <other_cols>) VALUES
--   ('<uuid-a>', '11111111-1111-1111-1111-111111111111', <test values>),
--   ('<uuid-b>', '22222222-2222-2222-2222-222222222222', <test values>)
-- ON CONFLICT (id) DO NOTHING;
-- ---------------------------------------------------------------------------

-- (Fill in below using the inventory file.)
```

- [ ] **Step 3:** For each table in the inventory, append a properly-typed INSERT block following the template. Keep two rows per table where possible (one owned by user A, one owned by user B) so RLS tests have both positive and negative cases.

- [ ] **Step 4:** Generate bcrypt hashes for the two test passwords.

```
docker run --rm httpd:alpine htpasswd -bnBC 10 "" test-password-a | tr -d ':\n'
docker run --rm httpd:alpine htpasswd -bnBC 10 "" test-password-b | tr -d ':\n'
```

Paste each output as the `encrypted_password` value in the corresponding `auth.users` row, replacing the `$2a$10$REPLACE_ME_...` placeholders.

- [ ] **Step 5:** Verify the file is syntactically valid SQL by running it against a throwaway local Postgres.

```
docker run --rm -e POSTGRES_PASSWORD=temp -d --name pg-syntax-check postgres:15
sleep 5
docker cp supabase/seed.sql pg-syntax-check:/seed.sql
# A pure syntax check — expect errors about missing tables, but no syntax errors.
docker exec pg-syntax-check psql -U postgres -c "DO \$\$ BEGIN RAISE NOTICE 'syntax check'; END \$\$;"
docker exec pg-syntax-check psql -U postgres -f /seed.sql 2>&1 | head -5 || true
docker stop pg-syntax-check
```

The errors should be table-not-found / function-not-found, NOT parse errors. If you see syntax errors, fix them.

- [ ] **Step 6:** Commit.

```
git add supabase/seed.sql
git commit -m "feat(supabase): add synthetic seed.sql for staging"
```

---

### Task 10 [Repo]: Write the host runbook

A clear step-by-step the user follows on the Linux host. The runbook lives in the repo so future operators have it; the actual execution happens in Tasks 11–17.

**Files:**
- Create: `infra/supabase/RUNBOOK.md`

- [ ] **Step 1:** Create `infra/supabase/RUNBOOK.md`:

````markdown
# Self-hosted Supabase — Host Runbook

Step-by-step for standing up the Peritus self-hosted Supabase stack on a
fresh Linux host. Use the values you captured in Task 0 of the standup plan.

## Prerequisites on the host

- Ubuntu 22.04 LTS or Debian 12
- Sudo user
- Docker + Docker Compose plugin (`docker compose version` returns v2.x)
- Caddy installed (`apt install caddy`)
- DNS A record for your public hostname pointed at the host
- Ports 80 and 443 open inbound

## 1. Clone the repo onto the host

```sh
sudo mkdir -p /opt/peritus-endpoint-guardian
sudo chown "$USER":"$USER" /opt/peritus-endpoint-guardian
git clone https://github.com/peritusdigitalshane/peritus-endpoint-guardian.git \
    /opt/peritus-endpoint-guardian
cd /opt/peritus-endpoint-guardian
```

## 2. Create persistent volume directories

```sh
sudo mkdir -p /var/lib/peritus-supabase/db
sudo mkdir -p /var/lib/peritus-supabase/storage
sudo mkdir -p /var/backups/peritus-supabase
sudo chown -R 1000:1000 /var/lib/peritus-supabase
```

## 3. Generate Supabase secrets

```sh
sudo mkdir -p /etc/peritus-supabase
sudo cp infra/supabase/.env.template /etc/peritus-supabase/.env
sudo chmod 600 /etc/peritus-supabase/.env

POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
DASHBOARD_PASSWORD=$(openssl rand -hex 16)

# Generate ANON_KEY and SERVICE_ROLE_KEY from JWT_SECRET.
# Easiest: use the upstream supabase jwt generator. One option:
docker run --rm -e JWT_SECRET="$JWT_SECRET" \
    -e EXP=$(($(date +%s) + 60*60*24*365*10)) \
    node:20-alpine sh -c '
  echo "ANON_KEY=$(node -e "const j=require(\"jsonwebtoken\");console.log(j.sign({iss:\"supabase\",role:\"anon\",iat:Math.floor(Date.now()/1000),exp:'$EXP'},process.env.JWT_SECRET))" 2>/dev/null)"
  echo "SERVICE_ROLE_KEY=$(node -e "const j=require(\"jsonwebtoken\");console.log(j.sign({iss:\"supabase\",role:\"service_role\",iat:Math.floor(Date.now()/1000),exp:'$EXP'},process.env.JWT_SECRET))")"
' || {
  echo "Falling back to manual generation — see https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys"
}
```

Open `/etc/peritus-supabase/.env` and fill in:
- `POSTGRES_PASSWORD` (from above)
- `JWT_SECRET` (from above)
- `ANON_KEY` (from above)
- `SERVICE_ROLE_KEY` (from above)
- `DASHBOARD_USERNAME` (your choice)
- `DASHBOARD_PASSWORD` (from above)
- `SITE_URL`, `API_EXTERNAL_URL`, `SUPABASE_PUBLIC_URL` (your public Caddy hostname)
- `FUNCTIONS_SOURCE=/opt/peritus-endpoint-guardian/supabase/functions`
- `OPENAI_API_KEY`, `VIRUSTOTAL_API_KEY` (test-tier values)
- Any additional upstream vars listed in `infra/supabase/upstream/.env.example`
  that you want to override (most defaults are fine for staging)

## 4. Bring up the stack

```sh
cd /opt/peritus-endpoint-guardian/infra/supabase

# Symlink the .env so compose picks it up
ln -sf /etc/peritus-supabase/.env ./upstream/.env

# Start (with our override)
docker compose -f upstream/docker-compose.yml \
               -f docker-compose.override.yml \
               up -d

# Watch health
docker compose -f upstream/docker-compose.yml \
               -f docker-compose.override.yml \
               ps
```

All services should reach `running (healthy)` within 1–2 minutes.

## 5. Verify each service responds

```sh
# Postgres (via the bound loopback port)
PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U postgres -c "SELECT version();"

# REST (via Kong)
curl -s http://127.0.0.1:8000/rest/v1/ -H "apikey: $ANON_KEY" | head

# Auth (via Kong)
curl -s http://127.0.0.1:8000/auth/v1/health | head

# Storage (via Kong)
curl -s http://127.0.0.1:8000/storage/v1/status | head
```

## 6. Set up Caddy

```sh
sudo cp infra/supabase/Caddyfile.template /etc/caddy/Caddyfile
# Replace supabase.staging.example with your real hostname AND set your real
# email in the global block at the top of the file.
sudo nano /etc/caddy/Caddyfile

sudo systemctl reload caddy
```

Wait ~30 seconds for cert issuance, then:

```sh
curl -I https://supabase.<your-hostname>/auth/v1/health
```

Expected: `HTTP/2 200`.

## 7. Studio access (SSH tunnel)

From your laptop:

```sh
ssh -L 3000:127.0.0.1:3000 your-user@your-host
```

Then open `http://localhost:3000` and log in with `DASHBOARD_USERNAME` /
`DASHBOARD_PASSWORD` from `/etc/peritus-supabase/.env`.

## 8. Install the backup timer

```sh
sudo cp infra/supabase/scripts/backup.sh /opt/peritus-supabase/backup.sh
sudo cp infra/supabase/scripts/peritus-supabase-backup.service /etc/systemd/system/
sudo cp infra/supabase/scripts/peritus-supabase-backup.timer /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable --now peritus-supabase-backup.timer

# Verify
systemctl list-timers peritus-supabase-backup.timer
```

## 9. Replay schema migrations

From your laptop with the repo checked out (NOT from the Linux host; we run
the script against the bound loopback Postgres via an SSH tunnel):

```sh
# In one terminal: open the tunnel
ssh -L 5432:127.0.0.1:5432 your-user@your-host

# In another terminal: run the replay script
DB_URL="postgresql://postgres:$POSTGRES_PASSWORD@127.0.0.1:5432/postgres" \
    ./infra/supabase/scripts/replay-migrations.sh
```

Expected: each migration prints `>>> Applying ...` with no errors.

## 10. Apply the synthetic seed

```sh
DB_URL="postgresql://postgres:$POSTGRES_PASSWORD@127.0.0.1:5432/postgres" \
    psql "$DB_URL" -f supabase/seed.sql
```

Expected: rows inserted, no errors.

## 11. Verify edge functions are serving

The `functions` container mounts `supabase/functions/` read-only. Any change
on the host requires `docker compose restart functions`.

```sh
curl -s http://127.0.0.1:8000/functions/v1/check-openai-models \
     -H "Authorization: Bearer $ANON_KEY"
```

Expected: a JSON response (the exact shape depends on the function — see
`infra/supabase/scripts/schema-inventory.md`).

## 12. Smoke test from your laptop with the staging frontend

Update `.env.staging` in the repo on your laptop with the self-hosted URL
and `ANON_KEY`, then:

```sh
npm run build:staging
npm run preview
```

Open the preview URL, sign in as `owner-a@test.peritus.local` / `test-password-a`.

## Troubleshooting

- **`db` container won't start** — check `/var/lib/peritus-supabase/db` is
  empty before first run; mounting a non-empty dir prevents init.
- **Caddy certs fail** — confirm DNS is correct and ports 80/443 are open.
- **`functions` can't see edge functions** — verify `FUNCTIONS_SOURCE` is an
  absolute path, the directory exists, and contains an `index.ts` in each
  subdir.
- **Auth issues with self-hosted JWTs** — confirm `JWT_SECRET` is the SAME
  value used to generate `ANON_KEY` and `SERVICE_ROLE_KEY`. A mismatch causes
  silent 401s.
````

- [ ] **Step 2:** Commit.

```
git add infra/supabase/RUNBOOK.md
git commit -m "docs(supabase): add self-hosted runbook"
```

---

### Task 11 [Linux host]: Provision and bring up the stack

This is where the user follows the runbook on the actual host.

- [ ] **Step 1:** SSH to the host as the sudo user.
- [ ] **Step 2:** Execute Runbook §1 (clone repo).
- [ ] **Step 3:** Execute Runbook §2 (volume directories).
- [ ] **Step 4:** Execute Runbook §3 (generate secrets, fill `.env`).
- [ ] **Step 5:** Execute Runbook §4 (`docker compose up -d`). Wait for all services healthy.
- [ ] **Step 6:** Execute Runbook §5 (per-service curl checks). All four should return 200/expected JSON.

Acceptance: `docker compose ps` shows all services `running (healthy)`.

No commit.

---

### Task 12 [Linux host]: Caddy + TLS

- [ ] **Step 1:** Execute Runbook §6 (`Caddyfile`, reload Caddy).
- [ ] **Step 2:** Verify HTTPS health endpoint:

```
curl -I https://<your-public-supabase-hostname>/auth/v1/health
```

Expected: `HTTP/2 200`. Cert should be Let's Encrypt valid.

- [ ] **Step 3:** Execute Runbook §7 (Studio SSH tunnel). Confirm Studio loads in browser.

Acceptance: public HTTPS endpoint responds, Studio login works.

No commit.

---

### Task 13 [Linux host]: Backup timer

- [ ] **Step 1:** Execute Runbook §8 (install backup script + systemd units).
- [ ] **Step 2:** Trigger a backup manually to verify it works end-to-end:

```
sudo systemctl start peritus-supabase-backup.service
journalctl -u peritus-supabase-backup.service -n 30
ls -lh /var/backups/peritus-supabase/
```

Expected: a `YYYY-MM-DD-HHMM.sql.gz` file exists and is non-empty.

Acceptance: at least one backup file present; timer is `active (waiting)`.

No commit.

---

### Task 14 [Repo → Linux host]: Replay schema migrations

- [ ] **Step 1:** From your laptop, open the SSH tunnel:

```
ssh -L 5432:127.0.0.1:5432 your-user@your-host
```

- [ ] **Step 2:** In a second terminal at the repo root, run replay:

```
DB_URL="postgresql://postgres:<POSTGRES_PASSWORD-from-.env>@127.0.0.1:5432/postgres" \
    ./infra/supabase/scripts/replay-migrations.sh
```

Expected: every `>>> Applying ...` line completes without error. Final line reports the count.

- [ ] **Step 3:** Verify a known table exists.

```
psql "$DB_URL" -c "\dt public.*" | head -20
```

Expected: tables from the migrations (per the schema-inventory file) are present.

Acceptance: all 20+ migrations applied, no errors.

No commit.

---

### Task 15 [Repo → Linux host]: Apply the seed

- [ ] **Step 1:** With the SSH tunnel still open:

```
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql
```

Expected: rows inserted without error.

- [ ] **Step 2:** Verify test users exist.

```
psql "$DB_URL" -c "SELECT email FROM auth.users WHERE email LIKE '%test.peritus.local';"
```

Expected: both `owner-a@test.peritus.local` and `owner-b@test.peritus.local`.

Acceptance: seed loaded; test users present.

No commit.

---

### Task 16 [Linux host]: Configure edge function secrets + verify functions

- [ ] **Step 1:** On the host, confirm the functions container mounted the source correctly:

```
docker compose -f /opt/peritus-endpoint-guardian/infra/supabase/upstream/docker-compose.yml \
               -f /opt/peritus-endpoint-guardian/infra/supabase/docker-compose.override.yml \
               exec functions ls -la /home/deno/functions
```

Expected: a directory entry for each of the 10 functions.

- [ ] **Step 2:** Set test-tier values for `OPENAI_API_KEY` and `VIRUSTOTAL_API_KEY` in `/etc/peritus-supabase/.env` and restart the functions container:

```
sudo nano /etc/peritus-supabase/.env  # fill in test keys

cd /opt/peritus-endpoint-guardian/infra/supabase
docker compose -f upstream/docker-compose.yml \
               -f docker-compose.override.yml \
               restart functions
```

- [ ] **Step 3:** Smoke-test one function (`check-openai-models` is a good choice — minimal payload).

```
ANON_KEY="$(grep '^ANON_KEY=' /etc/peritus-supabase/.env | cut -d= -f2-)"

curl -s -X POST http://127.0.0.1:8000/functions/v1/check-openai-models \
     -H "Authorization: Bearer $ANON_KEY" \
     -H "Content-Type: application/json" \
     -d '{}' | head -c 500
```

Expected: a JSON response. If `OPENAI_API_KEY` is set to a real test value, you'll see a model list; if stubbed, you'll see whatever error the function returns for an invalid key — that's still proof the function is serving.

Acceptance: at least one function responds end-to-end.

No commit.

---

### Task 17 [Repo]: Wire the staging frontend to the new instance

- [ ] **Step 1:** On your laptop, in the repo root, copy the template and fill in the real self-hosted values:

```
cp .env.staging.example .env.staging
# Edit .env.staging:
#   VITE_SUPABASE_URL=https://<your-public-supabase-hostname>
#   VITE_SUPABASE_ANON_KEY=<ANON_KEY from /etc/peritus-supabase/.env>
```

`.env.staging` is gitignored (per plan 1) — do not commit.

- [ ] **Step 2:** Build the staging bundle.

```
npm run build:staging
```

Expected: succeeds; bundle now contains the self-hosted hostname.

- [ ] **Step 3:** Smoke-test in the browser.

```
npm run preview
```

Open the preview URL, sign in with `owner-a@test.peritus.local` / `test-password-a`. Confirm:
- Login succeeds
- App loads dashboard data (seeded rows visible)
- DevTools Network tab shows requests going to the self-hosted hostname (not the cloud URL)

- [ ] **Step 4:** Stop the preview.

Press Ctrl-C.

No commit — `.env.staging` is intentionally not tracked.

---

## Plan 2 done

Self-hosted Supabase is running, schema is in, seed is loaded, edge functions are responding, backups are scheduled, the staging frontend can sign in against it. Cloud Supabase is untouched.

Proceed to plan 3 to formalise the validation gate (integration tests) and write `CLAUDE.md`.
