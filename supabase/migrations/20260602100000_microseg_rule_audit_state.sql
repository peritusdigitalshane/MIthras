-- Per-rule audit window control for microsegmentation.
--
-- `audit_started_at` is the "begin counting from" timestamp for a rule's
-- learning window. Clicking Restart on the microseg dashboard sets this to
-- now(), which makes the dashboard show only NEW hits since the operator
-- decided to start a fresh observation period -- without throwing away
-- the historical firewall_audit_logs (which other features still need).
--
-- Backfill: existing rules get the value of created_at so their dashboard
-- numbers don't suddenly jump after this migration applies.

ALTER TABLE public.firewall_service_rules
    ADD COLUMN IF NOT EXISTS audit_started_at TIMESTAMPTZ;

UPDATE public.firewall_service_rules
   SET audit_started_at = COALESCE(audit_started_at, created_at);

ALTER TABLE public.firewall_service_rules
    ALTER COLUMN audit_started_at SET DEFAULT now(),
    ALTER COLUMN audit_started_at SET NOT NULL;

COMMENT ON COLUMN public.firewall_service_rules.audit_started_at IS
'Baseline timestamp for the current learning window. Reset via the dashboard "Restart audit" action; hits before this point are excluded from rule stats.';

-- Rebuild get_microseg_rule_stats so it filters by audit_started_at as a lower
-- bound (on top of the existing 24h / 7d windows). Effect: when the operator
-- clicks Restart, the dashboard counts drop to 0 and grow from there.
DROP FUNCTION IF EXISTS public.get_microseg_rule_stats(uuid);

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
  hits_by_day         jsonb,
  audit_started_at    timestamptz
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
    SELECT fsr.id, fsr.audit_started_at
    FROM public.firewall_service_rules fsr
    JOIN public.firewall_policies fp ON fp.id = fsr.policy_id
    WHERE fp.organization_id = p_org_id
      AND EXISTS (SELECT 1 FROM allowed)
  ),
  -- Recent firewall logs, but ONLY those after each rule's audit baseline.
  recent AS (
    SELECT
      l.rule_id,
      l.remote_address,
      l.endpoint_id,
      l.event_time
    FROM public.firewall_audit_logs l
    JOIN org_rules r ON r.id = l.rule_id
    WHERE l.organization_id = p_org_id
      AND l.rule_id IS NOT NULL
      AND l.event_time >= now() - interval '7 days'
      AND l.event_time >= r.audit_started_at
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
      r.audit_started_at,
      COUNT(*) FILTER (WHERE rc.event_time >= now() - interval '24 hours')   AS hits_24h,
      COUNT(rc.*)                                                            AS hits_7d,
      COUNT(DISTINCT rc.remote_address) FILTER (WHERE rc.event_time >= now() - interval '24 hours') AS unique_sources_24h,
      COUNT(DISTINCT rc.remote_address)                                      AS unique_sources_7d,
      COUNT(DISTINCT rc.endpoint_id)                                         AS unique_endpoints_7d,
      MAX(rc.event_time)                                                     AS last_seen
    FROM org_rules r
    LEFT JOIN recent rc ON rc.rule_id = r.id
    GROUP BY r.id, r.audit_started_at
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
    COALESCE(d.days, '[]'::jsonb)     AS hits_by_day,
    b.audit_started_at
  FROM base b
  LEFT JOIN top_sources ts ON ts.rule_id = b.rule_id
  LEFT JOIN days_by_rule d ON d.rule_id = b.rule_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_microseg_rule_stats(uuid) TO authenticated;
