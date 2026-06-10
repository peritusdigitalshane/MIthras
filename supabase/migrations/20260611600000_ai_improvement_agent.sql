-- AI SOC Phase 5: Improvement Agent + dashboard expansion.
--
-- The Improvement Agent reads outcome signals across the autonomous SOC
-- and proposes prompt + threshold + playbook updates. This is the "AI that
-- learns from being wrong" piece — closes the feedback loop without
-- requiring a human to manually tune anything.
--
-- v1: report-only. The agent writes recommendations to ai_improvement_reports;
-- an operator reviews and decides whether to apply. (Auto-apply is a v2 risk
-- we don't take yet — a bad LLM-proposed prompt update could degrade every
-- subsequent triage decision.)

BEGIN;

-- ============================================================================
-- 1. ai_improvement_reports — one row per (period, agent) review cycle
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ai_improvement_reports (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Scope of the analysis window.
    period_start             timestamptz NOT NULL,
    period_end               timestamptz NOT NULL,
    agent_name               text NOT NULL CHECK (agent_name IN (
        'triage','verification','adversarial','response','comms','hunt','overall'
    )),

    -- Aggregates the agent computed.
    alerts_analyzed          integer NOT NULL DEFAULT 0,
    accuracy_score           numeric(4,3),
    false_positive_rate      numeric(4,3),
    false_negative_rate      numeric(4,3),
    avg_confidence_calibration numeric(4,3),

    -- Pattern analysis: typed jsonb so the frontend can pivot per kind.
    top_failure_patterns     jsonb NOT NULL DEFAULT '[]'::jsonb,
    proposed_improvements    jsonb NOT NULL DEFAULT '[]'::jsonb,
    metrics_breakdown        jsonb NOT NULL DEFAULT '{}'::jsonb,

    summary                  text,
    recommendations_summary  text,

    -- LLM accounting
    model                    text,
    prompt_tokens            integer,
    completion_tokens        integer,
    cost_microcents          bigint NOT NULL DEFAULT 0,
    latency_ms               integer,
    raw_response             jsonb,

    -- Review lifecycle
    status                   text NOT NULL DEFAULT 'drafted' CHECK (status IN (
        'drafted','reviewed','partially_applied','applied','dismissed','failed'
    )),
    reviewed_by              uuid,
    reviewed_at              timestamptz,
    reviewer_notes           text,
    applied_at               timestamptz,
    error_message            text,

    created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_improvement_reports_created
    ON public.ai_improvement_reports (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_improvement_reports_agent_period
    ON public.ai_improvement_reports (agent_name, period_end DESC);
CREATE INDEX IF NOT EXISTS idx_ai_improvement_reports_status
    ON public.ai_improvement_reports (status, created_at DESC) WHERE status IN ('drafted','reviewed');

ALTER TABLE public.ai_improvement_reports ENABLE ROW LEVEL SECURITY;

-- Reports are fleet-wide (no per-org data leak — they aggregate across all
-- tenants). Only super-admins can read.
DROP POLICY IF EXISTS ai_improvement_reports_super_read ON public.ai_improvement_reports;
CREATE POLICY ai_improvement_reports_super_read ON public.ai_improvement_reports
    FOR SELECT TO authenticated
    USING (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS ai_improvement_reports_super_update ON public.ai_improvement_reports;
CREATE POLICY ai_improvement_reports_super_update ON public.ai_improvement_reports
    FOR UPDATE TO authenticated
    USING (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS ai_improvement_reports_service_write ON public.ai_improvement_reports;
CREATE POLICY ai_improvement_reports_service_write ON public.ai_improvement_reports
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- 2. Extend dashboard RPC with Comms / Hunt / Improvement stats
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
    IF NOT v_is_super THEN
        IF v_org_filter IS NULL OR NOT public.is_member_of_org(v_caller, v_org_filter) THEN
            SELECT organization_id INTO v_org_filter
              FROM public.organization_memberships
             WHERE user_id = v_caller ORDER BY created_at LIMIT 1;
        END IF;
    END IF;

    v_since := now() - (p_hours || ' hours')::interval;

    WITH alerts_in_window AS (
        SELECT td.* FROM public.ai_triage_decisions td
         WHERE td.created_at >= v_since
           AND (v_org_filter IS NULL OR td.organization_id = v_org_filter)
    ),
    verdicts_in_window AS (
        SELECT v.* FROM public.ai_agent_verdicts v
         WHERE v.created_at >= v_since
           AND (v_org_filter IS NULL OR v.organization_id = v_org_filter)
    ),
    actions_in_window AS (
        SELECT a.* FROM public.ai_agent_actions a
         WHERE a.created_at >= v_since
           AND (v_org_filter IS NULL OR a.organization_id = v_org_filter)
    ),
    comms_in_window AS (
        SELECT c.* FROM public.ai_agent_comms c
         WHERE c.created_at >= v_since
           AND (v_org_filter IS NULL OR c.organization_id = v_org_filter)
    ),
    hunt_in_window AS (
        -- Hunt is fleet-wide; for tenant view, filter to findings affecting them.
        SELECT h.* FROM public.hunt_findings h
         WHERE h.created_at >= v_since
           AND (v_org_filter IS NULL OR v_org_filter = ANY(h.affected_tenant_ids))
    )
    SELECT jsonb_build_object(
        'window_hours', p_hours,
        'org_filter',   v_org_filter,
        'alerts_orchestrated',  (SELECT count(*) FROM alerts_in_window),
        'autonomous_responses', (SELECT count(*) FROM actions_in_window WHERE status IN ('executing','executed','customer_confirmed')),
        'auto_rollbacks',       (SELECT count(*) FROM actions_in_window WHERE status = 'rolled_back'),
        'customer_confirmations',(SELECT count(*) FROM actions_in_window WHERE customer_confirmed_at IS NOT NULL),
        'customer_overrides',   (SELECT count(*) FROM actions_in_window WHERE customer_overrode_at IS NOT NULL),
        'avg_consensus_confidence', (
            SELECT round(avg(final_confidence)::numeric, 2) FROM alerts_in_window WHERE final_confidence IS NOT NULL
        ),
        'verification_agreement_rate', (
            WITH p AS (
                SELECT SUM(CASE WHEN t.verdict = v.verdict THEN 1 ELSE 0 END)::numeric AS agree, count(*)::numeric AS total
                  FROM verdicts_in_window t
                  JOIN verdicts_in_window v ON v.triage_decision_id = t.triage_decision_id AND v.agent_name = 'verification'
                 WHERE t.agent_name = 'triage' AND v.verdict IS NOT NULL AND t.verdict IS NOT NULL
            ) SELECT CASE WHEN total > 0 THEN round((agree/total)*100, 1) ELSE NULL END FROM p
        ),
        'adversarial_fire_rate', (
            WITH adv AS (SELECT count(*)::numeric AS r FROM verdicts_in_window WHERE agent_name = 'adversarial'),
                 tri AS (SELECT count(*)::numeric AS r FROM verdicts_in_window WHERE agent_name = 'triage')
            SELECT CASE WHEN tri.r > 0 THEN round((adv.r/tri.r)*100, 1) ELSE NULL END FROM adv, tri
        ),
        'adversarial_refutation_rate', (
            WITH r AS (
                SELECT SUM(CASE WHEN verdict = 'refuted' THEN 1 ELSE 0 END)::numeric AS refuted, count(*)::numeric AS total
                  FROM verdicts_in_window WHERE agent_name = 'adversarial' AND verdict IS NOT NULL
            ) SELECT CASE WHEN total > 0 THEN round((refuted/total)*100, 1) ELSE NULL END FROM r
        ),
        'disagreement_rate', (
            WITH d AS (
                SELECT SUM(CASE WHEN disagreement_detected THEN 1 ELSE 0 END)::numeric AS dis, count(*)::numeric AS total
                  FROM alerts_in_window WHERE orchestration_state = 'completed'
            ) SELECT CASE WHEN total > 0 THEN round((dis/total)*100, 1) ELSE NULL END FROM d
        ),
        'verdict_distribution', (
            SELECT jsonb_object_agg(verdict, c) FROM (
                SELECT verdict, count(*) AS c FROM alerts_in_window WHERE verdict IS NOT NULL GROUP BY verdict
            ) x
        ),
        'final_verdict_distribution', (
            SELECT jsonb_object_agg(final_verdict, c) FROM (
                SELECT final_verdict, count(*) AS c FROM alerts_in_window WHERE final_verdict IS NOT NULL GROUP BY final_verdict
            ) x
        ),
        'total_cost_microcents', (SELECT COALESCE(sum(cost_microcents),0) FROM verdicts_in_window),
        'avg_cost_per_alert_microcents', (
            SELECT CASE WHEN c > 0 THEN round(s::numeric / c) ELSE 0 END FROM (
                SELECT COALESCE(sum(cost_microcents),0) AS s, (SELECT count(*) FROM alerts_in_window) AS c FROM verdicts_in_window
            ) x
        ),
        -- NEW: Comms Agent stats
        'comms_emails_sent',     (SELECT count(*) FROM comms_in_window WHERE status = 'sent'),
        'comms_emails_failed',   (SELECT count(*) FROM comms_in_window WHERE status = 'failed'),
        'comms_confirm_clicks',  (SELECT count(*) FROM comms_in_window WHERE confirm_clicked_at IS NOT NULL),
        'comms_override_clicks', (SELECT count(*) FROM comms_in_window WHERE override_clicked_at IS NOT NULL),
        -- NEW: Hunt Agent stats
        'hunt_findings_open',     (SELECT count(*) FROM hunt_in_window WHERE status = 'open'),
        'hunt_findings_critical', (SELECT count(*) FROM hunt_in_window WHERE severity = 'critical'),
        'hunt_findings_high',     (SELECT count(*) FROM hunt_in_window WHERE severity = 'high'),
        'hunt_iocs_active',       (SELECT count(*) FROM public.hunt_iocs WHERE enabled = true),
        -- NEW: Improvement Agent stats (super-admin only)
        'improvement_reports_count', CASE WHEN v_is_super THEN (
            SELECT count(*) FROM public.ai_improvement_reports WHERE created_at >= v_since
        ) ELSE NULL END,
        'improvement_last_report_at', CASE WHEN v_is_super THEN (
            SELECT max(created_at) FROM public.ai_improvement_reports
        ) ELSE NULL END,
        'as_of', now()
    ) INTO v_result;

    RETURN v_result;
END;
$$;

-- ============================================================================
-- 3. RPC for super-admin to fetch improvement reports
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_improvement_reports(
    p_limit integer DEFAULT 30
)
RETURNS SETOF public.ai_improvement_reports
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
    END IF;
    IF NOT public.is_super_admin(auth.uid()) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT * FROM public.ai_improvement_reports
     ORDER BY created_at DESC LIMIT GREATEST(LEAST(p_limit, 200), 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_improvement_reports(integer) TO authenticated;

-- ============================================================================
-- 4. Schedule daily improvement review via pg_cron (02:30 UTC)
-- ============================================================================

DO $$ BEGIN PERFORM cron.unschedule('ai-improvement-review-daily'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$
DECLARE v_url text; v_secret text;
BEGIN
    SELECT value INTO v_url    FROM public.platform_settings WHERE key = 'ai_soc_functions_base_url';
    SELECT value INTO v_secret FROM public.platform_settings WHERE key = 'ai_soc_poll_secret';
    IF v_url IS NULL OR v_url = '' THEN
        v_url := 'http://supabase-edge-functions:9000/functions/v1';
    END IF;
    PERFORM cron.schedule(
        'ai-improvement-review-daily',
        '30 2 * * *',  -- 02:30 UTC daily
        format(
            $cron$ SELECT net.http_post(
                url := %L,
                headers := jsonb_build_object('content-type','application/json','x-mithras-soc-secret', %L),
                body := jsonb_build_object('agent', 'overall'),
                timeout_milliseconds := 90000
            ); $cron$,
            rtrim(v_url, '/') || '/ai-improvement-review',
            COALESCE(v_secret, '')
        )
    );
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron unavailable, improvement review will need manual trigger';
END $$;

COMMIT;
