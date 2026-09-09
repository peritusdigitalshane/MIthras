# Runbook — publish a signed agent release

**Applies from agent v0.7.21.** Agents at or above that version refuse any
bundle without a valid Ed25519 signature. There is no bypass flag.

## Why

Before v0.7.21 the updater verified only the SHA-256 of the downloaded zip —
and that hash arrived in the same server message as the download URL. It
proved the file arrived intact, not that Mithras built it. Anyone who could
write a row into `agent_versions`, or queue an `upgrade_agent` command, had
SYSTEM-level code execution on every managed endpoint.

The signing key and the signing step had existed since Phase 1
(`scripts/phase1/provision-signing-key.sh`, `scripts/phase2a/build-release.sh`),
and `agent-version-check` already returned `ed25519_sig`. Only the agent-side
verification was missing. It is now in
`agent/runtime-powershell/lib/CodeSigning.psm1`.

## What is signed

The **raw 32 bytes** of the zip's SHA-256 digest — not the hex string, not the
file itself:

```
sha256(bundle.zip) -> 32 raw bytes -> Ed25519 sign -> base64 -> agent_versions.ed25519_sig
```

Both halves of the check must pass on the agent: the digest must match
`sha256`, and the signature must verify against the public key baked into
`CodeSigning.psm1` (which is asserted against
`agent/contracts/agent-signing-public.pem` by the Pester suite).

## Steps

1. **Bump the version**

   ```bash
   echo "0.7.22" > agent/runtime-powershell/agent.version
   ```

2. **Build and sign.** The private key lives root-owned, mode 600, on the
   build VM. Never copy it to a workstation.

   ```bash
   ssh itadmin@192.168.99.143
   cd /path/to/repo
   bash scripts/phase2a/build-release.sh /etc/peritus-supabase/agent-signing.pem
   ```

   The script fails if no key is given. It also verifies its own signature
   against the committed public key before it will finish — if that check
   fails, the key on the VM is not the one the fleet trusts. Stop and
   investigate; do not publish.

   For a local smoke build that will never be published:
   `ALLOW_UNSIGNED=1 bash scripts/phase2a/build-release.sh`.

3. **Upload the bundle** to the `agent-bundles` storage bucket. The download
   host must be on `$script:AllowedBundleHosts` in
   `agent/runtime-powershell/lib/Updater.psm1` — currently
   `api.mithras.com.au`, `njdcyjxgtckgtzgzoctw.supabase.co`, and
   `apidev.peritusdigital.com.au`. Anything else is refused before download.

4. **Register the release.**

   ```sql
   INSERT INTO public.agent_versions
       (version, runtime, channel, download_url, sha256, ed25519_sig, is_active, published_at, release_notes)
   VALUES
       ('0.7.22', 'powershell', 'stable',
        'https://api.mithras.com.au/storage/v1/object/public/agent-bundles/mithras-agent-0.7.22.zip',
        '<sha256 from dist/*.sha256>',
        '<base64 from dist/*.sig>',
        true, now(), '...')
   ON CONFLICT (version, runtime, channel) DO UPDATE SET
       download_url = EXCLUDED.download_url,
       sha256       = EXCLUDED.sha256,
       ed25519_sig  = EXCLUDED.ed25519_sig,
       is_active    = true;
   ```

   The `agent_versions_active_must_be_signed` constraint rejects this if
   `ed25519_sig` is null or blank on an active row. That is intentional — see
   the failure modes below.

5. **Verify** on one endpoint before rolling wider. On the target:

   ```powershell
   Get-Content C:\ProgramData\Mithras\logs\update.log -Tail 30
   ```

   A good update logs `verify: valid=True ... reason=ok`. A refusal logs
   `BUNDLE REJECTED: <reason>` and the endpoint stays on its current version.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Console shows "v0.7.x unsigned" instead of an Upgrade button | The active row has no `ed25519_sig` | Re-run step 2 with the key, update the row |
| `update.log`: `bundle rejected - signature does not verify` | Bundle re-uploaded after signing, or signed with the wrong key | Re-build, re-sign, re-upload together |
| `update.log`: `refusing bundle from untrusted host` | `download_url` host not in `AllowedBundleHosts` | Use an allow-listed host, or add one and ship an agent release first |
| Command fails: `refusing unsigned agent bundle` | `ed25519_sig` missing from the command params | Re-check `agent_versions`; agent-api will not auto-queue unsigned releases |
| Insert rejected by `agent_versions_active_must_be_signed` | Publishing unsigned as active | Sign it. This constraint is the guardrail working |

## Key rotation

The public key is compiled into every deployed agent, so rotation is a
two-release dance:

1. Publish release **N** signed with the **old** key, whose
   `Get-MithrasReleaseSigningKey` returns the **new** key.
2. Wait for the fleet to converge on N (check `endpoints.agent_version`).
3. Sign release N+1 with the new key. Update
   `agent/contracts/agent-signing-public.pem` to match.

Endpoints that miss step 1 will refuse every later release and need a manual
re-install. Do not skip the convergence wait.
