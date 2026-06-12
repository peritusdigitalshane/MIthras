-- =============================================================================
-- AI SOC review fixes — schema half of the critical + high-priority pass.
--
-- The multi-agent review (wi68rw32q) surfaced four schema gaps:
--
--   1. ai_agent_actions has no way to audit a forceFire bypass. Any caller
--      with the service key (legitimate or otherwise) could pass force=true,
--      skip every consensus gate, and dispatch an isolate / kill / quarantine
--      with no caller-id record on the action row. Adds the audit columns.
--
--   2. agent_commands.correlation_id has no UNIQUE constraint. A rollback can
--      run twice (manual + cron, or customer-override + operator) and both
--      insert separate reversal commands with the same correlation_id. Adds a
--      partial UNIQUE index on the ai-* correlation_id prefix so the race
--      collapses to one row.
--
--   3. Forensic / Commander failures need a way to be flagged on
--      ai_triage_decisions so the platform-health scan can surface them
--      instead of leaving the alert apparently-resolved.
--
-- Note on Critical #3 (snapshot rollback can't read is_isolated): rather than
-- adding endpoints.is_isolated, the response/rollback functions are being
-- updated in this commit to use endpoints.isolation_mode as the source of
-- truth (it's already a NOT NULL text in {'notify_only','enforce'}). No new
-- column required — see the function changes.
-- =============================================================================

-- 1. forceFire audit columns + comms-failure pause for auto-rollback
ALTER TABLE public.ai_agent_actions
    ADD COLUMN IF NOT EXISTS override_caller_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS override_reason     text,
    ADD COLUMN IF NOT EXISTS force_fired         boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS comms_failed        boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS comms_failure_at    timestamptz,
    ADD COLUMN IF NOT EXISTS comms_failure_reason text;

COMMENT ON COLUMN public.ai_agent_actions.override_caller_id IS
    'When force_fired=true, the user_id of the operator who dispatched the override (null for service-key callers, which must also set override_reason).';
COMMENT ON COLUMN public.ai_agent_actions.override_reason IS
    'Free-text justification recorded at the time of a forceFire dispatch — required when force_fired=true.';

-- 2. Rollback double-dispatch race — UNIQUE on agent_commands.correlation_id
--    for the ai-resp-* / ai-rollback-* / ai-comms-* prefixes only.
DO $$ BEGIN
    CREATE UNIQUE INDEX agent_commands_ai_correlation_uniq
        ON public.agent_commands (correlation_id)
        WHERE correlation_id LIKE 'ai-%';
EXCEPTION
    WHEN duplicate_table THEN NULL;
    WHEN unique_violation THEN
        RAISE NOTICE 'Pre-existing ai-* correlation duplicates detected; UNIQUE not enforced. Investigate before re-running.';
END $$;

-- 3. Surface agent failures on the orchestrator decision row so the health
--    scan + dashboard can distinguish "agent ran cleanly and said maybe" from
--    "agent failed; downgraded the verdict silently".
ALTER TABLE public.ai_triage_decisions
    ADD COLUMN IF NOT EXISTS verification_failed boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS adversarial_failed  boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS investigation_failed boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS commander_failed     boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS agent_failure_detail text;

COMMENT ON COLUMN public.ai_triage_decisions.verification_failed IS
    'TRUE when ai-verify-triage returned non-OK or malformed JSON; the verdict was downgraded as a fail-safe.';
COMMENT ON COLUMN public.ai_triage_decisions.adversarial_failed IS
    'TRUE when ai-adversarial-check returned non-OK; consensus must NOT pass — adversarial failure is treated as "refuted" not "skipped".';
COMMENT ON COLUMN public.ai_triage_decisions.investigation_failed IS
    'TRUE when ai-investigate-alert was attempted but returned non-OK; the commander runs anyway with a stub investigation note.';
COMMENT ON COLUMN public.ai_triage_decisions.commander_failed IS
    'TRUE when ai-incident-commander returned non-OK; a minimal-fallback incident row is opened by the orchestrator so analysts can find the alert.';
