#!/usr/bin/env bash
# Phase 1 smoke test against the replica VM. Exercises:
#   1. enrollment_tokens table accessible
#   2. agent-enroll exchanges token for credentials
#   3. agent-heartbeat accepts HMAC-signed request from the new endpoint
#   4. agent-version-check returns 204 (no versions published yet) and rejects bad HMAC
# Run after deploy-to-vm.sh.
set -euo pipefail

VM=${VM:-itadmin@192.168.99.143}
# Default hits Kong on the replica VM directly (port 8000).
# The public hostname apidev.peritusdigital.com.au routes through an upstream proxy
# that does not yet forward to the replica; use the VM IP from inside the LAN.
API_BASE=${API_BASE:-http://192.168.99.143:8000/functions/v1}
# Anon key for Kong authentication (low-privilege JWT; functions use service-role internally).
ANON_KEY=${ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzc4NjE5MTQ2LCJleHAiOjIwOTM5NzkxNDZ9.GODZYu9cHAV4Gyd4-UFgFYHOXfKOjEFQMgZoKMVPmAc}
COMPOSE="sudo docker compose -f /opt/peritus-supabase/docker-compose.yml -f /opt/peritus-supabase/docker-compose.override.yml"

# Use python3 on Linux/Git Bash, python on Windows
if command -v python3 >/dev/null 2>&1; then
    PY=python3
else
    PY=python
fi

psql_remote() {
    ssh "$VM" "$COMPOSE exec -T db psql -U postgres -d postgres -tAc \"$1\""
}

echo "=== [1/4] inserting test enrollment token ==="
TOKEN="phase1-smoke-$(date +%s)-$RANDOM"
ORG_ID=$(psql_remote "SELECT id FROM public.organizations ORDER BY created_at LIMIT 1")
USER_ID=$(psql_remote "SELECT id FROM auth.users WHERE email='shane.stephens@peritusdigital.com.au' LIMIT 1")
echo "  org=$ORG_ID user=$USER_ID token=$TOKEN"

psql_remote "INSERT INTO public.enrollment_tokens (token, organization_id, created_by, runtime_hint, channel) VALUES ('$TOKEN', '$ORG_ID', '$USER_ID', 'powershell', 'stable')"

echo "=== [2/4] POST /agent-enroll ==="
ENROLL_RESPONSE=$(curl -sS -X POST "$API_BASE/agent-enroll" \
    -H "content-type: application/json" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $ANON_KEY" \
    -d "{\"enrollment_token\":\"$TOKEN\",\"hostname\":\"phase1-smoke-host\",\"runtime\":\"powershell\"}")
echo "  response: $ENROLL_RESPONSE"

AGENT_ID=$(echo "$ENROLL_RESPONSE" | $PY -c "import sys,json; print(json.load(sys.stdin)['agent_id'])")
AGENT_SECRET=$(echo "$ENROLL_RESPONSE" | $PY -c "import sys,json; print(json.load(sys.stdin)['agent_secret'])")
echo "  agent_id=$AGENT_ID"
echo "  agent_secret=${AGENT_SECRET:0:8}... (truncated)"

echo "=== [3/4] POST /agent-heartbeat with valid HMAC ==="
TS=$(date +%s)
BODY='{"agent_version":"phase1-smoke","defender_version":"4.18.0"}'
SIG=$($PY - "$AGENT_SECRET" "$TS" "$BODY" <<'PY'
import hashlib, hmac, sys
secret, ts, body = sys.argv[1], sys.argv[2], sys.argv[3]
msg = f"POST\n/agent-heartbeat\n{ts}\n{body}".encode()
print(hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest())
PY
)
HB_RESPONSE=$(curl -sS -w "\n%{http_code}" -X POST "$API_BASE/agent-heartbeat" \
    -H "content-type: application/json" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $ANON_KEY" \
    -H "x-agent-id: $AGENT_ID" \
    -H "x-timestamp: $TS" \
    -H "x-signature: $SIG" \
    -d "$BODY")
echo "  response: $HB_RESPONSE"
if ! echo "$HB_RESPONSE" | head -1 | grep -q '"commands":\[\]'; then
    echo "  FAIL: expected commands:[] in response"
    exit 1
fi

echo "=== [4/4] GET /agent-version-check (HMAC over empty body) ==="
TS=$(date +%s)
SIG=$($PY - "$AGENT_SECRET" "$TS" <<'PY'
import hashlib, hmac, sys
secret, ts = sys.argv[1], sys.argv[2]
msg = f"GET\n/agent-version-check\n{ts}\n".encode()
print(hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest())
PY
)
VC_CODE=$(curl -sS -o /dev/null -w "%{http_code}" -X GET "$API_BASE/agent-version-check?current=0.0.0&runtime=powershell" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $ANON_KEY" \
    -H "x-agent-id: $AGENT_ID" \
    -H "x-timestamp: $TS" \
    -H "x-signature: $SIG")
echo "  http $VC_CODE (expected 204 — no versions published yet)"
if [ "$VC_CODE" != "204" ]; then
    echo "  FAIL: expected 204"
    exit 1
fi

echo "=== [4b] GET /agent-version-check with bad signature ==="
BAD_CODE=$(curl -sS -o /dev/null -w "%{http_code}" -X GET "$API_BASE/agent-version-check?current=0.0.0&runtime=powershell" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $ANON_KEY" \
    -H "x-agent-id: $AGENT_ID" \
    -H "x-timestamp: $TS" \
    -H "x-signature: 0000000000000000000000000000000000000000000000000000000000000000")
echo "  http $BAD_CODE (expected 401)"
if [ "$BAD_CODE" != "401" ]; then
    echo "  FAIL: expected 401"
    exit 1
fi

echo
echo "=== PHASE 1 SMOKE TEST PASSED ==="
echo "Created endpoint: $AGENT_ID"
echo "You may delete it with:"
echo "  ssh $VM \"$COMPOSE exec -T db psql -U postgres -d postgres -c \\\"DELETE FROM public.endpoints WHERE id='$AGENT_ID'\\\"\""
