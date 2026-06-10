-- AI SOC multi-agent core (Phase 1 of the autonomous SOC roadmap).
--
-- The existing single-agent flow:
--   alert insert -> trigger -> ai-triage-alert -> ai_triage_decisions
--
-- New multi-agent flow:
--   alert insert -> trigger -> ai-soc-orchestrate -> (sequential)
--      1. ai-triage-alert      -> writes verdict to ai_agent_verdicts (agent='triage')
--      2. ai-verify-triage     -> independent verdict (different model/prompt)
--      3. ai-adversarial-check -> ONLY if triage=true_positive OR triage/verify disagree
--      4. consensus            -> orchestrator writes final_verdict/final_confidence
--                                 on ai_triage_decisions
--
-- The motivation: a single LLM hallucinates ~5% of the time and will confidently
-- mislabel a real attack as benign. Three independent agents with adversarial
-- review cut hallucination-driven errors by an order of magnitude. This is
-- the foundation of the "AI SOC with errors-and-omissions warranty" story.

BEGIN;

-- ============================================================================
-- 1. ai_agent_verdicts — one row per (triage_decision, agent_name)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ai_agent_verdicts (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    triage_decision_id   uuid NOT NULL REFERENCES public.ai_triage_decisions(id) ON DELETE CASCADE,
    alert_id             uuid NOT NULL REFERENCES public.alerts(id) ON DELETE CASCADE,
    organization_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    agent_name           text NOT NULL CHECK (agent_name IN ('triage','verification','adversarial')),

    -- Verdict semantics:
    --   For agent_name='triage' or 'verification':
    --     true_positive | false_positive | needs_human | inconclusive
    --   For agent_name='adversarial':
    --     refuted (= we successfully argued the verdict is wrong) | not_refuted
    verdict              text CHECK (
        verdict IN (
            'true_positive','false_positive','needs_human','inconclusive',
            'refuted','not_refuted'
        )
    ),
    confidence           numeric(3,2) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),

    -- Verification/Triage: same shape as ai_triage_decisions.summary/reasoning.
    -- Adversarial: summary is the strongest single refutation if refuted=true,
    -- or a short note on why no refutation could be made.
    summary              text,
    reasoning_steps      jsonb NOT NULL DEFAULT '[]'::jsonb,
    key_indicators       jsonb NOT NULL DEFAULT '[]'::jsonb,

    -- Adversarial-specific: structured list of attempted refutations even if
    -- the final verdict was not_refuted, so we can see what was considered.
    refutations          jsonb NOT NULL DEFAULT '[]'::jsonb,

    -- LLM accounting
    model                text,
    prompt_tokens        integer,
    completion_tokens    integer,
    cost_microcents      bigint NOT NULL DEFAULT 0,
    latency_ms           integer,
    raw_response         jsonb,
    error_message        text,

    created_at           timestamptz NOT NULL DEFAULT now(),

    -- One verdict per (alert, agent). Re-runs (force=true) UPSERT this row.
    UNIQUE (triage_decision_id, agent_name)
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_verdicts_alert
    ON public.ai_agent_verdicts (alert_id);
CREATE INDEX IF NOT EXISTS idx_ai_agent_verdicts_org_created
    ON public.ai_agent_verdicts (organization_id, created_at DESC);

ALTER TABLE public.ai_agent_verdicts ENABLE ROW LEVEL SECURITY;

-- Read: org members of the org that owns the alert, plus super-admins.
DROP POLICY IF EXISTS ai_agent_verdicts_member_read ON public.ai_agent_verdicts;
CREATE POLICY ai_agent_verdicts_member_read ON public.ai_agent_verdicts
    FOR SELECT TO authenticated
    USING (
        public.is_member_of_org(auth.uid(), organization_id)
        OR public.is_super_admin(auth.uid())
    );

