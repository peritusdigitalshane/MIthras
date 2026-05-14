-- create_enrollment_token RPC — used by the Agent Download "Modern (Service)" UI
-- to mint a one-time agent enrolment token without the client having to know
-- the schema of enrollment_tokens. SECURITY DEFINER so we can run with
-- elevated rights for the INSERT while still enforcing the admin check ourselves.

CREATE OR REPLACE FUNCTION public.create_enrollment_token(
    p_org_id uuid,
    p_runtime_hint text DEFAULT 'powershell',
    p_channel text DEFAULT 'stable',
    p_hostname_hint text DEFAULT NULL
)
RETURNS TABLE(token text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_token text;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
    END IF;

    IF NOT public.is_admin_of_org(v_caller, p_org_id) THEN
        RAISE EXCEPTION 'forbidden_not_admin' USING ERRCODE = '42501';
    END IF;

    IF p_runtime_hint NOT IN ('powershell','dotnet') THEN
        RAISE EXCEPTION 'invalid_runtime_hint' USING ERRCODE = '22023';
    END IF;

    IF p_channel NOT IN ('stable','beta','canary') THEN
        RAISE EXCEPTION 'invalid_channel' USING ERRCODE = '22023';
    END IF;

    -- pgcrypto lives in the `extensions` schema (Supabase convention).
    -- We don't include it in search_path so we qualify it explicitly.
    v_token := encode(extensions.gen_random_bytes(24), 'hex');

    INSERT INTO public.enrollment_tokens (
        token, organization_id, created_by, runtime_hint, channel, hostname_hint
    ) VALUES (
        v_token, p_org_id, v_caller, p_runtime_hint, p_channel, p_hostname_hint
    );

    RETURN QUERY
    SELECT v_token, (now() + interval '7 days');
END;
$$;

REVOKE ALL ON FUNCTION public.create_enrollment_token(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_enrollment_token(uuid, text, text, text) TO authenticated;
