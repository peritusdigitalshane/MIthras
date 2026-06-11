# Peritus Supabase Stack — Operations RUNBOOK

This is the production peritus supabase stack on docker02 (`root@149.28.186.142`).

## TL;DR

```bash
cd /opt/peritus-supabase
docker compose <verb> ...          # ALWAYS from this directory, no -f flags
```

When run from /opt/peritus-supabase/ without any `-f` flags, docker compose
auto-includes `docker-compose.override.yml` which maps the real production
data volumes:

| Service   | Container path                  | Host path (override)               |
|-----------|---------------------------------|------------------------------------|
| db        | /var/lib/postgresql/data        | /var/lib/peritus-supabase/db       |
| storage   | /var/lib/storage                | /var/lib/peritus-supabase/storage  |
| imgproxy  | /var/lib/storage                | /var/lib/peritus-supabase/storage  |
| functions | /home/deno/functions            | /opt/peritus-functions             |

The base `docker-compose.yml` deliberately references undefined named volumes
for these paths, so ANY invocation that misses the override fails at config
validation. This prevents the "silent empty volume → looks like data loss"
class of bug.

## DO NOT

- `docker compose -f docker-compose.yml ...` — will fail loudly, by design
- `docker compose up -d` from any directory other than /opt/peritus-supabase/
- Delete `/var/lib/peritus-supabase/db/.peritus-prod-sentinel` — used by preflight

## Common operations

### Restart a single service
```bash
cd /opt/peritus-supabase
docker compose restart functions
```

### Apply a database migration
```bash
cd /opt/peritus-supabase
docker exec -i supabase-db psql -U supabase_admin -d postgres < /path/to/migration.sql
```
(Use `-U supabase_admin` — most migrations need superuser. `-U postgres` is for limited ops.)

### Restart everything (rare — last resort)
```bash
cd /opt/peritus-supabase
bash /usr/local/bin/peritus-preflight.sh   # sanity check first
docker compose down
docker compose up -d
```

## Backups

Daily pg_dumpall at 02:15 UTC, retained 7 daily / 4 weekly / 12 monthly:
- /opt/peritus-backups/daily/peritus-<date>.sql.gz
- /opt/peritus-backups/weekly/...
- /opt/peritus-backups/monthly/...

Backup script: /opt/peritus-supabase/backup.sh

## Restore procedure (full database from backup)

```bash
# 1. Stop everything that writes to the DB
cd /opt/peritus-supabase
docker compose stop functions rest realtime auth analytics

# 2. Restore as supabase_admin (NOT postgres — perms matter)
gunzip -c /opt/peritus-backups/daily/peritus-<DATE>.sql.gz     | docker exec -i supabase-db psql -U supabase_admin -d postgres 2>/tmp/restore.err

# 3. Resync supabase service-role passwords (they get reset by the restore)
docker exec supabase-db psql -U supabase_admin -d postgres -c "
  ALTER USER authenticator WITH PASSWORD '$POSTGRES_PASSWORD';
  ALTER USER authenticated WITH PASSWORD '$POSTGRES_PASSWORD';
  ALTER USER anon WITH PASSWORD '$POSTGRES_PASSWORD';
  ALTER USER service_role WITH PASSWORD '$POSTGRES_PASSWORD';
  ALTER USER supabase_auth_admin WITH PASSWORD '$POSTGRES_PASSWORD';
  ALTER USER supabase_storage_admin WITH PASSWORD '$POSTGRES_PASSWORD';
  ALTER USER supabase_realtime_admin WITH PASSWORD '$POSTGRES_PASSWORD';
"

# 4. If gotrue won't start (migration version errors): stamp missing versions
#    See "Auth migration stamp" below.

# 5. Restart everything
docker compose up -d

# 6. Verify
docker exec supabase-db psql -U postgres -d postgres -c "
  SELECT 'orgs' AS t, count(*) FROM public.organizations
  UNION ALL SELECT 'endpoints', count(*) FROM public.endpoints
  UNION ALL SELECT 'alerts', count(*) FROM public.alerts;
"
```

## Auth migration stamp (after restore)

If gotrue is restart-looping with "running db migrations: error executing"
followed by "constraint X already exists" or "column Y does not exist",
the gotrue migration tracking is out of sync. Stamp missing versions:

```bash
# List versions the image expects:
docker run --rm --entrypoint sh supabase/gotrue:v2.186.0   -c 'ls /usr/local/etc/auth/migrations/' | grep -oE '^[0-9]+' | sort -u > /tmp/expected.txt

# List versions already recorded:
docker exec supabase-db psql -U supabase_admin -d postgres -t -A   -c 'SELECT version FROM auth.schema_migrations' | sort -u > /tmp/existing.txt

# Stamp the diff:
comm -23 /tmp/expected.txt /tmp/existing.txt | while read v; do
  docker exec supabase-db psql -U supabase_admin -d postgres     -c "INSERT INTO auth.schema_migrations (version) VALUES ('$v') ON CONFLICT DO NOTHING"
done

docker compose restart auth
```

## Pre-flight

Before any maintenance op, run:
```bash
bash /usr/local/bin/peritus-preflight.sh
```

This checks the prod data dir exists, has the sentinel file, contains a
postgres cluster, has > 500 MB of data, and the functions dir has > 30
entries. Refuses to confirm if anything looks wrong.

## Files

- `docker-compose.yml` — upstream supabase base (with peritus warning header)
- `docker-compose.override.yml` — peritus customisations (data volumes, env, ports)
- `docker-compose.caddy.yml`, `docker-compose.nginx.yml`, `docker-compose.envoy.yml` — alternative gateways (not currently used)
- `.env` — secrets (gitignored)
- `backup.sh` — daily pg_dumpall
- `RUNBOOK.md` — this file
