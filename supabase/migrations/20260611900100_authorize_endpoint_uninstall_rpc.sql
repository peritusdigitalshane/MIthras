-- RPC: authorize_endpoint_uninstall(endpoint_id, reason)
--
-- Authorised path for decommissioning an endpoint from the SOC UI. Verifies
-- the caller is an admin of the endpoint's org (or a super-admin), stamps
-- the endpoint row with the authorisation, queues an uninstall_self command
-- for the agent to pick up on next heartbeat, and writes an activity_log
-- entry for audit.

CREATE OR REPLACE FUNCTION public.authorize_endpoint_uninstall(
    p_endpoint_id uuid,
    p_reason      text
)
RETURNS uuid    -- command id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_org_id     uuid;
    v_user_id    uuid := auth.uid();
    v_hostname   text;
    v_command_id uuid;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'unauthenticated';
    END IF;

    IF p_endpoint_id IS NULL THEN
        RAISE EXCEPTION 'endpoint_id required';
    END IF;

    IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
        RAISE EXCEPTION 'reason required';
    END IF;
    IF length(p_reason) > 500 THEN
        RAISE EXCEPTION 'reason too long (max 500 chars)';
    END IF;

    SELECT organization_id, hostname
    INTO v_org_id, v_hostname
    FROM public.endpoints
    WHERE id = p_endpoint_id;

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'endpoint not found';
    END IF;

    -- Auth: org admin OR super-admin.
    IF NOT (public.is_admin_of_org(v_user_id, v_org_id) OR public.is_super_admin(v_user_id)) THEN
        RAISE EXCEPTION 'permission denied';
    END IF;

    -- Stamp the endpoint row.
    UPDATE public.endpoints
    SET uninstall_authorized_at = NOW(),
        uninstall_authorized_by = v_user_id,
        uninstall_reason        = p_reason
    WHERE id = p_endpoint_id;

    -- Queue the agent command. expires_at defaults to NOW()+24h so the
    -- agent has a day to come online and pick it up before it lapses.
    INSERT INTO public.agent_commands (
        endpoint_id, organization_id, command_type, params, issued_by
    ) VALUES (
        p_endpoint_id, v_org_id, 'uninstall_self',
        jsonb_build_object('reason', p_reason),
        v_user_id
    )
    RETURNING id INTO v_command_id;

    -- Audit. log_activity is the canonical activity_logs writer; it already
    -- enforces who-can-write-what at the function layer.
    PERFORM public.log_activity(
        v_org_id,
        'endpoint.uninstall_authorized',
        jsonb_build_object(
            'endpoint_id', p_endpoint_id,
            'hostname',    v_hostname,
            'reason',      p_reason,
            'command_id',  v_command_id
        )
    );

    RETURN v_command_id;
END;
$$;

REVOKE ALL ON FUNCTION public.authorize_endpoint_uninstall(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.authorize_endpoint_uninstall(uuid, text) TO authenticated;
