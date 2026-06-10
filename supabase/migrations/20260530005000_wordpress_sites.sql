-- 20260530005000_wordpress_sites.sql
--
-- WordPress sites as a SIEM data source.
--
-- Mirrors the endpoint enrolment + heartbeat model so the same multi-tenant
-- RLS, partner inheritance, and SIEM hunting flows work for websites as well
-- as Windows endpoints. The MSP installs a Mithras WP plugin on each
-- customer's WordPress site; the plugin enrols with a one-shot token, holds
-- a per-site secret, then streams events back over HMAC-signed HTTPS.
--
-- Tables:
--   monitored_sites           — one row per WordPress install (analogous to endpoints)
--   site_enrollment_tokens    — one-time codes minted from the dashboard
--   site_event_logs           — partitioned monthly by event_time
--
-- All three are org-scoped. Same helper functions (is_member_of_org etc.)
-- as the rest of the platform.

BEGIN;

-- ===========================================================================
-- monitored_sites
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.monitored_sites (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    site_url            text NOT NULL,
    name                text,
    site_secret_hash    text NOT NULL,                 -- sha256 of the bearer secret
    enrolled_via        text,                          -- enrollment token used to enrol
    wp_version          text,
    php_version         text,
    plugin_count        integer DEFAULT 0,
    active_theme        text,
    is_active           boolean NOT NULL DEFAULT true,
    last_seen_at        timestamptz,
    last_ip             inet,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, site_url)
);

CREATE INDEX IF NOT EXISTS idx_monitored_sites_org      ON public.monitored_sites(organization_id);
CREATE INDEX IF NOT EXISTS idx_monitored_sites_lastseen ON public.monitored_sites(last_seen_at DESC NULLS LAST);

DROP TRIGGER IF EXISTS update_monitored_sites_updated_at ON public.monitored_sites;
CREATE TRIGGER update_monitored_sites_updated_at
    BEFORE UPDATE ON public.monitored_sites
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.monitored_sites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sites_org_select"  ON public.monitored_sites;
DROP POLICY IF EXISTS "sites_admin_write" ON public.monitored_sites;
DROP POLICY IF EXISTS "sites_service"     ON public.monitored_sites;

CREATE POLICY "sites_org_select"
    ON public.monitored_sites FOR SELECT
    USING (public.is_super_admin(auth.uid()) OR public.is_member_of_org(auth.uid(), organization_id));

