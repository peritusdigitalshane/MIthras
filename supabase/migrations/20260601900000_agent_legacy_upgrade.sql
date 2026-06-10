-- agent_legacy_upgrade: bootstrap HMAC credentials for a legacy bearer-token
-- agent so it can be migrated to the modular Mithras runtime without
-- creating a duplicate endpoint row.
--
-- Returns { agent_id, agent_secret, api_base_url } when the legacy token
-- matches an active endpoint that hasn't already been upgraded. The
-- generated secret is returned to the caller exactly once -- it is not
-- retrievable thereafter (the column stores it plain to allow HMAC verify,
-- but server-side never logs it).
--
-- Auth model: the legacy token IS the auth. Anyone with the token already
-- has full agent-API access via the legacy /agent-api/* routes; this RPC
-- doesn't widen the blast radius. The wrapping edge function
-- (/agent-legacy-upgrade) checks the X-Agent-Token header and forwards.

CREATE OR REPLACE FUNCTION public.agent_legacy_upgrade(
    p_legacy_token text,
    p_api_base_url text DEFAULT 'https://api.mithras.com.au'
)
RETURNS TABLE (
    agent_id       uuid,
    agent_secret   text,
    api_base_url   text,
    already_upgraded boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_endpoint   RECORD;
    v_new_secret text;
BEGIN
    IF p_legacy_token IS NULL OR length(trim(p_legacy_token)) = 0 THEN
        RAISE EXCEPTION 'missing_legacy_token' USING ERRCODE = 'invalid_parameter_value';
    END IF;

    SELECT id, agent_secret, deleted_at, is_active
      INTO v_endpoint
      FROM public.endpoints
     WHERE agent_token = p_legacy_token
     LIMIT 1;

    IF v_endpoint IS NULL OR v_endpoint.id IS NULL THEN
        RAISE EXCEPTION 'token_not_found' USING ERRCODE = 'no_data_found';
    END IF;

    IF v_endpoint.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'endpoint_soft_deleted' USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    -- Idempotent: if already upgraded, do NOT rotate -- the agent already
    -- has the secret on disk. Return the existing one so a re-running install
    -- script still succeeds. (already_upgraded=true so the caller can log it.)
    IF v_endpoint.agent_secret IS NOT NULL AND length(v_endpoint.agent_secret) > 0 THEN
        RETURN QUERY
        SELECT v_endpoint.id, v_endpoint.agent_secret, p_api_base_url, true;
        RETURN;
    END IF;

    -- 32 random bytes -> 64-char lowercase hex
    v_new_secret := encode(gen_random_bytes(32), 'hex');

    UPDATE public.endpoints
       SET agent_secret = v_new_secret,
           runtime      = COALESCE(runtime, 'powershell'),
           is_active    = true
     WHERE id = v_endpoint.id;

    RETURN QUERY
    SELECT v_endpoint.id, v_new_secret, p_api_base_url, false;
END;
$fn$;

-- This function should NOT be exposed to the broad authenticated/anon roles
-- via PostgREST. It's called only by the agent-legacy-upgrade edge function,
-- which uses the service role to invoke it. Grant only to service_role.
REVOKE ALL ON FUNCTION public.agent_legacy_upgrade(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_legacy_upgrade(text, text) TO service_role;

COMMENT ON FUNCTION public.agent_legacy_upgrade(text, text) IS
'Bootstrap HMAC credentials for a legacy bearer-token agent. Idempotent. Service-role only.';
