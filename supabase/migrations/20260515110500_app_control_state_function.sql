-- 20260515110500_app_control_state_function.sql
-- Returns a single jsonb merging all active rule-set assignments for an endpoint.
-- mode = strictest active mode (enforce > audit > off)
-- policy_version = stable hash of (rule_set_id, policy_version) pairs

CREATE OR REPLACE FUNCTION public.app_control_state_for_endpoint(p_endpoint_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH active AS (
    SELECT s.rule_set_id, s.current_mode, s.audit_until, rs.policy_version
    FROM public.endpoint_app_control_state s
    JOIN public.wdac_rule_sets rs ON rs.id = s.rule_set_id
    WHERE s.endpoint_id = p_endpoint_id
      AND rs.feature_enabled
      AND s.current_mode <> 'off'
  ),
  merged AS (
    SELECT
      CASE
        WHEN EXISTS (SELECT 1 FROM active WHERE current_mode = 'enforce') THEN 'enforce'
        WHEN EXISTS (SELECT 1 FROM active WHERE current_mode = 'audit')   THEN 'audit'
        ELSE 'off'
      END                                                                   AS mode,
      md5(COALESCE(string_agg(rule_set_id::text || ':' || policy_version::text, ',' ORDER BY rule_set_id), '')) AS pv,
      (SELECT min(audit_until) FROM active WHERE current_mode = 'audit')    AS audit_until,
      (SELECT jsonb_agg(jsonb_build_object('id', rule_set_id, 'mode', current_mode)) FROM active) AS rule_sets,
      (SELECT jsonb_agg(jsonb_build_object(
          'action',         r.action,
          'rule_type',      r.rule_type,
          'value',          r.value,
          'publisher_name', r.publisher_name,
          'product_name',   r.product_name,
          'file_version_min', r.file_version_min
        ))
        FROM public.wdac_rule_set_rules r
        WHERE r.rule_set_id IN (SELECT rule_set_id FROM active)
      )                                                                     AS rules
    FROM active
  )
  SELECT
    CASE WHEN EXISTS (SELECT 1 FROM active) THEN
      jsonb_build_object(
        'mode',                 mode,
        'policy_version',       pv,
        'audit_until',          audit_until,
        'observation_required', true,
        'rule_sets',            rule_sets,
        'rules',                COALESCE(rules, '[]'::jsonb)
      )
    ELSE NULL END
  INTO v_result
  FROM merged;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.app_control_state_for_endpoint(uuid) TO authenticated, service_role;
