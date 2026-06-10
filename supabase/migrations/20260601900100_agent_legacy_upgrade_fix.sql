-- Fix: column reference "agent_secret" was ambiguous between the OUT param
-- and the endpoints column inside RETURN QUERY. Prefix OUT params with out_.

DROP FUNCTION IF EXISTS public.agent_legacy_upgrade(text, text);

CREATE OR REPLACE FUNCTION public.agent_legacy_upgrade(
    p_legacy_token text,
    p_api_base_url text DEFAULT 'https://api.mithras.com.au'
)
RETURNS TABLE (
    out_agent_id         uuid,
    out_agent_secret     text,
    out_api_base_url     text,
    out_already_upgraded boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_endpoint_id     uuid;
    v_existing_secret text;
    v_deleted_at      timestamptz;
    v_new_secret      text;
BEGIN
    IF p_legacy_token IS NULL OR length(trim(p_legacy_token)) = 0 THEN
        RAISE EXCEPTION 'missing_legacy_token' USING ERRCODE = 'invalid_parameter_value';
    END IF;

    SELECT id, agent_secret, deleted_at
      INTO v_endpoint_id, v_existing_secret, v_deleted_at
      FROM public.endpoints
     WHERE agent_token = p_legacy_token
     LIMIT 1;

    IF v_endpoint_id IS NULL THEN
        RAISE EXCEPTION 'token_not_found' USING ERRCODE = 'no_data_found';
    END IF;

    IF v_deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'endpoint_soft_deleted' USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    -- Idempotent: if already upgraded, return the existing secret.
    IF v_existing_secret IS NOT NULL AND length(v_existing_secret) > 0 THEN
        out_agent_id         := v_endpoint_id;
        out_agent_secret     := v_existing_secret;
        out_api_base_url     := p_api_base_url;
        out_already_upgraded := true;
        RETURN NEXT;
        RETURN;
    END IF;

    -- 32 random bytes -> 64-char lowercase hex
    v_new_secret := encode(gen_random_bytes(32), 'hex');

    UPDATE public.endpoints
       SET agent_secret = v_new_secret,
           runtime      = COALESCE(runtime, 'powershell'),
           is_active    = true
     WHERE id = v_endpoint_id;

    out_agent_id         := v_endpoint_id;
    out_agent_secret     := v_new_secret;
    out_api_base_url     := p_api_base_url;
    out_already_upgraded := false;
    RETURN NEXT;
END;
$fn$;

REVOKE ALL ON FUNCTION public.agent_legacy_upgrade(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_legacy_upgrade(text, text) TO service_role;

COMMENT ON FUNCTION public.agent_legacy_upgrade(text, text) IS
'Bootstrap HMAC credentials for a legacy bearer-token agent. Idempotent. Service-role only.';
