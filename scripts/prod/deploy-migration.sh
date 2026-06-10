#!/usr/bin/env bash
# deploy-migration.sh — apply a Supabase migration on the prod VM and
# auto-reload PostgREST's schema cache so new tables/columns/RPCs become
# visible to authenticated REST callers immediately.
#
# Usage:  deploy-migration.sh <local-migration.sql>
#
# Without the schema reload, frontend writes against any new table fail with
# PGRST205 "Could not find the table in the schema cache" — silently invisible
# on the platform side because edge functions don't share the same cache path.

set -euo pipefail

if [ $# -ne 1 ]; then
    echo "usage: $0 <local-migration.sql>"
    exit 2
fi

LOCAL_SQL="$1"
if [ ! -f "$LOCAL_SQL" ]; then
    echo "error: migration file not found: $LOCAL_SQL"
    exit 2
fi

BASENAME=$(basename "$LOCAL_SQL")

echo "=== uploading $BASENAME to /tmp on the VM ==="
scp -o StrictHostKeyChecking=no "$LOCAL_SQL" "root@149.28.186.142:/tmp/$BASENAME"

echo "=== applying migration inside supabase-db ==="
ssh -o StrictHostKeyChecking=no root@149.28.186.142 \
    "docker cp /tmp/$BASENAME supabase-db:/tmp/$BASENAME && \
     docker exec supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/$BASENAME"

echo "=== NOTIFY pgrst to reload schema cache ==="
ssh -o StrictHostKeyChecking=no root@149.28.186.142 \
    "docker exec supabase-db psql -U postgres -d postgres -c \"NOTIFY pgrst, 'reload schema';\""

echo "=== bounce supabase-rest as a belt-and-braces reload ==="
ssh -o StrictHostKeyChecking=no root@149.28.186.142 \
    "docker restart supabase-rest >/dev/null && sleep 4"

echo "=== done. ==="
