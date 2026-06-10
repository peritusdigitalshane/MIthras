-- Allow a single enrolment token to be reused for up to N endpoints (RMM
-- deployment use-case: one token in your RMM script body, N machines enrol).
--
-- 1. Add max_uses + use_count columns (default keeps the old single-use behaviour).
-- 2. Update create_enrollment_token RPC to accept p_max_uses.
-- 3. Add reserve_enrollment_slot RPC — RACE-FREE atomic increment.
-- 4. (agent-enroll function calls reserve_enrollment_slot.)

ALTER TABLE public.enrollment_tokens
  ADD COLUMN IF NOT EXISTS max_uses  integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS use_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.enrollment_tokens
  DROP CONSTRAINT IF EXISTS enrollment_tokens_max_uses_check;
ALTER TABLE public.enrollment_tokens
  ADD  CONSTRAINT enrollment_tokens_max_uses_check
       CHECK (max_uses >= 1 AND max_uses <= 1000);

-- Backfill: any pre-existing single-use token with used_at set already had its
-- one slot consumed; reflect that in use_count for consistency.
UPDATE public.enrollment_tokens
   SET use_count = 1
 WHERE used_at IS NOT NULL
   AND use_count = 0;

-- ---------------------------------------------------------------------------
-- Updated create_enrollment_token: extra p_max_uses parameter.
-- DROP the old 4-arg signature so callers transparently pick up the new one.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_enrollment_token(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.create_enrollment_token(
    p_org_id        uuid,
    p_runtime_hint  text DEFAULT 'powershell',
    p_channel       text DEFAULT 'stable',
    p_hostname_hint text DEFAULT NULL,
    p_max_uses      integer DEFAULT 1
)
RETURNS TABLE(token text, expires_at timestamptz, max_uses integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_token  text;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
    END IF;

    IF NOT (public.is_admin_of_org(v_caller, p_org_id) OR public.is_super_admin(v_caller)) THEN
        RAISE EXCEPTION 'forbidden_not_admin' USING ERRCODE = '42501';
    END IF;

    IF p_runtime_hint NOT IN ('powershell','dotnet') THEN
        RAISE EXCEPTION 'invalid_runtime_hint' USING ERRCODE = '22023';
    END IF;

    IF p_channel NOT IN ('stable','beta','canary') THEN
        RAISE EXCEPTION 'invalid_channel' USING ERRCODE = '22023';
    END IF;

    IF p_max_uses IS NULL OR p_max_uses < 1 OR p_max_uses > 1000 THEN
        RAISE EXCEPTION 'invalid_max_uses' USING ERRCODE = '22023';
    END IF;

    v_token := encode(extensions.gen_random_bytes(24), 'hex');

    INSERT INTO public.enrollment_tokens (
        token, organization_id, created_by, runtime_hint, channel, hostname_hint, max_uses
    ) VALUES (
        v_token, p_org_id, v_caller, p_runtime_hint, p_channel, p_hostname_hint, p_max_uses
    );

    RETURN QUERY
    SELECT v_token, (now() + interval '7 days'), p_max_uses;
END;
$$;

REVOKE ALL ON FUNCTION public.create_enrollment_token(uuid, text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_enrollment_token(uuid, text, text, text, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- reserve_enrollment_slot: atomic slot reservation.
-- Returns the updated row on success, NULL when the token is exhausted/expired.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reserve_enrollment_slot(p_token text)
RETURNS TABLE(
    organization_id uuid,
    runtime_hint    text,
    channel         text,
    hostname_hint   text,
    use_count       integer,
    max_uses        integer,
    expires_at      timestamptz,
    used_at         timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_now timestamptz := now();
BEGIN
    -- One atomic UPDATE: bump use_count only if (not expired AND still has slots).
    RETURN QUERY
    UPDATE public.enrollment_tokens et
       SET use_count = et.use_count + 1,
           used_at   = CASE WHEN et.use_count + 1 >= et.max_uses THEN v_now ELSE et.used_at END
     WHERE et.token = p_token
       AND et.expires_at > v_now
       AND et.use_count < et.max_uses
    RETURNING et.organization_id, et.runtime_hint, et.channel, et.hostname_hint,
              et.use_count, et.max_uses, et.expires_at, et.used_at;
END;
$$;

-- Only the service_role (used by the agent-enroll edge function) needs this.
REVOKE ALL ON FUNCTION public.reserve_enrollment_slot(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_enrollment_slot(text) TO service_role;
