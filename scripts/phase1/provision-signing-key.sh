#!/usr/bin/env bash
# Run on the replica VM. Idempotent: if /etc/peritus-supabase/agent-signing.pem exists, do nothing.
# Generates an Ed25519 keypair, stores private key on the VM (mode 600, root-owned),
# and prints the PEM-encoded public key to stdout for copying into agent/contracts/.
set -euo pipefail

PRIVATE_KEY=/etc/peritus-supabase/agent-signing.pem
PUBLIC_KEY=/etc/peritus-supabase/agent-signing.pub.pem

if [ -f "$PRIVATE_KEY" ]; then
    echo "Private key already exists at $PRIVATE_KEY. Skipping generation."
    echo
    echo "--- public key (copy below into agent/contracts/agent-signing-public.pem) ---"
    sudo cat "$PUBLIC_KEY"
    exit 0
fi

echo "Generating Ed25519 keypair..."
sudo install -d -m 700 -o root -g root /etc/peritus-supabase
sudo openssl genpkey -algorithm ed25519 -out "$PRIVATE_KEY"
sudo chmod 600 "$PRIVATE_KEY"
sudo chown root:root "$PRIVATE_KEY"

sudo openssl pkey -in "$PRIVATE_KEY" -pubout -out "$PUBLIC_KEY"
sudo chmod 644 "$PUBLIC_KEY"

echo "Generated. Fingerprint:"
sudo openssl pkey -in "$PRIVATE_KEY" -pubout -outform DER | sha256sum | head -c 16
echo

echo
echo "--- public key (copy below into agent/contracts/agent-signing-public.pem) ---"
sudo cat "$PUBLIC_KEY"
