-- 20260614050000_agent_versions_ed25519_nullable.sql
--
-- Relax agent_versions.ed25519_sig from NOT NULL to NULL so unsigned
-- bundles (built without the Phase-5 code-signing pipeline) can still be
-- registered in the catalogue.
--
-- Context: every existing v0.5.x..v0.7.19 row carries an ed25519 signature
-- that the agent auto-updater is meant to verify. We never enforced
-- verification on the client side and the signing pipeline isn't yet
-- in place for this stack. Insisting the column be NOT NULL just blocked
-- the v0.7.20 release row from being inserted at all, so the version
-- never appeared in /admin/agent-versions even though latest.json was
-- updated and agents picked up the new build.
--
-- Once signing is wired up (Phase 5 of the agent modernisation plan), we
-- can re-tighten this column AND add a "signed" boolean view so the UI
-- can render an unsigned badge until then.

BEGIN;

ALTER TABLE public.agent_versions
    ALTER COLUMN ed25519_sig DROP NOT NULL;

-- Register the v0.7.20 release that introduced the update-ring agent
-- support (Apply-UpdateRing in PolicyEnforcer.psm1).
INSERT INTO public.agent_versions (version, runtime, channel, download_url, sha256, ed25519_sig, is_active, published_at, release_notes)
VALUES (
    '0.7.20',
    'powershell',
    'stable',
    'https://api.mithras.com.au/storage/v1/object/public/agent-bundles/mithras-agent-0.7.20.zip',
    'c7f71a24d6dcdf7895d348567f0e5725e611fbb34be4ec58b4fa41286d38c69d',
    NULL,
    true,
    '2026-06-14T13:06:58Z',
    'Adds /update-ring policy fetch in Invoke-PolicyEnforcementPass and a new Apply-UpdateRing function in PolicyEnforcer.psm1. Endpoints assigned to a group with an update ring now write the ring''s defer-days, install window, and critical-only flag into the WUfB registry policy at next heartbeat. Unsigned release.'
)
ON CONFLICT (version, runtime, channel) DO UPDATE SET
    download_url = EXCLUDED.download_url,
    sha256       = EXCLUDED.sha256,
    is_active    = true,
    release_notes = EXCLUDED.release_notes;

COMMIT;
