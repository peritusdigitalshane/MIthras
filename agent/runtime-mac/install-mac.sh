#!/bin/bash
#
# Mithras Threat Defence — macOS agent installer.
#
#   Usage:   curl -fsSL https://api.mithras.com.au/agent/install-mac.sh | sudo bash -s -- --token=<TOKEN>
#   Or:      sudo MITHRAS_TOKEN=<TOKEN> bash install-mac.sh
#
# What it does:
#   1. Downloads the agent script to /usr/local/libexec/mithras/mithras-agent.sh
#   2. Enrols the host with /functions/v1/agent-enroll using the supplied token
#   3. Writes /usr/local/etc/mithras/config.json (mode 0600) with agent_id +
#      agent_secret + api_base
#   4. Installs and loads /Library/LaunchDaemons/com.mithras.agent.plist
#      so the agent runs as root in the background and survives reboots
#
# Reversal: curl -fsSL https://api.mithras.com.au/agent/uninstall-mac.sh | sudo bash

set -euo pipefail

API_BASE="${MITHRAS_API:-https://api.mithras.com.au}"
TOKEN="${MITHRAS_TOKEN:-}"

# --- argv parsing ---
while [ $# -gt 0 ]; do
    case "$1" in
        --token=*) TOKEN="${1#*=}" ;;
        --api=*)   API_BASE="${1#*=}" ;;
        --help|-h)
            cat <<USAGE
Usage: $0 --token=<ENROLLMENT_TOKEN> [--api=https://api.mithras.com.au]

Environment vars:
  MITHRAS_TOKEN  same as --token
  MITHRAS_API    same as --api
USAGE
            exit 0
            ;;
        *) echo "unknown arg: $1" >&2; exit 2 ;;
    esac
    shift
done

# --- preflight ---
if [ "$(uname)" != "Darwin" ]; then
    echo "error: this installer is for macOS. Use install-linux.sh on Linux." >&2
    exit 1
fi
if [ "$(id -u)" -ne 0 ]; then
    echo "error: must run as root (use sudo)" >&2
    exit 1
fi
if [ -z "$TOKEN" ]; then
    echo "error: enrolment token required (--token=...)" >&2
    exit 1
fi

# --- paths ---
CONFIG_DIR="/usr/local/etc/mithras"
CONFIG_FILE="$CONFIG_DIR/config.json"
BIN_DIR="/usr/local/libexec/mithras"
AGENT_SCRIPT="$BIN_DIR/mithras-agent.sh"
LOG_DIR="/usr/local/var/log/mithras"
STATE_DIR="/usr/local/var/mithras"
PLIST_PATH="/Library/LaunchDaemons/com.mithras.agent.plist"
PLIST_LABEL="com.mithras.agent"

mkdir -p "$CONFIG_DIR" "$BIN_DIR" "$LOG_DIR" "$STATE_DIR"
chmod 0700 "$CONFIG_DIR"
chmod 0755 "$BIN_DIR" "$LOG_DIR" "$STATE_DIR"

# --- download the agent script ---
echo "==> Downloading Mithras agent..."
TMP_SCRIPT="$(mktemp)"
curl -fsSL -o "$TMP_SCRIPT" "$API_BASE/agent/mithras-agent-mac.sh"
chmod 0755 "$TMP_SCRIPT"
install -m 0755 -o root -g wheel "$TMP_SCRIPT" "$AGENT_SCRIPT"
rm -f "$TMP_SCRIPT"
echo "    installed: $AGENT_SCRIPT"

# --- collect host info for enrolment ---
HOSTNAME="$(scutil --get LocalHostName 2>/dev/null || hostname -s 2>/dev/null || hostname)"
OS_VERSION="macOS $(sw_vers -productVersion 2>/dev/null || echo unknown)"
OS_BUILD="$(sw_vers -buildVersion 2>/dev/null || echo unknown)"

