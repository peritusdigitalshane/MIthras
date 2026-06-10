-- AI SOC Phase 4: Hunt Agent (cross-tenant pattern detection).
--
-- Hunt finds patterns no single tenant's alerts would reveal:
--   - An IP that appears in firewall traffic across 3+ tenants in the last
--     hour = active campaign, not random scanning
--   - A SHA256 hash that lands in multiple tenants' threat reports = malware
--     kit in distribution
--   - A mailbox forwarding rule pattern repeated across customers = BEC kit
--
-- Privacy contract: this table sees cross-tenant data because it runs as
-- service-role. Findings exposed to a customer ONLY surface (a) the IOC
-- itself, (b) the number of other tenants affected, (c) sample events from
-- THEIR OWN tenant. They never learn the identities of the other tenants.

BEGIN;

-- ============================================================================
-- 1. hunt_findings — one row per detected campaign / pattern
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.hunt_findings (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    finding_kind         text NOT NULL CHECK (finding_kind IN (
        'cross_tenant_ip','cross_tenant_hash','cross_tenant_domain',
        'cross_tenant_command_line','cross_tenant_mailbox_rule',
        'cross_tenant_oauth_grant','novel_pattern','systematic_miss'
    )),

    -- The thing all the events shared. For cross_tenant_ip: { value: "1.2.3.4" }.
    -- For cross_tenant_hash: { value: "abc...", file_name: "..." }.
    shared_indicator     jsonb NOT NULL,

    -- Tenant + event scope. Stored as arrays so a single finding can grow as
    -- more tenants are affected without creating duplicate rows.
    affected_tenant_ids  uuid[] NOT NULL DEFAULT '{}',
    tenant_count         integer NOT NULL DEFAULT 0,
    sample_event_count   integer NOT NULL DEFAULT 0,
    event_window_start   timestamptz NOT NULL,
    event_window_end     timestamptz NOT NULL,

    -- LLM enrichment (populated lazily, may be NULL on first detection).
    severity             text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
    confidence           numeric(3,2) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    summary              text,
    recommended_action   text,
    enrichment_model     text,
    enrichment_cost_microcents bigint NOT NULL DEFAULT 0,
    enriched_at          timestamptz,

    -- Lifecycle
    status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','dismissed','resolved')),
    acknowledged_by      uuid,
    acknowledged_at      timestamptz,
    resolved_at          timestamptz,

    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Dedup: one open finding per (kind, indicator value). The cron upserts on
-- this so the same recurring IP gets one finding with growing counters
-- instead of N findings.
CREATE UNIQUE INDEX IF NOT EXISTS uq_hunt_findings_kind_indicator_open
    ON public.hunt_findings (finding_kind, (shared_indicator->>'value'))
    WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_hunt_findings_created
    ON public.hunt_findings (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hunt_findings_status
    ON public.hunt_findings (status, created_at DESC);
-- Tenant lookup uses array overlap; GIN handles uuid[] containment.
CREATE INDEX IF NOT EXISTS idx_hunt_findings_tenants
    ON public.hunt_findings USING GIN (affected_tenant_ids);

-- ============================================================================
-- 2. hunt_iocs — the per-IOC catalog used to enrich future triage decisions
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.hunt_iocs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ioc_type        text NOT NULL CHECK (ioc_type IN ('ip','sha256','domain','url','mailbox_rule_pattern','command_line_pattern')),
    ioc_value       text NOT NULL,
    finding_id      uuid REFERENCES public.hunt_findings(id) ON DELETE SET NULL,

    first_seen_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at    timestamptz NOT NULL DEFAULT now(),
    tenant_count    integer NOT NULL DEFAULT 1,
    confidence      numeric(3,2) NOT NULL DEFAULT 0.6 CHECK (confidence >= 0 AND confidence <= 1),
    enabled         boolean NOT NULL DEFAULT true,
    notes           text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_hunt_iocs_type_value
    ON public.hunt_iocs (ioc_type, ioc_value);
CREATE INDEX IF NOT EXISTS idx_hunt_iocs_last_seen
    ON public.hunt_iocs (last_seen_at DESC) WHERE enabled = true;

-- ============================================================================
-- 3. RLS — operators see findings affecting their tenant ONLY. Super-admins
-- see the full fleet view. hunt_iocs is fleet-wide and readable by all
-- authenticated users (the IOCs themselves are useful for any tenant to know).
-- ============================================================================

ALTER TABLE public.hunt_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hunt_iocs     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hunt_findings_member_read ON public.hunt_findings;
CREATE POLICY hunt_findings_member_read ON public.hunt_findings
    FOR SELECT TO authenticated
    USING (
        public.is_super_admin(auth.uid())
        OR EXISTS (
            SELECT 1 FROM unnest(affected_tenant_ids) t(org_id)
             WHERE public.is_member_of_org(auth.uid(), t.org_id)
        )
    );

DROP POLICY IF EXISTS hunt_findings_service_write ON public.hunt_findings;
CREATE POLICY hunt_findings_service_write ON public.hunt_findings
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Admins of an affected tenant can acknowledge a finding (ack status only).
-- Resolve / dismiss are super-admin operations.
DROP POLICY IF EXISTS hunt_findings_member_acknowledge ON public.hunt_findings;
CREATE POLICY hunt_findings_member_acknowledge ON public.hunt_findings
    FOR UPDATE TO authenticated
    USING (
        public.is_super_admin(auth.uid())
        OR EXISTS (
            SELECT 1 FROM unnest(affected_tenant_ids) t(org_id)
             WHERE public.is_admin_of_org(auth.uid(), t.org_id)
        )
    );

DROP POLICY IF EXISTS hunt_iocs_read ON public.hunt_iocs;
CREATE POLICY hunt_iocs_read ON public.hunt_iocs
    FOR SELECT TO authenticated USING (enabled = true);

DROP POLICY IF EXISTS hunt_iocs_service_write ON public.hunt_iocs;
CREATE POLICY hunt_iocs_service_write ON public.hunt_iocs
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- 4. Operator-facing RPCs
-- ============================================================================

-- Fetches findings for a customer's tenant. Privacy: redacts the
-- affected_tenant_ids array so the caller learns "you + N others" without
-- learning who the others are.
CREATE OR REPLACE FUNCTION public.get_hunt_findings_for_tenant(
    p_org_id  uuid DEFAULT NULL,
    p_status  text DEFAULT 'open',
    p_limit   integer DEFAULT 50
)
RETURNS TABLE (
    id                  uuid,
    finding_kind        text,
    shared_indicator    jsonb,
    other_tenant_count  integer,        -- not the list, just the count
    tenant_count        integer,
    sample_event_count  integer,
    event_window_start  timestamptz,
    event_window_end    timestamptz,
    severity            text,
    confidence          numeric,
    summary             text,
    recommended_action  text,
    status              text,
    created_at          timestamptz,
    updated_at          timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_org_filter uuid;
    v_is_super boolean;
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
             WHERE user_id = v_caller
             ORDER BY created_at
             LIMIT 1;
        END IF;
    END IF;

    RETURN QUERY
    SELECT
        h.id,
        h.finding_kind,
        h.shared_indicator,
        -- Subtract self from the count if affected, else show the full count.
        GREATEST(0,
            h.tenant_count
            - CASE WHEN v_org_filter = ANY(h.affected_tenant_ids) THEN 1 ELSE 0 END
        ) AS other_tenant_count,
        h.tenant_count,
        h.sample_event_count,
        h.event_window_start,
        h.event_window_end,
        h.severity,
        h.confidence,
        h.summary,
        h.recommended_action,
        h.status,
        h.created_at,
        h.updated_at
      FROM public.hunt_findings h
     WHERE (p_status = 'all' OR h.status = p_status)
       AND (
           v_is_super
           OR v_org_filter = ANY(h.affected_tenant_ids)
       )
     ORDER BY h.created_at DESC
     LIMIT GREATEST(LEAST(p_limit, 200), 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_hunt_findings_for_tenant(uuid, text, integer) TO authenticated;

-- ============================================================================
-- 5. Schedule the cross-tenant hunt every 15 minutes via pg_cron
-- ============================================================================
--
-- The cron job hits the edge function which runs the actual clustering
-- + LLM enrichment. Same pattern as the existing ai-cost-monitor cron.

DO $$ BEGIN PERFORM cron.unschedule('ai-hunt-cross-tenant'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$
DECLARE v_url text; v_secret text;
BEGIN
    SELECT value INTO v_url    FROM public.platform_settings WHERE key = 'ai_soc_functions_base_url';
    SELECT value INTO v_secret FROM public.platform_settings WHERE key = 'ai_soc_poll_secret';

    IF v_url IS NULL OR v_url = '' THEN
        v_url := 'http://supabase-edge-functions:9000/functions/v1';
    END IF;

    PERFORM cron.schedule(
        'ai-hunt-cross-tenant',
        '*/15 * * * *',
        format(
            $cron$ SELECT net.http_post(
                url := %L,
                headers := jsonb_build_object('content-type','application/json','x-mithras-soc-secret', %L),
                body := '{}'::jsonb,
                timeout_milliseconds := 60000
            ); $cron$,
            rtrim(v_url, '/') || '/ai-hunt-cross-tenant',
            COALESCE(v_secret, '')
        )
    );
EXCEPTION WHEN OTHERS THEN
    -- Local envs without cron just skip — the function still works on
    -- manual invocation.
    RAISE NOTICE 'pg_cron unavailable, skipping hunt schedule';
END $$;

COMMIT;
