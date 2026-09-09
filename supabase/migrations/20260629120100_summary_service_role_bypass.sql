-- =========================================================================
-- 2026-06-29 — Allow service_role to call build_org_period_summary
--
-- The customer-report generator runs as service_role inside the edge
-- function. The RPC's auth gate (added 2026-06-13) only allowed
-- super-admin / org-member / partner-admin, so the generator has been
-- returning "forbidden" for every queued row and silently marking them
-- failed. Cron-driven monthly customer reports therefore never produced
-- HTML or PDF artefacts.
--
-- Fix: same service_role bypass we use on the M365 Shield RPCs (see
-- 20260629100000_rls_audit_m365_rpcs.sql). service_role calls are
-- already authenticated as the platform, so the org-scoping argument
-- comes from the caller (the edge function) which is trusted.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.build_org_period_summary(
    p_org           uuid,
    p_period_start  timestamptz,
    p_period_end    timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    out                       jsonb;

    v_endpoints_total         int;
    v_endpoints_online        int;

    v_threats_in_period       int;
    v_threats_severe          int;

    v_incidents_opened        int;
    v_incidents_resolved      int;
    v_incidents_open_now      int;

    v_vulns_open              int;
    v_vulns_critical          int;

    v_top_incidents           jsonb;
    v_top_software            jsonb;

    v_m365_enabled            boolean;
    v_m365_users_total        int;
    v_m365_users_mfa          int;
    v_m365_mfa_pct            numeric;
    v_m365_admins_at_risk     int;
    v_m365_breach_unack       int;
    v_m365_breach_new         int;
    v_m365_oauth_high_risk    int;
    v_m365_anonymous_shares   int;
BEGIN
    IF NOT (
        auth.role() = 'service_role'
        OR public.is_super_admin(auth.uid())
        OR public.is_member_of_org(auth.uid(), p_org)
        OR public.is_partner_admin_of_org(auth.uid(), p_org)
    ) THEN
        RAISE EXCEPTION 'forbidden';
    END IF;

    SELECT count(*)::int INTO v_endpoints_total
      FROM public.endpoints
     WHERE organization_id = p_org AND is_active = true;
    SELECT count(*)::int INTO v_endpoints_online
      FROM public.endpoints
     WHERE organization_id = p_org
       AND is_active = true
       AND last_seen_at > now() - interval '24 hours';

    SELECT count(*)::int INTO v_threats_in_period
      FROM public.endpoint_threats et
      JOIN public.endpoints e ON e.id = et.endpoint_id
     WHERE e.organization_id = p_org
       AND COALESCE(et.initial_detection_time, et.created_at) >= p_period_start
       AND COALESCE(et.initial_detection_time, et.created_at) <  p_period_end;
    SELECT count(*)::int INTO v_threats_severe
      FROM public.endpoint_threats et
      JOIN public.endpoints e ON e.id = et.endpoint_id
     WHERE e.organization_id = p_org
       AND COALESCE(et.initial_detection_time, et.created_at) >= p_period_start
       AND COALESCE(et.initial_detection_time, et.created_at) <  p_period_end
       AND et.severity = 'Severe';

    SELECT count(*)::int INTO v_incidents_opened
      FROM public.incidents
     WHERE organization_id = p_org
       AND created_at >= p_period_start
       AND created_at <  p_period_end;
    SELECT count(*)::int INTO v_incidents_resolved
      FROM public.incidents
     WHERE organization_id = p_org
       AND resolved_at IS NOT NULL
       AND resolved_at >= p_period_start
       AND resolved_at <  p_period_end;
    SELECT count(*)::int INTO v_incidents_open_now
      FROM public.incidents
     WHERE organization_id = p_org
       AND resolved_at IS NULL;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'opened_at', created_at,
              'severity',  severity,
              'title',     title,
              'status',    COALESCE(status, 'open')
           ) ORDER BY created_at DESC), '[]'::jsonb)
      INTO v_top_incidents
      FROM (
          SELECT created_at, severity, title, status
            FROM public.incidents
           WHERE organization_id = p_org
             AND created_at >= p_period_start
             AND created_at <  p_period_end
           ORDER BY created_at DESC
           LIMIT 10
      ) recent_incidents;

    SELECT count(*)::int INTO v_vulns_open
      FROM public.vulnerability_findings
     WHERE organization_id = p_org AND status = 'open';
    SELECT count(*)::int INTO v_vulns_critical
      FROM public.vulnerability_findings
     WHERE organization_id = p_org
       AND status = 'open'
       AND COALESCE(cvss_score, 0) >= 9.0;

    BEGIN
        SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'count', cnt)
                                   ORDER BY cnt DESC), '[]'::jsonb)
          INTO v_top_software
          FROM (
              SELECT s.name AS name, count(DISTINCT s.endpoint_id)::int AS cnt
                FROM public.endpoint_software s
                JOIN public.endpoints e ON e.id = s.endpoint_id
               WHERE e.organization_id = p_org
            GROUP BY s.name
            ORDER BY cnt DESC
               LIMIT 10
          ) top;
    EXCEPTION WHEN undefined_table THEN
        v_top_software := '[]'::jsonb;
    END;

    SELECT COALESCE(m365_shield_enabled, false) INTO v_m365_enabled
      FROM public.organizations WHERE id = p_org;
    IF v_m365_enabled THEN
        SELECT count(*)::int INTO v_m365_users_total
          FROM public.m365_mfa_coverage WHERE organization_id = p_org;
        SELECT count(*)::int INTO v_m365_users_mfa
          FROM public.m365_mfa_coverage WHERE organization_id = p_org AND is_mfa_registered = TRUE;
        v_m365_mfa_pct := CASE WHEN COALESCE(v_m365_users_total,0) = 0
                                THEN 0::numeric
                                ELSE round(100.0 * v_m365_users_mfa / v_m365_users_total, 1) END;
        SELECT count(*)::int INTO v_m365_admins_at_risk
          FROM public.m365_mfa_coverage
         WHERE organization_id = p_org
           AND is_admin = TRUE
           AND is_mfa_registered = FALSE;
        SELECT count(*)::int INTO v_m365_breach_unack
          FROM public.m365_breach_findings
         WHERE organization_id = p_org AND acknowledged_at IS NULL;
        SELECT count(*)::int INTO v_m365_breach_new
          FROM public.m365_breach_findings
         WHERE organization_id = p_org
           AND first_seen_at >= p_period_start
           AND first_seen_at <  p_period_end;
        SELECT count(*)::int INTO v_m365_oauth_high_risk
          FROM public.m365_oauth_grants
         WHERE organization_id = p_org
           AND deleted_at IS NULL
           AND risk_level IN ('high','critical');
        SELECT count(*)::int INTO v_m365_anonymous_shares
          FROM public.m365_shared_items
         WHERE organization_id = p_org
           AND removed_at IS NULL
           AND is_anonymous_link = TRUE;
    ELSE
        v_m365_users_total      := 0;
        v_m365_users_mfa        := 0;
        v_m365_mfa_pct          := NULL;
        v_m365_admins_at_risk   := 0;
        v_m365_breach_unack     := 0;
        v_m365_breach_new       := 0;
        v_m365_oauth_high_risk  := 0;
        v_m365_anonymous_shares := 0;
    END IF;

    out := jsonb_build_object(
        'period_start',        p_period_start,
        'period_end',          p_period_end,
        'endpoints_total',     v_endpoints_total,
        'endpoints_online',    v_endpoints_online,
        'threats_in_period',   v_threats_in_period,
        'threats_severe',      v_threats_severe,
        'incidents_opened',    v_incidents_opened,
        'incidents_resolved',  v_incidents_resolved,
        'incidents_open_now',  v_incidents_open_now,
        'vulns_open',          v_vulns_open,
        'vulns_critical',      v_vulns_critical,
        'top_incidents',       v_top_incidents,
        'top_software',        v_top_software,
        'm365_shield',         jsonb_build_object(
            'enabled',               v_m365_enabled,
            'users_total',           v_m365_users_total,
            'users_mfa',             v_m365_users_mfa,
            'mfa_coverage_pct',      v_m365_mfa_pct,
            'admins_at_risk',        v_m365_admins_at_risk,
            'breach_findings_unack', v_m365_breach_unack,
            'breach_findings_new',   v_m365_breach_new,
            'oauth_high_risk',       v_m365_oauth_high_risk,
            'anonymous_share_links', v_m365_anonymous_shares
        )
    );
    RETURN out;
END;
$$;

REVOKE ALL ON FUNCTION public.build_org_period_summary(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.build_org_period_summary(uuid, timestamptz, timestamptz)
    TO service_role, authenticated;
