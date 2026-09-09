-- 20260909020000_mesh_config_to_platform_settings.sql
--
-- Move the MeshCentral enrolment config out of agent source and into
-- platform_settings, where it is reachable only by super-admin RLS and by
-- the service-role key that agent-api runs under.
--
-- WHAT WAS WRONG
-- --------------
-- agent/runtime-powershell/lib/CommandExecutor.psm1 carried the mesh group id
-- as a hardcoded default parameter value. That id is a shared remote-access
-- enrolment secret -- holding it is enough to enrol a device into the Mithras
-- remote-control group. It was therefore:
--
--   * committed to git (present in history from commit 8b0049a onward), and
--   * shipped in cleartext inside the agent bundle to every customer endpoint.
--
-- The console enqueues install_mesh_agent with no params at all, so that
-- hardcoded default was the value actually in use on every install.
--
-- WHAT CHANGES
-- ------------
-- Agent v0.7.21 has no built-in fallback. It reads the config from
-- agent-api GET /mesh-config, which is gated by the agent's own credentials
-- and reads the two rows created here.
--
-- ACTION REQUIRED AFTER APPLYING THIS MIGRATION
-- ---------------------------------------------
-- mesh_group_id is seeded EMPTY on purpose. The previous value is exposed in
-- git history and on every deployed endpoint, so it should be rotated in
-- MeshCentral rather than carried forward -- and writing it into this file
-- would just commit the same secret again.
--
-- Remote access (install_mesh_agent) returns a clear "not configured" error
-- until this is set. To set it:
--
--   1. In MeshCentral, create a new device group (or rotate the existing
--      group's id) and copy its mesh id.
--   2. UPDATE public.platform_settings
--         SET value = '<new mesh id>', updated_at = now()
--       WHERE key = 'mesh_group_id';
--   3. Existing endpoints keep working -- they are already enrolled. Only NEW
--      install_mesh_agent commands use this value.
--
-- If you would rather restore service immediately and rotate later, set it to
-- the current group's id in step 2. That is no worse than today's exposure,
-- but it does leave a known-published secret live, so treat it as temporary.
--
-- See docs/runbooks/rotate-mesh-group-id.md.

BEGIN;

INSERT INTO public.platform_settings (key, value, description, is_secret)
VALUES (
    'mesh_group_id',
    '',
    'MeshCentral device-group id used by the install_mesh_agent command. Shared remote-access enrolment secret: anyone holding it can enrol a device into the Mithras remote-control group. Served only to authenticated agents via agent-api GET /mesh-config. Never expose to the web console.',
    true
)
ON CONFLICT (key) DO UPDATE SET
    description = EXCLUDED.description,
    is_secret   = true;

INSERT INTO public.platform_settings (key, value, description, is_secret)
VALUES (
    'mesh_server_url',
    'https://remote.mithras.com.au',
    'MeshCentral server base URL for agent enrolment. Must also appear in $script:AllowedMeshHosts in agent/runtime-powershell/lib/CommandExecutor.psm1 -- the agent refuses to download from any host not on that list.',
    false
)
ON CONFLICT (key) DO UPDATE SET
    description = EXCLUDED.description;

COMMIT;
