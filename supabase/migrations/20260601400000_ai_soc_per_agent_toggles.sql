-- Split the single `ai_soc_enabled` boolean into per-agent toggles.
--
-- The MSP tiering model needs more granularity than "all AI SOC on or
-- all off". Concrete use cases the user described:
--   - Customer A: only triage runs; human reviews + decides escalation
--   - Customer B: triage + auto-investigation
--   - Customer C: full autonomy (future — auto-response actions)
--
-- New columns:
--   ai_triage_enabled         — gates the AI Triage Agent on alert insert
--   ai_investigation_enabled  — gates the AI Investigation Agent on a
--                               true_positive triage decision (also
--                               requires ai_triage_enabled implicitly,
--                               because without triage there's no
--                               escalation path)
--
-- ai_soc_enabled is kept for one release as a *generated* convenience
-- column ("any agent enabled") so existing queries don't break, but the
-- trigger logic now reads only the per-agent flags. Drop the column in
-- a follow-up once the dashboard is fully migrated.
--
-- Auto-response action execution is NOT shipped yet. A future
-- `ai_auto_response_enabled` will land alongside that agent.

-- =============================================================================
-- 1. Add the new columns; default off.
-- =============================================================================
ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS ai_triage_enabled         BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS ai_investigation_enabled  BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.ai_triage_enabled IS
    'When true, every new alert in this org is automatically triaged by the AI Triage Agent. Replaces ai_soc_enabled.';
COMMENT ON COLUMN public.organizations.ai_investigation_enabled IS
    'When true, true_positive triage decisions (confidence >= 0.85) automatically escalate to the AI Investigation Agent. Has no effect unless ai_triage_enabled is also true.';

-- =============================================================================
-- 2. Migrate existing data: any org currently on under the master flag
--    gets BOTH agents on (matches current behaviour exactly).
-- =============================================================================
UPDATE public.organizations
   SET ai_triage_enabled        = true,
       ai_investigation_enabled = true
 WHERE ai_soc_enabled = true
   AND ai_triage_enabled = false;     -- idempotent — won't clobber later UI changes

-- =============================================================================
-- 3. Rewrite the triage trigger to read the per-agent flag.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fire_ai_triage_on_alert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
    _enabled   BOOLEAN;
    _remaining INTEGER;
    _fn_url    TEXT;
    _secret    TEXT;
BEGIN
    IF NEW.organization_id IS NULL THEN RETURN NEW; END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
        RETURN NEW;
    END IF;

    SELECT ai_triage_enabled INTO _enabled
      FROM public.organizations WHERE id = NEW.organization_id;
    IF _enabled IS NOT TRUE THEN RETURN NEW; END IF;

    SELECT public.ai_soc_budget_remaining_cents(NEW.organization_id) INTO _remaining;
    IF _remaining <= 0 THEN
        INSERT INTO public.ai_triage_decisions (alert_id, organization_id, status, error_message)
        VALUES (NEW.id, NEW.organization_id, 'budget_exceeded',
                'Daily AI SOC cost cap reached; auto-triage paused until 00:00 UTC.')
        ON CONFLICT (alert_id) DO NOTHING;
        RETURN NEW;
    END IF;

    SELECT value INTO _fn_url FROM public.platform_settings WHERE key = 'ai_soc_triage_url';
    SELECT value INTO _secret FROM public.platform_settings WHERE key = 'ai_soc_poll_secret';
    IF _fn_url IS NULL OR _fn_url = '' THEN RETURN NEW; END IF;

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

-- =============================================================================
-- 4. Rewrite the investigation trigger to read the per-agent flag.
--    Implicit requirement: triage must also be on, but that's already
--    enforced by the verdict-based escalation — no triage row means no
--    fire on this trigger.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fire_ai_investigate_on_true_positive()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
    _enabled   BOOLEAN;
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

    -- Per-agent gate: investigation must be opted-in for this org.
    SELECT ai_investigation_enabled INTO _enabled
      FROM public.organizations WHERE id = NEW.organization_id;
    IF _enabled IS NOT TRUE THEN
        -- Mark the triage row as "would have escalated but investigation
        -- agent is off for this org" — leaves an audit trail without
        -- silently dropping the signal.
        UPDATE public.ai_triage_decisions
           SET escalated_to_investigation = false,
               review_notes = COALESCE(review_notes, '') ||
                              CASE WHEN review_notes IS NULL OR review_notes = ''
                                   THEN '[system] '
                                   ELSE ' [system] '
                              END ||
                              'Investigation agent disabled for this org; human escalation required.'
         WHERE id = NEW.id;
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

-- =============================================================================
-- 5. Sync ai_soc_enabled to match — for now it's a derived "any agent
--    enabled" boolean kept for compatibility with the dashboard counter
--    queries. Updated by trigger whenever either per-agent flag changes.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.sync_ai_soc_enabled()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
BEGIN
    NEW.ai_soc_enabled := (NEW.ai_triage_enabled OR NEW.ai_investigation_enabled);
    RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_sync_ai_soc_enabled ON public.organizations;
CREATE TRIGGER trg_sync_ai_soc_enabled
    BEFORE INSERT OR UPDATE OF ai_triage_enabled, ai_investigation_enabled
        ON public.organizations
    FOR EACH ROW EXECUTE FUNCTION public.sync_ai_soc_enabled();

-- One-time backfill so existing rows reflect the new derivation.
UPDATE public.organizations
   SET ai_soc_enabled = (ai_triage_enabled OR ai_investigation_enabled)
 WHERE ai_soc_enabled <> (ai_triage_enabled OR ai_investigation_enabled);
