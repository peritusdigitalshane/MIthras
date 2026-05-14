-- 20260515110550_app_control_migration_followups.sql
-- Follow-ups from code-quality review of Phase 1 app-control migrations:
--   1. Add missing INSERT policy on endpoint_app_control_state so org admins
--      can perform direct inserts (manual re-seed, backfill). The agent-driven
--      write path goes through SECURITY DEFINER triggers and is unaffected.
--   2. Replace per-row PL/pgSQL loops in the group-assignment and
--      group-membership trigger functions with set-based INSERT...SELECT
--      ...ON CONFLICT DO NOTHING. Scales to large groups without per-row
--      lock contention or PL/pgSQL overhead.
--
-- Trigger A (endpoint→rule_set, single-row) is left unchanged; it still uses
-- the upsert_app_control_state_for_endpoint_rule_set helper, which is also
-- left in place.

-- --------------------------------------------------------------------------
-- Issue 1: admin INSERT policy on endpoint_app_control_state
-- --------------------------------------------------------------------------

CREATE POLICY "Admins insert endpoint_app_control_state"
  ON public.endpoint_app_control_state FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.endpoints e
    WHERE e.id = endpoint_app_control_state.endpoint_id
      AND public.is_admin_of_org(auth.uid(), e.organization_id)
  ));

-- --------------------------------------------------------------------------
-- Issue 2a: set-based body for trigger B (group_rule_set_assignments)
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_group_rule_set_assignment_state()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_window_days int;
BEGIN
  SELECT audit_window_days INTO v_window_days
  FROM public.wdac_rule_sets WHERE id = NEW.rule_set_id;
  IF v_window_days IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.endpoint_app_control_state (endpoint_id, rule_set_id, audit_until, current_mode)
  SELECT egm.endpoint_id,
         NEW.rule_set_id,
         now() + (v_window_days || ' days')::interval,
         'audit'
  FROM public.endpoint_group_memberships egm
  WHERE egm.group_id = NEW.group_id
  ON CONFLICT (endpoint_id, rule_set_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- --------------------------------------------------------------------------
-- Issue 2b: set-based body for trigger C (endpoint_group_memberships)
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_endpoint_group_membership_state()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.endpoint_app_control_state (endpoint_id, rule_set_id, audit_until, current_mode)
  SELECT NEW.endpoint_id,
         gra.rule_set_id,
         now() + (rs.audit_window_days || ' days')::interval,
         'audit'
  FROM public.group_rule_set_assignments gra
  JOIN public.wdac_rule_sets rs ON rs.id = gra.rule_set_id
  WHERE gra.group_id = NEW.group_id
  ON CONFLICT (endpoint_id, rule_set_id) DO NOTHING;

  RETURN NEW;
END;
$$;
