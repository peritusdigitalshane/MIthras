-- 20260909010000_require_signed_agent_releases.sql
--
-- Re-tighten agent_versions so an unsigned bundle cannot be published as a
-- live release. This is the server-side half of the fix that added Ed25519
-- verification to the agent updater (agent/runtime-powershell/lib/CodeSigning.psm1).
--
-- BACKGROUND
-- ----------
-- 20260513120100_agent_versions.sql created ed25519_sig NOT NULL, documenting
-- that the "public key [is] baked into every agent binary". It never was --
-- the agent verified only the SHA-256, and that hash arrives in the same
-- server message as the download URL, so it proved transport integrity and
-- nothing about provenance. Anyone able to write an agent_versions row, or
-- queue an upgrade_agent command, had SYSTEM code execution across the fleet.
--
-- 20260614050000 then dropped the NOT NULL because the release pipeline was
-- not signing, and the constraint was blocking the v0.7.20 row. That was the
-- right call at the time (the constraint was protecting nothing), but it left
-- the column permanently optional.
--
-- Now that the client actually verifies, "unsigned" means "no agent >= 0.7.21
-- will install it". Publishing one strands the fleet silently, so the database
-- should refuse.
--
-- WHY A NOT VALID CHECK RATHER THAN NOT NULL
-- ------------------------------------------
-- Row v0.7.20 exists today with ed25519_sig NULL and is the current stable
-- release. Setting the column NOT NULL would fail outright, and deleting or
-- deactivating that row would leave the fleet with no stable version to sit
-- on. A NOT VALID constraint skips validating the existing rows but IS
-- enforced on every INSERT and UPDATE from here on -- including the
-- ON CONFLICT DO UPDATE path in the release runbook, which is exactly the
-- path that would otherwise re-publish something unsigned.
--
-- The constraint is scoped to rows that are actually live (is_active = true).
-- Historical and withdrawn rows keep their NULLs; nobody can install them.
--
-- ROLLOUT ORDER (matters):
--   1. Apply this migration.
--   2. Publish v0.7.21 SIGNED. Agents still on <= 0.7.20 run the old updater,
--      which does not verify, so they take 0.7.21 normally. This is the last
--      unverified hop and it is unavoidable -- there is no way to retrofit
--      verification onto code already deployed.
--   3. Every hop after that is signature-verified.
--
-- To validate the constraint against history later (after backfilling or
-- retiring the v0.7.20 row):
--   ALTER TABLE public.agent_versions VALIDATE CONSTRAINT agent_versions_active_must_be_signed;

BEGIN;

ALTER TABLE public.agent_versions
    DROP CONSTRAINT IF EXISTS agent_versions_active_must_be_signed;

ALTER TABLE public.agent_versions
    ADD CONSTRAINT agent_versions_active_must_be_signed
    CHECK (
        is_active IS NOT TRUE
        OR (ed25519_sig IS NOT NULL AND length(btrim(ed25519_sig)) > 0)
    )
    NOT VALID;

COMMENT ON CONSTRAINT agent_versions_active_must_be_signed ON public.agent_versions IS
    'An active release must carry an Ed25519 signature over its sha256 digest. '
    'Agents >= 0.7.21 refuse unsigned bundles (CodeSigning.psm1), so publishing '
    'one strands the fleet. NOT VALID so the pre-existing unsigned v0.7.20 row '
    'survives; enforced on all new inserts and updates.';

COMMENT ON COLUMN public.agent_versions.ed25519_sig IS
    'Base64 Ed25519 signature over the RAW 32 bytes of the sha256 digest (not '
    'the hex string). Produced by scripts/phase2a/build-release.sh; verified by '
    'Test-AgentBundleSignature in agent/runtime-powershell/lib/CodeSigning.psm1 '
    'against the key committed at agent/contracts/agent-signing-public.pem.';

COMMIT;
