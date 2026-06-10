-- Agent auto-update fix #2: central record of every agent version change so
-- operators can answer "when did this box update?", "did it succeed?", "is
-- it stuck?", "which version did it skip?".
--
-- Two ways rows land here:
--   1. Server-side detection -- when a heartbeat reports a version different
--      from the one on the endpoint row, /agent-api/heartbeat inserts a
--      'completed' row. Works for every agent including legacy bearer-token
--      (no agent code change required).
--   2. Agent-side reporting (future v0.6.3+) -- a future POST /agent-update-event
--      route will let modern agents stream 'started', 'downloaded', 'verified',
--      'failed' rows during the swap. Schema is designed to support that path
--      without further migration.

CREATE TABLE IF NOT EXISTS public.agent_update_log (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint_id       uuid NOT NULL REFERENCES public.endpoints(id) ON DELETE CASCADE,
    organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    from_version      text,
    to_version        text NOT NULL,
    channel           text NOT NULL DEFAULT 'stable',
    -- trigger: how the update was initiated. New verbs can be added freely.
    trigger           text NOT NULL DEFAULT 'heartbeat_detected',
    -- status: 'started' | 'downloaded' | 'verified' | 'swap_pending' |
    --        'completed' | 'failed'. 'completed' is what server-side detection writes.
    status            text NOT NULL DEFAULT 'completed',
    error_message     text,
    download_url      text,
    download_sha256   text,
    bytes_downloaded  bigint,
    duration_ms       integer,
    detected_at       timestamptz NOT NULL DEFAULT now(),
    completed_at      timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT agent_update_log_status_check
        CHECK (status IN ('started','downloaded','verified','swap_pending','completed','failed'))
);

CREATE INDEX IF NOT EXISTS idx_agent_update_log_endpoint_time
    ON public.agent_update_log(endpoint_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_update_log_org_time
    ON public.agent_update_log(organization_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_update_log_failed
    ON public.agent_update_log(organization_id, detected_at DESC)
    WHERE status = 'failed';

ALTER TABLE public.agent_update_log ENABLE ROW LEVEL SECURITY;

-- Org members can read their own org's update history.
DROP POLICY IF EXISTS "agent_update_log_select_own_org" ON public.agent_update_log;
CREATE POLICY "agent_update_log_select_own_org"
    ON public.agent_update_log FOR SELECT
    USING (
        public.is_member_of_org(auth.uid(), organization_id)
        OR public.is_super_admin(auth.uid())
    );

-- Inserts come exclusively from edge functions running as service_role.
-- (Bearer-token /agent-api and HMAC /agent-heartbeat both use the service-role
-- supabase client, so service_role inserts are fine and intentional.)
DROP POLICY IF EXISTS "agent_update_log_insert_service_role" ON public.agent_update_log;
CREATE POLICY "agent_update_log_insert_service_role"
    ON public.agent_update_log FOR INSERT
    WITH CHECK (auth.role() = 'service_role');

REVOKE INSERT, UPDATE, DELETE ON public.agent_update_log FROM anon, authenticated, PUBLIC;
GRANT  INSERT, UPDATE, DELETE ON public.agent_update_log TO service_role;

COMMENT ON TABLE public.agent_update_log IS
'Audit trail of agent version transitions. Server-side detected today; agent-side reported in v0.6.3+. Closes auto-update fix #2.';
