-- customer_reports enqueue cron has been failing since 2026-06-01 with:
--   ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification
--
-- The function `enqueue_customer_reports` uses
--   ON CONFLICT (organization_id, kind, period_start) DO NOTHING
-- but the only unique index that covers those columns is
--   customer_reports_org_or_site_unique
--     (organization_id, COALESCE(site_id::text, ''), kind, period_start)
-- which Postgres rejects as a partial match — ON CONFLICT requires the
-- column list to match the index exactly (no expressions).
--
-- Since the cron only enqueues ORG-LEVEL reports (site_id is left NULL),
-- a partial unique index that ignores site_id is the right shape: it
-- enforces "one (org, kind, period_start) report row WHERE site_id IS NULL"
-- which is exactly what the function wants. The existing four-column
-- unique still enforces per-site uniqueness.

CREATE UNIQUE INDEX IF NOT EXISTS customer_reports_org_kind_period_uniq
ON public.customer_reports (organization_id, kind, period_start)
WHERE site_id IS NULL;

-- Postgres requires the partial-index predicate to be repeated inline on
-- the ON CONFLICT clause — it won't infer it from the SELECT. The function
-- currently omits the predicate, so it can't bind to the partial index
-- and falls through to the four-column unique (whose expression-based
-- columns aren't a valid ON CONFLICT target). Patch the function to spell
-- out `WHERE site_id IS NULL` so the inference resolves.
CREATE OR REPLACE FUNCTION public.enqueue_customer_reports(
    p_kind text,
    p_period_start timestamp with time zone,
    p_period_end timestamp with time zone
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_count int := 0;
BEGIN
    IF p_kind NOT IN ('weekly','monthly','quarterly','ad_hoc') THEN
        RAISE EXCEPTION 'invalid_kind' USING ERRCODE='22023';
    END IF;
    IF p_period_end <= p_period_start THEN
        RAISE EXCEPTION 'invalid_period' USING ERRCODE='22023';
    END IF;

    INSERT INTO public.customer_reports(organization_id, kind, period_start, period_end, status)
    SELECT o.id, p_kind, p_period_start, p_period_end, 'queued'
      FROM public.organizations o
     WHERE EXISTS (SELECT 1 FROM public.endpoints e WHERE e.organization_id = o.id AND e.is_active)
    ON CONFLICT (organization_id, kind, period_start) WHERE site_id IS NULL DO NOTHING;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$function$;
