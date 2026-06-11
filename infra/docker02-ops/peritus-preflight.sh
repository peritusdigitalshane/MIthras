#!/usr/bin/env bash
# Source me at the top of any /opt/peritus-supabase maintenance script.
# Refuses to continue if the prod data dir doesn't look right.

set -euo pipefail

PERITUS_PROD_DB_DIR="/var/lib/peritus-supabase/db"
PERITUS_PROD_SENTINEL="$PERITUS_PROD_DB_DIR/.peritus-prod-sentinel"
PERITUS_PROD_FUNCTIONS_DIR="/opt/peritus-functions"

fail() {
    echo "PERITUS PREFLIGHT FAILED: $1" >&2
    echo "" >&2
    echo "If you intended to run a maintenance op on the prod stack:" >&2
    echo "  1. cd /opt/peritus-supabase" >&2
    echo "  2. Use 'docker compose ...' (no -f flags) so docker-compose.override.yml is auto-included." >&2
    echo "  3. See /opt/peritus-supabase/RUNBOOK.md for restore + maintenance procedures." >&2
    exit 1
}

[[ -d "$PERITUS_PROD_DB_DIR" ]]      || fail "prod db dir $PERITUS_PROD_DB_DIR missing"
[[ -f "$PERITUS_PROD_SENTINEL" ]]    || fail "sentinel file $PERITUS_PROD_SENTINEL missing — wrong path?"
[[ -f "$PERITUS_PROD_DB_DIR/PG_VERSION" ]] || fail "$PERITUS_PROD_DB_DIR/PG_VERSION missing — postgres cluster missing?"

DB_SIZE_MB=$(du -sm "$PERITUS_PROD_DB_DIR" | awk '{print $1}')
[[ "$DB_SIZE_MB" -gt 500 ]] || fail "prod db dir is only ${DB_SIZE_MB}MB — looks freshly initialised, not real prod"

[[ -d "$PERITUS_PROD_FUNCTIONS_DIR" ]] || fail "functions dir $PERITUS_PROD_FUNCTIONS_DIR missing"
FN_COUNT=$(ls "$PERITUS_PROD_FUNCTIONS_DIR" | wc -l)
[[ "$FN_COUNT" -ge 30 ]] || fail "only $FN_COUNT entries in $PERITUS_PROD_FUNCTIONS_DIR — expected 30+"

echo "peritus-preflight: prod state looks healthy (db=${DB_SIZE_MB}MB, functions=$FN_COUNT)"
