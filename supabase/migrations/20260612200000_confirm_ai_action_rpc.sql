-- confirm_ai_action(p_action_id) — in-app counterpart to the customer's
-- one-click "Confirm action" email link. Cancels the auto-rollback timer,
-- moves the action to 'customer_confirmed', stamps customer_confirmed_at.
--
-- Authorisation: caller must either
--   * be a super-admin (cross-tenant), or
--   * be an org admin of the action's owning organisation
--
-- The action must currently be in 'executed' state with no prior rollback.

CREATE OR REPLACE FUNCTION public.confirm_ai_action(p_action_id uuid)
RETURNS TABLE(action_id uuid, status text, customer_confirmed_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller   uuid := auth.uid();
    v_action   public.ai_agent_actions%ROWTYPE;
    v_org_id   uuid;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'auth_required' USING ERRCODE = '28000';
    END IF;

    SELECT * INTO v_action FROM public.ai_agent_actions WHERE id = p_action_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'action_not_found' USING ERRCODE = 'P0002';
    END IF;

    IF v_action.status NOT IN ('executed') THEN
        RAISE EXCEPTION 'action_not_confirmable' USING ERRCODE = '22023';
    END IF;
    IF v_action.rolled_back_at IS NOT NULL OR v_action.customer_overrode_at IS NOT NULL THEN
        RAISE EXCEPTION 'action_already_finalised' USING ERRCODE = '22023';
    END IF;

    -- Resolve the action's org via its triage_decision → alert chain.
    SELECT a.organization_id INTO v_org_id
    FROM public.ai_triage_decisions t
    JOIN public.alerts a ON a.id = t.alert_id
    WHERE t.id = v_action.triage_decision_id;

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'org_resolution_failed' USING ERRCODE = '22023';
    END IF;

    IF NOT (public.is_super_admin(v_caller) OR public.is_admin_of_org(v_caller, v_org_id)) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    UPDATE public.ai_agent_actions
       SET status                = 'customer_confirmed',
           customer_confirmed_at = now(),
           rollback_at           = NULL
     WHERE id = p_action_id;

    RETURN QUERY
        SELECT p_action_id, 'customer_confirmed'::text, now()::timestamptz;
END
$$;

REVOKE ALL ON FUNCTION public.confirm_ai_action(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.confirm_ai_action(uuid) TO authenticated;
