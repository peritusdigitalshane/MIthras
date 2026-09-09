-- 20260605050000_expire_stuck_commands_cron.sql
--
-- pg_cron job that auto-expires agent commands stuck in 'dispatched' state
-- longer than 15 minutes. The agent SLA is one heartbeat (≤30s on a
-- properly-running endpoint), so anything still dispatched after 15
-- minutes indicates either:
--   - the agent received it, ran it, then crashed or restarted before
--     reporting (common with upgrade_agent — the swap kills the agent)
--   - the agent went offline mid-execution
--   - a transient comms failure on the result-reporting side
-- Either way the row is dead; without auto-expiry it sits forever in the
-- UI as "Upgrade queued" and blocks future clicks against the same
-- endpoint until manual SQL intervention.
--
-- The 12-hour edge-fn outage on 2026-06-04 left 3 such commands stranded
-- (1 from 3 days earlier). This cron makes that self-healing.

CREATE OR REPLACE FUNCTION public.expire_stuck_agent_commands()
RETURNS TABLE (
    expired_count   integer,
    oldest_age_min  integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count integer;
    v_oldest interval;
BEGIN
    -- Capture the oldest BEFORE the UPDATE so the reported value is what
    -- triggered the sweep, not 'now'.
    SELECT now() - MIN(dispatched_at)
      INTO v_oldest
      FROM public.agent_commands
     WHERE status = 'dispatched'
       AND dispatched_at < now() - interval '15 minutes';

    WITH updated AS (
        UPDATE public.agent_commands
           SET status        = 'expired',
               completed_at  = now(),
               error_message = COALESCE(error_message,'') || ' [auto-expired by cron: dispatched > 15min, agent never reported back]'
         WHERE status        = 'dispatched'
           AND dispatched_at < now() - interval '15 minutes'
        RETURNING 1
    )
    SELECT count(*) INTO v_count FROM updated;

    RETURN QUERY SELECT v_count, COALESCE(EXTRACT(EPOCH FROM v_oldest)::int / 60, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stuck_agent_commands() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_stuck_agent_commands() TO service_role;

COMMENT ON FUNCTION public.expire_stuck_agent_commands() IS
'Auto-expires agent_commands stuck in dispatched > 15 min. Returns the '
'count expired and the oldest dispatched age that triggered the sweep. '
'Scheduled via pg_cron every 5 minutes (job name: mithras-expire-stuck-commands).';

-- Ensure agent_commands.status accepts 'expired'. The original CHECK
-- constraint may or may not include it depending on when the table was
-- created; re-issue idempotently.
DO $$
DECLARE
    has_expired boolean;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.agent_commands'::regclass
           AND contype = 'c'
           AND conname = 'agent_commands_status_check'
           AND pg_get_constraintdef(oid) ILIKE '%expired%'
    ) INTO has_expired;
    IF NOT has_expired THEN
        ALTER TABLE public.agent_commands
            DROP CONSTRAINT IF EXISTS agent_commands_status_check;
        ALTER TABLE public.agent_commands
            ADD CONSTRAINT agent_commands_status_check
            CHECK (status IN ('queued','dispatched','succeeded','failed','expired','cancelled'));
    END IF;
END $$;

-- Schedule it. pg_cron's cron.schedule is idempotent on (jobname).
SELECT cron.schedule(
    'mithras-expire-stuck-commands',
    '*/5 * * * *',
    $$SELECT public.expire_stuck_agent_commands();$$
);
