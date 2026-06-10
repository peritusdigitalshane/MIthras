-- Cut 3 — Customer-visible value.
--
-- Per-customer weekly and monthly reports generated automatically by pg_cron
-- jobs. Edge function `generate-customer-report` (deployed separately) builds
-- the actual HTML/PDF and stores it; this migration creates the data layer.

CREATE TABLE IF NOT EXISTS public.customer_reports (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    kind             text NOT NULL CHECK (kind IN ('weekly','monthly','quarterly','ad_hoc')),
    period_start     timestamptz NOT NULL,
    period_end       timestamptz NOT NULL,

    status           text NOT NULL DEFAULT 'queued'
                         CHECK (status IN ('queued','generating','ready','failed','sent')),

    storage_path     text,
    summary          jsonb,
    error_message    text,

    generated_at     timestamptz,
    sent_at          timestamptz,
    delivered_to     text[],

    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),

    -- One report per (org, kind, period_start) to keep cron-driven idempotency simple.
    UNIQUE (organization_id, kind, period_start)
);
CREATE INDEX IF NOT EXISTS idx_customer_reports_org_period ON public.customer_reports(organization_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_customer_reports_status ON public.customer_reports(status, created_at DESC) WHERE status IN ('queued','generating');

CREATE OR REPLACE FUNCTION public.touch_customer_reports_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_customer_reports_touch ON public.customer_reports;
CREATE TRIGGER trg_customer_reports_touch BEFORE UPDATE ON public.customer_reports
FOR EACH ROW EXECUTE FUNCTION public.touch_customer_reports_updated_at();

ALTER TABLE public.customer_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customer_reports_select_org" ON public.customer_reports;
CREATE POLICY "customer_reports_select_org" ON public.customer_reports FOR SELECT TO authenticated
USING (public.is_super_admin(auth.uid()) OR public.is_member_of_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "customer_reports_insert_service" ON public.customer_reports;
CREATE POLICY "customer_reports_insert_service" ON public.customer_reports FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "customer_reports_update_service" ON public.customer_reports;
CREATE POLICY "customer_reports_update_service" ON public.customer_reports FOR UPDATE TO service_role USING (true);

-- ---------------------------------------------------------------------------
-- enqueue_customer_reports — fan out one queued row per active org for the
-- requested kind + period. Idempotent via the UNIQUE constraint.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_customer_reports(
    p_kind         text,
    p_period_start timestamptz,
    p_period_end   timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
    ON CONFLICT (organization_id, kind, period_start) DO NOTHING;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- build_org_period_summary — server-side metrics roll-up used by the edge
-- function. Returns a jsonb blob the report template fills out.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.build_org_period_summary(
    p_org          uuid,
    p_period_start timestamptz,
    p_period_end   timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_endpoints_total int;
    v_endpoints_online int;
    v_threats_in_period int;
    v_threats_severe int;
    v_incidents_opened int;
    v_incidents_resolved int;
    v_incidents_open_now int;
    v_vulns_open int;
    v_vulns_critical int;
    v_top_software jsonb;
    v_top_incidents jsonb;
BEGIN
    SELECT COUNT(*) INTO v_endpoints_total FROM public.endpoints WHERE organization_id = p_org AND is_active;
    SELECT COUNT(*) INTO v_endpoints_online FROM public.endpoints
     WHERE organization_id = p_org AND is_active AND last_seen_at > now() - interval '10 minutes';

    SELECT COUNT(*) INTO v_threats_in_period
      FROM public.endpoint_threats t
      JOIN public.endpoints e ON e.id = t.endpoint_id
     WHERE e.organization_id = p_org
       AND t.created_at >= p_period_start AND t.created_at < p_period_end;

    SELECT COUNT(*) INTO v_threats_severe
      FROM public.endpoint_threats t
      JOIN public.endpoints e ON e.id = t.endpoint_id
     WHERE e.organization_id = p_org
       AND t.created_at >= p_period_start AND t.created_at < p_period_end
       AND t.severity = 'Severe';

    SELECT COUNT(*) INTO v_incidents_opened
      FROM public.incidents
     WHERE organization_id = p_org
       AND opened_at >= p_period_start AND opened_at < p_period_end;
    SELECT COUNT(*) INTO v_incidents_resolved
      FROM public.incidents
     WHERE organization_id = p_org
       AND resolved_at >= p_period_start AND resolved_at < p_period_end;
    SELECT COUNT(*) INTO v_incidents_open_now
      FROM public.incidents
     WHERE organization_id = p_org AND status NOT IN ('resolved','false_positive');

    SELECT COUNT(*) INTO v_vulns_open
      FROM public.vulnerability_findings v
      JOIN public.endpoints e ON e.id = v.endpoint_id
     WHERE e.organization_id = p_org AND v.status = 'open';
    SELECT COUNT(*) INTO v_vulns_critical
      FROM public.vulnerability_findings v
      JOIN public.endpoints e ON e.id = v.endpoint_id
     WHERE e.organization_id = p_org AND v.status = 'open' AND COALESCE(v.cvss_score, 0) >= 9.0;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'count', cnt)), '[]'::jsonb)
      INTO v_top_software
      FROM (
            SELECT software_name AS name, COUNT(*) AS cnt
              FROM public.endpoint_software_inventory
             WHERE organization_id = p_org
             GROUP BY software_name
             ORDER BY COUNT(*) DESC
             LIMIT 10
           ) s;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', id, 'title', title, 'severity', severity,
             'status', status, 'opened_at', opened_at
           ) ORDER BY opened_at DESC), '[]'::jsonb)
      INTO v_top_incidents
      FROM (
            SELECT *
              FROM public.incidents
             WHERE organization_id = p_org
               AND opened_at >= p_period_start AND opened_at < p_period_end
             ORDER BY opened_at DESC
             LIMIT 20
           ) i;

    RETURN jsonb_build_object(
        'organization_id',    p_org,
        'period_start',       p_period_start,
        'period_end',         p_period_end,
        'endpoints_total',    v_endpoints_total,
        'endpoints_online',   v_endpoints_online,
        'threats_in_period',  v_threats_in_period,
        'threats_severe',     v_threats_severe,
        'incidents_opened',   v_incidents_opened,
        'incidents_resolved', v_incidents_resolved,
        'incidents_open_now', v_incidents_open_now,
        'vulns_open',         v_vulns_open,
        'vulns_critical',     v_vulns_critical,
        'top_software',       v_top_software,
        'top_incidents',      v_top_incidents
    );
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_customer_reports(text, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_customer_reports(text, timestamptz, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.build_org_period_summary(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.build_org_period_summary(uuid, timestamptz, timestamptz) TO service_role, authenticated;

-- ---------------------------------------------------------------------------
-- Schedule the periodic enqueue via pg_cron. The actual generation happens
-- via the generate-customer-report edge function — pg_cron just enqueues so
-- the edge runtime stays focused and rate-limited.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
    PERFORM cron.unschedule('customer-report-weekly-enqueue');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN
    PERFORM cron.unschedule('customer-report-monthly-enqueue');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Weekly: every Monday at 07:00 UTC, generate the report for the prior week.
SELECT cron.schedule(
    'customer-report-weekly-enqueue',
    '0 7 * * 1',
    $$SELECT public.enqueue_customer_reports(
        'weekly',
        date_trunc('week', now() - interval '1 day'),
        date_trunc('week', now())
    )$$
);

-- Monthly: on the 1st at 07:30 UTC, generate the report for the prior month.
SELECT cron.schedule(
    'customer-report-monthly-enqueue',
    '30 7 1 * *',
    $$SELECT public.enqueue_customer_reports(
        'monthly',
        date_trunc('month', now() - interval '1 day'),
        date_trunc('month', now())
    )$$
);
