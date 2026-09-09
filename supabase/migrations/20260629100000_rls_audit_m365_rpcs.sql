-- =========================================================================
-- 2026-06-29 — RLS audit: harden 9 SECURITY DEFINER M365/identity RPCs
--
-- All nine functions accept p_org_id and bypass row-level security to return
-- aggregate data for that organisation. None of them were verifying the
-- caller belonged to the organisation, so any authenticated user could read
-- another tenant's MFA coverage, breach findings, privileged-admin list,
-- sharing exposure, CA posture, sign-in geo, and identity defence stats by
-- guessing or enumerating org ids.
--
-- Fix:
--   1. Introduce assert_m365_org_access(p_org_id) — raises 42501 unless the
--      caller is super-admin, an org member, a partner admin of that org,
--      or running as the service_role (for cron/edge-function callers).
--   2. Rewrite each RPC as plpgsql so we can PERFORM the guard before the
--      data query. The SELECT bodies are unchanged — same columns, same
--      ordering, same logic — only the language and a 1-line precondition
--      change.
--   3. Re-grant EXECUTE to authenticated (and where relevant, service_role).
--
-- Pre-deploy verification:
--   PSQL> SELECT public.get_m365_shield_overview('<some-other-org-id>');
--   expected: ERROR  access denied: caller is not a member of organization …
-- =========================================================================

