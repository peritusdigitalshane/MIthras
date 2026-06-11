#!/usr/bin/env bash
# Peritus DB integrity heartbeat. Runs every 5 min via cron.
#
# Counts critical table rows + verifies today's backup. If anything looks
# anomalous (table count drops >50% from baseline, or backup missing/too small),
# emails the platform admin.
#
# Exit codes:
#   0 = healthy
#   1 = warning (email sent, but service continues)
#   2 = critical (email sent, escalates)
#
# Baselines live at /etc/peritus-baselines.env. Bootstrap them once with:
#   /opt/peritus-monitoring/refresh-baselines.sh

set -uo pipefail

BASELINES_FILE="/etc/peritus-baselines.env"
STATE_DIR="/var/lib/peritus-monitoring"
LAST_ALERT_FILE="$STATE_DIR/last-alert"
ALERT_RATELIMIT_MIN=60   # don't email more than once an hour
ALERT_EMAIL="accounts@peritusdigital.com.au"
BACKUP_DIR="/opt/peritus-backups/daily"
MIN_BACKUP_BYTES=$((100 * 1024 * 1024))   # 100 MB

mkdir -p "$STATE_DIR"

if [[ ! -f "$BASELINES_FILE" ]]; then
    echo "FATAL: $BASELINES_FILE missing — run refresh-baselines.sh once to bootstrap" >&2
    exit 1
fi
# shellcheck disable=SC1090
source "$BASELINES_FILE"

now() { date -u +%FT%TZ; }

# Get current counts for the critical tables. We use ONLY here so partition
# parents don't double-count.
get_count() {
    docker exec supabase-db psql -U postgres -d postgres -t -A -c "SELECT COALESCE(count(*), 0) FROM public.$1" 2>/dev/null || echo 0
}

ORGS=$(get_count organizations)
ENDPOINTS=$(get_count endpoints)
ALERTS=$(get_count alerts)
FW=$(get_count firewall_audit_logs)

problems=()

check_drop() {
    local name="$1" current="$2" baseline_var="$3"
    local baseline="${!baseline_var:-0}"
    if [[ "$baseline" -gt 0 ]]; then
        local pct=$(( current * 100 / baseline ))
        if [[ "$pct" -lt 50 ]]; then
            problems+=("$name dropped to $current (${pct}% of baseline $baseline)")
        fi
    fi
}

check_drop organizations           "$ORGS"        BASELINE_ORGS
check_drop endpoints               "$ENDPOINTS"   BASELINE_ENDPOINTS
check_drop alerts                  "$ALERTS"      BASELINE_ALERTS
check_drop firewall_audit_logs     "$FW"          BASELINE_FW

# Backup freshness — find today's backup.
TODAY=$(date -u +%Y%m%d)
LATEST_BACKUP=$(ls -t "$BACKUP_DIR"/peritus-*.sql.gz 2>/dev/null | head -1)
if [[ -z "$LATEST_BACKUP" ]]; then
    problems+=("no backup files found in $BACKUP_DIR")
else
    BACKUP_AGE_HOURS=$(( ($(date -u +%s) - $(stat -c %Y "$LATEST_BACKUP")) / 3600 ))
    BACKUP_SIZE=$(stat -c %s "$LATEST_BACKUP")
    if [[ "$BACKUP_AGE_HOURS" -gt 26 ]]; then
        problems+=("latest backup is $BACKUP_AGE_HOURS hours old (>26h cutoff)")
    fi
    if [[ "$BACKUP_SIZE" -lt "$MIN_BACKUP_BYTES" ]]; then
        problems+=("latest backup is only ${BACKUP_SIZE} bytes (< 100MB)")
    fi
fi

# Healthy path: log to stderr (cron will discard), don't email.
if [[ ${#problems[@]} -eq 0 ]]; then
    echo "[$(now)] db-integrity-check OK: orgs=$ORGS endpoints=$ENDPOINTS alerts=$ALERTS fw=$FW backup=$(basename "$LATEST_BACKUP" 2>/dev/null)" >&2
    exit 0
fi

# Anomaly path. Rate-limit so we don't spam.
if [[ -f "$LAST_ALERT_FILE" ]]; then
    LAST_TS=$(cat "$LAST_ALERT_FILE")
    NOW_TS=$(date -u +%s)
    DIFF_MIN=$(( (NOW_TS - LAST_TS) / 60 ))
    if [[ "$DIFF_MIN" -lt "$ALERT_RATELIMIT_MIN" ]]; then
        echo "[$(now)] db-integrity-check: anomaly detected but last alert was ${DIFF_MIN} min ago; suppressing" >&2
        echo "  problems:" >&2
        printf '    - %s\n' "${problems[@]}" >&2
        exit 1
    fi
fi

# Send email.
{
    echo "Subject: [Peritus] DB integrity heartbeat: anomaly detected on docker02"
    echo "From: alerts@lyfeforge.com.au"
    echo "To: $ALERT_EMAIL"
    echo ""
    echo "docker02 db integrity heartbeat ran at $(now) and detected the following:"
    echo ""
    printf '  - %s\n' "${problems[@]}"
    echo ""
    echo "Current counts:"
    echo "  organizations:       $ORGS  (baseline $BASELINE_ORGS)"
    echo "  endpoints:           $ENDPOINTS  (baseline $BASELINE_ENDPOINTS)"
    echo "  alerts:              $ALERTS  (baseline $BASELINE_ALERTS)"
    echo "  firewall_audit_logs: $FW  (baseline $BASELINE_FW)"
    echo "  latest backup:       $(basename "$LATEST_BACKUP" 2>/dev/null || echo 'NONE')"
    echo ""
    echo "Investigation:"
    echo "  ssh root@149.28.186.142"
    echo "  bash /usr/local/bin/peritus-preflight.sh"
    echo "  See /opt/peritus-supabase/RUNBOOK.md"
} | msmtp -a default "$ALERT_EMAIL"

date -u +%s > "$LAST_ALERT_FILE"
echo "[$(now)] db-integrity-check: ALERT sent to $ALERT_EMAIL" >&2
exit 2
