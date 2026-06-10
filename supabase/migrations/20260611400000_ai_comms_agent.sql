-- AI SOC Phase 3: Customer Comms Agent.
--
-- Closes the loop on the Response Agent. When an autonomous action fires,
-- the customer needs to know (a) what we detected, (b) what we did, and
-- (c) how to confirm or override.
--
-- This migration adds the audit trail table for all customer notifications
-- sent by the Comms Agent. Drafted emails are persisted so we can:
--   * Show the operator what was sent (per-org compliance trail)
--   * Track engagement (opened, confirm clicked, override clicked)
--   * Re-send on failure / regenerate on operator feedback
-- The actual email send happens via the existing SMTP plumbing
-- (platform_settings.smtp_*).

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_agent_comms (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    triage_decision_id  uuid NOT NULL REFERENCES public.ai_triage_decisions(id) ON DELETE CASCADE,
    action_id           uuid REFERENCES public.ai_agent_actions(id) ON DELETE SET NULL,
    alert_id            uuid NOT NULL REFERENCES public.alerts(id) ON DELETE CASCADE,
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    channel             text NOT NULL DEFAULT 'email' CHECK (channel IN ('email','sms','voice','slack','teams')),

    -- Multi-recipient. Sanitised at insert time by the Comms Agent.
    recipients          text[] NOT NULL,

    subject             text NOT NULL,
    body_html           text NOT NULL,
    body_text           text NOT NULL,
    body_markdown       text,

    status              text NOT NULL DEFAULT 'drafted' CHECK (status IN ('drafted','sent','failed','suppressed')),
    sent_at             timestamptz,
    error_message       text,

    -- LLM accounting (matches ai_agent_verdicts pattern)
    model               text,
    prompt_tokens       integer,
    completion_tokens   integer,
    cost_microcents     bigint NOT NULL DEFAULT 0,
    latency_ms          integer,
    raw_response        jsonb,

    -- Engagement
    opened_at           timestamptz,
    confirm_clicked_at  timestamptz,
    override_clicked_at timestamptz,

    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_comms_org_created
    ON public.ai_agent_comms (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_agent_comms_alert
    ON public.ai_agent_comms (alert_id);
CREATE INDEX IF NOT EXISTS idx_ai_agent_comms_action
    ON public.ai_agent_comms (action_id) WHERE action_id IS NOT NULL;

ALTER TABLE public.ai_agent_comms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_agent_comms_member_read ON public.ai_agent_comms;
CREATE POLICY ai_agent_comms_member_read ON public.ai_agent_comms
    FOR SELECT TO authenticated
    USING (
        public.is_member_of_org(auth.uid(), organization_id)
        OR public.is_super_admin(auth.uid())
    );

DROP POLICY IF EXISTS ai_agent_comms_service_write ON public.ai_agent_comms;
CREATE POLICY ai_agent_comms_service_write ON public.ai_agent_comms
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- Extend the activity-feed RPC to surface comms events too. The Comms Agent
-- writes its row at draft-time; we filter on status='sent' so the feed only
-- shows actually-delivered notifications.
CREATE OR REPLACE FUNCTION public.get_ai_agent_activity(
    p_org_id uuid DEFAULT NULL,
    p_limit  integer DEFAULT 100
)
RETURNS TABLE (
    occurred_at      timestamptz,
    agent_name       text,
    event_kind       text,
    alert_id         uuid,
    triage_decision_id uuid,
    organization_id  uuid,
    verdict          text,
    confidence       numeric,
    summary          text,
    extra            jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_org_filter uuid;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
    END IF;

    v_org_filter := p_org_id;
    IF NOT public.is_super_admin(v_caller) THEN
        IF v_org_filter IS NULL OR NOT public.is_member_of_org(v_caller, v_org_filter) THEN
            SELECT organization_id INTO v_org_filter
              FROM public.organization_memberships
             WHERE user_id = v_caller
             ORDER BY created_at
             LIMIT 1;
        END IF;
    END IF;

    RETURN QUERY
    WITH stream AS (
        SELECT v.created_at AS occurred_at, v.agent_name, 'verdict'::text AS event_kind,
               v.alert_id, v.triage_decision_id, v.organization_id, v.verdict, v.confidence, v.summary,
               jsonb_build_object('model', v.model, 'cost_microcents', v.cost_microcents) AS extra
          FROM public.ai_agent_verdicts v
         WHERE (v_org_filter IS NULL OR v.organization_id = v_org_filter)
        UNION ALL
        SELECT a.created_at, 'response'::text, 'action'::text,
               a.alert_id, a.triage_decision_id, a.organization_id, a.status, NULL::numeric, a.action_kind,
               jsonb_build_object('endpoint_id', a.endpoint_id, 'action_kind', a.action_kind,
                   'auto_rollback_minutes', a.auto_rollback_minutes, 'rollback_at', a.rollback_at) AS extra
          FROM public.ai_agent_actions a
         WHERE (v_org_filter IS NULL OR a.organization_id = v_org_filter)
        UNION ALL
        SELECT a.rolled_back_at, 'response'::text, 'rollback'::text,
               a.alert_id, a.triage_decision_id, a.organization_id, 'rolled_back'::text, NULL::numeric, a.action_kind,
               jsonb_build_object('reason', CASE WHEN a.customer_overrode_at IS NOT NULL THEN 'customer_override' ELSE 'auto_expiry' END) AS extra
          FROM public.ai_agent_actions a
         WHERE a.rolled_back_at IS NOT NULL
           AND (v_org_filter IS NULL OR a.organization_id = v_org_filter)
        UNION ALL
        SELECT a.customer_confirmed_at, 'response'::text, 'confirm'::text,
               a.alert_id, a.triage_decision_id, a.organization_id, 'confirmed'::text, NULL::numeric, a.action_kind,
               '{}'::jsonb
          FROM public.ai_agent_actions a
         WHERE a.customer_confirmed_at IS NOT NULL
           AND (v_org_filter IS NULL OR a.organization_id = v_org_filter)
        UNION ALL
        -- New: Comms Agent emails
        SELECT c.sent_at, 'comms'::text, 'email_sent'::text,
               c.alert_id, c.triage_decision_id, c.organization_id, c.status, NULL::numeric, c.subject,
               jsonb_build_object('recipients', c.recipients, 'action_id', c.action_id, 'channel', c.channel) AS extra
          FROM public.ai_agent_comms c
         WHERE c.status = 'sent' AND c.sent_at IS NOT NULL
           AND (v_org_filter IS NULL OR c.organization_id = v_org_filter)
        UNION ALL
        SELECT c.confirm_clicked_at, 'comms'::text, 'email_confirm_clicked'::text,
               c.alert_id, c.triage_decision_id, c.organization_id, 'confirmed'::text, NULL::numeric, c.subject, '{}'::jsonb
          FROM public.ai_agent_comms c
         WHERE c.confirm_clicked_at IS NOT NULL
           AND (v_org_filter IS NULL OR c.organization_id = v_org_filter)
        UNION ALL
        SELECT c.override_clicked_at, 'comms'::text, 'email_override_clicked'::text,
               c.alert_id, c.triage_decision_id, c.organization_id, 'override'::text, NULL::numeric, c.subject, '{}'::jsonb
          FROM public.ai_agent_comms c
         WHERE c.override_clicked_at IS NOT NULL
           AND (v_org_filter IS NULL OR c.organization_id = v_org_filter)
    )
    SELECT * FROM stream
     ORDER BY occurred_at DESC NULLS LAST
     LIMIT GREATEST(LEAST(p_limit, 500), 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ai_agent_activity(uuid, integer) TO authenticated;

COMMIT;
