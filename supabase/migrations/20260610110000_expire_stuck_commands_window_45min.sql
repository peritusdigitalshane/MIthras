-- Bump the expire-stuck cron window from 15 to 45 minutes.
--
-- Originally 15min was fine — every command type returned in seconds
-- after dispatch. install_updates (v0.7.12+) drives a Windows Update
-- install that can legitimately take 5–30 minutes; with the new
-- agent-side background-job model the agent keeps heartbeating but the
-- command stays 'dispatched' until the job finishes. A 15-min sweep
-- would auto-expire it during a normal long install.
--
-- 45min covers a worst-case WUA install + agent heartbeat latency,
-- and still cleans up genuinely stuck commands (upgrade_agent that
-- never came back, agent went offline mid-execution) in a reasonable
-- window.

CREATE OR REPLACE FUNCTION public.expire_stuck_agent_commands()
RETURNS TABLE (
    expired_count   integer,
    oldest_age_min  integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_count  integer;
    v_oldest interval;
BEGIN
    SELECT now() - MIN(dispatched_at)
      INTO v_oldest
      FROM public.agent_commands
     WHERE status = 'dispatched'
       AND dispatched_at < now() - interval '45 minutes';

    WITH updated AS (
        UPDATE public.agent_commands
           SET status        = 'expired',
               completed_at  = now(),
               error_message = COALESCE(error_message,'') || ' [auto-expired by cron: dispatched > 45min, agent never reported back]'
         WHERE status        = 'dispatched'
           AND dispatched_at < now() - interval '45 minutes'
        RETURNING 1
    )
    SELECT count(*) INTO v_count FROM updated;

    RETURN QUERY SELECT v_count, COALESCE(EXTRACT(EPOCH FROM v_oldest)::int / 60, 0);
END;
$$;
