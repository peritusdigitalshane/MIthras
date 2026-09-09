#!/usr/bin/env bash
# Deploy App-Control Phase 2 to replica VM (192.168.99.143).
# Run from the repo root: bash scripts/phase2b/deploy-app-control-phase2.sh
set -euo pipefail

VM=${VM:-itadmin@192.168.99.143}
REPO_ROOT=$(git rev-parse --show-toplevel)
FUNCTIONS_DIR=/opt/peritus-functions

cd "$REPO_ROOT"

echo "=== [1/5] copying migrations to VM ==="
scp supabase/migrations/20260515120000_wdac_policy_templates.sql       "$VM:/tmp/"
scp supabase/migrations/20260515120100_wdac_rule_set_rings.sql         "$VM:/tmp/"
scp supabase/migrations/20260515120200_app_control_state_rings.sql     "$VM:/tmp/"

echo "=== [2/5] applying migrations ==="
ssh "$VM" "bash -s" <<'REMOTE'
set -euo pipefail
COMPOSE="sudo docker compose -f /opt/peritus-supabase/docker-compose.yml -f /opt/peritus-supabase/docker-compose.override.yml"

apply() {
    local file=$1
    echo "  applying $file"
    $COMPOSE exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "/tmp/$file"
}

apply 20260515120000_wdac_policy_templates.sql
apply 20260515120100_wdac_rule_set_rings.sql
apply 20260515120200_app_control_state_rings.sql
REMOTE

echo "=== [3/5] deploying agent-app-control edge function ==="
ssh "$VM" "sudo mkdir -p $FUNCTIONS_DIR/agent-app-control"
scp supabase/functions/agent-app-control/index.ts "$VM:/tmp/agent-app-control-index.ts"
ssh "$VM" "sudo install -m 644 /tmp/agent-app-control-index.ts $FUNCTIONS_DIR/agent-app-control/index.ts"

echo "=== [4/5] reloading edge runtime ==="
ssh "$VM" "sudo docker compose -f /opt/peritus-supabase/docker-compose.yml -f /opt/peritus-supabase/docker-compose.override.yml restart functions"
sleep 5
ssh "$VM" "sudo docker compose -f /opt/peritus-supabase/docker-compose.yml -f /opt/peritus-supabase/docker-compose.override.yml logs functions --tail=10"

echo "=== [5/5] building + deploying frontend ==="
cd "$REPO_ROOT"
# Extract ANON_KEY from VM .env
ANON_KEY=$(ssh "$VM" "sudo grep '^ANON_KEY=' /opt/peritus-supabase/.env | cut -d= -f2-")
VITE_SUPABASE_URL=http://192.168.99.143:8000 \
VITE_SUPABASE_ANON_KEY="$ANON_KEY" \
  npm run build 2>&1 | tail -5

echo "  copying dist to VM"
ssh "$VM" "sudo mkdir -p /opt/peritus-frontend"
rsync -az --delete dist/ "$VM:/tmp/peritus-frontend-dist/"
# Exclude config files so rsync --delete doesn't wipe them. See incident
# 2026-06-19 (peritus-frontend container crash-looped because nginx.conf
# was turned into an empty directory by the rsync delete logic).
ssh "$VM" "sudo rsync -az --delete \
    --exclude='nginx.conf' \
    --exclude='docker-compose.yml' \
    /tmp/peritus-frontend-dist/ /opt/peritus-frontend/"

echo "=== deploy complete ==="
