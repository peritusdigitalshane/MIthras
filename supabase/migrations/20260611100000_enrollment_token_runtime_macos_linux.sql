-- Widen enrollment_tokens.runtime_hint to accept the new agent runtimes.
--
-- Original migrations (20260513120000 + 20260514100000) restricted the hint to
-- ('powershell','dotnet') back when only Windows agents existed. The new
-- macOS bash + launchd agent (agent/runtime-mac) and the Go-based Linux
-- agent (agent/runtime-linux) need to be mintable too, otherwise the
-- /deploy page Mac tab fails with `invalid_runtime_hint`.
--
-- agent-enroll already accepts ('powershell','dotnet','linux','macos') for
-- the runtime field — this aligns the mint path so the hint can travel
-- through enrollment_tokens cleanly.

BEGIN;

-- The column-level CHECK already accepts macos + linux + linux-go on prod
-- (manually widened earlier). Only the RPC validator was left at the
-- original ('powershell','dotnet') set. We keep this migration in case a
-- fresh dev DB only has the narrow original constraint — the IF NOT
-- EXISTS pattern + targeted re-add lets it apply cleanly either way.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'enrollment_tokens_runtime_hint_check'
           AND pg_get_constraintdef(oid) !~ 'macos'
    ) THEN
        ALTER TABLE public.enrollment_tokens
            DROP CONSTRAINT enrollment_tokens_runtime_hint_check;
        ALTER TABLE public.enrollment_tokens
            ADD CONSTRAINT enrollment_tokens_runtime_hint_check
            CHECK (runtime_hint IS NULL OR runtime_hint IN ('powershell','dotnet','linux','linux-go','macos'));
    END IF;
END
$$;

-- Replace the RPC validator. Function signature stays identical so the
-- frontend doesn't have to change.
CREATE OR REPLACE FUNCTION public.create_enrollment_token(
    p_org_id        uuid,
    p_runtime_hint  text DEFAULT 'powershell',
    p_channel       text DEFAULT 'stable',
    p_hostname_hint text DEFAULT NULL,
    p_max_uses      integer DEFAULT 1
)
RETURNS TABLE (token text, expires_at timestamptz, max_uses integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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

    IF p_runtime_hint NOT IN ('powershell','dotnet','linux','linux-go','macos') THEN
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

COMMIT;
