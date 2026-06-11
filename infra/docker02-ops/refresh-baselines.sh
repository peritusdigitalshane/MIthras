#!/usr/bin/env bash
# Snapshot current critical-table counts into /etc/peritus-baselines.env.
# Run manually when you intentionally change the platform scale (e.g. new
# customer onboarded, retention prune ran).
set -euo pipefail

q() { docker exec supabase-db psql -U postgres -d postgres -t -A -c "SELECT count(*) FROM public.$1" 2>/dev/null || echo 0; }

cat > /etc/peritus-baselines.env <<EOF
# Peritus DB baselines. Generated $(date -u -Iseconds).
# Used by /opt/peritus-monitoring/db-integrity-check.sh to detect drops.
# Refresh after intentional changes via:
#   bash /opt/peritus-monitoring/refresh-baselines.sh
BASELINE_ORGS=$(q organizations)
BASELINE_ENDPOINTS=$(q endpoints)
BASELINE_ALERTS=$(q alerts)
BASELINE_FW=$(q firewall_audit_logs)
EOF

chmod 0644 /etc/peritus-baselines.env
cat /etc/peritus-baselines.env
