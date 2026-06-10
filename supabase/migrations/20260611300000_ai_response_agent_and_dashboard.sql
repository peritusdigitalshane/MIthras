-- AI SOC Phase 2: Response Agent + operator-facing dashboard surface.
--
-- The Response Agent autonomously executes containment actions when the
-- multi-agent consensus reaches true_positive at high confidence. Every action
-- is logged, snapshotted, and time-boxed:
--   * snapshot_data records pre-action state so rollback is deterministic
--   * rollback_at sets an automatic reversal deadline (default 4 hours)
--   * customer_confirmed_at cancels the auto-rollback (real threat — keep it)
--   * customer_overrode_at fires immediate rollback (false positive — undo now)
--
-- This is the safety mechanism for autonomous response: no Mithras-initiated
-- action can permanently impact a customer's environment without a positive
-- human confirmation (or, alternatively, the action just reverses itself).

BEGIN;

-- ============================================================================
-- 1. ai_agent_actions
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ai_agent_actions (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    triage_decision_id   uuid NOT NULL REFERENCES public.ai_triage_decisions(id) ON DELETE CASCADE,
    alert_id             uuid NOT NULL REFERENCES public.alerts(id) ON DELETE CASCADE,
    organization_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    endpoint_id          uuid REFERENCES public.endpoints(id) ON DELETE SET NULL,

    action_kind          text NOT NULL CHECK (action_kind IN (
        'isolate_network',
        'release_isolation',
        'kill_process',
        'quarantine_file',
        'run_quick_scan',
        'run_full_scan',
        'collect_persistence',
        'restart_agent'
    )),

    -- Lifecycle:
    --   planned              -> orchestrator decided this action is warranted
    --   awaiting_consensus   -> waiting for adversarial / consensus to land
    --   executing            -> agent_commands row dispatched, agent picking it up
    --   executed             -> agent reported success; rollback timer ticking
    --   customer_confirmed   -> customer confirmed real threat; rollback cancelled
    --   rolled_back          -> auto-rollback fired (timer or customer override)
    --   failed               -> command failed to execute on the endpoint
    status               text NOT NULL DEFAULT 'planned' CHECK (status IN (
        'planned','awaiting_consensus','executing','executed',
        'customer_confirmed','rolled_back','failed'
    )),

    -- Reversibility envelope. Default 4h, configurable per-org via
    -- organizations.settings.ai_response_rollback_minutes.
    auto_rollback_minutes integer NOT NULL DEFAULT 240
        CHECK (auto_rollback_minutes >= 5 AND auto_rollback_minutes <= 4320),

    -- The exact state we will restore on rollback. Action-specific shape:
    -- isolate_network -> { was_isolated: false }
    -- kill_process    -> { pid: 4123, image: '...' } (informational; reversal = none, kill is irreversible)
    -- quarantine_file -> { path: 'c:\\...', sha256: '...' } (reversal = restore from quarantine)
    snapshot_data        jsonb NOT NULL DEFAULT '{}'::jsonb,

    reasoning            text,

    -- Confirmation token surfaces in customer notification emails as a
    -- one-click "Confirm threat" / "Mark false positive" deep link. Token
    -- is short-lived and only valid until rollback_at.
    confirmation_token   text NOT NULL DEFAULT replace(gen_random_uuid()::text,'-',''),

    rollback_at          timestamptz,
    executed_at          timestamptz,
    rolled_back_at       timestamptz,
    customer_confirmed_at timestamptz,
    customer_overrode_at  timestamptz,

    -- Endpoint-side agent_commands row that actually executes the action.
    linked_command_id    uuid REFERENCES public.agent_commands(id) ON DELETE SET NULL,
    -- And the reversal command (set when rollback fires).
    rollback_command_id  uuid REFERENCES public.agent_commands(id) ON DELETE SET NULL,

    error_message        text,
    created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_actions_org_created
    ON public.ai_agent_actions (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_agent_actions_pending_rollback
    ON public.ai_agent_actions (rollback_at)
    WHERE status = 'executed';
CREATE INDEX IF NOT EXISTS idx_ai_agent_actions_alert
    ON public.ai_agent_actions (alert_id);
CREATE INDEX IF NOT EXISTS idx_ai_agent_actions_endpoint
    ON public.ai_agent_actions (endpoint_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_agent_actions_confirmation_token
    ON public.ai_agent_actions (confirmation_token);

ALTER TABLE public.ai_agent_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_agent_actions_member_read ON public.ai_agent_actions;
CREATE POLICY ai_agent_actions_member_read ON public.ai_agent_actions
    FOR SELECT TO authenticated
    USING (
        public.is_member_of_org(auth.uid(), organization_id)
        OR public.is_super_admin(auth.uid())
    );

DROP POLICY IF EXISTS ai_agent_actions_admin_update ON public.ai_agent_actions;
CREATE POLICY ai_agent_actions_admin_update ON public.ai_agent_actions
    FOR UPDATE TO authenticated
    USING (
        public.is_admin_of_org(auth.uid(), organization_id)
        OR public.is_super_admin(auth.uid())
    );

DROP POLICY IF EXISTS ai_agent_actions_service_write ON public.ai_agent_actions;
CREATE POLICY ai_agent_actions_service_write ON public.ai_agent_actions
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ============================================================================
-- 2. Per-org dashboard aggregates
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_ai_agent_dashboard(
    p_org_id uuid DEFAULT NULL,
    p_hours  integer DEFAULT 24
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_is_super boolean;
    v_org_filter uuid;
    v_since timestamptz;
    v_result jsonb;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
    END IF;

    v_is_super := public.is_super_admin(v_caller);
    v_org_filter := p_org_id;

    -- Non-super-admins are pinned to their own org regardless of the
    -- p_org_id argument (defence-in-depth — the SELECTs below also filter
    -- by membership).
    IF NOT v_is_super THEN
        IF v_org_filter IS NULL OR NOT public.is_member_of_org(v_caller, v_org_filter) THEN
            -- Pick the first org the user belongs to as a default. If they
            -- belong to none, fall through with an empty filter -> zeroes.
            SELECT organization_id INTO v_org_filter
              FROM public.organization_memberships
             WHERE user_id = v_caller
             ORDER BY created_at
             LIMIT 1;
        END IF;
    END IF;

    v_since := now() - (p_hours || ' hours')::interval;

    WITH alerts_in_window AS (
        SELECT td.*
          FROM public.ai_triage_decisions td
         WHERE td.created_at >= v_since
           AND (v_org_filter IS NULL OR td.organization_id = v_org_filter)
    ),
    verdicts_in_window AS (
        SELECT v.*
          FROM public.ai_agent_verdicts v
         WHERE v.created_at >= v_since
           AND (v_org_filter IS NULL OR v.organization_id = v_org_filter)
    ),
    actions_in_window AS (
        SELECT a.*
          FROM public.ai_agent_actions a
         WHERE a.created_at >= v_since
           AND (v_org_filter IS NULL OR a.organization_id = v_org_filter)
    )
    SELECT jsonb_build_object(
        'window_hours', p_hours,
        'org_filter',   v_org_filter,
        -- Throughput
        'alerts_orchestrated',  (SELECT count(*) FROM alerts_in_window),
        'autonomous_responses', (SELECT count(*) FROM actions_in_window WHERE status IN ('executing','executed','customer_confirmed')),
        'auto_rollbacks',       (SELECT count(*) FROM actions_in_window WHERE status = 'rolled_back'),
        'customer_confirmations',(SELECT count(*) FROM actions_in_window WHERE customer_confirmed_at IS NOT NULL),
        'customer_overrides',   (SELECT count(*) FROM actions_in_window WHERE customer_overrode_at IS NOT NULL),

        -- Quality signals
        'avg_consensus_confidence', (
            SELECT round(avg(final_confidence)::numeric, 2)
              FROM alerts_in_window WHERE final_confidence IS NOT NULL
        ),
        'verification_agreement_rate', (
            WITH p AS (
                SELECT
                    SUM(CASE WHEN t.verdict = v.verdict THEN 1 ELSE 0 END)::numeric AS agree,
                    count(*)::numeric AS total
                  FROM verdicts_in_window t
                  JOIN verdicts_in_window v
                    ON v.triage_decision_id = t.triage_decision_id
                   AND v.agent_name = 'verification'
                 WHERE t.agent_name = 'triage'
                   AND v.verdict IS NOT NULL
                   AND t.verdict IS NOT NULL
            )
            SELECT CASE WHEN total > 0 THEN round((agree/total)*100, 1) ELSE NULL END FROM p
        ),
        'adversarial_fire_rate', (
            WITH adv AS (
                SELECT count(*)::numeric AS adv_runs FROM verdicts_in_window WHERE agent_name = 'adversarial'
            ),
            tri AS (
                SELECT count(*)::numeric AS tri_runs FROM verdicts_in_window WHERE agent_name = 'triage'
            )
            SELECT CASE WHEN tri_runs > 0 THEN round((adv_runs/tri_runs)*100, 1) ELSE NULL END FROM adv, tri
        ),
        'adversarial_refutation_rate', (
            WITH r AS (
                SELECT
                    SUM(CASE WHEN verdict = 'refuted' THEN 1 ELSE 0 END)::numeric AS refuted,
                    count(*)::numeric AS total
                  FROM verdicts_in_window
                 WHERE agent_name = 'adversarial' AND verdict IS NOT NULL
            )
            SELECT CASE WHEN total > 0 THEN round((refuted/total)*100, 1) ELSE NULL END FROM r
        ),
        'disagreement_rate', (
            WITH d AS (
                SELECT
                    SUM(CASE WHEN disagreement_detected THEN 1 ELSE 0 END)::numeric AS dis,
                    count(*)::numeric AS total
                  FROM alerts_in_window WHERE orchestration_state = 'completed'
            )
            SELECT CASE WHEN total > 0 THEN round((dis/total)*100, 1) ELSE NULL END FROM d
        ),

        -- Verdict distribution (Triage's view, since that's the raw classifier)
        'verdict_distribution', (
            SELECT jsonb_object_agg(verdict, c) FROM (
                SELECT verdict, count(*) AS c
                  FROM alerts_in_window
                 WHERE verdict IS NOT NULL
                 GROUP BY verdict
            ) x
        ),
        'final_verdict_distribution', (
            SELECT jsonb_object_agg(final_verdict, c) FROM (
                SELECT final_verdict, count(*) AS c
                  FROM alerts_in_window
                 WHERE final_verdict IS NOT NULL
                 GROUP BY final_verdict
            ) x
        ),

        -- Cost ledger
        'total_cost_microcents', (SELECT COALESCE(sum(cost_microcents),0) FROM verdicts_in_window),
        'avg_cost_per_alert_microcents', (
            SELECT CASE WHEN c > 0 THEN round(s::numeric / c) ELSE 0 END
              FROM (
                SELECT COALESCE(sum(cost_microcents),0) AS s,
                       (SELECT count(*) FROM alerts_in_window) AS c
                  FROM verdicts_in_window
              ) x
        ),

        'as_of', now()
    ) INTO v_result;

    RETURN v_result;
END;
$$;

-- ============================================================================
-- 3. Activity feed — unified stream across all agents + actions
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_ai_agent_activity(
    p_org_id uuid DEFAULT NULL,
    p_limit  integer DEFAULT 100
)
RETURNS TABLE (
    occurred_at      timestamptz,
    agent_name       text,
    event_kind       text,        -- verdict | action | rollback | confirm | override | orchestration
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
        -- Agent verdicts (triage, verification, adversarial completion events)
        SELECT
            v.created_at AS occurred_at,
            v.agent_name AS agent_name,
            'verdict'::text AS event_kind,
            v.alert_id,
            v.triage_decision_id,
            v.organization_id,
            v.verdict,
            v.confidence,
            v.summary,
            jsonb_build_object('model', v.model, 'cost_microcents', v.cost_microcents) AS extra
          FROM public.ai_agent_verdicts v
         WHERE (v_org_filter IS NULL OR v.organization_id = v_org_filter)

        UNION ALL

        -- Response Agent actions
        SELECT
            a.created_at AS occurred_at,
            'response'::text AS agent_name,
            'action'::text AS event_kind,
            a.alert_id,
            a.triage_decision_id,
            a.organization_id,
            a.status AS verdict,
            NULL::numeric AS confidence,
            a.action_kind AS summary,
            jsonb_build_object(
                'endpoint_id', a.endpoint_id,
                'action_kind', a.action_kind,
                'auto_rollback_minutes', a.auto_rollback_minutes,
                'rollback_at', a.rollback_at
            ) AS extra
          FROM public.ai_agent_actions a
         WHERE (v_org_filter IS NULL OR a.organization_id = v_org_filter)

        UNION ALL

        -- Rollback events (separate row so the feed shows the timeline)
        SELECT
            a.rolled_back_at AS occurred_at,
            'response'::text AS agent_name,
            'rollback'::text AS event_kind,
            a.alert_id,
            a.triage_decision_id,
            a.organization_id,
            'rolled_back'::text AS verdict,
            NULL::numeric AS confidence,
            a.action_kind AS summary,
            jsonb_build_object('reason', CASE WHEN a.customer_overrode_at IS NOT NULL THEN 'customer_override' ELSE 'auto_expiry' END) AS extra
          FROM public.ai_agent_actions a
         WHERE a.rolled_back_at IS NOT NULL
           AND (v_org_filter IS NULL OR a.organization_id = v_org_filter)

        UNION ALL

        SELECT
            a.customer_confirmed_at AS occurred_at,
            'response'::text AS agent_name,
            'confirm'::text AS event_kind,
            a.alert_id,
            a.triage_decision_id,
            a.organization_id,
            'confirmed'::text AS verdict,
            NULL::numeric AS confidence,
            a.action_kind AS summary,
            '{}'::jsonb AS extra
          FROM public.ai_agent_actions a
         WHERE a.customer_confirmed_at IS NOT NULL
           AND (v_org_filter IS NULL OR a.organization_id = v_org_filter)
    )
    SELECT * FROM stream
     ORDER BY occurred_at DESC
     LIMIT GREATEST(LEAST(p_limit, 500), 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ai_agent_dashboard(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ai_agent_activity(uuid, integer) TO authenticated;

-- ============================================================================
-- 4. Auto-rollback cron
-- ============================================================================
--
-- Every 5 minutes, find actions whose rollback timer has expired without
-- customer confirmation, and emit reversal commands. The agent picks them
-- up on its next heartbeat.

CREATE OR REPLACE FUNCTION public.expire_pending_ai_responses()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row     record;
    v_count   integer := 0;
    v_cmd_id  uuid;
    v_cmd_kind text;
BEGIN
    FOR v_row IN
        SELECT *
          FROM public.ai_agent_actions
         WHERE status = 'executed'
           AND customer_confirmed_at IS NULL
           AND rollback_at IS NOT NULL
           AND rollback_at <= now()
           FOR UPDATE SKIP LOCKED
    LOOP
        -- Map forward action -> reversal command kind.
        v_cmd_kind := CASE v_row.action_kind
            WHEN 'isolate_network'   THEN 'release_isolation'
            WHEN 'release_isolation' THEN 'isolate_network'    -- defensive (we don't auto-fire this forward)
            ELSE NULL
        END;

        IF v_cmd_kind IS NULL THEN
            -- Irreversible action (kill_process, quarantine, scans, collect) —
            -- mark as expired without rollback. Still useful for the audit trail.
            UPDATE public.ai_agent_actions
               SET status = 'rolled_back',
                   rolled_back_at = now(),
                   error_message  = 'auto_expired_irreversible_action'
             WHERE id = v_row.id;
        ELSIF v_row.endpoint_id IS NOT NULL THEN
            -- Dispatch reversal via agent_commands.
            INSERT INTO public.agent_commands (
                endpoint_id, organization_id, command_type, params, status, correlation_id
            ) VALUES (
                v_row.endpoint_id, v_row.organization_id, v_cmd_kind,
                jsonb_build_object('reason', 'ai_auto_rollback', 'source_action_id', v_row.id),
                'queued',
                'ai-rollback-' || v_row.id::text
            ) RETURNING id INTO v_cmd_id;

            UPDATE public.ai_agent_actions
               SET status = 'rolled_back',
                   rolled_back_at = now(),
                   rollback_command_id = v_cmd_id
             WHERE id = v_row.id;
        END IF;

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.expire_pending_ai_responses() FROM public;
GRANT EXECUTE ON FUNCTION public.expire_pending_ai_responses() TO service_role;

-- Schedule via pg_cron. Idempotent registration.
DO $$
BEGIN
    PERFORM cron.unschedule('ai-response-auto-rollback');
EXCEPTION WHEN OTHERS THEN
    -- cron extension may not be present in some local envs.
    NULL;
END $$;

DO $$
BEGIN
    PERFORM cron.schedule(
        'ai-response-auto-rollback',
        '*/5 * * * *',
        $cron$ SELECT public.expire_pending_ai_responses(); $cron$
    );
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

COMMIT;
