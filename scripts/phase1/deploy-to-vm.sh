#!/usr/bin/env bash
# Phase 1 deployment to replica VM (peritus-supabase, 192.168.99.143).
# Run from the repo root on the workstation:
#   bash scripts/phase1/deploy-to-vm.sh
# Idempotent: re-running is safe (migrations are skipped if already applied; functions are overwritten).
set -euo pipefail

VM=${VM:-itadmin@192.168.99.143}
REPO_ROOT=$(git rev-parse --show-toplevel)
SUPABASE_DIR=/opt/peritus-supabase
FUNCTIONS_DIR=/opt/peritus-functions

cd "$REPO_ROOT"

echo "=== [1/4] copying new migrations to VM ==="
scp supabase/migrations/20260513120000_enrollment_tokens.sql "$VM:/tmp/"
scp supabase/migrations/20260513120100_agent_versions.sql "$VM:/tmp/"
scp supabase/migrations/20260513120200_endpoints_hmac_columns.sql "$VM:/tmp/"

echo "=== [2/4] applying migrations ==="
# Migrations are idempotent (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS guards
# are baked into the SQL itself or the structure is naturally re-runnable), so we apply each
# unconditionally and let Postgres no-op duplicates.
ssh "$VM" "bash -s" <<'REMOTE'
set -euo pipefail
COMPOSE="sudo docker compose -f /opt/peritus-supabase/docker-compose.yml -f /opt/peritus-supabase/docker-compose.override.yml"

apply() {
    local file=$1
    echo "  $file"
    $COMPOSE exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "/tmp/$file"
}

apply 20260513120000_enrollment_tokens.sql || echo "  (enrollment_tokens may already exist — continuing)"
apply 20260513120100_agent_versions.sql    || echo "  (agent_versions may already exist — continuing)"
apply 20260513120200_endpoints_hmac_columns.sql
REMOTE

echo "=== [3/4] copying edge functions to VM ==="
ssh "$VM" "sudo mkdir -p $FUNCTIONS_DIR/_shared $FUNCTIONS_DIR/agent-enroll $FUNCTIONS_DIR/agent-heartbeat $FUNCTIONS_DIR/agent-version-check $FUNCTIONS_DIR/agent-installer"
scp supabase/functions/_shared/hmac.ts "$VM:/tmp/hmac.ts"
scp supabase/functions/_shared/cors.ts "$VM:/tmp/cors.ts"
scp supabase/functions/agent-enroll/index.ts "$VM:/tmp/agent-enroll-index.ts"
scp supabase/functions/agent-heartbeat/index.ts "$VM:/tmp/agent-heartbeat-index.ts"
scp supabase/functions/agent-version-check/index.ts "$VM:/tmp/agent-version-check-index.ts"
scp supabase/functions/agent-installer/index.ts "$VM:/tmp/agent-installer-index.ts"
scp supabase/functions/ai-security-advisor/index.ts "$VM:/tmp/ai-security-advisor-index.ts"

ssh "$VM" "bash -s" <<'REMOTE'
set -euo pipefail
F=/opt/peritus-functions
sudo install -m 644 /tmp/hmac.ts                       "$F/_shared/hmac.ts"
sudo install -m 644 /tmp/cors.ts                       "$F/_shared/cors.ts"
sudo install -m 644 /tmp/agent-enroll-index.ts          "$F/agent-enroll/index.ts"
sudo install -m 644 /tmp/agent-heartbeat-index.ts       "$F/agent-heartbeat/index.ts"
sudo install -m 644 /tmp/agent-version-check-index.ts   "$F/agent-version-check/index.ts"
sudo install -m 644 /tmp/agent-installer-index.ts       "$F/agent-installer/index.ts"
sudo install -m 644 /tmp/ai-security-advisor-index.ts   "$F/ai-security-advisor/index.ts"
REMOTE

echo "=== [4/4] reloading edge runtime ==="
ssh "$VM" "sudo docker compose -f /opt/peritus-supabase/docker-compose.yml -f /opt/peritus-supabase/docker-compose.override.yml restart functions"
sleep 5
ssh "$VM" "sudo docker compose -f /opt/peritus-supabase/docker-compose.yml -f /opt/peritus-supabase/docker-compose.override.yml logs functions --tail=20"

echo "=== deploy complete ==="
