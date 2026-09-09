-- 20260618050000_m365_privileged_audit.sql
--
-- Privileged Group Audit — pure RPCs over existing data. No new tables.
-- Joins m365_mfa_coverage (admin role + MFA state) with m365_signin_risk
-- (last sign-in). Powers the "Privileged Audit" tab on M365 Shield.
--
-- Risk flags surfaced:
--   no_mfa           — admin without MFA registered (highest weight)
--   global_admin     — has Global Administrator role
--   dormant_180d     — last signin older than 180 days (or never seen)
--   dormant_90d      — last signin 90-180 days
--   dormant_30d      — last signin 30-90 days
--   never_signed_in  — no sign-in record at all in our polling window

-- Per-admin detail
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
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
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
        user_id, user_upn, display_name, admin_roles, is_global_admin,
        is_mfa_registered, methods_registered, last_signin_at, days_since_signin,
        (
            CASE WHEN NOT is_mfa_registered THEN 50 ELSE 0 END +
            CASE WHEN is_global_admin THEN 20 ELSE 0 END +
            CASE WHEN last_signin_at IS NULL THEN 25
                 WHEN days_since_signin > 180 THEN 30
                 WHEN days_since_signin > 90  THEN 20
                 WHEN days_since_signin > 30  THEN 10
                 ELSE 0
            END
        ) AS risk_score,
        ARRAY_REMOVE(ARRAY[
            CASE WHEN NOT is_mfa_registered THEN 'no_mfa' END,
            CASE WHEN is_global_admin THEN 'global_admin' END,
            CASE WHEN last_signin_at IS NULL THEN 'never_signed_in'
                 WHEN days_since_signin > 180 THEN 'dormant_180d'
                 WHEN days_since_signin > 90  THEN 'dormant_90d'
                 WHEN days_since_signin > 30  THEN 'dormant_30d'
            END
        ], NULL) AS risk_flags
    FROM ranked
    ORDER BY
        (NOT is_mfa_registered)::int DESC,
        is_global_admin DESC,
        (CASE WHEN last_signin_at IS NULL THEN 1 ELSE 0 END) DESC,
        days_since_signin DESC NULLS LAST,
        user_upn
$$;

GRANT EXECUTE ON FUNCTION public.get_m365_privileged_audit(UUID) TO authenticated;

-- Summary KPIs
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
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT
        count(*)::int,
        count(*) FILTER (WHERE 'no_mfa' = ANY(risk_flags))::int,
        count(*) FILTER (WHERE risk_flags && ARRAY['dormant_90d','dormant_180d','never_signed_in'])::int,
        count(*) FILTER (WHERE last_signin_at IS NULL)::int,
        count(*) FILTER (WHERE is_global_admin)::int,
        count(*) FILTER (WHERE is_global_admin AND NOT is_mfa_registered)::int,
        count(*) FILTER (WHERE risk_score >= 60)::int
    FROM public.get_m365_privileged_audit(p_org_id);
$$;

GRANT EXECUTE ON FUNCTION public.get_m365_privileged_audit_summary(UUID) TO authenticated;
