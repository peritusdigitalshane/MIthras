#!/usr/bin/env bash
# Build a release zip of the Phase 2a PowerShell agent and Ed25519-sign it.
# Output:
#   dist/peritus-secure-agent-<version>.zip
#   dist/peritus-secure-agent-<version>.sha256
#   dist/peritus-secure-agent-<version>.sig    (base64 Ed25519 over the sha256)
#
# Usage:
#   bash scripts/phase2a/build-release.sh                          # builds with version from agent.version
#   bash scripts/phase2a/build-release.sh /etc/peritus-supabase/agent-signing.pem   # sign on the VM
#
# The signing key MUST be the same one whose public key lives at
# agent/contracts/agent-signing-public.pem. Phase 1 provisioned this.
set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
AGENT_DIR="$REPO_ROOT/agent/runtime-powershell"
VERSION=$(cat "$AGENT_DIR/agent.version" | tr -d '[:space:]')
DIST="$REPO_ROOT/dist"
SIGNING_KEY=${1:-}

if [ -z "$VERSION" ]; then
    echo "FATAL: agent.version is empty"
    exit 1
fi

mkdir -p "$DIST"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

echo "Building peritus-secure-agent-$VERSION.zip"

# Copy everything the runtime needs, excluding tests
cp -r "$AGENT_DIR/lib"           "$STAGE/lib"
cp -r "$AGENT_DIR/vendor"        "$STAGE/vendor"
cp    "$AGENT_DIR/peritus-secure-agent.ps1" "$STAGE/"
cp    "$AGENT_DIR/install-agent.ps1"        "$STAGE/"
cp    "$AGENT_DIR/uninstall-agent.ps1"      "$STAGE/"
cp    "$AGENT_DIR/agent.version"            "$STAGE/"
cp    "$AGENT_DIR/README.md"                "$STAGE/"

ZIP="$DIST/peritus-secure-agent-$VERSION.zip"
rm -f "$ZIP"
(cd "$STAGE" && zip -rq "$ZIP" .)
echo "  $(stat -c%s "$ZIP" 2>/dev/null || stat -f%z "$ZIP") bytes"

SHA=$(sha256sum "$ZIP" | awk '{print $1}')
echo "$SHA  peritus-secure-agent-$VERSION.zip" > "$DIST/peritus-secure-agent-$VERSION.sha256"
echo "  sha256: $SHA"

if [ -n "$SIGNING_KEY" ]; then
    if [ ! -r "$SIGNING_KEY" ]; then
        echo "FATAL: signing key not readable at $SIGNING_KEY"
        exit 1
    fi
    # Ed25519 signs raw bytes — we sign the SHA-256 digest (binary).
    SIG_B64=$(printf '%s' "$SHA" | xxd -r -p | openssl pkeyutl -sign -inkey "$SIGNING_KEY" -rawin | base64 -w0)
    echo "$SIG_B64" > "$DIST/peritus-secure-agent-$VERSION.sig"
    echo "  signature: ${SIG_B64:0:32}..."

    # Verify locally using the committed public key
    PUBKEY="$REPO_ROOT/agent/contracts/agent-signing-public.pem"
    if [ -r "$PUBKEY" ]; then
        printf '%s' "$SHA" | xxd -r -p > "$STAGE/digest.bin"
        printf '%s' "$SIG_B64" | base64 -d > "$STAGE/sig.bin"
        if openssl pkeyutl -verify -pubin -inkey "$PUBKEY" -rawin -in "$STAGE/digest.bin" -sigfile "$STAGE/sig.bin" >/dev/null 2>&1; then
            echo "  signature verifies against committed public key ✓"
        else
            echo "FATAL: signature does NOT verify against committed public key"
            exit 1
        fi
    fi
else
    echo "  (no signing key provided — skipping Ed25519 signature)"
fi

echo "Done. Artifacts in $DIST/"
