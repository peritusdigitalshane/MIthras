#!/bin/bash
#
# Uploads the three Mac agent scripts to /opt/peritus-agent-releases/ on
# docker02 (which Caddy serves at https://api.mithras.com.au/agent/*).
# Run from this directory on the build host.

set -euo pipefail

HOST="${MITHRAS_PROD_HOST:-root@149.28.186.142}"
DEST="${MITHRAS_PROD_DIR:-/opt/peritus-agent-releases}"

cd "$(dirname "$0")"

if [ ! -f install-mac.sh ] || [ ! -f mithras-agent-mac.sh ] || [ ! -f uninstall-mac.sh ]; then
    echo "error: run from agent/runtime-mac/" >&2
    exit 1
fi

VERSION="$(tr -d '[:space:]' < agent.version)"
echo "==> Uploading Mac agent v$VERSION to $HOST:$DEST"

scp install-mac.sh         "$HOST:$DEST/install-mac.sh"
scp uninstall-mac.sh       "$HOST:$DEST/uninstall-mac.sh"
scp mithras-agent-mac.sh   "$HOST:$DEST/mithras-agent-mac.sh"

ssh "$HOST" "chmod 0755 $DEST/install-mac.sh $DEST/uninstall-mac.sh $DEST/mithras-agent-mac.sh && ls -la $DEST/*-mac*.sh"

echo
echo "==> Mac agent live at:"
echo "    https://api.mithras.com.au/agent/install-mac.sh"
echo "    https://api.mithras.com.au/agent/mithras-agent-mac.sh"
echo "    https://api.mithras.com.au/agent/uninstall-mac.sh"
