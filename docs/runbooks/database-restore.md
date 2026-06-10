# Restore the production database from a backup

This is the runbook for restoring `supabase-db` (Postgres 15) on the Vultr
prod box (`149.28.186.142`) from a `pg_dumpall` snapshot taken by the daily
backup cron.

## When to run this

- The prod database has been corrupted, accidentally truncated, or otherwise
  lost data that can't be recovered by point-in-time queries.
- A catastrophic host failure forced a fresh VM and you're rebuilding the
  Supabase stack from scratch.
- You're testing the disaster-recovery path (do this at least quarterly).

## Where the backups live

| Tier | Path | Retention |
|---|---|---|
| Daily | `/opt/peritus-backups/daily/` | 14 days |
| Weekly | `/opt/peritus-backups/weekly/` | 8 weeks (Sundays only) |
| Monthly | `/opt/peritus-backups/monthly/` | 6 months (1st of month) |
| Logs | `/opt/peritus-backups/logs/` | rotated per-run |

Each dump is `pg_dumpall --clean --if-exists --no-role-passwords` piped
through `gzip -9`. The script: `/usr/local/sbin/peritus-backup.sh`. Schedule:
`/etc/cron.d/peritus-backup` (02:15 UTC daily).

## Pre-restore checklist

1. **Confirm with the team** before restoring — every write after the
   backup's timestamp will be lost.
2. **Pick the right backup file.** Filenames are `peritus-<YYYYMMDD-HHMMSS>.sql.gz`
   in UTC. Verify size against the trend:
   ```bash
   ls -lh /opt/peritus-backups/daily/ | tail -10
   ```
   A backup file >100KB but suddenly much smaller than recent dumps is
   suspect (the script aborts <100KB but won't catch a 50% shrink).
3. **Stop the services that write to the DB.** Edge functions, frontend,
   anything that talks to `supabase-db`:
   ```bash
   docker stop supabase-edge-functions supabase-kong supabase-rest \
                supabase-auth realtime-dev.supabase-realtime
   ```
   Leave `supabase-db` running.

## Restore procedure

### Option A — restore inside the running supabase-db container

This is the normal path. Postgres is up; we replace the data.

```bash
# 1. Copy the dump into the container.
docker cp /opt/peritus-backups/daily/peritus-<TS>.sql.gz supabase-db:/tmp/restore.sql.gz

# 2. Decompress + apply. `pg_dumpall --clean --if-exists` rebuilds every
#    database from scratch, so this single command is enough.
docker exec supabase-db bash -c \
  "gunzip -c /tmp/restore.sql.gz | psql -U postgres -d postgres"

# 3. Clean up.
docker exec supabase-db rm /tmp/restore.sql.gz
```

The restore should take a few seconds to a few minutes depending on dump
size. Watch for ERRORs — `--clean --if-exists` means most `DROP IF EXISTS`
lines that fail are benign; only `pg_restore` / `psql` exit code != 0
indicates a real failure.

### Option B — restore into a fresh supabase-db

Use this when the container itself is corrupted or you're standing up a
new VM.

```bash
# 1. Bring the stack up with an empty volume (read Supabase install notes
#    for the exact compose location):
cd /opt/peritus-supabase && docker compose up -d db
sleep 10  # wait for db to accept connections

# 2. Restore as in Option A.
docker cp /opt/peritus-backups/daily/peritus-<TS>.sql.gz supabase-db:/tmp/restore.sql.gz
docker exec supabase-db bash -c \
  "gunzip -c /tmp/restore.sql.gz | psql -U postgres -d postgres"

# 3. Bring the rest of the stack up:
docker compose up -d
```

## Post-restore verification

1. **Confirm data is back:**
   ```bash
   docker exec supabase-db psql -U postgres -d postgres -c \
     "SELECT count(*) FROM endpoints; SELECT count(*) FROM organizations;"
   ```
2. **Restart services** stopped in pre-restore:
   ```bash
   docker start supabase-auth supabase-rest supabase-kong \
                 supabase-edge-functions realtime-dev.supabase-realtime
   ```
3. **Smoke-test from the SOC:** log in, switch tenants, open a recent
   incident, generate an ad-hoc report. If something looks empty, recheck
   the dump timestamp — you may have restored an older snapshot than
   intended.
4. **Force the agent to re-check policy** on at least one endpoint:
   ```powershell
   Restart-Service PeritusSecureAgent
   ```

## Known restore gotchas

- **Realtime channels** lose all subscribers; clients will reconnect
  automatically but in-flight subscriptions are dropped.
- **Storage objects** are NOT covered by the SQL dump — they live in
  `supabase-storage`'s volume. If you've lost generated PDF reports or
  uploaded files, restore the storage volume separately.
- **GoTrue migrations** are inside the dump — version mismatches between
  the dump and the running auth container can cause migration drift on
  next restart. If you see `auth.users` schema errors, bounce
  `supabase-auth` to re-run migrations against the restored DB.
- **Activity_logs / sysmon_events / firewall_audit_logs** are partitioned;
  the dump restores all partitions in place.

## DR drill cadence

Run this restore against a scratch VM (or a docker compose dev stack on
your laptop) **once per quarter** and record the result in
`docs/runbooks/dr-drills.md`. A restore you've never tested is not a
restore plan.
