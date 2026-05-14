#!/usr/bin/env bash
# Add PUBLIC_API_BASE_URL to the supabase-edge-functions container environment.
# Idempotent: skips if already present. Restarts the functions container.
set -euo pipefail

VM=${VM:-itadmin@192.168.99.143}
ssh "$VM" "bash -s" <<'REMOTE'
set -euo pipefail
COMPOSE=/opt/peritus-supabase/docker-compose.yml
TMP=$(sudo mktemp)

if sudo grep -q 'PUBLIC_API_BASE_URL:' "$COMPOSE"; then
    echo "Already present in docker-compose.yml"
else
    sudo awk '
    {
        print
        if ($0 ~ /^[[:space:]]+VERIFY_JWT:[[:space:]]+/) {
            print "      PUBLIC_API_BASE_URL: ${PUBLIC_API_BASE_URL:-https://api.cmwcollective.com.au}"
        }
    }' "$COMPOSE" | sudo tee "$TMP" >/dev/null
    sudo cp "$COMPOSE" "$COMPOSE.bak.$(date +%s)"
    sudo mv "$TMP" "$COMPOSE"
    sudo chown root:root "$COMPOSE"
    sudo chmod 644 "$COMPOSE"
    echo "Inserted PUBLIC_API_BASE_URL after VERIFY_JWT in functions: env"
fi

sudo grep -B1 -A2 'PUBLIC_API_BASE_URL' "$COMPOSE" | head -10

echo "Restarting functions container..."
sudo docker compose -f /opt/peritus-supabase/docker-compose.yml -f /opt/peritus-supabase/docker-compose.override.yml up -d functions
sleep 3
sudo docker inspect supabase-edge-functions --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E '^(PUBLIC_API_BASE_URL|SUPABASE_URL)='
REMOTE
