-- 20260530006000_wordpress_audit_and_protect.sql
--
-- WordPress audit + active-protection data plane.
--
-- Three additions:
--   1. site_audit_findings — stateful per-site findings (open / resolved),
--      mirrors the endpoint_threats pattern. Upserted by finding_key so the
--      plugin can re-report the same finding without creating duplicates.
--   2. site_protection_settings — per-site toggles. The platform decides what
--      the plugin should enforce; the plugin pulls these on heartbeat.
--   3. customer_reports.site_id — nullable. Null = org-wide report (existing).
--      Set = per-site report rendered by generate-customer-report.

BEGIN;

-- ===========================================================================
-- site_audit_findings
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.site_audit_findings (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id           uuid NOT NULL REFERENCES public.monitored_sites(id) ON DELETE CASCADE,
    organization_id   uuid NOT NULL REFERENCES public.organizations(id)   ON DELETE CASCADE,
    finding_key       text NOT NULL,                       -- stable identifier per check, e.g. "core.outdated", "uploads.php_in_uploads:/foo/x.php"
    category          text NOT NULL CHECK (category IN
                          ('core','plugin','theme','file_integrity','user','config','login','server','headers','content')),
    severity          text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','error','critical')),
    title             text NOT NULL,
    description       text,
    recommendation    text,
    evidence          jsonb,
    status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','accepted_risk')),
    first_seen_at     timestamptz NOT NULL DEFAULT now(),
    last_seen_at      timestamptz NOT NULL DEFAULT now(),
    resolved_at       timestamptz,
    resolved_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    UNIQUE (site_id, finding_key)
);

CREATE INDEX IF NOT EXISTS idx_saf_site            ON public.site_audit_findings(site_id);
CREATE INDEX IF NOT EXISTS idx_saf_org             ON public.site_audit_findings(organization_id);
CREATE INDEX IF NOT EXISTS idx_saf_status_severity ON public.site_audit_findings(status, severity);
CREATE INDEX IF NOT EXISTS idx_saf_lastseen        ON public.site_audit_findings(last_seen_at DESC);

ALTER TABLE public.site_audit_findings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saf_org_select"     ON public.site_audit_findings;
DROP POLICY IF EXISTS "saf_admin_write"    ON public.site_audit_findings;
DROP POLICY IF EXISTS "saf_service"        ON public.site_audit_findings;

CREATE POLICY "saf_org_select"
    ON public.site_audit_findings FOR SELECT
    USING (public.is_super_admin(auth.uid()) OR public.is_member_of_org(auth.uid(), organization_id));

CREATE POLICY "saf_admin_write"
    ON public.site_audit_findings FOR UPDATE
    USING (public.is_super_admin(auth.uid()) OR public.is_admin_of_org(auth.uid(), organization_id))
    WITH CHECK (public.is_super_admin(auth.uid()) OR public.is_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "saf_service"
    ON public.site_audit_findings FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- ===========================================================================
-- site_protection_settings
-- Per-site protection toggles. The plugin polls these on heartbeat and
-- applies enforcement locally. Defaults captured here = MSP-grade baseline.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.site_protection_settings (
    site_id         uuid PRIMARY KEY REFERENCES public.monitored_sites(id) ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    settings        jsonb NOT NULL DEFAULT '{
        "disable_file_edit":        true,
        "force_ssl_admin":          true,
        "disable_xmlrpc":           true,
        "hide_wp_version":          true,
        "block_user_enumeration":   true,
        "block_php_in_uploads":     true,
        "security_headers":         true,
        "disable_pingbacks":        true,
        "limit_login_attempts":     true,
        "login_lockout_threshold":  5,
        "login_lockout_minutes":    30,
        "require_strong_passwords": true,
        "disable_app_passwords":    false,
        "auto_update_minor_core":   true,
        "auto_update_plugins":      false,
        "auto_update_themes":       false,
        "audit_interval_hours":     24,
        "scan_uploads_for_php":     true,
        "scan_file_integrity":      true,
        "watch_admin_creation":     true
    }'::jsonb,
    settings_version int NOT NULL DEFAULT 1,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.site_protection_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sps_org_select"   ON public.site_protection_settings;
DROP POLICY IF EXISTS "sps_admin_write"  ON public.site_protection_settings;
DROP POLICY IF EXISTS "sps_service"      ON public.site_protection_settings;

CREATE POLICY "sps_org_select"
    ON public.site_protection_settings FOR SELECT
    USING (public.is_super_admin(auth.uid()) OR public.is_member_of_org(auth.uid(), organization_id));

CREATE POLICY "sps_admin_write"
    ON public.site_protection_settings FOR ALL
    USING (public.is_super_admin(auth.uid()) OR public.is_admin_of_org(auth.uid(), organization_id))
    WITH CHECK (public.is_super_admin(auth.uid()) OR public.is_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "sps_service"
    ON public.site_protection_settings FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- Auto-seed defaults when a site is enrolled.
CREATE OR REPLACE FUNCTION public.seed_site_protection_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.site_protection_settings (site_id, organization_id)
    VALUES (NEW.id, NEW.organization_id)
    ON CONFLICT (site_id) DO NOTHING;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_seed_site_protection_defaults ON public.monitored_sites;
CREATE TRIGGER trg_seed_site_protection_defaults
    AFTER INSERT ON public.monitored_sites
    FOR EACH ROW EXECUTE FUNCTION public.seed_site_protection_defaults();

-- Backfill defaults for sites that enrolled before this migration.
INSERT INTO public.site_protection_settings (site_id, organization_id)
SELECT id, organization_id FROM public.monitored_sites
ON CONFLICT (site_id) DO NOTHING;

-- ===========================================================================
-- customer_reports.site_id
-- ===========================================================================
ALTER TABLE public.customer_reports
    ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES public.monitored_sites(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_customer_reports_site ON public.customer_reports(site_id);

-- The existing unique constraint (organization_id, kind, period_start) would
-- now collide on per-site reports for the same period. Drop and replace.
ALTER TABLE public.customer_reports DROP CONSTRAINT IF EXISTS customer_reports_org_kind_period_uk;
ALTER TABLE public.customer_reports DROP CONSTRAINT IF EXISTS customer_reports_organization_id_kind_period_start_key;

DO $$ BEGIN
    -- Use a partial UNIQUE INDEX so two rows can both have site_id=NULL (org-wide)
    -- only if they're for different (org, kind, period_start) tuples, and
    -- per-site rows are unique by (site, kind, period_start).
    CREATE UNIQUE INDEX customer_reports_org_or_site_unique
        ON public.customer_reports (organization_id, COALESCE(site_id::text, ''), kind, period_start);
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

-- ===========================================================================
-- build_site_period_summary — returns metrics for a per-site security report.
-- ===========================================================================
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
BEGIN
    SELECT to_jsonb(ms.*) - 'site_secret_hash', ms.organization_id
      INTO v_site, v_org
      FROM public.monitored_sites ms
     WHERE ms.id = p_site;
    IF v_org IS NULL THEN
        RETURN jsonb_build_object('error','site_not_found');
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

REVOKE ALL ON FUNCTION public.build_site_period_summary(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.build_site_period_summary(uuid, timestamptz, timestamptz) TO authenticated, service_role;

COMMIT;
