#!/usr/bin/env bash
# Publish agent v0.6.5 to the replica VM.
# Run once the VM at 192.168.99.143 is back online.
#
# Steps:
#   1. scp bundle + manifest to /tmp on VM
#   2. upload bundle into Supabase Storage bucket 'agent-bundles' via REST
#   3. INSERT into agent_versions (psql)
#   4. scp edge function sources + restart functions container
#   5. curl /agent-version-check to verify
set -euo pipefail

VM_USER="${VM_USER:-itadmin}"
VM_HOST="${VM_HOST:-192.168.99.143}"
VM="${VM_USER}@${VM_HOST}"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUNDLE="${REPO_ROOT}/dist/mithras-agent-0.6.5.zip"
MANIFEST="${REPO_ROOT}/dist/mithras-agent-0.6.5.json"
SHA256="d6ac8c7745bb0d1f44bb6e3add8f13462fa1b4c8912d7f768c6ce0cbcd03abbb"

[ -f "$BUNDLE" ]   || { echo "missing $BUNDLE"; exit 1; }
[ -f "$MANIFEST" ] || { echo "missing $MANIFEST"; exit 1; }

echo "[publish-0.6.5] copying bundle to VM"
scp -o ConnectTimeout=10 "$BUNDLE" "$MANIFEST" "$VM:/tmp/"

echo "[publish-0.6.5] uploading to Supabase Storage"
ssh "$VM" 'bash -s' <<'EOSSH'
set -e
cd /tmp

# Read service role key from the env file the supabase stack uses.
SERVICE_KEY="$(sudo grep -m1 SERVICE_ROLE_KEY /opt/peritus-supabase/.env | cut -d= -f2- | tr -d '"' | xargs)"

# Upload bundle
curl -sf -X PUT \
    -H "Authorization: Bearer ${SERVICE_KEY}" \
    -H "Content-Type: application/zip" \
    -H "x-upsert: true" \
    --data-binary @mithras-agent-0.6.5.zip \
    "http://localhost:8000/storage/v1/object/agent-bundles/mithras-agent-0.6.5.zip"
echo

# Update latest.json so agent-script can find it
curl -sf -X PUT \
    -H "Authorization: Bearer ${SERVICE_KEY}" \
    -H "Content-Type: application/json" \
    -H "x-upsert: true" \
    --data-binary @mithras-agent-0.6.5.json \
    "http://localhost:8000/storage/v1/object/agent-bundles/latest.json"
echo

# Register the version row + flip prior 0.6.4 row to inactive.
sudo -u postgres psql -d postgres <<EOSQL
UPDATE agent_versions
   SET is_active = false
 WHERE runtime = 'powershell' AND channel = 'stable' AND is_active = true;

INSERT INTO agent_versions (version, runtime, channel, download_url, sha256, is_active, published_at)
VALUES (
  '0.6.5',
  'powershell',
  'stable',
  'https://apidev.peritusdigital.com.au/storage/v1/object/public/agent-bundles/mithras-agent-0.6.5.zip',
  'd6ac8c7745bb0d1f44bb6e3add8f13462fa1b4c8912d7f768c6ce0cbcd03abbb',
  true,
  now()
);
EOSQL
EOSSH

echo "[publish-0.6.5] copying edge function sources"
scp "${REPO_ROOT}/supabase/functions/agent-heartbeat/index.ts" "$VM:/tmp/agent-heartbeat.ts"
scp "${REPO_ROOT}/supabase/functions/agent-api/index.ts"        "$VM:/tmp/agent-api.ts"

ssh "$VM" 'bash -s' <<'EOSSH'
set -e
sudo cp /tmp/agent-heartbeat.ts /opt/peritus-functions/agent-heartbeat/index.ts
sudo cp /tmp/agent-api.ts        /opt/peritus-functions/agent-api/index.ts
sudo docker compose -f /opt/peritus-supabase/docker-compose.yml restart functions
sleep 4
sudo docker compose -f /opt/peritus-supabase/docker-compose.yml logs --tail 20 functions
EOSSH

echo "[publish-0.6.5] verifying version-check returns 0.6.5"
curl -sk --resolve apidev.peritusdigital.com.au:443:192.168.99.143 \
    "https://apidev.peritusdigital.com.au/functions/v1/agent-version-check" | head -20

echo "[publish-0.6.5] done. sha256=${SHA256}"