# --- enrol ---
echo "==> Enrolling host with platform..."
ENROLL_BODY="{\"enrollment_token\":\"$TOKEN\",\"hostname\":\"$HOSTNAME\",\"os_version\":\"$OS_VERSION\",\"os_build\":\"$OS_BUILD\",\"runtime\":\"macos\"}"

# We capture stdout (the JSON response) and stderr separately so a non-2xx
# can show the server's error message verbatim.
ENROLL_OUT="$(mktemp)"
ENROLL_ERR="$(mktemp)"
HTTP_CODE="$(curl -sS -o "$ENROLL_OUT" -w '%{http_code}' \
    -X POST \
    -H "Content-Type: application/json" \
    -d "$ENROLL_BODY" \
    "$API_BASE/functions/v1/agent-enroll" 2>"$ENROLL_ERR")" || true

if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "201" ]; then
    echo "error: enrolment failed (HTTP $HTTP_CODE)" >&2
    cat "$ENROLL_OUT" >&2 || true
    cat "$ENROLL_ERR" >&2 || true
    rm -f "$ENROLL_OUT" "$ENROLL_ERR"
    exit 1
fi

# Parse the response — single-shot sed regex, no jq dependency. The server
# emits a stable shape and never re-orders these two fields within a record.
AGENT_ID=$(sed -n 's/.*"agent_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ENROLL_OUT")
AGENT_SECRET=$(sed -n 's/.*"agent_secret"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ENROLL_OUT")
API_RESP_BASE=$(sed -n 's/.*"api_base_url"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ENROLL_OUT")
rm -f "$ENROLL_OUT" "$ENROLL_ERR"

if [ -z "$AGENT_ID" ] || [ -z "$AGENT_SECRET" ]; then
    echo "error: enrolment response missing agent_id or agent_secret" >&2
    exit 1
fi
[ -n "$API_RESP_BASE" ] && API_BASE="$API_RESP_BASE"

# --- write config (0600 owner=root) ---
umask 077
cat > "$CONFIG_FILE" <<JSON
{
  "agent_id": "$AGENT_ID",
  "agent_secret": "$AGENT_SECRET",
  "api_base": "$API_BASE"
}
JSON
chmod 0600 "$CONFIG_FILE"
chown root:wheel "$CONFIG_FILE"
echo "    config: $CONFIG_FILE (mode 0600)"

# --- write launchd plist ---
cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$PLIST_LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$AGENT_SCRIPT</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>MITHRAS_CONFIG</key>
        <string>$CONFIG_FILE</string>
        <key>MITHRAS_LOG_DIR</key>
        <string>$LOG_DIR</string>
        <key>MITHRAS_STATE_DIR</key>
        <string>$STATE_DIR</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>30</integer>
    <key>StandardOutPath</key>
    <string>$LOG_DIR/agent.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/agent.err</string>
</dict>
</plist>
PLIST
chown root:wheel "$PLIST_PATH"
chmod 0644 "$PLIST_PATH"

# --- (re)load via launchctl ---
launchctl bootout system "$PLIST_PATH" 2>/dev/null || true
launchctl bootstrap system "$PLIST_PATH"
launchctl enable system/"$PLIST_LABEL"

# --- wait a moment, confirm the daemon is alive ---
sleep 3
if launchctl print system/"$PLIST_LABEL" >/dev/null 2>&1; then
    echo
    echo "==> Mithras agent is running."
    echo
    echo "    Status:    sudo launchctl print system/$PLIST_LABEL | head -20"
    echo "    Logs:      tail -f $LOG_DIR/agent.log"
    echo "    Config:    $CONFIG_FILE"
    echo "    Uninstall: curl -fsSL $API_BASE/agent/uninstall-mac.sh | sudo bash"
    echo
    echo "    This Mac will appear in your Mithras console within ~60 seconds."
else
    echo "warning: launchctl print returned no info. Check $LOG_DIR/agent.err" >&2
    exit 1
fi
