-- Switch ledger cost from integer cents to micro-cents (1 cent = 1000 µ¢).
-- gpt-4.1-mini at ~5000 tokens costs ~0.1 cents per call. Integer cents
-- round every individual call to 0, so per-call attribution disappears
-- even though monthly totals are roughly right. Micro-cents preserves
-- ~4 decimal places of cent — plenty for any model at any prompt size.

ALTER TABLE public.ai_llm_calls
    ADD COLUMN IF NOT EXISTS cost_microcents bigint NOT NULL DEFAULT 0;

-- Backfill from existing cost_cents so the historical rows stay readable.
UPDATE public.ai_llm_calls
   SET cost_microcents = (cost_cents::bigint) * 1000
 WHERE cost_microcents = 0
   AND cost_cents > 0;

-- Keep cost_cents around for backward compatibility (anything reading the
-- ledger directly still sees the integer-cents column). New writes populate
-- both columns; reads should prefer cost_microcents.

-- Refresh the breakdown RPC to expose micro-cents alongside the integer.
DROP FUNCTION IF EXISTS public.get_ai_cost_breakdown(timestamptz, timestamptz);
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
    total_cost_microcents   bigint,
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
            o.name,
            count(*)::bigint,
            count(*) FILTER (WHERE c.status = 'success')::bigint,
            count(*) FILTER (WHERE c.status <> 'success')::bigint,
            sum(c.cost_microcents)::bigint,
            (sum(c.cost_microcents) / 1000)::bigint,
            sum(c.prompt_tokens)::bigint,
            sum(c.completion_tokens)::bigint,
            avg(c.latency_ms)::numeric(10,1)
        FROM public.ai_llm_calls c
        LEFT JOIN public.organizations o ON o.id = c.organization_id
        WHERE c.created_at >= _start
          AND c.created_at <  _end
        GROUP BY c.feature, c.organization_id, o.name
        ORDER BY sum(c.cost_microcents) DESC NULLS LAST;
END;
$$;

DROP FUNCTION IF EXISTS public.get_ai_month_spend(text);
CREATE OR REPLACE FUNCTION public.get_ai_month_spend(
    _month text DEFAULT to_char(now(), 'YYYY-MM')
)
RETURNS TABLE (
    budget_id          uuid,
    scope_org_id       uuid,
    scope_org_name     text,
    spent_microcents   bigint,
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
            COALESCE(SUM(c.cost_microcents), 0)::bigint,
            (COALESCE(SUM(c.cost_microcents), 0) / 1000)::bigint,
            b.month_budget_cents,
            CASE WHEN b.month_budget_cents > 0
                 THEN ROUND(100.0 * (COALESCE(SUM(c.cost_microcents), 0) / 1000.0) / b.month_budget_cents, 1)
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

-- Recent-calls RPC also exposes micro-cents.
DROP FUNCTION IF EXISTS public.get_ai_recent_calls(int);
CREATE OR REPLACE FUNCTION public.get_ai_recent_calls(_limit int DEFAULT 50)
RETURNS TABLE (
    id                uuid,
    organization_id   uuid,
    organization_name text,
    feature           text,
    model             text,
    prompt_tokens     int,
    completion_tokens int,
    cost_microcents   bigint,
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
               c.prompt_tokens, c.completion_tokens,
               c.cost_microcents, c.cost_cents,
               c.latency_ms, c.status, c.error_message, c.created_at
        FROM public.ai_llm_calls c
        LEFT JOIN public.organizations o ON o.id = c.organization_id
        ORDER BY c.created_at DESC
        LIMIT GREATEST(1, LEAST(_limit, 500));
END;
$$;