-- Write: service role only. Agents run via service-role JWT, never directly
-- from end users.
DROP POLICY IF EXISTS ai_agent_verdicts_service_write ON public.ai_agent_verdicts;
CREATE POLICY ai_agent_verdicts_service_write ON public.ai_agent_verdicts
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ============================================================================
-- 2. ai_triage_decisions — add consensus columns
-- ============================================================================
--
-- Triage continues to write verdict/confidence as before (those are now
-- specifically "the triage agent's view"). The orchestrator writes the
-- consensus fields after all agents have voted.

ALTER TABLE public.ai_triage_decisions
    ADD COLUMN IF NOT EXISTS final_verdict        text,
    ADD COLUMN IF NOT EXISTS final_confidence     numeric(3,2),
    ADD COLUMN IF NOT EXISTS disagreement_detected boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS adversarial_refuted  boolean,
    ADD COLUMN IF NOT EXISTS consensus_reasoning  text,
    ADD COLUMN IF NOT EXISTS orchestration_state  text NOT NULL DEFAULT 'pending';

-- final_verdict reuses the same enum as verdict.
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ai_triage_decisions_final_verdict_check'
    ) THEN
        ALTER TABLE public.ai_triage_decisions
            ADD CONSTRAINT ai_triage_decisions_final_verdict_check
            CHECK (final_verdict IS NULL OR final_verdict IN (
                'true_positive','false_positive','needs_human','inconclusive'
            ));
    END IF;
END $$;

-- orchestration_state lifecycle:
--   pending     -> triage in progress
--   triaged     -> triage done, verification queued
--   verified    -> verification done, adversarial queued (or skipped)
--   completed   -> consensus computed and written
--   failed      -> orchestration aborted
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ai_triage_decisions_orchestration_state_check'
    ) THEN
        ALTER TABLE public.ai_triage_decisions
            ADD CONSTRAINT ai_triage_decisions_orchestration_state_check
            CHECK (orchestration_state IN ('pending','triaged','verified','completed','failed','budget_exceeded'));
    END IF;
END $$;

-- ============================================================================
-- 3. Update the alert-trigger to call the orchestrator instead of ai-triage-alert
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fire_ai_soc_orchestrate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net
AS $$
DECLARE
    v_url      text;
    v_secret   text;
    v_enabled  boolean;
BEGIN
    -- Per-org gate: ai_soc_enabled. Match the existing toggle behaviour
    -- so flipping the org-level switch off also turns off the new flow.
    SELECT (settings->>'ai_soc_enabled')::boolean INTO v_enabled
      FROM public.organizations
     WHERE id = NEW.organization_id;
    IF v_enabled IS DISTINCT FROM true THEN
        RETURN NEW;
    END IF;

    -- Look up the function URL + secret from platform_settings, same place
    -- the legacy ai-triage trigger reads from.
    SELECT value INTO v_url
      FROM public.platform_settings
     WHERE key = 'ai_soc_functions_base_url';
    IF v_url IS NULL OR v_url = '' THEN
        v_url := 'http://supabase-edge-functions:9000/functions/v1';
    END IF;
    v_url := rtrim(v_url, '/') || '/ai-soc-orchestrate';

    SELECT value INTO v_secret
      FROM public.platform_settings
     WHERE key = 'ai_soc_poll_secret';
    IF v_secret IS NULL THEN
        v_secret := '';
    END IF;

    PERFORM net.http_post(
        url     := v_url,
        headers := jsonb_build_object(
            'content-type',          'application/json',
            'x-mithras-soc-secret',  v_secret
        ),
        body    := jsonb_build_object('alert_id', NEW.id),
        timeout_milliseconds := 5000  -- fire-and-forget; orchestrator does the long work
    );

    RETURN NEW;
END;
$$;

-- Swap the trigger from the old function to the new one. Keep the old function
-- around so we can flip back if something goes wrong with v1 of multi-agent.
DROP TRIGGER IF EXISTS trg_fire_ai_triage ON public.alerts;
DROP TRIGGER IF EXISTS trg_fire_ai_soc_orchestrate ON public.alerts;
CREATE TRIGGER trg_fire_ai_soc_orchestrate
    AFTER INSERT ON public.alerts
    FOR EACH ROW
    EXECUTE FUNCTION public.fire_ai_soc_orchestrate();

COMMIT;
