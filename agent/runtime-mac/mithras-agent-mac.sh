#!/bin/bash
#
# Mithras Threat Defence — macOS agent (lightweight).
#
# Runs as a launchd system daemon (com.mithras.agent), loops every 60s,
# heartbeats posture + identity + auth events to /functions/v1/agent-heartbeat.
# Every 6h also ships an installed-apps inventory snapshot.
#
# This is the lightweight v1 — posture + inventory + sparse auth events.
# Does NOT do ESF-grade real-time process monitoring (out of scope for v1;
# requires Apple notarisation + Endpoint Security entitlement).
#
# Config:
#   /usr/local/etc/mithras/config.json  ← agent_id, agent_secret, api_base
# State:
#   /usr/local/var/mithras/last_inventory_ts  ← unix ts of last full inventory
#   /usr/local/var/mithras/last_auth_ts       ← unix ts of last shipped auth event
# Logs:
#   /usr/local/var/log/mithras/agent.log
#   /usr/local/var/log/mithras/agent.err

set -uo pipefail

AGENT_VERSION="0.1.0"
CONFIG_FILE="${MITHRAS_CONFIG:-/usr/local/etc/mithras/config.json}"
LOG_DIR="${MITHRAS_LOG_DIR:-/usr/local/var/log/mithras}"
STATE_DIR="${MITHRAS_STATE_DIR:-/usr/local/var/mithras}"

HEARTBEAT_INTERVAL=60
INVENTORY_INTERVAL=21600  # 6 hours
AUTH_EVENT_LOOKBACK="5m"  # log show --last
MAX_AUTH_EVENTS=50        # per heartbeat

INVENTORY_STATE_FILE="$STATE_DIR/last_inventory_ts"
AUTH_STATE_FILE="$STATE_DIR/last_auth_ts"

mkdir -p "$STATE_DIR" "$LOG_DIR"

# ============================================================================
# CONFIG
# ============================================================================

if [ ! -r "$CONFIG_FILE" ]; then
    echo "$(date) [agent] fatal: config file not readable: $CONFIG_FILE" >&2
    exit 1
fi

AGENT_ID=$(sed -n 's/.*"agent_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$CONFIG_FILE")
AGENT_SECRET=$(sed -n 's/.*"agent_secret"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$CONFIG_FILE")
API_BASE=$(sed -n 's/.*"api_base"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$CONFIG_FILE")

if [ -z "$AGENT_ID" ] || [ -z "$AGENT_SECRET" ] || [ -z "$API_BASE" ]; then
    echo "$(date) [agent] fatal: config missing agent_id/agent_secret/api_base" >&2
    exit 1
fi

# ============================================================================
# JSON UTILS  — pure bash, no jq dependency
# ============================================================================

# Escape a string for embedding inside a JSON ".." literal.
# Handles: backslash, double quote, newline, CR, tab. Other control chars are
# rare in the values we feed (hostname, model, version strings) and not worth
# handling in v1.
json_escape() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\t'/\\t}"
    printf '%s' "$s"
}

# ============================================================================
# HMAC SIGNING
# ============================================================================
#
# Server canonical: "<METHOD>\n<path>\n<unix_ts>\n<raw_body>"
# Verified at supabase/functions/_shared/hmac.ts. We sign the literal bytes
# we'll send on the wire — server does NOT re-canonicalise the body for
# signature check, it uses request.text() verbatim.

hmac_sign() {
    local method="$1" path="$2" ts="$3" body="$4"
    printf '%s\n%s\n%s\n%s' "$method" "$path" "$ts" "$body" \
        | openssl dgst -sha256 -hmac "$AGENT_SECRET" -hex 2>/dev/null \
        | awk '{print $NF}'
}

# ============================================================================
# POSTURE COLLECTORS
# ============================================================================

posture_filevault() {
    fdesetup status 2>/dev/null | grep -q "FileVault is On" && echo true || echo false
}
posture_sip() {
    csrutil status 2>/dev/null | grep -q "enabled" && echo true || echo false
}
posture_gatekeeper() {
    spctl --status 2>/dev/null | grep -q "assessments enabled" && echo true || echo false
}
posture_mdm_enrolled() {
    profiles status -type enrollment 2>/dev/null | grep -q "MDM enrollment: Yes" && echo true || echo false
}
posture_xprotect_version() {
    # Apple has moved XProtect's location across versions; try the modern path first.
    local v
    v=$(defaults read "/Library/Apple/System/Library/CoreServices/XProtect.bundle/Contents/Info" CFBundleShortVersionString 2>/dev/null)
    [ -z "$v" ] && v=$(defaults read "/System/Library/CoreServices/XProtect.bundle/Contents/Info" CFBundleShortVersionString 2>/dev/null)
    printf '%s' "${v:-unknown}"
}
posture_firewall() {
    local state
    state=$(defaults read /Library/Preferences/com.apple.alf globalstate 2>/dev/null || echo 0)
    case "$state" in
        1|2) echo true ;;
        *)   echo false ;;
    esac
}
posture_secureboot() {
    # Apple Silicon only. On Intel Macs returns "unknown".
    nvram -p 2>/dev/null | grep -q "secure-boot" && echo true || echo unknown
}
posture_remote_login() {
    systemsetup -getremotelogin 2>/dev/null | grep -q "Off" && echo false || echo true
}

