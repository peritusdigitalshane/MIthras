-- 20260605020000_cancel_agent_command_rpc.sql
--
-- SECURITY DEFINER RPC for cancelling a queued / dispatched agent command.
--
-- Browser-side .update() on agent_commands was silently denied (the table
-- has SELECT + INSERT + service-role policies but no user-facing UPDATE).
-- Operators clicking Cancel in RemoteAccessCard's in-flight UI saw a
-- success toast while the command stayed queued and the agent executed
-- it on the next heartbeat. This RPC fixes the cancel path without
-- opening a broad UPDATE policy on a security-sensitive table.
--
-- Authorization:
--   - super admin, OR
--   - admin/owner of the command's organization (NOT regular members - same
--     bar as enqueue_agent_command).
--
-- Refuses to cancel commands that already terminated (succeeded, failed,
-- expired, cancelled). Returns true if a row was actually transitioned.

CREATE OR REPLACE FUNCTION public.cancel_agent_command(p_command_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org_id uuid;
    v_status text;
    v_uid    uuid := auth.uid();
    v_can    boolean := false;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'unauthenticated';
    END IF;

    SELECT organization_id, status
      INTO v_org_id, v_status
      FROM public.agent_commands
     WHERE id = p_command_id;

    IF v_org_id IS NULL THEN
        RETURN false;  -- not found OR caller can't read; either way nothing to do
    END IF;

    -- Authorize: super admin, OR org admin/owner
    IF public.is_super_admin(v_uid) THEN
        v_can := true;
    ELSE
        SELECT EXISTS(
            SELECT 1 FROM public.organization_memberships
            WHERE user_id = v_uid
              AND organization_id = v_org_id
              AND role IN ('admin','owner')
        ) INTO v_can;
    END IF;

    IF NOT v_can THEN
        RAISE EXCEPTION 'forbidden';
    END IF;

    -- Only cancel if still pre-terminal. The conditional UPDATE returns
    -- 0 rows for already-terminal commands; FOUND captures that.
    UPDATE public.agent_commands
       SET status        = 'cancelled',
           completed_at  = now(),
           error_message = COALESCE(error_message, 'Cancelled by operator')
     WHERE id = p_command_id
       AND status IN ('queued','dispatched');

    RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_agent_command(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_agent_command(uuid) TO authenticated;

COMMENT ON FUNCTION public.cancel_agent_command(uuid) IS
'Cancel a queued or dispatched agent command. Returns true if a row was '
'transitioned, false if the command was already terminal or not found. '
'Callable by super-admins and the command''s-org admins/owners only.';
