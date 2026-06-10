-- 20260604060000_endpoint_mesh_agent_state.sql
--
-- Per-endpoint Remote Access (MeshAgent) install state. v0.7.4+: the
-- Mithras installer no longer drops MeshAgent on by default; operators
-- opt in per-endpoint from the SOC console. This column tracks where in
-- the lifecycle each endpoint is.
--
--   not_installed -> default for every endpoint
--   installing    -> operator clicked Install; install_mesh_agent
--                    command is queued/dispatched
--   installed     -> agent confirmed MeshAgent service is Running
--   failed        -> install attempt errored; mesh_agent_error has the
--                    last failure reason
--   uninstalling  -> uninstall_mesh_agent queued/in-flight

ALTER TABLE public.endpoints
    ADD COLUMN IF NOT EXISTS mesh_agent_state TEXT NOT NULL DEFAULT 'not_installed'
    CHECK (mesh_agent_state IN ('not_installed','installing','installed','failed','uninstalling'));

ALTER TABLE public.endpoints
    ADD COLUMN IF NOT EXISTS mesh_agent_error TEXT;

ALTER TABLE public.endpoints
    ADD COLUMN IF NOT EXISTS mesh_agent_installed_at TIMESTAMPTZ;

-- Backfill: any endpoint that ALREADY has a mesh_node_id was set up under
-- the v0.7.3 always-on path - mark them as installed so the SOC console
-- shows the right state and Remote Desktop stays enabled for them.
UPDATE public.endpoints
SET mesh_agent_state = 'installed',
    mesh_agent_installed_at = COALESCE(mesh_agent_installed_at, now())
WHERE mesh_node_id IS NOT NULL
  AND mesh_agent_state = 'not_installed';

COMMENT ON COLUMN public.endpoints.mesh_agent_state IS
'Lifecycle of MeshAgent (Remote Access) on this endpoint. Driven by the '
'install_mesh_agent / uninstall_mesh_agent commands and confirmed by the '
'agent in subsequent heartbeats. Remote Desktop button in the SOC is gated '
'on this being ''installed''.';
