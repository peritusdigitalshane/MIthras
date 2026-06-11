-- Retire the pg_net-based AI SOC orchestration path.
--
-- The trigger + cron pattern attempted to invoke /functions/v1/ai-soc-orchestrate
-- via pg_net, but pg_net's HTTP timeout cap on this Supabase build cuts the
-- connection at ~5s — long enough for Triage to land its verdict but too short
-- for Verification + Adversarial + Comms to finish. Same orchestrator invoked
-- from outside Postgres (any caller that holds the connection open the full
-- 15-90s the chain needs) completes correctly.
--
-- The replacement is the standalone Deno worker container at
-- infra/peritus-ai-soc-worker/ (deployed to docker02 at
-- /opt/peritus-ai-soc-worker/). It polls for pending alerts every 15s and
-- POSTs to the orchestrator with wait=true over plain fetch().
--
-- This migration removes the dead-code legacy that the worker replaces:
--   - cron job `ai-soc-orchestrate-pending` (every-30-second pg_net cron)
--   - function `process_pending_ai_orchestrations()` (cron's body)
--   - function `fire_ai_soc_orchestrate()` (alerts INSERT trigger body)
-- The trigger itself was dropped earlier in the debugging cycle.

-- Idempotent: cron.unschedule throws if the job doesn't exist, so guard it.
DO $$
BEGIN
    PERFORM cron.unschedule('ai-soc-orchestrate-pending');
EXCEPTION WHEN OTHERS THEN
    NULL;  -- job already gone
END $$;

DROP FUNCTION IF EXISTS public.process_pending_ai_orchestrations();
DROP FUNCTION IF EXISTS public.fire_ai_soc_orchestrate();
