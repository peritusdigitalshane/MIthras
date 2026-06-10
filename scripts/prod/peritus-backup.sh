#!/usr/bin/env bash
# peritus-backup.sh — daily pg_dump → gzip → retention rotation.
#
# Where this runs : Vultr prod VM (149.28.186.142), under cron
# What it captures: all postgres user databases on supabase-db container
# Retention       : 14 daily + 8 weekly + 6 monthly snapshots
# Destination     : /opt/peritus-backups (local volume) + optional remote sync
#
# Hooks: drop a script at /opt/peritus-backups/post-backup.d/*.sh and it runs
#        after a successful dump (e.g. rclone copy to B2 / S3 / object storage).

set -euo pipefail

BACKUP_ROOT=/opt/peritus-backups
KEEP_DAILY=14
KEEP_WEEKLY=8
KEEP_MONTHLY=6

mkdir -p "$BACKUP_ROOT"/{daily,weekly,monthly,logs,post-backup.d}

TS=$(date -u +%Y%m%d-%H%M%S)
DOW=$(date -u +%u)             # 1=Mon .. 7=Sun
DOM=$(date -u +%d)
LOG="$BACKUP_ROOT/logs/$TS.log"

{
  echo "=== peritus-backup $TS ==="

  DUMP_FILE="$BACKUP_ROOT/daily/peritus-$TS.sql.gz"

  # pg_dump from inside the container (uses POSTGRES_PASSWORD already set).
  # --no-owner / --no-privileges keeps restore portable across roles. Custom
  # format would be faster but plain SQL is human-inspectable and replays
  # cleanly into a fresh container.
  docker exec supabase-db pg_dumpall \
      -U postgres \
      --clean --if-exists \
      --no-role-passwords \
    | gzip -9 > "$DUMP_FILE"

  # Sanity: refuse a backup that's suspiciously small (Postgres had a row count
  # collapse or pg_dump silently bombed).
  SIZE=$(stat -c %s "$DUMP_FILE")
  if [ "$SIZE" -lt 100000 ]; then
    echo "FATAL: dump size $SIZE bytes is below the 100KB sanity floor"
    rm -f "$DUMP_FILE"
    exit 1
  fi
  echo "wrote $DUMP_FILE size=$SIZE"

  # On Sunday, also stamp a weekly copy. On the 1st of the month, also stamp a
  # monthly copy. Hard-link to save disk.
  if [ "$DOW" = "7" ]; then
    ln -f "$DUMP_FILE" "$BACKUP_ROOT/weekly/peritus-$TS.sql.gz"
    echo "linked weekly snapshot"
  fi
  if [ "$DOM" = "01" ]; then
    ln -f "$DUMP_FILE" "$BACKUP_ROOT/monthly/peritus-$TS.sql.gz"
    echo "linked monthly snapshot"
  fi

  # Retention: keep last N in each tier.
  ls -1t "$BACKUP_ROOT/daily/"*.sql.gz   2>/dev/null | tail -n +$((KEEP_DAILY   + 1)) | xargs -r rm -f
  ls -1t "$BACKUP_ROOT/weekly/"*.sql.gz  2>/dev/null | tail -n +$((KEEP_WEEKLY  + 1)) | xargs -r rm -f
  ls -1t "$BACKUP_ROOT/monthly/"*.sql.gz 2>/dev/null | tail -n +$((KEEP_MONTHLY + 1)) | xargs -r rm -f

  # Post-backup hooks: every executable in post-backup.d runs with $1 = path to
  # fresh dump. Failures of a single hook don't fail the backup.
  for hook in "$BACKUP_ROOT/post-backup.d/"*.sh; do
    [ -x "$hook" ] || continue
    echo "running hook $hook"
    "$hook" "$DUMP_FILE" || echo "hook $hook returned non-zero (continuing)"
  done

  echo "=== peritus-backup $TS OK ==="
} 2>&1 | tee -a "$LOG"

# Trim logs to last 30 days.
find "$BACKUP_ROOT/logs" -name '*.log' -mtime +30 -delete