# ============================================================================
# HOST IDENTITY
# ============================================================================

host_hostname() {
    scutil --get LocalHostName 2>/dev/null || hostname -s 2>/dev/null || hostname
}
host_os_version() {
    printf 'macOS %s' "$(sw_vers -productVersion 2>/dev/null || echo unknown)"
}
host_os_build() {
    sw_vers -buildVersion 2>/dev/null || echo unknown
}
host_arch() {
    uname -m
}
host_model() {
    sysctl -n hw.model 2>/dev/null || echo unknown
}
host_uuid() {
    ioreg -rd1 -c IOPlatformExpertDevice 2>/dev/null | awk -F'"' '/IOPlatformUUID/ {print $4; exit}'
}

# ============================================================================
# INVENTORY  (every 6 hours)
# ============================================================================
#
# Walks /Applications (system) + /Applications/Utilities + ~/Applications for
# every signed-in user. For each .app, pulls name + version + bundle id from
# its Info.plist. The output is a JSON array.

inventory_apps_json() {
    local out=""
    local first=true
    local app name version bundle_id

    # System + per-user app directories
    local dirs=("/Applications" "/Applications/Utilities")
    while IFS= read -r home; do
        [ -d "$home/Applications" ] && dirs+=("$home/Applications")
    done < <(dscl . -list /Users NFSHomeDirectory 2>/dev/null | awk '$1 !~ /^_/ && $2 ~ /^\// { print $2 }')

    for dir in "${dirs[@]}"; do
        # -maxdepth 2 catches /Applications/Foo.app AND /Applications/Utilities/Bar.app
        while IFS= read -r app; do
            local plist="$app/Contents/Info.plist"
            [ ! -r "$plist" ] && continue
            name=$(defaults read "$plist" CFBundleName 2>/dev/null || basename "$app" .app)
            version=$(defaults read "$plist" CFBundleShortVersionString 2>/dev/null || echo "")
            bundle_id=$(defaults read "$plist" CFBundleIdentifier 2>/dev/null || echo "")
            if [ "$first" = "true" ]; then first=false; else out="$out,"; fi
            out="$out{\"name\":\"$(json_escape "$name")\",\"version\":\"$(json_escape "$version")\",\"bundle_id\":\"$(json_escape "$bundle_id")\",\"path\":\"$(json_escape "$app")\"}"
        done < <(find "$dir" -maxdepth 2 -name '*.app' -type d 2>/dev/null)
    done

    # Homebrew formulae + casks if present
    if command -v brew >/dev/null 2>&1; then
        while IFS= read -r line; do
            [ -z "$line" ] && continue
            name=$(echo "$line" | awk '{print $1}')
            version=$(echo "$line" | awk '{print $2}')
            if [ "$first" = "true" ]; then first=false; else out="$out,"; fi
            out="$out{\"name\":\"$(json_escape "$name")\",\"version\":\"$(json_escape "$version")\",\"bundle_id\":\"\",\"path\":\"brew\"}"
        done < <(sudo -u "$(stat -f %Su /Users/$(ls /Users | head -1))" brew list --formula --versions 2>/dev/null | head -200)
    fi

    printf '[%s]' "$out"
}

# ============================================================================
# AUTH EVENTS  — log show with predicate, capped
# ============================================================================
#
# Sparse / human-readable rather than full firehose. We're catching sudo,
# loginwindow auth failures, screen unlocks, and ssh accepted/rejected.
# Each row → {time, process, message}.

auth_events_json() {
    local out=""
    local first=true
    local line ts process message

    # `log show` is slow if we ask for a long window. v1: only the last 5
    # minutes — more than 50 auth events in 5 minutes already means something
    # weird is going on, so the cap is also a budget guard.
    while IFS= read -r line; do
        # Format: 2026-06-11 04:32:17.123456+1000 process: message
        ts=$(echo "$line" | awk '{print $1, $2}')
        process=$(echo "$line" | awk -F': ' '{print $1}' | awk '{print $NF}')
        message=$(echo "$line" | sed 's/^[^:]*: //')
        [ -z "$ts" ] && continue
        if [ "$first" = "true" ]; then first=false; else out="$out,"; fi
        out="$out{\"time\":\"$(json_escape "$ts")\",\"process\":\"$(json_escape "$process")\",\"message\":\"$(json_escape "$message")\"}"
    done < <(log show --last "$AUTH_EVENT_LOOKBACK" \
        --predicate 'process == "sudo" OR process == "loginwindow" OR (process == "sshd" AND (eventMessage CONTAINS "Accepted" OR eventMessage CONTAINS "Failed"))' \
        --style syslog 2>/dev/null | grep -v "^Filtering" | head -"$MAX_AUTH_EVENTS")

    printf '[%s]' "$out"
}

