-- 20260616010000_tighten_email_sweep_cadence.sql
--
-- Drop the email-security sweep cadence from every 5 minutes to every 2.
-- The sweep function is watermark-driven (it polls Microsoft Graph for
-- messages received after `email_mailbox_sweeps.last_message_received_at`),
-- so a faster cron only changes detection latency — not total work. If a
-- mailbox has no new mail since the previous tick, the function returns
-- in O(1) per tenant. Steady-state LLM cost is unchanged; bursty mail
-- gets caught in 2 minutes instead of 5.
--
-- Tick budget remains 45s (SWEEP_BUDGET_MS in the function); concurrency
-- cap remains 5 (CLASSIFY_CONCURRENCY). Both are well below the worker
-- wall-clock limit even on a 2-minute cadence.

DO $$ BEGIN
    PERFORM cron.unschedule('mithras-email-security-sweep');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
    'mithras-email-security-sweep',
    '*/2 * * * *',  -- every 2 minutes (was every 5)
    $kick$SELECT public.kick_email_security_sweep();$kick$
);
