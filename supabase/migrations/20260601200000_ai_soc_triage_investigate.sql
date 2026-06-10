-- AI SOC — Triage Agent + Investigation Agent.
--
-- Two new tables that capture every AI decision in audit-grade detail:
--   ai_triage_decisions     one per alert, written by ai-triage-alert
--   ai_investigations       one per escalated alert, written by ai-investigate-alert
--
-- Every claim made by either agent carries an evidence citation: a
-- (source_table, source_row_id) pair pointing at a real row in the
-- platform's data. Citations are validated server-side before persistence;
-- claims that can't be cited get dropped, and an entirely uncitable
-- response gets marked status='failed' with verdict='needs_human' so a
-- human picks it up.
--
-- Auto-triage is wired via Postgres trigger → pg_net.http_post → edge fn.
-- It's OFF by default per org and gated by a daily LLM cost cap so a
-- runaway prompt loop can't bankrupt anyone.

-- =============================================================================
-- Per-org enable flag + daily cost cap
-- =============================================================================
ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS ai_soc_enabled         BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS ai_soc_daily_cap_cents INTEGER NOT NULL DEFAULT 500;     -- USD ≈ $5/day default

COMMENT ON COLUMN public.organizations.ai_soc_enabled IS
    'When true, every new alert in this org is automatically triaged by the AI Triage Agent. Off by default — orgs opt in via the AI SOC settings card.';
COMMENT ON COLUMN public.organizations.ai_soc_daily_cap_cents IS
    'Daily ceiling on AI SOC spend per org, in US cents. Both triage + investigation agents check this before calling the LLM. Hitting the cap pauses auto-triage until midnight UTC; manual runs still work.';

