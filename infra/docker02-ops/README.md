# docker02 Operations

Defensive infrastructure that lives on docker02 (`root@149.28.186.142`).
Tracked here so it survives rebuild + can be reviewed.

## What's here

| File | Server path | Purpose |
|------|-------------|---------|
| `SUPABASE-RUNBOOK.md` | `/opt/peritus-supabase/RUNBOOK.md` | Operations playbook for the supabase stack — invocation patterns, restore procedure, gotrue migration stamp fix |
| `supabase-docker-compose.override.yml` | `/opt/peritus-supabase/docker-compose.override.yml` | Maps the real production data volumes (db, storage, functions). The base `docker-compose.yml` references undefined named volumes so missing this override fails at config-validation time |
| `peritus-preflight.sh` | `/usr/local/bin/peritus-preflight.sh` | Sanity-check helper — verifies the prod data dir + sentinel + functions dir before any maintenance op |
| `db-integrity-check.sh` | `/opt/peritus-monitoring/db-integrity-check.sh` | Runs every 5 min via cron, emails on >50% row drop from baseline or missing/stale backup |
| `refresh-baselines.sh` | `/opt/peritus-monitoring/refresh-baselines.sh` | Snapshots current critical-table counts into `/etc/peritus-baselines.env`. Run after intentional scale changes |
| `cron.d-peritus-db-integrity-check` | `/etc/cron.d/peritus-db-integrity-check` | Wires the integrity check to cron |

## Why this exists

A SEV-1 on 2026-06-11 wasted ~90 minutes restoring from backup to discover
the production data had never been wiped — it was just unmounted because a
`docker compose -f docker-compose.yml ...` invocation skipped the override
file. The override is what maps `/var/lib/peritus-supabase/db` (the real
4.8GB data) onto the container. Without it, docker uses the base file's
empty `./volumes/db/data` and postgres initdb writes a fresh cluster there.
By the time the agents notice they can't write heartbeats, the engineer is
already debugging the wrong thing.

Defence layered:

1. **Structural impossibility** — base `docker-compose.yml` references
   undefined named volumes (`peritus-*-must-use-override-yml`). Any
   invocation missing the override fails at `config` validation with a
   clear `service "X" refers to undefined volume Y: invalid compose project`
   error. No containers are created. No data is touched.
2. **Pre-flight check** — `peritus-preflight.sh` verifies the prod data
   dir is plausible before any maintenance op. Refuses to confirm if
   anything looks wrong.
3. **Sentinel file** — `/var/lib/peritus-supabase/db/.peritus-prod-sentinel`
   is a marker the pre-flight checks. Catches "I thought this was the right
   dir" mistakes.
4. **Detection** — `db-integrity-check.sh` runs every 5 minutes. If the
   critical tables drop >50% from baseline, or if today's pg_dumpall
   backup is missing/stale, emails the platform admin within 5 min.
   Rate-limits to one email/hour per anomaly.
