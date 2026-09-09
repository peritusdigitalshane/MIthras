-- 20260616020000_platform_locks.sql
--
-- Lightweight named mutex used by edge functions that don't want to race
-- themselves. Postgres has pg_advisory_lock, but advisory locks are bound
-- to a Postgres session — and a Supabase edge function uses a transient
-- PostgREST request per call, so the session lifetime doesn't span the
-- function invocation cleanly. A table-row TTL'd mutex sidesteps the issue
-- and is easier to reason about.
--
-- Used by m365-email-sweep on every tick. At a 2-minute pg_cron cadence
-- with a 45-second per-tick budget, runs shouldn't overlap — but a hung
-- Graph call or a slow LLM batch could push past the budget. Without this
-- mutex, the next tick would re-read the unchanged watermark and pay for
-- duplicate LLM classifications on the in-flight mailbox.

CREATE TABLE IF NOT EXISTS public.platform_locks (
    lock_name   text PRIMARY KEY,
    acquired_at timestamptz NOT NULL DEFAULT now(),
    holder      text,        -- free-form caller identifier for debugging
    ttl_seconds integer NOT NULL DEFAULT 120
);

REVOKE ALL ON public.platform_locks FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.platform_locks TO service_role;

-- try_acquire_platform_lock — returns TRUE if the caller is now the
-- exclusive holder of <name>, FALSE if another holder is still inside
-- their TTL window. Stale locks (acquired_at + ttl_seconds < now) are
-- auto-released so a crashed function doesn't permanently wedge the
-- mutex.
CREATE OR REPLACE FUNCTION public.try_acquire_platform_lock(
    _name        text,
    _ttl_seconds integer DEFAULT 120,
    _holder      text    DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_existing record;
BEGIN
    SELECT lock_name, acquired_at, ttl_seconds
      INTO v_existing
      FROM public.platform_locks
     WHERE lock_name = _name
     FOR UPDATE;

    IF NOT FOUND THEN
        INSERT INTO public.platform_locks (lock_name, ttl_seconds, holder)
        VALUES (_name, _ttl_seconds, _holder);
        RETURN TRUE;
    END IF;

    -- Auto-release stale locks. A run that crashes (worker SIGKILL,
    -- network blip, OOM) won't get to release_platform_lock, so the
    -- TTL is the only thing that frees the mutex. make_interval avoids
    -- the integer-vs-text coercion of `N || ' seconds'`.
    IF v_existing.acquired_at + make_interval(secs => v_existing.ttl_seconds) < now() THEN
        UPDATE public.platform_locks
           SET acquired_at = now(),
               ttl_seconds = _ttl_seconds,
               holder      = _holder
         WHERE lock_name = _name;
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.try_acquire_platform_lock(text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_acquire_platform_lock(text, integer, text) TO service_role;

CREATE OR REPLACE FUNCTION public.release_platform_lock(_name text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    DELETE FROM public.platform_locks WHERE lock_name = _name;
$$;

REVOKE EXECUTE ON FUNCTION public.release_platform_lock(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_platform_lock(text) TO service_role;
