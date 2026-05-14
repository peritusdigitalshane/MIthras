-- App-Control Phase 1 — extend_app_control_audit RPC
-- Adds extra audit-window days to every device assigned to a rule set, and
-- forces them back into 'audit' mode (in case any had been promoted early).
-- Caller must be admin/owner of the rule set's organization.

CREATE OR REPLACE FUNCTION public.extend_app_control_audit(
  p_rule_set_id uuid,
  p_extra_days  int
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- Caller must be admin of the org owning the rule set.
  IF NOT EXISTS (
    SELECT 1 FROM public.wdac_rule_sets rs
    WHERE rs.id = p_rule_set_id
      AND public.is_admin_of_org(auth.uid(), rs.organization_id)
  ) THEN
    RAISE EXCEPTION 'forbidden_not_admin' USING ERRCODE = '42501';
  END IF;

  UPDATE public.endpoint_app_control_state
     SET audit_until = audit_until + (p_extra_days || ' days')::interval,
         current_mode = 'audit'
   WHERE rule_set_id = p_rule_set_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.extend_app_control_audit(uuid, int) TO authenticated;
