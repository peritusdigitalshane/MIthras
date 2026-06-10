-- 20260604010000_endpoint_isolation_mode.sql
--
-- Per-endpoint isolation mode. Safe-by-default: every endpoint defaults to
-- 'notify_only' so a stray Isolate click can't take a real customer machine
-- offline before the operator has built confidence in the response flow.
-- The operator flips a per-endpoint radio to 'enforce' when they're ready.
--
-- The agent (v0.7.2+) reads the mode from the isolate_network command's
-- params. The frontend's enqueue path looks up the endpoint's current mode
-- and embeds it; if missing (older clients), the agent falls back to
-- 'notify_only' for safety.

ALTER TABLE public.endpoints
    ADD COLUMN IF NOT EXISTS isolation_mode TEXT NOT NULL DEFAULT 'notify_only'
    CHECK (isolation_mode IN ('notify_only', 'enforce'));

COMMENT ON COLUMN public.endpoints.isolation_mode IS
'Per-endpoint isolate_network behaviour. notify_only (default) logs and '
'alerts what would have been blocked without changing the firewall. '
'enforce applies the real outbound block + allow-list. Honoured by agent '
'v0.7.2+. Older agents always enforce.';
