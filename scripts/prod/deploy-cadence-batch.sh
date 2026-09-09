#!/usr/bin/env bash
# deploy-cadence-batch.sh — ship the v0.7.6 cadence + mutex + per-tenant
# AI-remediation batch in one go. Idempotent: re-running is safe
# (migrations guard with IF NOT EXISTS; function deploys are file-copy-
# then-restart).
#
# What this ships:
#   1. Migration: platform_locks table + try/release RPCs
#   2. Migration: email-sweep cron */5 → */2
#   3. Migration: organizations.ai_email_remediation_enabled +
#                 ai_endpoint_remediation_enabled (both default false)
#   4. Function: agent-heartbeat (NEXT_CHECK_IN_SECONDS 60 → 30,
#                mesh-state update error logging)
#   5. Function: m365-email-sweep (self-overlap mutex + per-org gate
#                on canRemediate)
#   6. Function: m365-poll-tenants (bulk-cron mutex)
#   7. Function: ai-response-execute (gate switched to ai_endpoint_remediation_enabled)
#   8. Function: admin-resend-home-welcome (super-admin re-trigger of the 3-step welcome)
#   9. Frontend bundle: vite build + rsync dist/ → /opt/peritus-frontend
#       (skips if --no-frontend is passed; the run-only-functions case is rare
#        but exists when you've already shipped a frontend in the same window)
#
# Post-deploy verification:
#   - SELECT * FROM cron.job WHERE jobname IN ('mithras-email-security-sweep');
#       expect schedule = '*/2 * * * *'
#   - SELECT * FROM platform_locks;
#       expect 0 rows when idle; 1-2 rows transiently during ticks
#   - Watch the next sweep tick (within 2 min) and confirm
#     email_sweep_metrics increments.
#   - Open a connected endpoint; the agent should switch from 60s to 30s
#     check-in within one heartbeat (look at endpoint_status.collected_at
#     deltas).
#
# Rollback: each function has its prior version under git. Revert + redeploy.
# Migrations are additive so no schema rollback is needed.

set -euo pipefail

# Parse flags. --no-frontend skips the vite build + frontend sync step,
# useful when iterating on backend only.
DEPLOY_FRONTEND=1
for arg in "$@"; do
    case "$arg" in
        --no-frontend) DEPLOY_FRONTEND=0 ;;
        *) echo "unknown flag: $arg" >&2; exit 2 ;;
    esac
done

HOST="root@149.28.186.142"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"
FUNCTIONS_DIR="$REPO_ROOT/supabase/functions"

apply_migration () {
    local local_sql="$1"
    local basename
    basename=$(basename "$local_sql")
    echo "  -> uploading $basename"
    scp -o StrictHostKeyChecking=no "$local_sql" "$HOST:/tmp/$basename" >/dev/null
    echo "  -> applying inside supabase-db"
    ssh -o StrictHostKeyChecking=no "$HOST" "
        docker cp /tmp/$basename supabase-db:/tmp/$basename
        docker exec supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/$basename
    " >/dev/null
}

deploy_function () {
    local fn_name="$1"
    local src="$FUNCTIONS_DIR/$fn_name/index.ts"
    if [ ! -f "$src" ]; then
        echo "  !! source missing: $src"
        return 1
    fi
    echo "  -> uploading $fn_name/index.ts"
    # mkdir on the host first — new functions land in a fresh dir that
    # scp won't auto-create. Cheap idempotent op.
    ssh -o StrictHostKeyChecking=no "$HOST" "mkdir -p /opt/peritus-functions/$fn_name" >/dev/null
    scp -o StrictHostKeyChecking=no "$src" "$HOST:/opt/peritus-functions/$fn_name/index.ts" >/dev/null
}

# Apply platform_locks BEFORE the edge functions are uploaded — the
# functions call try_acquire_platform_lock, so the RPC must exist before
# they go live. (Migration timestamp ordering would put cadence first,
# but the deploy graph here is dependency-driven.)
echo "=== STEP 1: apply platform_locks migration (defines mutex RPCs) ==="
apply_migration "$MIGRATIONS_DIR/20260616020000_platform_locks.sql"

echo "=== STEP 2: apply email-sweep cadence migration (changes pg_cron schedule) ==="
apply_migration "$MIGRATIONS_DIR/20260616010000_tighten_email_sweep_cadence.sql"

echo "=== STEP 3: apply AI remediation toggles migration ==="
apply_migration "$MIGRATIONS_DIR/20260616030000_per_tenant_ai_remediation.sql"

echo "=== STEP 3b: apply email-campaign grouping migration (cross-mailbox sweep) ==="
apply_migration "$MIGRATIONS_DIR/20260617010000_email_campaign_grouping.sql"