CREATE POLICY "sites_admin_write"
    ON public.monitored_sites FOR ALL
    USING (public.is_super_admin(auth.uid()) OR public.is_admin_of_org(auth.uid(), organization_id))
    WITH CHECK (public.is_super_admin(auth.uid()) OR public.is_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "sites_service"
    ON public.monitored_sites FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- ===========================================================================
-- site_enrollment_tokens
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.site_enrollment_tokens (
    token            text PRIMARY KEY,
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    expires_at       timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
    max_uses         integer NOT NULL DEFAULT 1,
    use_count        integer NOT NULL DEFAULT 0,
    used_at          timestamptz,
    used_by_site_id  uuid REFERENCES public.monitored_sites(id) ON DELETE SET NULL,
    created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    note             text,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_enrollment_tokens_org ON public.site_enrollment_tokens(organization_id);

ALTER TABLE public.site_enrollment_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "site_tokens_admin_rw" ON public.site_enrollment_tokens;
DROP POLICY IF EXISTS "site_tokens_service"  ON public.site_enrollment_tokens;

CREATE POLICY "site_tokens_admin_rw"
    ON public.site_enrollment_tokens FOR ALL
    USING (public.is_super_admin(auth.uid()) OR public.is_admin_of_org(auth.uid(), organization_id))
    WITH CHECK (public.is_super_admin(auth.uid()) OR public.is_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "site_tokens_service"
    ON public.site_enrollment_tokens FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- Atomic slot reserver, mirrors reserve_enrollment_slot for endpoints.
CREATE OR REPLACE FUNCTION public.reserve_site_enrollment_slot(p_token text)
RETURNS TABLE (organization_id uuid, use_count int, max_uses int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN QUERY
    UPDATE public.site_enrollment_tokens t
       SET use_count = t.use_count + 1,
           used_at   = COALESCE(t.used_at, now())
     WHERE t.token = p_token
       AND t.expires_at > now()
       AND t.use_count < t.max_uses
    RETURNING t.organization_id, t.use_count, t.max_uses;
END $$;

REVOKE ALL ON FUNCTION public.reserve_site_enrollment_slot(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.reserve_site_enrollment_slot(text) TO service_role;

-- ===========================================================================
-- site_event_logs  (partitioned monthly by event_time)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.site_event_logs (
    id                uuid                     NOT NULL DEFAULT gen_random_uuid(),
    site_id           uuid                     NOT NULL,
    organization_id   uuid                     NOT NULL,
    event_type        text                     NOT NULL,            -- e.g. login_success, plugin_activated
    severity          text                     NOT NULL DEFAULT 'info'
                                                CHECK (severity IN ('info','warning','error','critical')),
    actor_user_login  text,
    actor_ip          inet,
    target            text,                                          -- e.g. plugin slug, post id, user id
    summary           text                     NOT NULL,
    event_time        timestamptz              NOT NULL,
    raw               jsonb,
    created_at        timestamptz              NOT NULL DEFAULT now(),
    PRIMARY KEY (id, event_time),
    CONSTRAINT site_event_logs_site_fk
        FOREIGN KEY (site_id) REFERENCES public.monitored_sites(id) ON DELETE CASCADE,
    CONSTRAINT site_event_logs_org_fk
        FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE
) PARTITION BY RANGE (event_time);

CREATE INDEX IF NOT EXISTS idx_sel_site             ON public.site_event_logs (site_id);
CREATE INDEX IF NOT EXISTS idx_sel_site_time        ON public.site_event_logs (site_id, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_sel_org_time         ON public.site_event_logs (organization_id, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_sel_event_type       ON public.site_event_logs (event_type);
CREATE INDEX IF NOT EXISTS idx_sel_severity         ON public.site_event_logs (severity);

ALTER TABLE public.site_event_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sel_org_select" ON public.site_event_logs;
DROP POLICY IF EXISTS "sel_service"    ON public.site_event_logs;

CREATE POLICY "sel_org_select"
    ON public.site_event_logs FOR SELECT
    USING (public.is_super_admin(auth.uid()) OR public.is_member_of_org(auth.uid(), organization_id));

CREATE POLICY "sel_service"
    ON public.site_event_logs FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- Partition lifecycle helpers
CREATE OR REPLACE FUNCTION public.ensure_site_event_log_partition(p_month date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_start date := date_trunc('month', p_month)::date;
    v_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
    v_name  text := format('site_event_logs_%s', to_char(v_start, 'YYYY_MM'));
BEGIN
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.site_event_logs FOR VALUES FROM (%L) TO (%L);',
        v_name, v_start, v_end
    );
END $$;

CREATE OR REPLACE FUNCTION public.drop_old_site_event_log_partitions(p_keep interval DEFAULT interval '180 days')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_cutoff timestamptz := now() - p_keep;
    v_partition text;
    v_dropped int := 0;
BEGIN
    FOR v_partition IN
        SELECT child.relname
        FROM pg_inherits i
        JOIN pg_class parent ON i.inhparent = parent.oid
        JOIN pg_class child  ON i.inhrelid  = child.oid
        JOIN pg_namespace n  ON child.relnamespace = n.oid
        WHERE parent.relname = 'site_event_logs'
          AND n.nspname = 'public'
          AND (to_date(substring(child.relname FROM 'site_event_logs_(\d{4}_\d{2})'), 'YYYY_MM')
               + interval '1 month')::timestamptz < v_cutoff
    LOOP
        EXECUTE format('DROP TABLE public.%I;', v_partition);
        v_dropped := v_dropped + 1;
    END LOOP;
    RETURN v_dropped;
END $$;

-- Initial partitions: prev 2 + current + next 2 months.
DO $$
DECLARE
    months date[] := ARRAY[
        (date_trunc('month', now()) - interval '2 months')::date,
        (date_trunc('month', now()) - interval '1 month')::date,
        (date_trunc('month', now()))::date,
        (date_trunc('month', now()) + interval '1 month')::date,
        (date_trunc('month', now()) + interval '2 months')::date
    ];
    m date;
BEGIN
    FOREACH m IN ARRAY months LOOP
        PERFORM public.ensure_site_event_log_partition(m);
    END LOOP;
END $$;

-- pg_cron lifecycle
DO $$ BEGIN PERFORM cron.unschedule('site-event-logs-create-next-partition'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('site-event-logs-drop-old-partitions');   EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
    'site-event-logs-create-next-partition',
    '0 0 25 * *',
    $$SELECT public.ensure_site_event_log_partition((date_trunc('month', now()) + interval '1 month')::date)$$
);
SELECT cron.schedule(
    'site-event-logs-drop-old-partitions',
    '30 3 * * *',
    $$SELECT public.drop_old_site_event_log_partitions(interval '180 days')$$
);

COMMIT;
