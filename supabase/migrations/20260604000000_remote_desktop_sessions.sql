-- 20260604000000_remote_desktop_sessions.sql
--
-- Remote Desktop session audit + MeshCentral node mapping.
--
-- A row is created every time the SOC operator clicks "Remote Desktop" on
-- an endpoint. The transport is MeshCentral (same architecture Tactical RMM
-- uses): the MeshAgent on the endpoint holds an outbound WSS to
-- remote.mithras.com.au; operators connect through the MeshCentral web UI
-- and Mithras records the session for audit.
--
-- endpoints.mesh_node_id is populated by the agent's first heartbeat after
-- MeshAgent installs - the agent reads the node_id from MeshAgent and
-- ships it back. The edge function uses this to deep-link straight to
-- the device in MeshCentral.

ALTER TABLE public.endpoints
    ADD COLUMN IF NOT EXISTS mesh_node_id TEXT;

COMMENT ON COLUMN public.endpoints.mesh_node_id IS
'MeshCentral node identifier ("node//<meshid>/<sha384>"). Populated by '
'the agent after MeshAgent enrols; null until then.';

CREATE TABLE IF NOT EXISTS public.remote_desktop_sessions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    endpoint_id      UUID NOT NULL REFERENCES public.endpoints(id) ON DELETE CASCADE,
    initiated_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    reason           TEXT,
    mesh_node_id     TEXT,
    session_url      TEXT,
    transport        TEXT NOT NULL DEFAULT 'meshcentral'
                     CHECK (transport IN ('meshcentral')),
    duration_seconds INTEGER NOT NULL DEFAULT 1800,
    status           TEXT NOT NULL DEFAULT 'initiated'
                     CHECK (status IN ('initiated','active','ended','expired','failed')),
    error_message    TEXT,
    started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_remote_desktop_sessions_endpoint
    ON public.remote_desktop_sessions(endpoint_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_remote_desktop_sessions_active
    ON public.remote_desktop_sessions(organization_id, started_at DESC)
    WHERE status IN ('initiated','active');

ALTER TABLE public.remote_desktop_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rd_sessions_select_member ON public.remote_desktop_sessions;
CREATE POLICY rd_sessions_select_member
  ON public.remote_desktop_sessions FOR SELECT
  USING (is_member_of_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS rd_sessions_select_super ON public.remote_desktop_sessions;
CREATE POLICY rd_sessions_select_super
  ON public.remote_desktop_sessions FOR SELECT
  USING (is_super_admin(auth.uid()));

-- INSERT/UPDATE/DELETE: handled exclusively by edge functions running
-- with the service role; nothing user-facing writes here directly.

COMMENT ON TABLE public.remote_desktop_sessions IS
'Audit + state for Remote Desktop sessions opened from the SOC console. '
'Transport is MeshCentral; mesh_node_id is the deep-link target, session_url '
'is what the operator opened. status: initiated -> active -> ended/expired/failed.';