echo "=== STEP 3c: apply radar-ai-digest cron migration ==="
apply_migration "$MIGRATIONS_DIR/20260617030000_radar_ai_digest_cron.sql"

echo "=== STEP 3d: apply m365 Conditional Access migration ==="
apply_migration "$MIGRATIONS_DIR/20260617040000_m365_conditional_access.sql"

echo "=== STEP 3e: apply m365-ca-poll cron migration ==="
apply_migration "$MIGRATIONS_DIR/20260617050000_m365_ca_poll_cron.sql"

echo "=== STEP 3f: apply identity-defence migration ==="
apply_migration "$MIGRATIONS_DIR/20260617060000_identity_defence.sql"

echo "=== STEP 3g: apply identity-evaluate cron migration ==="
apply_migration "$MIGRATIONS_DIR/20260617070000_identity_evaluate_cron.sql"

echo "=== STEP 3h: apply m365 Shield schema migration ==="
apply_migration "$MIGRATIONS_DIR/20260618010000_m365_shield.sql"

echo "=== STEP 3i: apply m365 Shield cron schedules migration ==="
apply_migration "$MIGRATIONS_DIR/20260618020000_m365_shield_crons.sql"

echo "=== STEP 4: upload edge functions ==="
deploy_function "agent-heartbeat"
deploy_function "m365-email-sweep"
deploy_function "m365-email-action"
deploy_function "m365-poll-tenants"
deploy_function "m365-ca-poll"
deploy_function "identity-evaluate"
deploy_function "ai-response-execute"
deploy_function "admin-resend-home-welcome"
deploy_function "radar-refresh"
deploy_function "radar-public"
deploy_function "radar-ai-digest"
deploy_function "m365-pim-elevate"
deploy_function "m365-pim-auto-revoke"
deploy_function "m365-risk-poll"
deploy_function "m365-oauth-poll"
deploy_function "m365-oauth-revoke"
deploy_function "m365-access-review-create"
deploy_function "m365-access-review-enforce"
deploy_function "identity-evaluate"

echo "=== STEP 5: reload PostgREST schema cache ==="
ssh -o StrictHostKeyChecking=no "$HOST" "
    docker exec supabase-db psql -U postgres -d postgres -c \"NOTIFY pgrst, 'reload schema';\" >/dev/null
" >/dev/null

echo "=== STEP 6: restart edge runtime so new function code goes live ==="
ssh -o StrictHostKeyChecking=no "$HOST" "
    cd /opt/peritus-supabase
    docker compose -f docker-compose.yml -f docker-compose.override.yml restart functions
" 2>&1 | tail -5

