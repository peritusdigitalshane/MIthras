-- 20260515110400_app_control_policy_version_trigger.sql
-- Bump wdac_rule_sets.policy_version whenever a rule in wdac_rule_set_rules changes.

CREATE OR REPLACE FUNCTION public.trg_bump_rule_set_policy_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_target uuid;
BEGIN
  v_target := COALESCE(NEW.rule_set_id, OLD.rule_set_id);
  UPDATE public.wdac_rule_sets
     SET policy_version = policy_version + 1,
         updated_at     = now()
   WHERE id = v_target;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_rule_set_policy_version ON public.wdac_rule_set_rules;
CREATE TRIGGER trg_bump_rule_set_policy_version
  AFTER INSERT OR UPDATE OR DELETE ON public.wdac_rule_set_rules
  FOR EACH ROW EXECUTE FUNCTION public.trg_bump_rule_set_policy_version();
