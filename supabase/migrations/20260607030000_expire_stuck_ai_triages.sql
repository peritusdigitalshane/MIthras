-- AI triage stuck-row reaper.
--
-- ai_triage_decisions rows go status='pending' the moment the alert is
-- claimed by the function. They transition to 'completed' or 'failed' on
-- normal return. If the deno isolate is killed mid-call (wall-clock
-- ceiling, container restart, OOM), the row sits 'pending' forever — no
-- cleanup exists, the LLM cost has been spent (or not), and the UI
-- shows the alert as still being analysed for days.
--
-- This mirrors the pattern already in place for agent_commands —
-- `mithras-expire-stuck-commands` reaps anything that hasn't completed
-- inside a sane wall-clock budget. Same idea, different table.
--
-- The triage function's LLM call is ~45s max (AbortSignal.timeout in
-- _shared/ai-llm.ts), plus a few seconds of DB ops on either side. We
-- treat anything still 'pending' after 5 minutes as definitively stuck.

CREATE OR REPLACE FUNCTION public.expire_stuck_ai_triages()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_count int := 0;
BEGIN
    UPDATE public.ai_triage_decisions
       SET status        = 'failed',
           error_message = coalesce(error_message, 'expired_by_reaper: pending > 5 min'),
           completed_at  = now()
     WHERE status     = 'pending'
       AND created_at < now() - interval '5 minutes';

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$function$;

-- Same idea for investigations — they ride the same deno isolate so the
-- same failure mode applies.
CREATE OR REPLACE FUNCTION public.expire_stuck_ai_investigations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_count int := 0;
BEGIN
    UPDATE public.ai_investigations
       SET status        = 'failed',
           error_message = coalesce(error_message, 'expired_by_reaper: pending > 10 min'),
           completed_at  = now()
     WHERE status     = 'pending'
       AND created_at < now() - interval '10 minutes';

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$function$;

-- One reaper cron, fires every 5 minutes, handles both surfaces.
SELECT cron.schedule(
    'mithras-expire-stuck-ai-analysis',
    '*/5 * * * *',
    $$SELECT public.expire_stuck_ai_triages(), public.expire_stuck_ai_investigations();$$
);

-- One-time cleanup for the rows already stuck when this migration runs.
SELECT public.expire_stuck_ai_triages();
SELECT public.expire_stuck_ai_investigations();