-- =============================================================================
-- ai_triage_decisions
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.ai_triage_decisions (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id                        UUID NOT NULL UNIQUE REFERENCES public.alerts(id) ON DELETE CASCADE,
    organization_id                 UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    status                          TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'completed', 'failed', 'budget_exceeded', 'skipped')),

    verdict                         TEXT
        CHECK (verdict IS NULL OR verdict IN ('true_positive', 'false_positive', 'needs_human', 'inconclusive')),
    confidence                      NUMERIC(3,2)
        CHECK (confidence IS NULL OR (confidence BETWEEN 0 AND 1)),

    summary                         TEXT,
    key_indicators                  JSONB NOT NULL DEFAULT '[]'::jsonb,
        -- shape: [{ "indicator": text, "citation": {"table": text, "row_id": text} }, ...]
    reasoning_steps                 JSONB NOT NULL DEFAULT '[]'::jsonb,
        -- shape: [{ "step": text, "citation": {"table": text, "row_id": text} }, ...]
    recommended_action              TEXT,
    recommended_command             TEXT
        CHECK (recommended_command IS NULL OR recommended_command IN (
            'isolate_network','release_isolation','kill_process','quarantine_file',
            'run_quick_scan','run_full_scan','collect_persistence','restart_agent','none'
        )),
    mitre_tags                      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

    -- Acted-on flags
    auto_closed                     BOOLEAN NOT NULL DEFAULT false,
        -- true means we acknowledged the underlying alert
    escalated_to_investigation      BOOLEAN NOT NULL DEFAULT false,

    -- LLM bookkeeping
    model                           TEXT,
    prompt_tokens                   INTEGER,
    completion_tokens               INTEGER,
    cost_cents                      INTEGER NOT NULL DEFAULT 0,
    latency_ms                      INTEGER,
    raw_response                    JSONB,
    error_message                   TEXT,

    -- Human review trail
    reviewed_by_user_id             UUID REFERENCES public.profiles(id),
    reviewed_at                     TIMESTAMPTZ,
    review_action                   TEXT
        CHECK (review_action IS NULL OR review_action IN ('approved', 'overridden', 'dismissed')),
    review_notes                    TEXT,

    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at                    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_triage_org_created    ON public.ai_triage_decisions(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_triage_verdict        ON public.ai_triage_decisions(organization_id, verdict, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_triage_needs_review   ON public.ai_triage_decisions(organization_id, created_at DESC)
    WHERE reviewed_at IS NULL AND status = 'completed';

ALTER TABLE public.ai_triage_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members read triage decisions"
    ON public.ai_triage_decisions FOR SELECT
    USING (is_member_of_org(auth.uid(), organization_id));

CREATE POLICY "Super admins read all triage decisions"
    ON public.ai_triage_decisions FOR SELECT
    USING (is_super_admin(auth.uid()));

CREATE POLICY "Partner admins read customer triage decisions"
    ON public.ai_triage_decisions FOR SELECT
    USING (is_partner_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Org admins review triage decisions"
    ON public.ai_triage_decisions FOR UPDATE
    USING (is_admin_of_org(auth.uid(), organization_id))
    WITH CHECK (is_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Service role writes triage decisions"
    ON public.ai_triage_decisions FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- =============================================================================
-- ai_investigations
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.ai_investigations (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id                    UUID NOT NULL UNIQUE REFERENCES public.alerts(id) ON DELETE CASCADE,
    organization_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    triage_decision_id          UUID REFERENCES public.ai_triage_decisions(id) ON DELETE SET NULL,

    status                      TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'completed', 'failed', 'budget_exceeded')),

    incident_summary            TEXT,
    timeline                    JSONB NOT NULL DEFAULT '[]'::jsonb,
        -- [{ "occurred_at": ISO, "event_text": text, "severity": text, "citation": {...} }, ...]
    affected_assets             JSONB NOT NULL DEFAULT '[]'::jsonb,
        -- [{ "asset_type": text, "asset_id": text, "asset_name": text, "citation": {...} }, ...]
    attack_chain_analysis       TEXT,
    suggested_containment       JSONB NOT NULL DEFAULT '[]'::jsonb,
        -- [{ "action": text, "rationale": text, "citation": {...} }, ...]
    suggested_eradication       JSONB NOT NULL DEFAULT '[]'::jsonb,
    customer_report_markdown    TEXT,
    mitre_tags                  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

    -- LLM bookkeeping
    model                       TEXT,
    prompt_tokens               INTEGER,
    completion_tokens           INTEGER,
    cost_cents                  INTEGER NOT NULL DEFAULT 0,
    latency_ms                  INTEGER,
    raw_response                JSONB,
    error_message               TEXT,

    reviewed_by_user_id         UUID REFERENCES public.profiles(id),
    reviewed_at                 TIMESTAMPTZ,
    customer_notified_at        TIMESTAMPTZ,

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at                TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_invest_org_created  ON public.ai_investigations(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_invest_status       ON public.ai_investigations(organization_id, status, created_at DESC);

ALTER TABLE public.ai_investigations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members read investigations"
    ON public.ai_investigations FOR SELECT
    USING (is_member_of_org(auth.uid(), organization_id));

CREATE POLICY "Super admins read all investigations"
    ON public.ai_investigations FOR SELECT
    USING (is_super_admin(auth.uid()));

CREATE POLICY "Partner admins read customer investigations"
    ON public.ai_investigations FOR SELECT
    USING (is_partner_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Org admins update investigations"
    ON public.ai_investigations FOR UPDATE
    USING (is_admin_of_org(auth.uid(), organization_id))
    WITH CHECK (is_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Service role writes investigations"
    ON public.ai_investigations FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- =============================================================================
-- Budget helper — has this org hit its daily cap?
-- =============================================================================
CREATE OR REPLACE FUNCTION public.ai_soc_budget_remaining_cents(p_org_id UUID)
RETURNS INTEGER LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
    _cap   INTEGER;
    _spent INTEGER;
BEGIN
    SELECT COALESCE(ai_soc_daily_cap_cents, 0) INTO _cap
      FROM public.organizations WHERE id = p_org_id;
    IF _cap IS NULL OR _cap = 0 THEN RETURN 0; END IF;

    SELECT COALESCE(SUM(cost_cents), 0) INTO _spent
      FROM (
        SELECT cost_cents FROM public.ai_triage_decisions
         WHERE organization_id = p_org_id
           AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        UNION ALL
        SELECT cost_cents FROM public.ai_investigations
         WHERE organization_id = p_org_id
           AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
      ) t;

    RETURN GREATEST(_cap - _spent, 0);
END;
$fn$;

-- =============================================================================
-- Trigger: on new alert, fire ai-triage-alert via pg_net (best-effort)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fire_ai_triage_on_alert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
    _enabled   BOOLEAN;
    _remaining INTEGER;
    _fn_url    TEXT;
    _secret    TEXT;
BEGIN
    -- Skip silently if pg_net isn't installed.
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
        RETURN NEW;
    END IF;

    SELECT ai_soc_enabled INTO _enabled
      FROM public.organizations WHERE id = NEW.organization_id;
    IF _enabled IS NOT TRUE THEN
        RETURN NEW;
    END IF;

    SELECT public.ai_soc_budget_remaining_cents(NEW.organization_id) INTO _remaining;
    IF _remaining <= 0 THEN
        -- Record a stub so the dashboard shows we deliberately skipped.
        INSERT INTO public.ai_triage_decisions (alert_id, organization_id, status, error_message)
        VALUES (NEW.id, NEW.organization_id, 'budget_exceeded',
                'Daily AI SOC cost cap reached; auto-triage paused until 00:00 UTC.')
        ON CONFLICT (alert_id) DO NOTHING;
        RETURN NEW;
    END IF;

    SELECT value INTO _fn_url    FROM public.platform_settings WHERE key = 'ai_soc_triage_url';
    SELECT value INTO _secret    FROM public.platform_settings WHERE key = 'ai_soc_poll_secret';
    IF _fn_url IS NULL OR _fn_url = '' THEN
        RETURN NEW;
    END IF;

    -- Pre-create the pending row so the UI shows "triaging…" immediately.
    INSERT INTO public.ai_triage_decisions (alert_id, organization_id, status)
    VALUES (NEW.id, NEW.organization_id, 'pending')
    ON CONFLICT (alert_id) DO NOTHING;

    PERFORM net.http_post(
        url := _fn_url,
        headers := jsonb_build_object(
            'content-type', 'application/json',
            'x-mithras-soc-secret', COALESCE(_secret, '')
        ),
        body := jsonb_build_object('alert_id', NEW.id::text, 'trigger', 'auto')
    );
    RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_fire_ai_triage_on_alert ON public.alerts;
CREATE TRIGGER trg_fire_ai_triage_on_alert
    AFTER INSERT ON public.alerts
    FOR EACH ROW EXECUTE FUNCTION public.fire_ai_triage_on_alert();

-- =============================================================================
-- Trigger: when triage verdict=true_positive, fire ai-investigate-alert
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fire_ai_investigate_on_true_positive()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
    _remaining INTEGER;
    _fn_url    TEXT;
    _secret    TEXT;
BEGIN
    IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
    IF NEW.verdict <> 'true_positive' THEN RETURN NEW; END IF;
    IF NEW.confidence IS NULL OR NEW.confidence < 0.85 THEN RETURN NEW; END IF;
    IF NEW.escalated_to_investigation THEN RETURN NEW; END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
        RETURN NEW;
    END IF;

    SELECT public.ai_soc_budget_remaining_cents(NEW.organization_id) INTO _remaining;
    IF _remaining <= 0 THEN
        INSERT INTO public.ai_investigations (alert_id, organization_id, triage_decision_id, status, error_message)
        VALUES (NEW.alert_id, NEW.organization_id, NEW.id, 'budget_exceeded',
                'Daily AI SOC cost cap reached; investigation skipped.')
        ON CONFLICT (alert_id) DO NOTHING;
        RETURN NEW;
    END IF;

    SELECT value INTO _fn_url FROM public.platform_settings WHERE key = 'ai_soc_investigate_url';
    SELECT value INTO _secret FROM public.platform_settings WHERE key = 'ai_soc_poll_secret';
    IF _fn_url IS NULL OR _fn_url = '' THEN RETURN NEW; END IF;

    INSERT INTO public.ai_investigations (alert_id, organization_id, triage_decision_id, status)
    VALUES (NEW.alert_id, NEW.organization_id, NEW.id, 'pending')
    ON CONFLICT (alert_id) DO NOTHING;

    UPDATE public.ai_triage_decisions SET escalated_to_investigation = true WHERE id = NEW.id;

    PERFORM net.http_post(
        url := _fn_url,
        headers := jsonb_build_object(
            'content-type', 'application/json',
            'x-mithras-soc-secret', COALESCE(_secret, '')
        ),
        body := jsonb_build_object('alert_id', NEW.alert_id::text, 'trigger', 'auto')
    );
    RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_fire_ai_investigate ON public.ai_triage_decisions;
CREATE TRIGGER trg_fire_ai_investigate
    AFTER INSERT OR UPDATE OF status, verdict, confidence ON public.ai_triage_decisions
    FOR EACH ROW EXECUTE FUNCTION public.fire_ai_investigate_on_true_positive();

-- =============================================================================
-- Settings seed
-- =============================================================================
INSERT INTO public.platform_settings (key, value, description, is_secret) VALUES
    ('ai_soc_triage_url',       'http://supabase-edge-functions:9000/ai-triage-alert',
        'Internal URL the AI triage trigger posts to.', false),
    ('ai_soc_investigate_url',  'http://supabase-edge-functions:9000/ai-investigate-alert',
        'Internal URL the AI investigation trigger posts to.', false),
    ('ai_soc_poll_secret',      '',
        'Shared secret between Postgres triggers and the AI SOC edge functions.', true)
ON CONFLICT (key) DO NOTHING;
