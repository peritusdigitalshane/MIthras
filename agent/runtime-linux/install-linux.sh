#!/usr/bin/env bash
#
# Mithras Linux agent installer.
#
#   Usage:   curl -fsSL https://api.mithras.com.au/agent/install-linux.sh | sudo bash -s -- --token=<TOKEN>
#   Or:      sudo MITHRAS_TOKEN=<TOKEN> bash install-linux.sh
#
# What it does:
#   1. Detects CPU architecture (amd64 or arm64)
#   2. Downloads the matching mithras-agent binary to /usr/local/bin
#   3. Enrolls the host with the on-prem API using the supplied token
#   4. Writes /etc/peritus/config.json (mode 0600)
#   5. Installs and starts a mithras-agent.service systemd unit

set -euo pipefail

API_BASE="${MITHRAS_API:-https://api.mithras.com.au}"
TOKEN="${MITHRAS_TOKEN:-}"
BIN_PATH="/usr/local/bin/mithras-agent"
CONFIG_DIR="/etc/peritus"
CONFIG_FILE="$CONFIG_DIR/config.json"
SERVICE_FILE="/etc/systemd/system/mithras-agent.service"

# Parse args
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
            exit 0 ;;
        *) echo "unknown arg: $1" >&2; exit 2 ;;
    esac
    shift
done

if [ "$(id -u)" -ne 0 ]; then
    echo "error: must run as root (use sudo)" >&2
    exit 1
fi
if [ -z "$TOKEN" ]; then
    echo "error: enrolment token required (--token=...)" >&2
    exit 1
fi

# Detect arch
arch="$(uname -m)"
case "$arch" in
    x86_64|amd64) GOARCH="amd64" ;;
    aarch64|arm64) GOARCH="arm64" ;;
    *) echo "error: unsupported architecture: $arch" >&2; exit 1 ;;
esac

# Detect systemd
if ! command -v systemctl >/dev/null 2>&1; then
    echo "error: systemd is required" >&2
    exit 1
fi

echo "==> Downloading mithras-agent ($GOARCH)..."
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL -o "$TMP/mithras-agent" "$API_BASE/agent/mithras-agent-linux-$GOARCH"

chmod 0755 "$TMP/mithras-agent"
install -m 0755 -o root -g root "$TMP/mithras-agent" "$BIN_PATH"
echo "    installed: $BIN_PATH ($("$BIN_PATH" version))"

mkdir -p "$CONFIG_DIR"
chmod 0700 "$CONFIG_DIR"

echo "==> Enrolling host..."
"$BIN_PATH" enroll --token="$TOKEN" --api="$API_BASE" --config="$CONFIG_FILE"

cat > "$SERVICE_FILE" <<UNIT
[Unit]
Description=Mithras Threat Defence agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$BIN_PATH run --config=$CONFIG_FILE
Restart=on-failure
RestartSec=10s
User=root
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$CONFIG_DIR
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

chmod 0644 "$SERVICE_FILE"
systemctl daemon-reload
systemctl enable --now mithras-agent.service

sleep 3
if systemctl is-active --quiet mithras-agent.service; then
    echo "==> Active: mithras-agent.service"
    echo
    echo "    Status:    systemctl status mithras-agent"
    echo "    Logs:      journalctl -u mithras-agent -f"
    echo "    Config:    $CONFIG_FILE"
else
    echo "warning: service did not become active. journalctl -u mithras-agent -e" >&2
    exit 1
fi
