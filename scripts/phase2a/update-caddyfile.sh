#!/usr/bin/env bash
# Add /agent/* file-server route to api.cmwcollective.com.au and apidev.peritusdigital.com.au.
# Idempotent: re-running won't duplicate.
#
# VM specifics this script accommodates:
#  - fs.protected_regular=2 — blocks `sudo tee` from writing to user-owned files
#    in /tmp, so the staging tempfile must be created with `sudo mktemp` (root-owned).
#  - caddy.service runs as the `caddy` user — the Caddyfile must be world-readable
#    after replacement, so we re-set 644 after `sudo mv`.
set -euo pipefail

VM=${VM:-itadmin@192.168.99.143}
ssh "$VM" "bash -s" <<'REMOTE'
set -euo pipefail
CADDYFILE=/etc/caddy/Caddyfile
sudo cp "$CADDYFILE" "$CADDYFILE.bak.$(date +%s)"

apply_handler () {
    local host="$1"   # plain hostname (e.g. api.cmwcollective.com.au) — used for skip check
    local pattern="$2"   # awk regex-safe (dots escaped, no leading /) — used for matching

    # Skip if this vhost already has /agent. Use string match in awk to sidestep regex-delimiter issues.
    if sudo awk -v h="$host" '
        $0 ~ h && /\{/ { in_block=1 }
        in_block && /handle \/agent/ { print "FOUND"; exit }
        in_block && /^}/ { in_block=0 }
    ' "$CADDYFILE" | grep -q FOUND; then
        echo "/agent/* handler already present on $host"
        return 0
    fi

    local TMP
    TMP=$(sudo mktemp)
    sudo awk -v p="$pattern" '
    $0 ~ p && /\{/ {
        print
        print "    handle /agent/* {"
        print "        root * /opt/peritus-agent-releases"
        print "        uri strip_prefix /agent"
        print "        file_server"
        print "    }"
        next
    }
    { print }
    ' "$CADDYFILE" | sudo tee "$TMP" >/dev/null
    sudo mv "$TMP" "$CADDYFILE"
    sudo chown root:root "$CADDYFILE"
    sudo chmod 644 "$CADDYFILE"
    echo "Added /agent/* handler to $host"
}

apply_handler 'api.cmwcollective.com.au'    'api\.cmwcollective\.com\.au:80'
apply_handler 'apidev.peritusdigital.com.au' 'apidev\.peritusdigital\.com\.au:80'

sudo caddy validate --config "$CADDYFILE"
sudo systemctl reload caddy
echo "Caddy reloaded."
REMOTE
