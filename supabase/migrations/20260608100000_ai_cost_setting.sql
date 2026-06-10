-- AI cost setting: editable per-model rates, universal LLM-call ledger,
-- monthly budgets with 80%/100% alerting, and aggregate RPCs that power the
-- /admin/ai-costs dashboard.
--
-- Before this, rates were hardcoded in supabase/functions/_shared/ai-llm.ts.
-- When OpenAI changes pricing the cost numbers silently drift. Three tables
-- (ai_triage_decisions, ai_investigations, m365_posture_advice) already
-- write cost_cents but the other LLM callers (cve-auto-scan, security-advisor,
-- mitigation-advisor, report exec summary) don't track spend anywhere.
-- The ledger table fixes that — every callLlmStructured/callLlmText writes
-- one row, attributed to its feature and organization.

-- ──────────────────────────────────────────────────────────────────────
-- 1. Editable rates per model
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_model_rates (
    model                    text PRIMARY KEY,
    usd_per_million_input    numeric(10,4) NOT NULL,
    usd_per_million_output   numeric(10,4) NOT NULL,
    notes                    text,
    updated_by               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_model_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super-admins manage ai_model_rates" ON public.ai_model_rates;
CREATE POLICY "Super-admins manage ai_model_rates"
    ON public.ai_model_rates
    FOR ALL
    USING (public.is_super_admin(auth.uid()))
    WITH CHECK (public.is_super_admin(auth.uid()));

DROP TRIGGER IF EXISTS trg_ai_model_rates_updated_at ON public.ai_model_rates;
CREATE TRIGGER trg_ai_model_rates_updated_at
    BEFORE UPDATE ON public.ai_model_rates
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Seed the rates that were hardcoded in _shared/ai-llm.ts.
INSERT INTO public.ai_model_rates (model, usd_per_million_input, usd_per_million_output, notes) VALUES
    ('gpt-4o-mini',  0.15,  0.60, 'OpenAI public price as of 2026-06'),
    ('gpt-4o',       2.50, 10.00, 'OpenAI public price as of 2026-06'),
    ('gpt-4.1-mini', 0.15,  0.60, 'OpenAI public price as of 2026-06'),
    ('gpt-4.1',      2.00,  8.00, 'OpenAI public price as of 2026-06'),
    ('gpt-5-mini',   0.25,  2.00, 'OpenAI public price as of 2026-06'),
    ('gpt-5',        1.25, 10.00, 'OpenAI public price as of 2026-06'),
    ('o4-mini',      1.10,  4.40, 'OpenAI public price as of 2026-06')
ON CONFLICT (model) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────
-- 2. Universal LLM-call ledger
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_llm_calls (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
    feature             text NOT NULL,  -- triage|investigation|posture_advisor|cve_scan|cve_protect|cve_mitigation|security_advisor|report_exec_summary|incident_triage|other
    model               text NOT NULL,
    prompt_tokens       int NOT NULL DEFAULT 0,
    completion_tokens   int NOT NULL DEFAULT 0,
    cost_cents          int NOT NULL DEFAULT 0,
    latency_ms          int,
    status              text NOT NULL,  -- success|error|refusal
    error_message       text,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_llm_calls_created_at        ON public.ai_llm_calls (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_llm_calls_org_created       ON public.ai_llm_calls (organization_id, created_at DESC) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_llm_calls_feature_created   ON public.ai_llm_calls (feature, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_llm_calls_model_created     ON public.ai_llm_calls (model, created_at DESC);

ALTER TABLE public.ai_llm_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super-admins read all ai_llm_calls" ON public.ai_llm_calls;
CREATE POLICY "Super-admins read all ai_llm_calls"
    ON public.ai_llm_calls
    FOR SELECT
    USING (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Org admins read own ai_llm_calls" ON public.ai_llm_calls;
CREATE POLICY "Org admins read own ai_llm_calls"
    ON public.ai_llm_calls
    FOR SELECT
    USING (organization_id IS NOT NULL AND public.is_admin_of_org(auth.uid(), organization_id));

-- Writes are service-role only (no policy = locked down to service_role).

-- ──────────────────────────────────────────────────────────────────────
-- 3. Monthly budgets + alerting state
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_cost_budgets (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id      uuid REFERENCES public.organizations(id) ON DELETE CASCADE,  -- NULL = global default
    month_budget_cents   int NOT NULL CHECK (month_budget_cents >= 0),
    alert_at_80_pct      boolean NOT NULL DEFAULT true,
    alert_at_100_pct     boolean NOT NULL DEFAULT true,
    notify_email         text,  -- optional override; falls back to org_alert_recipients
    current_month        text NOT NULL DEFAULT to_char(now(), 'YYYY-MM'),  -- last reset month
    alert_80_sent_at     timestamptz,
    alert_100_sent_at    timestamptz,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Exactly one global row (organization_id IS NULL), and one row per org.
CREATE UNIQUE INDEX IF NOT EXISTS ai_cost_budgets_global_uniq
    ON public.ai_cost_budgets ((1))
    WHERE organization_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ai_cost_budgets_org_uniq
    ON public.ai_cost_budgets (organization_id)
    WHERE organization_id IS NOT NULL;

ALTER TABLE public.ai_cost_budgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super-admins manage ai_cost_budgets" ON public.ai_cost_budgets;
CREATE POLICY "Super-admins manage ai_cost_budgets"
    ON public.ai_cost_budgets
    FOR ALL
    USING (public.is_super_admin(auth.uid()))
    WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Org admins read own ai_cost_budgets" ON public.ai_cost_budgets;
CREATE POLICY "Org admins read own ai_cost_budgets"
    ON public.ai_cost_budgets
    FOR SELECT
    USING (organization_id IS NOT NULL AND public.is_admin_of_org(auth.uid(), organization_id));

DROP TRIGGER IF EXISTS trg_ai_cost_budgets_updated_at ON public.ai_cost_budgets;
CREATE TRIGGER trg_ai_cost_budgets_updated_at
    BEFORE UPDATE ON public.ai_cost_budgets
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Seed a $50/month global default. Operators tune via the UI.
INSERT INTO public.ai_cost_budgets (organization_id, month_budget_cents, current_month)
VALUES (NULL, 5000, to_char(now(), 'YYYY-MM'))
ON CONFLICT DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────
-- 4. Aggregation RPCs
-- ──────────────────────────────────────────────────────────────────────

-- Spend breakdown over an arbitrary window, grouped by (feature, org).
CREATE OR REPLACE FUNCTION public.get_ai_cost_breakdown(
    _start timestamptz DEFAULT date_trunc('month', now()),
    _end   timestamptz DEFAULT now()
)
RETURNS TABLE (
    feature                 text,
    organization_id         uuid,
    organization_name       text,
    call_count              bigint,
    success_count           bigint,
    error_count             bigint,
    total_cost_cents        bigint,
    total_prompt_tokens     bigint,
    total_completion_tokens bigint,
    avg_latency_ms          numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT public.is_super_admin(auth.uid()) THEN
        RAISE EXCEPTION 'super_admin_required' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
        SELECT
            c.feature,
            c.organization_id,
            o.name AS organization_name,
            count(*)::bigint,
            count(*) FILTER (WHERE c.status = 'success')::bigint,
            count(*) FILTER (WHERE c.status <> 'success')::bigint,
            sum(c.cost_cents)::bigint,
            sum(c.prompt_tokens)::bigint,
            sum(c.completion_tokens)::bigint,
            avg(c.latency_ms)::numeric(10,1)
        FROM public.ai_llm_calls c
        LEFT JOIN public.organizations o ON o.id = c.organization_id
        WHERE c.created_at >= _start
          AND c.created_at <  _end
        GROUP BY c.feature, c.organization_id, o.name
        ORDER BY total_cost_cents DESC NULLS LAST;
END;
$$;

-- Current-month total spend vs budget, one row per budget (global + each org).
-- Used by the dashboard hero card and the cost-monitor cron.
CREATE OR REPLACE FUNCTION public.get_ai_month_spend(
    _month text DEFAULT to_char(now(), 'YYYY-MM')
)
RETURNS TABLE (
    budget_id          uuid,
    scope_org_id       uuid,
    scope_org_name     text,
    spent_cents        bigint,
    budget_cents       int,
    pct_of_budget      numeric,
    alert_at_80_pct    boolean,
    alert_at_100_pct   boolean,
    alert_80_sent_at   timestamptz,
    alert_100_sent_at  timestamptz,
    current_month      text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    _start timestamptz := to_timestamp(_month || '-01', 'YYYY-MM-DD');
    _stop  timestamptz := _start + interval '1 month';
BEGIN
    IF NOT public.is_super_admin(auth.uid()) THEN
        RAISE EXCEPTION 'super_admin_required' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
        SELECT
            b.id,
            b.organization_id,
            CASE WHEN b.organization_id IS NULL THEN 'GLOBAL'::text ELSE o.name END,
            COALESCE(SUM(c.cost_cents), 0)::bigint,
            b.month_budget_cents,
            CASE WHEN b.month_budget_cents > 0
                 THEN ROUND(100.0 * COALESCE(SUM(c.cost_cents), 0) / b.month_budget_cents, 1)
                 ELSE NULL END,
            b.alert_at_80_pct,
            b.alert_at_100_pct,
            b.alert_80_sent_at,
            b.alert_100_sent_at,
            b.current_month
        FROM public.ai_cost_budgets b
        LEFT JOIN public.organizations o ON o.id = b.organization_id
        LEFT JOIN public.ai_llm_calls c
               ON c.created_at >= _start
              AND c.created_at <  _stop
              AND (b.organization_id IS NULL OR c.organization_id = b.organization_id)
        GROUP BY b.id, b.organization_id, o.name, b.month_budget_cents,
                 b.alert_at_80_pct, b.alert_at_100_pct,
                 b.alert_80_sent_at, b.alert_100_sent_at, b.current_month;
END;
$$;

-- Last N LLM calls — powers the activity feed.
CREATE OR REPLACE FUNCTION public.get_ai_recent_calls(_limit int DEFAULT 50)
RETURNS TABLE (
    id                uuid,
    organization_id   uuid,
    organization_name text,
    feature           text,
    model             text,
    prompt_tokens     int,
    completion_tokens int,
    cost_cents        int,
    latency_ms        int,
    status            text,
    error_message     text,
    created_at        timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT public.is_super_admin(auth.uid()) THEN
        RAISE EXCEPTION 'super_admin_required' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
        SELECT c.id, c.organization_id, o.name, c.feature, c.model,
               c.prompt_tokens, c.completion_tokens, c.cost_cents,
               c.latency_ms, c.status, c.error_message, c.created_at
        FROM public.ai_llm_calls c
        LEFT JOIN public.organizations o ON o.id = c.organization_id
        ORDER BY c.created_at DESC
        LIMIT GREATEST(1, LEAST(_limit, 500));
END;
$$;

-- ──────────────────────────────────────────────────────────────────────
-- 5. Backfill ledger from existing cost tables
-- ──────────────────────────────────────────────────────────────────────
-- We have three tables already writing cost_cents. Copy historical rows into
-- the new ledger so the dashboard isn't blank on day one. This is one-shot;
-- the function refactor will write to the ledger going forward.

INSERT INTO public.ai_llm_calls (organization_id, feature, model, prompt_tokens, completion_tokens, cost_cents, latency_ms, status, error_message, created_at)
SELECT
    organization_id,
    'triage'::text,
    COALESCE(model, 'unknown'),
    COALESCE(prompt_tokens, 0),
    COALESCE(completion_tokens, 0),
    COALESCE(cost_cents, 0),
    latency_ms,
    CASE WHEN error_message IS NULL THEN 'success' ELSE 'error' END,
    error_message,
    created_at
FROM public.ai_triage_decisions
WHERE model IS NOT NULL;

INSERT INTO public.ai_llm_calls (organization_id, feature, model, prompt_tokens, completion_tokens, cost_cents, latency_ms, status, error_message, created_at)
SELECT
    organization_id,
    'investigation'::text,
    COALESCE(model, 'unknown'),
    COALESCE(prompt_tokens, 0),
    COALESCE(completion_tokens, 0),
    COALESCE(cost_cents, 0),
    latency_ms,
    CASE WHEN error_message IS NULL THEN 'success' ELSE 'error' END,
    error_message,
    created_at
FROM public.ai_investigations
WHERE model IS NOT NULL;

-- m365_posture_advice doesn't store organization_id directly; resolve via
-- the snapshot link. Also doesn't track tokens — leave as 0.
INSERT INTO public.ai_llm_calls (organization_id, feature, model, prompt_tokens, completion_tokens, cost_cents, latency_ms, status, error_message, created_at)
SELECT
    s.organization_id,
    'posture_advisor'::text,
    COALESCE(a.model, 'unknown'),
    0, 0,
    COALESCE(a.cost_cents, 0),
    a.latency_ms,
    'success',
    NULL,
    a.generated_at
FROM public.m365_posture_advice a
JOIN public.m365_posture_snapshots s ON s.id = a.snapshot_id
WHERE a.model IS NOT NULL;
