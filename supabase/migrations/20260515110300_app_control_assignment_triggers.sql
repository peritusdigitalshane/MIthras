-- 20260515110300_app_control_assignment_triggers.sql
-- When an endpoint becomes assigned to a rule set (direct or via group),
-- ensure an endpoint_app_control_state row exists.

CREATE OR REPLACE FUNCTION public.upsert_app_control_state_for_endpoint_rule_set(
  p_endpoint_id uuid,
  p_rule_set_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_window_days int;
BEGIN
  SELECT audit_window_days INTO v_window_days
  FROM public.wdac_rule_sets WHERE id = p_rule_set_id;
  IF v_window_days IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.endpoint_app_control_state (endpoint_id, rule_set_id, audit_until, current_mode)
  VALUES (p_endpoint_id, p_rule_set_id, now() + (v_window_days || ' days')::interval, 'audit')
  ON CONFLICT (endpoint_id, rule_set_id) DO NOTHING;
END;
$$;

-- Trigger A: direct endpoint→rule_set assignment.
CREATE OR REPLACE FUNCTION public.trg_endpoint_rule_set_assignment_state()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.upsert_app_control_state_for_endpoint_rule_set(NEW.endpoint_id, NEW.rule_set_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_endpoint_rule_set_assignment_state ON public.endpoint_rule_set_assignments;
CREATE TRIGGER trg_endpoint_rule_set_assignment_state
  AFTER INSERT ON public.endpoint_rule_set_assignments
  FOR EACH ROW EXECUTE FUNCTION public.trg_endpoint_rule_set_assignment_state();

-- Trigger B: group→rule_set assignment. Expand to every endpoint in the group.
CREATE OR REPLACE FUNCTION public.trg_group_rule_set_assignment_state()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_endpoint_id uuid;
BEGIN
  FOR v_endpoint_id IN
    SELECT endpoint_id FROM public.endpoint_group_memberships WHERE group_id = NEW.group_id
  LOOP
    PERFORM public.upsert_app_control_state_for_endpoint_rule_set(v_endpoint_id, NEW.rule_set_id);
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_group_rule_set_assignment_state ON public.group_rule_set_assignments;
CREATE TRIGGER trg_group_rule_set_assignment_state
  AFTER INSERT ON public.group_rule_set_assignments
  FOR EACH ROW EXECUTE FUNCTION public.trg_group_rule_set_assignment_state();

-- Trigger C: when an endpoint joins a group, expand to all rule sets assigned to that group.
CREATE OR REPLACE FUNCTION public.trg_endpoint_group_membership_state()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rule_set_id uuid;
BEGIN
  FOR v_rule_set_id IN
    SELECT rule_set_id FROM public.group_rule_set_assignments WHERE group_id = NEW.group_id
  LOOP
    PERFORM public.upsert_app_control_state_for_endpoint_rule_set(NEW.endpoint_id, v_rule_set_id);
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_endpoint_group_membership_state ON public.endpoint_group_memberships;
CREATE TRIGGER trg_endpoint_group_membership_state
  AFTER INSERT ON public.endpoint_group_memberships
  FOR EACH ROW EXECUTE FUNCTION public.trg_endpoint_group_membership_state();
