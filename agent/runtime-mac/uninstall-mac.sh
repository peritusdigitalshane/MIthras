#!/bin/bash
#
# Mithras Threat Defence — macOS agent uninstaller.
#
#   Usage: curl -fsSL https://api.mithras.com.au/agent/uninstall-mac.sh | sudo bash
#
# What it does:
#   1. Stops + unloads com.mithras.agent launchd job
#   2. Removes /Library/LaunchDaemons/com.mithras.agent.plist
#   3. Removes /usr/local/libexec/mithras (agent script)
#   4. Removes /usr/local/etc/mithras (config — agent_id + agent_secret)
#   5. Optionally preserves logs and state with --keep-logs

set -uo pipefail

KEEP_LOGS=false

while [ $# -gt 0 ]; do
    case "$1" in
        --keep-logs) KEEP_LOGS=true ;;
        --help|-h)
            echo "Usage: $0 [--keep-logs]"
            exit 0
            ;;
        *) echo "unknown arg: $1" >&2; exit 2 ;;
    esac
    shift
done

if [ "$(uname)" != "Darwin" ]; then
    echo "error: this uninstaller is for macOS" >&2
    exit 1
fi
if [ "$(id -u)" -ne 0 ]; then
    echo "error: must run as root (use sudo)" >&2
    exit 1
fi

PLIST_PATH="/Library/LaunchDaemons/com.mithras.agent.plist"
PLIST_LABEL="com.mithras.agent"
CONFIG_DIR="/usr/local/etc/mithras"
BIN_DIR="/usr/local/libexec/mithras"
LOG_DIR="/usr/local/var/log/mithras"
STATE_DIR="/usr/local/var/mithras"

echo "==> Stopping com.mithras.agent..."
launchctl bootout system "$PLIST_PATH" 2>/dev/null || true

echo "==> Removing $PLIST_PATH"
rm -f "$PLIST_PATH"

echo "==> Removing $BIN_DIR"
rm -rf "$BIN_DIR"

echo "==> Removing $CONFIG_DIR (config with agent secret)"
rm -rf "$CONFIG_DIR"

if [ "$KEEP_LOGS" = "true" ]; then
    echo "==> Preserving $LOG_DIR and $STATE_DIR (--keep-logs)"
else
    echo "==> Removing $LOG_DIR + $STATE_DIR"
    rm -rf "$LOG_DIR" "$STATE_DIR"
fi

echo
echo "==> Mithras agent removed."
echo "    The endpoint stays visible in the Mithras console until you soft-delete it."
