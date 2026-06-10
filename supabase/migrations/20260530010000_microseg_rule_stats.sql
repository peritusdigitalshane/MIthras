-- Per-rule microsegmentation aggregates: 24h + 7d hit counts, unique sources,
-- daily sparkline buckets, top 5 sources. Returns one row per audit/enforce rule
-- the caller's org owns. Org membership is checked by joining through the
-- existing helper, so the function is safe to expose via PostgREST as an RPC.

CREATE OR REPLACE FUNCTION public.get_microseg_rule_stats(p_org_id uuid)
RETURNS TABLE (
  rule_id             uuid,
  hits_24h            bigint,
  hits_7d             bigint,
  unique_sources_24h  bigint,
  unique_sources_7d   bigint,
  unique_endpoints_7d bigint,
  last_seen           timestamptz,
  top_sources         jsonb,
  hits_by_day         jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH allowed AS (
    SELECT 1
    WHERE public.is_member_of_org(auth.uid(), p_org_id)
       OR public.is_super_admin(auth.uid())
  ),
  org_rules AS (
    SELECT fsr.id
    FROM public.firewall_service_rules fsr
    JOIN public.firewall_policies fp ON fp.id = fsr.policy_id
    WHERE fp.organization_id = p_org_id
      AND EXISTS (SELECT 1 FROM allowed)
  ),
  recent AS (
    SELECT
      l.rule_id,
      l.remote_address,
      l.endpoint_id,
      l.event_time
    FROM public.firewall_audit_logs l
    WHERE l.organization_id = p_org_id
      AND l.rule_id IS NOT NULL
      AND l.rule_id IN (SELECT id FROM org_rules)
      AND l.event_time >= now() - interval '7 days'
      AND EXISTS (SELECT 1 FROM allowed)
  ),
  per_source AS (
    SELECT rule_id, remote_address, COUNT(*) AS hits
    FROM recent
    GROUP BY rule_id, remote_address
  ),
  top_sources AS (
    SELECT
      rule_id,
      jsonb_agg(
        jsonb_build_object('ip', remote_address, 'count', hits)
        ORDER BY hits DESC
      ) FILTER (WHERE rn <= 5) AS sources
    FROM (
      SELECT
        rule_id,
        remote_address,
        hits,
        ROW_NUMBER() OVER (PARTITION BY rule_id ORDER BY hits DESC) AS rn
      FROM per_source
    ) ranked
    GROUP BY rule_id
  ),
  per_day AS (
    SELECT
      rule_id,
      to_char(date_trunc('day', event_time), 'YYYY-MM-DD') AS day,
      COUNT(*) AS hits
    FROM recent
    GROUP BY rule_id, date_trunc('day', event_time)
  ),
  days_by_rule AS (
    SELECT
      rule_id,
      jsonb_agg(jsonb_build_object('day', day, 'count', hits) ORDER BY day) AS days
    FROM per_day
    GROUP BY rule_id
  ),
  base AS (
    SELECT
      r.id AS rule_id,
      COUNT(*) FILTER (WHERE rc.event_time >= now() - interval '24 hours')   AS hits_24h,
      COUNT(rc.*)                                                            AS hits_7d,
      COUNT(DISTINCT rc.remote_address) FILTER (WHERE rc.event_time >= now() - interval '24 hours') AS unique_sources_24h,
      COUNT(DISTINCT rc.remote_address)                                      AS unique_sources_7d,
      COUNT(DISTINCT rc.endpoint_id)                                         AS unique_endpoints_7d,
      MAX(rc.event_time)                                                     AS last_seen
    FROM org_rules r
    LEFT JOIN recent rc ON rc.rule_id = r.id
    GROUP BY r.id
  )
  SELECT
    b.rule_id,
    b.hits_24h,
    b.hits_7d,
    b.unique_sources_24h,
    b.unique_sources_7d,
    b.unique_endpoints_7d,
    b.last_seen,
    COALESCE(ts.sources, '[]'::jsonb) AS top_sources,
    COALESCE(d.days, '[]'::jsonb)     AS hits_by_day
  FROM base b
  LEFT JOIN top_sources ts ON ts.rule_id = b.rule_id
  LEFT JOIN days_by_rule d ON d.rule_id = b.rule_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_microseg_rule_stats(uuid) TO authenticated;

-- Per-endpoint breakdown for one rule (used by the drill-in dialog).
CREATE OR REPLACE FUNCTION public.get_microseg_rule_endpoint_breakdown(
  p_org_id uuid,
  p_rule_id uuid
)
RETURNS TABLE (
  endpoint_id      uuid,
  hostname         text,
  hits_7d          bigint,
  unique_sources   bigint,
  last_seen        timestamptz,
  top_sources      jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH allowed AS (
    SELECT 1
    WHERE public.is_member_of_org(auth.uid(), p_org_id)
       OR public.is_super_admin(auth.uid())
  ),
  recent AS (
    SELECT l.endpoint_id, l.remote_address, l.event_time
    FROM public.firewall_audit_logs l
    WHERE l.organization_id = p_org_id
      AND l.rule_id = p_rule_id
      AND l.event_time >= now() - interval '7 days'
      AND EXISTS (SELECT 1 FROM allowed)
  ),
  per_source AS (
    SELECT endpoint_id, remote_address, COUNT(*) AS hits
    FROM recent
    GROUP BY endpoint_id, remote_address
  ),
  top_sources AS (
    SELECT
      endpoint_id,
      jsonb_agg(
        jsonb_build_object('ip', remote_address, 'count', hits)
        ORDER BY hits DESC
      ) FILTER (WHERE rn <= 3) AS sources
    FROM (
      SELECT
        endpoint_id,
        remote_address,
        hits,
        ROW_NUMBER() OVER (PARTITION BY endpoint_id ORDER BY hits DESC) AS rn
      FROM per_source
    ) ranked
    GROUP BY endpoint_id
  )
  SELECT
    r.endpoint_id,
    COALESCE(e.hostname, 'Unknown') AS hostname,
    COUNT(*)                        AS hits_7d,
    COUNT(DISTINCT r.remote_address) AS unique_sources,
    MAX(r.event_time)               AS last_seen,
    COALESCE(ts.sources, '[]'::jsonb) AS top_sources
  FROM recent r
  LEFT JOIN public.endpoints e ON e.id = r.endpoint_id
  LEFT JOIN top_sources ts ON ts.endpoint_id = r.endpoint_id
  GROUP BY r.endpoint_id, e.hostname, ts.sources
  ORDER BY COUNT(*) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_microseg_rule_endpoint_breakdown(uuid, uuid) TO authenticated;

-- Add IP to allowed_source_ips array (deduped). Used by the one-click
-- "Allow this source" popover.
CREATE OR REPLACE FUNCTION public.firewall_rule_allow_source(
  p_rule_id uuid,
  p_ip text
)
RETURNS public.firewall_service_rules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_rule   public.firewall_service_rules;
BEGIN
  SELECT fp.organization_id INTO v_org_id
  FROM public.firewall_service_rules fsr
  JOIN public.firewall_policies fp ON fp.id = fsr.policy_id
  WHERE fsr.id = p_rule_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Rule not found';
  END IF;

  IF NOT (public.is_admin_of_org(auth.uid(), v_org_id) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'Not authorised to modify rules in this organisation';
  END IF;

  IF p_ip IS NULL OR length(trim(p_ip)) = 0 THEN
    RAISE EXCEPTION 'IP cannot be empty';
  END IF;

  UPDATE public.firewall_service_rules
  SET allowed_source_ips = (
    SELECT array_agg(DISTINCT ip)
    FROM unnest(COALESCE(allowed_source_ips, ARRAY[]::text[]) || ARRAY[trim(p_ip)]) AS ip
  )
  WHERE id = p_rule_id
  RETURNING * INTO v_rule;

  RETURN v_rule;
END;
$$;

GRANT EXECUTE ON FUNCTION public.firewall_rule_allow_source(uuid, text) TO authenticated;