if [ "$DEPLOY_FRONTEND" = "1" ]; then
    # Update the peritus-frontend container's nginx config FIRST so the new
    # SPA fallback + apex→www redirect lands at the same time as the new
    # bundle. Reload nginx after the file moves.
    echo "=== STEP 6b: sync peritus-frontend nginx.conf + docker-compose.yml (config-as-code) ==="
    if [ -f "$REPO_ROOT/infra/peritus-frontend/nginx.conf" ]; then
        scp -o StrictHostKeyChecking=no "$REPO_ROOT/infra/peritus-frontend/nginx.conf" "$HOST:/opt/peritus-frontend/nginx.conf" >/dev/null
        ssh -o StrictHostKeyChecking=no "$HOST" "docker exec peritus-frontend nginx -t && docker exec peritus-frontend nginx -s reload" 2>&1 | tail -3
    else
        echo "  !! infra/peritus-frontend/nginx.conf missing — skipping"
    fi
    if [ -f "$REPO_ROOT/infra/peritus-frontend/docker-compose.yml" ]; then
        scp -o StrictHostKeyChecking=no "$REPO_ROOT/infra/peritus-frontend/docker-compose.yml" "$HOST:/opt/peritus-frontend/docker-compose.yml" >/dev/null
    fi

    echo "=== STEP 7: build + sync frontend bundle ==="
    if [ ! -d "$REPO_ROOT/node_modules" ]; then
        echo "  -> node_modules missing; running npm install (one-time)"
        (cd "$REPO_ROOT" && npm install --no-audit --no-fund 2>&1 | tail -3)
    fi
    # 2026-06-16: prerender is opt-in until we've validated it locally.
    # Without SKIP_PRERENDER=1 the build script tries to launch puppeteer,
    # which downloads Chromium (~300MB) on first run and needs system deps
    # that we haven't verified on the CI/local box yet. Ship the bulk SEO
    # fixes (nginx, sitemap, code-split) today; prerender follows.
    export SKIP_PRERENDER=1
    echo "  -> npm run build  (SKIP_PRERENDER=1)"
    (cd "$REPO_ROOT" && npm run build:nopr 2>&1 | tail -5)
    # Windows-git-bash rsync sees `C:/...` as remote (the colon). Use a
    # relative path by cd'ing into $REPO_ROOT, AND skip rsync entirely if
    # it errors — fall back to scp -r which has no such limitation. The
    # frontend bundle is ~50MB so the lack of delta-transfer isn't painful.
    # Pre-flight: the local dist/ must exist and have a non-trivial index.html.
    # If the build silently produced an empty dist, refuse to deploy — better
    # to abort with the old bundle still live than to push test-stub content.
    if [ ! -s "$REPO_ROOT/dist/index.html" ] || [ "$(wc -c < "$REPO_ROOT/dist/index.html")" -lt 500 ]; then
        echo "  !! ABORT: dist/index.html missing or under 500 bytes — refusing to deploy" >&2
        exit 1
    fi
    LOCAL_BUNDLE_SIZE=$(du -sk "$REPO_ROOT/dist" | cut -f1)
    if [ "$LOCAL_BUNDLE_SIZE" -lt 1000 ]; then
        echo "  !! ABORT: local dist/ is only ${LOCAL_BUNDLE_SIZE}KB — looks like an empty or stub build" >&2
        exit 1
    fi
    echo "  -> upload dist/ ($LOCAL_BUNDLE_SIZE KB) to $HOST:/tmp/peritus-frontend-dist/"
    ssh -o StrictHostKeyChecking=no "$HOST" "rm -rf /tmp/peritus-frontend-dist && mkdir -p /tmp/peritus-frontend-dist" >/dev/null
    if ! (cd "$REPO_ROOT" && scp -o StrictHostKeyChecking=no -r dist/. "$HOST:/tmp/peritus-frontend-dist/") >/dev/null; then
        echo "  !! ABORT: scp failed — refusing to run rsync against empty source" >&2
        exit 1
    fi
    # Verify the remote staging area got a real bundle (index.html present + large enough).
    REMOTE_SIZE=$(ssh -o StrictHostKeyChecking=no "$HOST" "wc -c < /tmp/peritus-frontend-dist/index.html 2>/dev/null || echo 0")
    if [ "$REMOTE_SIZE" -lt 500 ]; then
        echo "  !! ABORT: /tmp/peritus-frontend-dist/index.html is only ${REMOTE_SIZE} bytes — scp did not land the real bundle" >&2
        exit 1
    fi
    echo "  -> staged bundle verified ($REMOTE_SIZE-byte index.html)"
    echo "  -> atomic move into /opt/peritus-frontend (excludes config files so they survive)"
    # CRITICAL: --exclude nginx.conf and docker-compose.yml so rsync --delete
    # doesn't wipe them. Without these excludes, --delete will remove these
    # files (and worse, may leave nginx.conf as an empty directory when a
    # dist sub-path collides), which breaks the container's bind mount.
    # See incident 2026-06-19.
    ssh -o StrictHostKeyChecking=no "$HOST" "
        sudo mkdir -p /opt/peritus-frontend
        sudo rsync -a --delete \
            --exclude='nginx.conf' \
            --exclude='docker-compose.yml' \
            /tmp/peritus-frontend-dist/ /opt/peritus-frontend/
    " >/dev/null
    # Post-flight: hit www publicly and verify a real Mithras response (not a
    # tiny stub from a half-deploy). If this fails the bundle is live but
    # serving garbage — we surface that loudly so the operator can roll back.
    sleep 2
    LIVE_SIZE=$(curl -s -o /dev/null -w "%{size_download}" "https://www.mithras.com.au/?postdeploy=$(date +%s)")
    if [ "$LIVE_SIZE" -lt 500 ]; then
        echo "  !! WARN: public www.mithras.com.au returned ${LIVE_SIZE} bytes — looks wrong" >&2
        echo "  !!       check /opt/peritus-frontend/index.html on $HOST and roll back if needed" >&2
    else
        echo "  -> public www.mithras.com.au verified (${LIVE_SIZE} bytes served)"
    fi
else
    echo "=== STEP 7 skipped (--no-frontend) ==="
fi

echo ""
echo "=== verification queries ==="
ssh -o StrictHostKeyChecking=no "$HOST" "
    docker exec supabase-db psql -U postgres -d postgres -c \"
        SELECT jobname, schedule FROM cron.job
         WHERE jobname IN ('mithras-email-security-sweep', 'm365-poll-tenants');
    \"
    docker exec supabase-db psql -U postgres -d postgres -c \"
        SELECT lock_name, holder, acquired_at FROM public.platform_locks;
    \"
"

echo ""
echo "=== done. agents will adopt 30s heartbeat on next round-trip; ==="
echo "=== next email-sweep tick should fire within 2 minutes. ==="
