-- 20260515120200_app_control_state_rings.sql
-- Replace app_control_state_for_endpoint to honour wdac_rule_set_rings overrides.

CREATE OR REPLACE FUNCTION public.app_control_state_for_endpoint(p_endpoint_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH active AS (
    -- Base rows: what endpoint_app_control_state says for this endpoint.
    SELECT s.rule_set_id, s.current_mode, s.audit_until, rs.policy_version
    FROM public.endpoint_app_control_state s
    JOIN public.wdac_rule_sets rs ON rs.id = s.rule_set_id
    WHERE s.endpoint_id = p_endpoint_id
      AND rs.feature_enabled
      AND s.current_mode <> 'off'
  ),
  ring_override AS (
    -- Per rule_set, pick the ring with the lowest ring_order that the endpoint
    -- belongs to (DISTINCT ON guarantees one row per rule_set_id).
    SELECT DISTINCT ON (r.rule_set_id)
      r.rule_set_id,
      r.mode AS ring_mode
    FROM public.wdac_rule_set_rings r
    JOIN public.endpoint_group_memberships m ON m.group_id = r.group_id
    WHERE m.endpoint_id = p_endpoint_id
      AND r.rule_set_id IN (SELECT rule_set_id FROM active)
    ORDER BY r.rule_set_id, r.ring_order ASC
  ),
  effective AS (
    -- Merge: ring mode overrides base mode when a ring exists.
    SELECT
      a.rule_set_id,
      COALESCE(ro.ring_mode, a.current_mode) AS effective_mode,
      a.audit_until,
      a.policy_version
    FROM active a
    LEFT JOIN ring_override ro ON ro.rule_set_id = a.rule_set_id
    WHERE COALESCE(ro.ring_mode, a.current_mode) <> 'off'
  ),
  merged AS (
    SELECT
      CASE
        WHEN EXISTS (SELECT 1 FROM effective WHERE effective_mode = 'enforce') THEN 'enforce'
        WHEN EXISTS (SELECT 1 FROM effective WHERE effective_mode = 'audit')   THEN 'audit'
        ELSE 'off'
      END                                                                          AS mode,
      md5(COALESCE(string_agg(rule_set_id::text || ':' || policy_version::text, ',' ORDER BY rule_set_id), '')) AS pv,
      (SELECT min(audit_until) FROM effective WHERE effective_mode = 'audit')      AS audit_until,
      (SELECT jsonb_agg(jsonb_build_object('id', rule_set_id, 'mode', effective_mode)) FROM effective) AS rule_sets,
      (SELECT jsonb_agg(jsonb_build_object(
          'action',           r.action,
          'rule_type',        r.rule_type,
          'value',            r.value,
          'publisher_name',   r.publisher_name,
          'product_name',     r.product_name,
          'file_version_min', r.file_version_min
        ))
        FROM public.wdac_rule_set_rules r
        WHERE r.rule_set_id IN (SELECT rule_set_id FROM effective)
      )                                                                            AS rules
    FROM effective
  )
  SELECT
    CASE WHEN EXISTS (SELECT 1 FROM effective) THEN
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
