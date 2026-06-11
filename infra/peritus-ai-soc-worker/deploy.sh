#!/usr/bin/env bash
# Deploy / restart the Mithras AI SOC worker on docker02.
#
# Run as root from /opt/peritus-ai-soc-worker. Reuses the env values from
# /opt/peritus-supabase/.env so we never duplicate the service-role key in
# two places.

set -euo pipefail

cd "$(dirname "$0")"

# Pull the three required env values from the upstream supabase compose .env.
SUPABASE_ENV=/opt/peritus-supabase/.env
if [[ ! -f $SUPABASE_ENV ]]; then
    echo "FATAL: $SUPABASE_ENV not found — can't source service-role key" >&2
    exit 1
fi

# shellcheck disable=SC1090
source <(grep -E '^(SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY|AI_SOC_POLL_SECRET)=' "$SUPABASE_ENV" || true)

# Some installs store the key as SERVICE_ROLE_KEY rather than
# SUPABASE_SERVICE_ROLE_KEY — map either to the var the worker expects.
: "${SUPABASE_SERVICE_ROLE_KEY:=${SERVICE_ROLE_KEY:-}}"

# SUPABASE_URL is always the docker-internal kong DNS name — the public
# URL (api.mithras.com.au) would route us back out through Caddy + Cloudflare
# for no reason. Hardcode it.
SUPABASE_URL="http://supabase-kong:8000"

# Pull AI_SOC_POLL_SECRET from platform_settings if it's not in .env.
if [[ -z "${AI_SOC_POLL_SECRET:-}" ]]; then
    AI_SOC_POLL_SECRET="$(docker exec supabase-db psql -U postgres -d postgres -tA -c \
        "SELECT value FROM platform_settings WHERE key='ai_soc_poll_secret'" 2>/dev/null || true)"
fi

# Sanity check.
for var in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY AI_SOC_POLL_SECRET; do
    if [[ -z "${!var:-}" ]]; then
        echo "FATAL: $var is empty" >&2
        exit 1
    fi
done

# Write the local .env (used by docker-compose).
cat > .env <<ENV
SUPABASE_URL=http://supabase-kong:8000
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
AI_SOC_POLL_SECRET=$AI_SOC_POLL_SECRET
ENV
chmod 0600 .env

echo "[1/3] Building image..."
docker compose build --quiet

echo "[2/3] (Re)starting container..."
docker compose up -d

echo "[3/3] First poll cycle (tailing for 12s)..."
sleep 12
docker compose logs --tail 30