-- ---------------------------------------------------------------------------
-- 1. Helper guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_m365_org_access(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT (
        auth.role() = 'service_role'
        OR public.is_super_admin(auth.uid())
        OR public.is_member_of_org(auth.uid(), p_org_id)
        OR public.is_partner_admin_of_org(auth.uid(), p_org_id)
    ) THEN
        RAISE EXCEPTION 'access denied: caller is not a member of organization %', p_org_id
            USING ERRCODE = '42501';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_m365_org_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_m365_org_access(UUID) TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 2. get_m365_shield_overview
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_m365_shield_overview(p_org_id UUID)
RETURNS TABLE (
    enabled                 BOOLEAN,
    enabled_at              TIMESTAMPTZ,
    active_elevations       INT,
    pending_elevations      INT,
    elevations_24h          INT,
    high_risk_users         INT,
    critical_risk_users     INT,
    risk_users_total        INT,
    oauth_grants_total      INT,
    oauth_grants_high_risk  INT,
    open_reviews            INT,
    last_risk_poll_at       TIMESTAMPTZ,
    last_oauth_poll_at      TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public.assert_m365_org_access(p_org_id);
    RETURN QUERY
    SELECT
        (SELECT o.m365_shield_enabled    FROM public.organizations o WHERE o.id = p_org_id),
        (SELECT o.m365_shield_enabled_at FROM public.organizations o WHERE o.id = p_org_id),
        (SELECT count(*)::int FROM public.pim_elevations
            WHERE organization_id = p_org_id AND status = 'active'),
        (SELECT count(*)::int FROM public.pim_elevations
            WHERE organization_id = p_org_id AND status = 'pending'),
        (SELECT count(*)::int FROM public.pim_elevations
            WHERE organization_id = p_org_id AND requested_at >= now() - interval '24 hours'),
        (SELECT count(*)::int FROM public.m365_signin_risk
            WHERE organization_id = p_org_id AND risk_level = 'high'),
        (SELECT count(*)::int FROM public.m365_signin_risk
            WHERE organization_id = p_org_id AND risk_level = 'critical'),
        (SELECT count(*)::int FROM public.m365_signin_risk
            WHERE organization_id = p_org_id),
        (SELECT count(*)::int FROM public.m365_oauth_grants
            WHERE organization_id = p_org_id AND deleted_at IS NULL),
        (SELECT count(*)::int FROM public.m365_oauth_grants
            WHERE organization_id = p_org_id AND deleted_at IS NULL
              AND risk_level IN ('high','critical')),
        (SELECT count(*)::int FROM public.m365_access_reviews
            WHERE organization_id = p_org_id AND completed_at IS NULL),
        (SELECT max(last_evaluated_at) FROM public.m365_signin_risk
            WHERE organization_id = p_org_id),
        (SELECT max(last_seen_at) FROM public.m365_oauth_grants
            WHERE organization_id = p_org_id)
    ;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_m365_shield_overview(UUID) TO authenticated;


-- ---------------------------------------------------------------------------
-- 3. get_m365_breach_overview
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_m365_breach_overview(p_org_id UUID)
RETURNS TABLE (
    domains_total                INT,
    domains_verified             INT,
    domains_with_api_key         INT,
    domains_polling_ok           INT,
    users_breached               INT,
    findings_total               INT,
    findings_unack               INT,
    findings_new_24h             INT,
    findings_new_30d             INT,
    findings_hibp                INT,
    findings_hudson_rock         INT,
    findings_github              INT,
    last_poll_at                 TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public.assert_m365_org_access(p_org_id);
    RETURN QUERY
    SELECT
        (SELECT count(*)::int FROM public.m365_breach_monitoring WHERE organization_id = p_org_id),
        (SELECT count(*)::int FROM public.m365_breach_monitoring
            WHERE organization_id = p_org_id AND verified_at IS NOT NULL),
        (SELECT count(*)::int FROM public.m365_breach_monitoring
            WHERE organization_id = p_org_id AND hibp_api_key IS NOT NULL),
        (SELECT count(*)::int FROM public.m365_breach_monitoring
            WHERE organization_id = p_org_id
              AND (last_poll_status = 'ok' OR hudson_rock_last_polled_at IS NOT NULL OR github_last_polled_at IS NOT NULL)),
        (SELECT count(DISTINCT user_upn)::int FROM public.m365_breach_findings WHERE organization_id = p_org_id),
        (SELECT count(*)::int FROM public.m365_breach_findings WHERE organization_id = p_org_id),
        (SELECT count(*)::int FROM public.m365_breach_findings WHERE organization_id = p_org_id AND acknowledged_at IS NULL),
        (SELECT count(*)::int FROM public.m365_breach_findings WHERE organization_id = p_org_id AND first_seen_at >= now() - interval '24 hours'),
        (SELECT count(*)::int FROM public.m365_breach_findings WHERE organization_id = p_org_id AND first_seen_at >= now() - interval '30 days'),
        (SELECT count(*)::int FROM public.m365_breach_findings WHERE organization_id = p_org_id AND source = 'hibp'),
        (SELECT count(*)::int FROM public.m365_breach_findings WHERE organization_id = p_org_id AND source = 'hudson_rock'),
        (SELECT count(*)::int FROM public.m365_breach_findings WHERE organization_id = p_org_id AND source = 'github_leak'),
        (SELECT GREATEST(
            (SELECT max(last_polled_at) FROM public.m365_breach_monitoring WHERE organization_id = p_org_id),
            (SELECT max(hudson_rock_last_polled_at) FROM public.m365_breach_monitoring WHERE organization_id = p_org_id),
            (SELECT max(github_last_polled_at) FROM public.m365_breach_monitoring WHERE organization_id = p_org_id)
        ))
    ;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_m365_breach_overview(UUID) TO authenticated;


-- ---------------------------------------------------------------------------
-- 4. get_m365_mfa_coverage_overview
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_m365_mfa_coverage_overview(p_org_id UUID)
RETURNS TABLE (
    total_users                INT,
    users_mfa_registered       INT,
    users_mfa_capable_unreg    INT,
    users_no_mfa_capability    INT,
    admins_total               INT,
    admins_mfa_registered      INT,
    admins_at_risk             INT,
    pct_users_with_mfa         NUMERIC,
    pct_admins_with_mfa        NUMERIC,
    last_evaluated_at          TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public.assert_m365_org_access(p_org_id);
    RETURN QUERY
    WITH t AS (
        SELECT * FROM public.m365_mfa_coverage WHERE organization_id = p_org_id
    )
    SELECT
        (SELECT count(*)::int FROM t),
        (SELECT count(*)::int FROM t WHERE is_mfa_registered = TRUE),
        (SELECT count(*)::int FROM t WHERE is_mfa_capable = TRUE  AND is_mfa_registered = FALSE),
        (SELECT count(*)::int FROM t WHERE is_mfa_capable = FALSE),
        (SELECT count(*)::int FROM t WHERE is_admin = TRUE),
        (SELECT count(*)::int FROM t WHERE is_admin = TRUE AND is_mfa_registered = TRUE),
        (SELECT count(*)::int FROM t WHERE is_admin = TRUE AND is_mfa_registered = FALSE),
        CASE WHEN (SELECT count(*) FROM t) = 0 THEN 0::numeric
             ELSE round(100.0 * (SELECT count(*) FROM t WHERE is_mfa_registered = TRUE) / (SELECT count(*) FROM t), 1)
        END,
        CASE WHEN (SELECT count(*) FROM t WHERE is_admin = TRUE) = 0 THEN 0::numeric
             ELSE round(100.0 * (SELECT count(*) FROM t WHERE is_admin = TRUE AND is_mfa_registered = TRUE) /
                                 (SELECT count(*) FROM t WHERE is_admin = TRUE), 1)
        END,
        (SELECT max(last_evaluated_at) FROM t)
    ;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_m365_mfa_coverage_overview(UUID) TO authenticated;


-- ---------------------------------------------------------------------------
-- 5. get_m365_privileged_audit
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_m365_privileged_audit(p_org_id UUID)
RETURNS TABLE (
    user_id            TEXT,
    user_upn           TEXT,
    display_name       TEXT,
    admin_roles        TEXT[],
    is_global_admin    BOOLEAN,
    is_mfa_registered  BOOLEAN,
    methods_registered TEXT[],
    last_signin_at     TIMESTAMPTZ,
    days_since_signin  INT,
    risk_score         INT,
    risk_flags         TEXT[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public.assert_m365_org_access(p_org_id);
    RETURN QUERY
    WITH ranked AS (
        SELECT
            m.user_id,
            m.user_upn,
            m.display_name,
            m.admin_roles,
            ('Global Administrator' = ANY(m.admin_roles)) AS is_global_admin,
            m.is_mfa_registered,
            m.methods_registered,
            r.last_signin_at,
            CASE WHEN r.last_signin_at IS NOT NULL
                 THEN EXTRACT(DAY FROM (now() - r.last_signin_at))::int
                 ELSE NULL
            END AS days_since_signin
        FROM public.m365_mfa_coverage m
        LEFT JOIN LATERAL (
            SELECT max(sr.last_signin_at) AS last_signin_at
            FROM public.m365_signin_risk sr
            WHERE sr.organization_id = m.organization_id
              AND sr.user_id = m.user_id
        ) r ON TRUE
        WHERE m.organization_id = p_org_id
          AND m.is_admin = TRUE
    )
    SELECT
        ranked.user_id,
        ranked.user_upn,
        ranked.display_name,
        ranked.admin_roles,
        ranked.is_global_admin,
        ranked.is_mfa_registered,
        ranked.methods_registered,
        ranked.last_signin_at,
        ranked.days_since_signin,
        (
            CASE WHEN NOT ranked.is_mfa_registered THEN 50 ELSE 0 END +
            CASE WHEN ranked.is_global_admin THEN 20 ELSE 0 END +
            CASE WHEN ranked.last_signin_at IS NULL THEN 25
                 WHEN ranked.days_since_signin > 180 THEN 30
                 WHEN ranked.days_since_signin > 90  THEN 20
                 WHEN ranked.days_since_signin > 30  THEN 10
                 ELSE 0
            END
        ) AS risk_score,
        ARRAY_REMOVE(ARRAY[
            CASE WHEN NOT ranked.is_mfa_registered THEN 'no_mfa' END,
            CASE WHEN ranked.is_global_admin THEN 'global_admin' END,
            CASE WHEN ranked.last_signin_at IS NULL THEN 'never_signed_in'
                 WHEN ranked.days_since_signin > 180 THEN 'dormant_180d'
                 WHEN ranked.days_since_signin > 90  THEN 'dormant_90d'
                 WHEN ranked.days_since_signin > 30  THEN 'dormant_30d'
            END
        ], NULL) AS risk_flags
    FROM ranked
    ORDER BY
        (NOT ranked.is_mfa_registered)::int DESC,
        ranked.is_global_admin DESC,
        (CASE WHEN ranked.last_signin_at IS NULL THEN 1 ELSE 0 END) DESC,
        ranked.days_since_signin DESC NULLS LAST,
        ranked.user_upn
    ;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_m365_privileged_audit(UUID) TO authenticated;


-- ---------------------------------------------------------------------------
-- 6. get_m365_privileged_audit_summary
--     (re-uses #5, but still needs its own guard so the inner call is
--      authorised regardless of grant order)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_m365_privileged_audit_summary(p_org_id UUID)
RETURNS TABLE (
    total_admins         INT,
    admins_no_mfa        INT,
    admins_dormant_90d   INT,
    admins_never_seen    INT,
    global_admins        INT,
    global_admins_no_mfa INT,
    high_risk_admins     INT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public.assert_m365_org_access(p_org_id);
    RETURN QUERY
    SELECT
        count(*)::int,
        (count(*) FILTER (WHERE 'no_mfa' = ANY(pa.risk_flags)))::int,
        (count(*) FILTER (WHERE pa.risk_flags && ARRAY['dormant_90d','dormant_180d','never_signed_in']))::int,
        (count(*) FILTER (WHERE pa.last_signin_at IS NULL))::int,
        (count(*) FILTER (WHERE pa.is_global_admin))::int,
        (count(*) FILTER (WHERE pa.is_global_admin AND NOT pa.is_mfa_registered))::int,
        (count(*) FILTER (WHERE pa.risk_score >= 60))::int
    FROM public.get_m365_privileged_audit(p_org_id) pa
    ;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_m365_privileged_audit_summary(UUID) TO authenticated;


-- ---------------------------------------------------------------------------
-- 7. get_m365_sharing_overview
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_m365_sharing_overview(p_org_id UUID)
RETURNS TABLE (
    total_active           INT,
    external_active        INT,
    anonymous_links        INT,
    suspicious_domains     INT,
    dormant_over_90d       INT,
    high_risk              INT,
    last_poll_at           TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public.assert_m365_org_access(p_org_id);
    RETURN QUERY
    WITH t AS (
        SELECT * FROM public.m365_shared_items
        WHERE organization_id = p_org_id AND removed_at IS NULL
    )
    SELECT
        (SELECT count(*)::int FROM t),
        (SELECT count(*)::int FROM t WHERE is_external),
        (SELECT count(*)::int FROM t WHERE is_anonymous_link),
        (SELECT count(*)::int FROM t WHERE is_suspicious_domain),
        (SELECT count(*)::int FROM t WHERE dormant_days IS NOT NULL AND dormant_days > 90),
        (SELECT count(*)::int FROM t WHERE risk_score >= 60),
        (SELECT max(last_seen_at) FROM public.m365_shared_items WHERE organization_id = p_org_id)
    ;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_m365_sharing_overview(UUID) TO authenticated;


-- ---------------------------------------------------------------------------
-- 8. get_m365_signin_geo
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_m365_signin_geo(p_org_id UUID, p_days INT DEFAULT 7)
RETURNS TABLE (
    country_code               TEXT,
    signin_count               INT,
    unique_users               INT,
    high_risk_count            INT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public.assert_m365_org_access(p_org_id);
    RETURN QUERY
    WITH expanded AS (
        SELECT
            r.user_id,
            r.risk_level,
            jsonb_array_elements(r.risk_factors) AS f
        FROM public.m365_signin_risk r
        WHERE r.organization_id = p_org_id
          AND r.last_evaluated_at >= now() - (p_days * interval '1 day')
    ),
    countries AS (
        SELECT
            expanded.user_id,
            expanded.risk_level,
            (expanded.f->>'evidence') AS country
        FROM expanded
        WHERE expanded.f->>'kind' = 'history_country'
    )
    SELECT
        countries.country,
        count(*)::int                                                     AS signin_count,
        count(DISTINCT countries.user_id)::int                            AS unique_users,
        count(*) FILTER (WHERE countries.risk_level IN ('high','critical'))::int AS high_risk_count
    FROM countries
    WHERE countries.country IS NOT NULL AND countries.country <> ''
    GROUP BY countries.country
    ORDER BY signin_count DESC
    ;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_m365_signin_geo(UUID, INT) TO authenticated;


-- ---------------------------------------------------------------------------
-- 9. get_m365_ca_overview
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_m365_ca_overview(p_org_id UUID)
RETURNS TABLE (
    tenant_count           INTEGER,
    policies_total         INTEGER,
    policies_enabled       INTEGER,
    policies_report_only   INTEGER,
    findings_open          INTEGER,
    findings_critical      INTEGER,
    last_fetched_at        TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public.assert_m365_org_access(p_org_id);
    RETURN QUERY
    SELECT
        (SELECT count(*)::int FROM public.m365_tenants WHERE organization_id = p_org_id),
        (SELECT count(*)::int FROM public.m365_ca_policies WHERE organization_id = p_org_id AND deleted_at IS NULL),
        (SELECT count(*)::int FROM public.m365_ca_policies WHERE organization_id = p_org_id AND deleted_at IS NULL AND state = 'enabled'),
        (SELECT count(*)::int FROM public.m365_ca_policies WHERE organization_id = p_org_id AND deleted_at IS NULL AND state = 'enabledForReportingNotEnforced'),
        (SELECT count(*)::int FROM public.m365_ca_findings WHERE organization_id = p_org_id AND acknowledged_at IS NULL),
        (SELECT count(*)::int FROM public.m365_ca_findings WHERE organization_id = p_org_id AND acknowledged_at IS NULL AND severity = 'critical'),
        (SELECT max(fetched_at) FROM public.m365_ca_policies WHERE organization_id = p_org_id)
    ;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_m365_ca_overview(UUID) TO authenticated;


-- ---------------------------------------------------------------------------
-- 10. get_identity_defence_overview
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_identity_defence_overview(p_org_id UUID)
RETURNS TABLE (
    rules_total             INT,
    rules_enforced          INT,
    rules_report_only       INT,
    actions_last_24h        INT,
    actions_enforced_24h    INT,
    actions_report_only_24h INT,
    last_action_at          TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public.assert_m365_org_access(p_org_id);
    RETURN QUERY
    SELECT
        (SELECT count(*)::int FROM public.identity_access_rules WHERE organization_id = p_org_id),
        (SELECT count(*)::int FROM public.identity_access_rules WHERE organization_id = p_org_id AND mode = 'enforce'),
        (SELECT count(*)::int FROM public.identity_access_rules WHERE organization_id = p_org_id AND mode = 'report_only'),
        (SELECT count(*)::int FROM public.identity_actions WHERE organization_id = p_org_id AND created_at >= now() - interval '24 hours'),
        (SELECT count(*)::int FROM public.identity_actions WHERE organization_id = p_org_id AND created_at >= now() - interval '24 hours' AND outcome = 'enforced'),
        (SELECT count(*)::int FROM public.identity_actions WHERE organization_id = p_org_id AND created_at >= now() - interval '24 hours' AND outcome = 'would_have_fired'),
        (SELECT max(created_at) FROM public.identity_actions WHERE organization_id = p_org_id)
    ;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_identity_defence_overview(UUID) TO authenticated;
