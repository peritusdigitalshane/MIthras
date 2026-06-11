-- SOC team replacement build.
--
-- Adds the schema for:
--   1. Conversational SOC chat (sessions + messages) — backs the chat panel.
--   2. Incident commander linkage — points from incidents to the source
--      alert/triage/investigation and tracks per-step playbook state.
--   3. A helper RPC to seed an "active incident" feed for the operator
--      dashboard without scanning every column.
--
-- ai_investigations and incidents already exist (see earlier migrations), so
-- we extend them rather than duplicate.

BEGIN;

-- ============================================================================
-- 1. INCIDENT COMMANDER linkage on the incidents table
-- ============================================================================
--
-- The Incident Commander Agent creates or updates rows in public.incidents.
-- We need a few extra columns so the row tells the full story without joining
-- a dozen other tables: which alert spawned it, which investigation explains
-- it, what playbook step it's on, and the last AI status update for the
-- operator dashboard.

ALTER TABLE public.incidents
    ADD COLUMN IF NOT EXISTS triage_decision_id    uuid REFERENCES public.ai_triage_decisions(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS investigation_id      uuid REFERENCES public.ai_investigations(id)   ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS playbook_step         text,        -- e.g. 'forensics_complete','contained','customer_notified','review_scheduled'
    ADD COLUMN IF NOT EXISTS playbook_state        jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS commander_summary     text,        -- short human-readable status line
    ADD COLUMN IF NOT EXISTS commander_last_action_at timestamptz,
    ADD COLUMN IF NOT EXISTS commander_model       text,
    ADD COLUMN IF NOT EXISTS commander_cost_microcents bigint NOT NULL DEFAULT 0;

-- Indexes for the operator "open incidents" feed.
CREATE INDEX IF NOT EXISTS idx_incidents_open
    ON public.incidents (organization_id, status, severity, opened_at DESC)
    WHERE status IN ('open','triaged','investigating','contained');

CREATE INDEX IF NOT EXISTS idx_incidents_alert
    ON public.incidents (alert_id) WHERE alert_id IS NOT NULL;

-- ============================================================================
-- 2. AI SOC CHAT — session + messages
-- ============================================================================
--
-- Conversational interface to the AI SOC. The session row holds a stable id
-- the UI keeps in localStorage so users can resume conversations. Messages
-- alternate user/assistant and accumulate as the conversation grows.

CREATE TABLE IF NOT EXISTS public.ai_chat_sessions (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title             text,                       -- auto-set from first user message
    last_message_at   timestamptz NOT NULL DEFAULT now(),
    archived_at       timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_user
    ON public.ai_chat_sessions (user_id, last_message_at DESC) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_org
    ON public.ai_chat_sessions (organization_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS public.ai_chat_messages (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id        uuid NOT NULL REFERENCES public.ai_chat_sessions(id) ON DELETE CASCADE,
    role              text NOT NULL CHECK (role IN ('user','assistant','system','tool')),
    content           text NOT NULL,

    -- Structured outputs for the citation chips on the frontend. Each entry
    -- is { kind:'alert'|'endpoint'|'incident'|'investigation'|'verdict', id:uuid, label:text }.
    citations         jsonb NOT NULL DEFAULT '[]'::jsonb,

    -- Tool call telemetry for the assistant turns (which read-only tools the
    -- agent invoked and what they returned). Useful for debugging + auditing.
    tool_calls        jsonb NOT NULL DEFAULT '[]'::jsonb,

    -- LLM accounting for assistant turns.
    model             text,
    prompt_tokens     integer,
    completion_tokens integer,
    cost_microcents   bigint NOT NULL DEFAULT 0,
    latency_ms        integer,
    error_message     text,

    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_session
    ON public.ai_chat_messages (session_id, created_at);

-- ============================================================================
-- 3. RLS — chat is per-user, incidents already use org membership policy
-- ============================================================================

ALTER TABLE public.ai_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_chat_sessions_owner_read ON public.ai_chat_sessions;
CREATE POLICY ai_chat_sessions_owner_read
    ON public.ai_chat_sessions FOR SELECT
    USING (user_id = auth.uid() OR public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS ai_chat_sessions_owner_insert ON public.ai_chat_sessions;
CREATE POLICY ai_chat_sessions_owner_insert
    ON public.ai_chat_sessions FOR INSERT
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS ai_chat_sessions_owner_update ON public.ai_chat_sessions;
CREATE POLICY ai_chat_sessions_owner_update
    ON public.ai_chat_sessions FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS ai_chat_messages_owner_read ON public.ai_chat_messages;
CREATE POLICY ai_chat_messages_owner_read
    ON public.ai_chat_messages FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.ai_chat_sessions s
            WHERE s.id = ai_chat_messages.session_id
              AND (s.user_id = auth.uid() OR public.is_super_admin(auth.uid()))
        )
    );

-- Inserts only via service-role (the ai-soc-chat function writes both
-- user and assistant turns server-side so it can validate tool calls).

-- ============================================================================
-- 4. RPC — operator open-incidents feed
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_open_incidents_feed(p_org_id uuid DEFAULT NULL)
RETURNS TABLE (
    id                uuid,
    organization_id   uuid,
    organization_name text,
    endpoint_id       uuid,
    endpoint_hostname text,
    alert_id          uuid,
    investigation_id  uuid,
    kind              text,
    severity          text,
    status            text,
    title             text,
    commander_summary text,
    playbook_step     text,
    opened_at         timestamptz,
    sla_due_at        timestamptz,
    commander_last_action_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT
        i.id,
        i.organization_id,
        o.name,
        i.endpoint_id,
        e.hostname,
        i.alert_id,
        i.investigation_id,
        i.kind,
        i.severity,
        i.status,
        i.title,
        i.commander_summary,
        i.playbook_step,
        i.opened_at,
        i.sla_due_at,
        i.commander_last_action_at
    FROM public.incidents i
    JOIN public.organizations o ON o.id = i.organization_id
    LEFT JOIN public.endpoints e ON e.id = i.endpoint_id
    WHERE i.status IN ('open','triaged','investigating','contained')
      AND (
          public.is_super_admin(auth.uid())
          OR public.is_member_of_org(auth.uid(), i.organization_id)
      )
      AND (p_org_id IS NULL OR i.organization_id = p_org_id)
    ORDER BY
        CASE i.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        i.opened_at DESC
    LIMIT 200;
$$;

GRANT EXECUTE ON FUNCTION public.get_open_incidents_feed(uuid) TO authenticated;

COMMIT;
