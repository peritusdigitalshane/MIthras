-- get_microseg_unmatched_traffic: aggregates inbound firewall_audit_logs that
-- did NOT match any tracked rule (rule_id IS NULL), grouped by (local_port,
-- protocol). Powers the "Other inbound traffic" panel on the microseg
-- dashboard so operators can see what's hitting the box on ports they haven't
-- written rules for, and one-click promote any port to a tracked rule.
--
-- Returns at most TOP_LIMIT rows ordered by 7d hit count.

CREATE OR REPLACE FUNCTION public.get_microseg_unmatched_traffic(
    p_org_id   uuid,
    p_top_limit int DEFAULT 50
)
RETURNS TABLE (
    local_port          integer,
    protocol            text,
    hits_24h            bigint,
    hits_7d             bigint,
    unique_sources_24h  bigint,
    unique_sources_7d   bigint,
    unique_endpoints_7d bigint,
    last_seen           timestamptz,
    sample_service_name text,
    top_sources         jsonb
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
    SELECT
      l.local_port,
      lower(coalesce(l.protocol, 'tcp')) AS protocol,
      l.remote_address,
      l.endpoint_id,
      l.event_time,
      l.service_name
    FROM public.firewall_audit_logs l
    WHERE l.organization_id = p_org_id
      AND l.rule_id IS NULL
      AND l.direction = 'inbound'
      AND l.event_time >= now() - interval '7 days'
      AND EXISTS (SELECT 1 FROM allowed)
  ),
  per_source AS (
    SELECT local_port, protocol, remote_address, COUNT(*) AS hits
    FROM recent
    GROUP BY local_port, protocol, remote_address
  ),
  top_sources AS (
    SELECT
      local_port, protocol,
      jsonb_agg(
        jsonb_build_object('ip', remote_address, 'count', hits)
        ORDER BY hits DESC
      ) FILTER (WHERE rn <= 5) AS sources
    FROM (
      SELECT
        local_port, protocol, remote_address, hits,
        ROW_NUMBER() OVER (PARTITION BY local_port, protocol ORDER BY hits DESC) AS rn
      FROM per_source
    ) ranked
    GROUP BY local_port, protocol
  ),
  base AS (
    SELECT
      r.local_port,
      r.protocol,
      COUNT(*) FILTER (WHERE r.event_time >= now() - interval '24 hours')                            AS hits_24h,
      COUNT(*)                                                                                       AS hits_7d,
      COUNT(DISTINCT r.remote_address) FILTER (WHERE r.event_time >= now() - interval '24 hours')    AS unique_sources_24h,
      COUNT(DISTINCT r.remote_address)                                                               AS unique_sources_7d,
      COUNT(DISTINCT r.endpoint_id)                                                                  AS unique_endpoints_7d,
      MAX(r.event_time)                                                                              AS last_seen,
      -- Pick a representative service_name (agent-side label e.g. "MySQL", "HTTPS-Alt")
      (array_agg(r.service_name ORDER BY r.event_time DESC) FILTER (WHERE r.service_name IS NOT NULL))[1] AS sample_service_name
    FROM recent r
    GROUP BY r.local_port, r.protocol
  )
  SELECT
    b.local_port,
    b.protocol,
    b.hits_24h,
    b.hits_7d,
    b.unique_sources_24h,
    b.unique_sources_7d,
    b.unique_endpoints_7d,
    b.last_seen,
    b.sample_service_name,
    COALESCE(ts.sources, '[]'::jsonb) AS top_sources
  FROM base b
  LEFT JOIN top_sources ts ON ts.local_port = b.local_port AND ts.protocol = b.protocol
  ORDER BY b.hits_7d DESC, b.last_seen DESC NULLS LAST
  LIMIT p_top_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_microseg_unmatched_traffic(uuid, int) TO authenticated;
