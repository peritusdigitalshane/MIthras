-- 20260530007000_wp_audit_review_fixes.sql
--
-- Post-review fixes for the WP audit + protect feature:
--   #3  Safe array-based stale-finding resolve (replaces fragile PostgREST .not.in)
--   #8  Cross-tenant data leak via build_site_period_summary (no org check)

BEGIN;

-- --------------------------------------------------------------------
-- #8 — Add org-membership check to build_site_period_summary.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.build_site_period_summary(
    p_site         uuid,
    p_period_start timestamptz,
    p_period_end   timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_org uuid;
    v_site jsonb;
    v_summary jsonb;
    v_caller uuid := auth.uid();
    v_is_service boolean := (auth.role() = 'service_role');
BEGIN
    SELECT to_jsonb(ms.*) - 'site_secret_hash', ms.organization_id
      INTO v_site, v_org
      FROM public.monitored_sites ms
     WHERE ms.id = p_site;
    IF v_org IS NULL THEN
        RETURN jsonb_build_object('error','site_not_found');
    END IF;

    -- Authorise: service-role or member of org or super-admin.
    IF NOT v_is_service
       AND NOT public.is_super_admin(v_caller)
       AND NOT public.is_member_of_org(v_caller, v_org) THEN
        RETURN jsonb_build_object('error','forbidden');
    END IF;

    SELECT jsonb_build_object(
        'organization_id', v_org,
        'site',            v_site,
        'period_start',    p_period_start,
        'period_end',      p_period_end,
        'events_total',    (SELECT count(*) FROM public.site_event_logs WHERE site_id = p_site AND event_time >= p_period_start AND event_time < p_period_end),
        'events_critical', (SELECT count(*) FROM public.site_event_logs WHERE site_id = p_site AND event_time >= p_period_start AND event_time < p_period_end AND severity = 'critical'),
        'events_error',    (SELECT count(*) FROM public.site_event_logs WHERE site_id = p_site AND event_time >= p_period_start AND event_time < p_period_end AND severity = 'error'),
        'events_warning',  (SELECT count(*) FROM public.site_event_logs WHERE site_id = p_site AND event_time >= p_period_start AND event_time < p_period_end AND severity = 'warning'),
        'logins_success',  (SELECT count(*) FROM public.site_event_logs WHERE site_id = p_site AND event_time >= p_period_start AND event_time < p_period_end AND event_type = 'login_success'),
        'logins_failed',   (SELECT count(*) FROM public.site_event_logs WHERE site_id = p_site AND event_time >= p_period_start AND event_time < p_period_end AND event_type = 'login_failed'),
        'role_changes',    (SELECT count(*) FROM public.site_event_logs WHERE site_id = p_site AND event_time >= p_period_start AND event_time < p_period_end AND event_type = 'role_changed'),
        'plugin_changes',  (SELECT count(*) FROM public.site_event_logs WHERE site_id = p_site AND event_time >= p_period_start AND event_time < p_period_end AND event_type IN ('plugin_activated','plugin_deactivated','plugin_updated','plugin_installed')),
        'user_changes',    (SELECT count(*) FROM public.site_event_logs WHERE site_id = p_site AND event_time >= p_period_start AND event_time < p_period_end AND event_type IN ('user_created','user_deleted','role_changed')),
        'findings_open_critical', (SELECT count(*) FROM public.site_audit_findings WHERE site_id = p_site AND status = 'open' AND severity = 'critical'),
        'findings_open_error',    (SELECT count(*) FROM public.site_audit_findings WHERE site_id = p_site AND status = 'open' AND severity = 'error'),
        'findings_open_warning',  (SELECT count(*) FROM public.site_audit_findings WHERE site_id = p_site AND status = 'open' AND severity = 'warning'),
        'findings_open_total',    (SELECT count(*) FROM public.site_audit_findings WHERE site_id = p_site AND status = 'open'),
        'findings_resolved',      (SELECT count(*) FROM public.site_audit_findings WHERE site_id = p_site AND status = 'resolved' AND COALESCE(resolved_at, last_seen_at) >= p_period_start AND COALESCE(resolved_at, last_seen_at) < p_period_end),
        'top_findings',           (SELECT COALESCE(jsonb_agg(jsonb_build_object('severity',severity,'category',category,'title',title,'recommendation',recommendation) ORDER BY array_position(ARRAY['critical','error','warning','info']::text[], severity), last_seen_at DESC), '[]'::jsonb)
                                       FROM (SELECT * FROM public.site_audit_findings WHERE site_id = p_site AND status='open' ORDER BY array_position(ARRAY['critical','error','warning','info']::text[], severity), last_seen_at DESC LIMIT 20) sub),
        'top_failed_login_ips',   (SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (SELECT actor_ip::text AS ip, count(*) AS count FROM public.site_event_logs WHERE site_id = p_site AND event_type='login_failed' AND event_time >= p_period_start AND event_time < p_period_end AND actor_ip IS NOT NULL GROUP BY actor_ip ORDER BY count DESC LIMIT 10) t),
        'top_admin_logins',       (SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (SELECT actor_user_login AS user, count(*) AS count FROM public.site_event_logs WHERE site_id = p_site AND event_type='login_success' AND event_time >= p_period_start AND event_time < p_period_end AND actor_user_login IS NOT NULL GROUP BY actor_user_login ORDER BY count DESC LIMIT 10) t)
    ) INTO v_summary;
    RETURN v_summary;
END $$;

-- --------------------------------------------------------------------
-- #3 — Safe stale-finding resolve via RPC with a real text[] argument.
-- Replaces fragile PostgREST .not("finding_key", "in", "(...)") which
-- would break on any finding_key containing parens, commas, or quotes.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_stale_site_findings(
    p_site          uuid,
    p_active_keys   text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_count integer;
BEGIN
    -- Guard: never auto-resolve when the active-keys array is empty, since
    -- that would close every open finding for the site.
    IF p_active_keys IS NULL OR array_length(p_active_keys, 1) IS NULL THEN
        RETURN 0;
    END IF;

    UPDATE public.site_audit_findings
       SET status      = 'resolved',
           resolved_at = now()
     WHERE site_id   = p_site
       AND status    = 'open'
       AND NOT (finding_key = ANY (p_active_keys));
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.resolve_stale_site_findings(uuid, text[]) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.resolve_stale_site_findings(uuid, text[]) TO service_role;

COMMIT;