# ============================================================================
# HEARTBEAT BODY BUILDER
# ============================================================================

build_body() {
    local include_inventory="$1"

    local hostname os_version os_build arch model uuid
    hostname=$(host_hostname)
    os_version=$(host_os_version)
    os_build=$(host_os_build)
    arch=$(host_arch)
    model=$(host_model)
    uuid=$(host_uuid)

    local fv sip gk mdm xprotect fw secboot rl
    fv=$(posture_filevault)
    sip=$(posture_sip)
    gk=$(posture_gatekeeper)
    mdm=$(posture_mdm_enrolled)
    xprotect=$(posture_xprotect_version)
    fw=$(posture_firewall)
    secboot=$(posture_secureboot)
    rl=$(posture_remote_login)

    # defender_state is a free-form JSONB column server-side. Embedding a
    # "platform":"macos" lets the frontend dispatch on it cleanly.
    local defender_state
    defender_state="{\"platform\":\"macos\",\"filevault_enabled\":$fv,\"sip_enabled\":$sip,\"gatekeeper_enabled\":$gk,\"firewall_enabled\":$fw,\"mdm_enrolled\":$mdm,\"remote_login_enabled\":$rl,\"secure_boot\":\"$(json_escape "$secboot")\",\"xprotect_version\":\"$(json_escape "$xprotect")\",\"arch\":\"$(json_escape "$arch")\",\"model\":\"$(json_escape "$model")\",\"hardware_uuid\":\"$(json_escape "$uuid")\"}"

    local events_json
    events_json=$(auth_events_json)

    local inventory_payload=""
    if [ "$include_inventory" = "true" ]; then
        local apps_json
        apps_json=$(inventory_apps_json)
        inventory_payload=",\"software_inventory\":$apps_json,\"software_inventory_complete\":true"
    fi

    printf '{"hostname":"%s","os_version":"%s","os_build":"%s","agent_version":"%s","defender_state":%s,"event_logs":%s%s}' \
        "$(json_escape "$hostname")" \
        "$(json_escape "$os_version")" \
        "$(json_escape "$os_build")" \
        "$AGENT_VERSION" \
        "$defender_state" \
        "$events_json" \
        "$inventory_payload"
}

# ============================================================================
# HEARTBEAT SENDER
# ============================================================================

send_heartbeat() {
    local body="$1"
    local ts path sig resp_file
    ts=$(date +%s)
    path="/functions/v1/agent-heartbeat"
    sig=$(hmac_sign POST "$path" "$ts" "$body")
    resp_file=$(mktemp)
    local code
    code=$(curl -sS -o "$resp_file" -w '%{http_code}' \
        --max-time 30 \
        -X POST \
        -H "Content-Type: application/json" \
        -H "X-Agent-Id: $AGENT_ID" \
        -H "X-Timestamp: $ts" \
        -H "X-Signature: $sig" \
        -d "$body" \
        "$API_BASE$path" 2>/dev/null || echo "000")
    if [ "$code" != "200" ]; then
        echo "$(date) [agent] heartbeat failed code=$code" >&2
        head -c 500 "$resp_file" >&2 2>/dev/null || true
        echo >&2
    fi
    rm -f "$resp_file"
    [ "$code" = "200" ]
}

# ============================================================================
# MAIN LOOP
# ============================================================================

echo "$(date) [agent] starting v$AGENT_VERSION agent_id=$AGENT_ID api_base=$API_BASE"

last_inventory=0
if [ -r "$INVENTORY_STATE_FILE" ]; then
    last_inventory=$(cat "$INVENTORY_STATE_FILE" 2>/dev/null || echo 0)
fi

while true; do
    now=$(date +%s)
    include_inv="false"
    if [ $((now - last_inventory)) -ge $INVENTORY_INTERVAL ]; then
        include_inv="true"
    fi

    body=$(build_body "$include_inv")
    if send_heartbeat "$body"; then
        if [ "$include_inv" = "true" ]; then
            echo "$now" > "$INVENTORY_STATE_FILE"
            last_inventory=$now
            echo "$(date) [agent] heartbeat OK (with inventory)"
        else
            # Quiet log on the common path — only the first per hour gets a line
            if [ $((now % 3600)) -lt $HEARTBEAT_INTERVAL ]; then
                echo "$(date) [agent] heartbeat OK"
            fi
        fi
    fi

    sleep $HEARTBEAT_INTERVAL
done
