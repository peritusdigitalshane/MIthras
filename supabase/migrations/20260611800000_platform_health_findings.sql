-- Platform health findings — backing tables for the System Health Dashboard.
--
-- The scanner (ai-platform-health-scan edge function) runs every 15 minutes,
-- collects raw signals (failed crons, stale pulses, DB integrity, agent fleet,
-- AI budget overruns, stuck jobs), runs an LLM triage pass to assign severity
-- and recommend a fix, and upserts the result here. A finding stays open until
-- a super-admin acknowledges/dismisses it, or until the next scan sees that
-- the underlying condition has cleared.

BEGIN;

-- ============================================================================
-- 1. platform_health_findings — one row per distinct condition currently or
--    historically detected. Idempotent on `finding_key` so repeated detections
--    bump `last_seen` instead of creating new rows.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.platform_health_findings (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Stable identifier for idempotent upsert. Composed by the scanner from
    -- the check name + the specific entity it relates to. Examples:
    --   "cron_failed:ai-hunt-cross-tenant"
    --   "stale_pulse:wordpress-alert-detector"
    --   "rls_disabled:public.foo"
    --   "agent_silent:<endpoint_id>"
    finding_key         text NOT NULL UNIQUE,

    -- Coarse category — drives the dashboard grouping.
    category            text NOT NULL CHECK (category IN (
        'cron','edge_function','database','agent_fleet','ai_pipeline',
        'budget','integration','security','other'
    )),

    -- After triage. Pre-triage records use 'unknown'.
    severity            text NOT NULL DEFAULT 'unknown'
                          CHECK (severity IN ('critical','high','medium','low','info','unknown')),

    -- Human-readable.
    title               text NOT NULL,
    description         text,

    -- Raw evidence the scanner collected. The triage agent reads this and
    -- writes triage_verdict + recommended_fix.
    evidence            jsonb NOT NULL DEFAULT '{}'::jsonb,

    -- LLM triage output.
    triage_verdict      text,     -- "real issue" | "noise" | "needs human"
    triage_reasoning    text,     -- short explanation of severity assignment
    recommended_fix     text,     -- concrete next step
    triage_model        text,
    triage_cost_microcents bigint DEFAULT 0,

    -- Lifecycle.
    status              text NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open','acknowledged','fixed','dismissed','auto_resolved')),
    first_seen          timestamptz NOT NULL DEFAULT now(),
    last_seen           timestamptz NOT NULL DEFAULT now(),
    seen_count          integer NOT NULL DEFAULT 1,
    resolved_at         timestamptz,
    resolved_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    resolution_note     text
);

CREATE INDEX IF NOT EXISTS idx_health_findings_status_severity
    ON public.platform_health_findings (status, severity, last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_health_findings_category
    ON public.platform_health_findings (category, status);
CREATE INDEX IF NOT EXISTS idx_health_findings_last_seen
    ON public.platform_health_findings (last_seen DESC);

ALTER TABLE public.platform_health_findings ENABLE ROW LEVEL SECURITY;

-- Super-admins only — this is platform-wide observability, not per-tenant.
DROP POLICY IF EXISTS health_findings_super_admin_read ON public.platform_health_findings;
CREATE POLICY health_findings_super_admin_read
    ON public.platform_health_findings FOR SELECT
    USING (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS health_findings_super_admin_update ON public.platform_health_findings;
CREATE POLICY health_findings_super_admin_update
    ON public.platform_health_findings FOR UPDATE
    USING (public.is_super_admin(auth.uid()))
    WITH CHECK (public.is_super_admin(auth.uid()));

-- Inserts only via service-role (scanner edge function). No member policy.

-- ============================================================================
-- 2. platform_health_runs — one row per scanner invocation. Powers
--    "last scanned X min ago" and trend analytics.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.platform_health_runs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at          timestamptz NOT NULL DEFAULT now(),
    finished_at         timestamptz,
    duration_ms         integer,

    -- Aggregate counts the scanner returns.
    signals_collected   integer NOT NULL DEFAULT 0,
    findings_opened     integer NOT NULL DEFAULT 0,
    findings_updated    integer NOT NULL DEFAULT 0,
    findings_resolved   integer NOT NULL DEFAULT 0,

    -- Scanner outcome.
    status              text NOT NULL DEFAULT 'running'
                          CHECK (status IN ('running','succeeded','failed','partial')),
    error_message       text,

    -- LLM accounting for the whole run.
    triage_cost_microcents bigint NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_health_runs_started
    ON public.platform_health_runs (started_at DESC);

ALTER TABLE public.platform_health_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS health_runs_super_admin_read ON public.platform_health_runs;
CREATE POLICY health_runs_super_admin_read
    ON public.platform_health_runs FOR SELECT
    USING (public.is_super_admin(auth.uid()));

-- ============================================================================
-- 3. RPC: get_platform_health_overview()
--    One-shot read for the dashboard hero. Returns counts by severity, last
--    scan time + status, and the next-expected scan time.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_platform_health_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_open  jsonb;
    v_last  jsonb;
BEGIN
    IF NOT public.is_super_admin(auth.uid()) THEN
        RAISE EXCEPTION 'permission denied';
    END IF;

    SELECT jsonb_build_object(
        'critical', COUNT(*) FILTER (WHERE severity='critical'),
        'high',     COUNT(*) FILTER (WHERE severity='high'),
        'medium',   COUNT(*) FILTER (WHERE severity='medium'),
        'low',      COUNT(*) FILTER (WHERE severity='low'),
        'info',     COUNT(*) FILTER (WHERE severity='info'),
        'unknown',  COUNT(*) FILTER (WHERE severity='unknown'),
        'total',    COUNT(*)
    )
    INTO v_open
    FROM public.platform_health_findings
    WHERE status IN ('open','acknowledged');

    SELECT jsonb_build_object(
        'started_at',         started_at,
        'finished_at',        finished_at,
        'duration_ms',        duration_ms,
        'status',             status,
        'signals_collected',  signals_collected,
        'findings_opened',    findings_opened,
        'findings_updated',   findings_updated,
        'findings_resolved',  findings_resolved
    )
    INTO v_last
    FROM public.platform_health_runs
    ORDER BY started_at DESC
    LIMIT 1;

    RETURN jsonb_build_object(
        'open_counts',  COALESCE(v_open, '{}'::jsonb),
        'last_run',     v_last
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_platform_health_overview() TO authenticated;

-- ============================================================================
-- 4. Retention — auto-purge resolved findings older than 90 days. Done in the
--    scanner; this comment is the contract.
-- ============================================================================

COMMIT;
