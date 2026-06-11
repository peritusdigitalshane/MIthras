-- WordPress alert promotion — feeds the multi-agent SOC.
--
-- The site_event_logs partition has been collecting WP telemetry for weeks
-- (failed logins, plugin activations, option changes, file mods) but nothing
-- ever promoted that data to an `alerts` row, so the AI agents never saw it.
--
-- This migration adds:
--   1. A detector function that scans site_event_logs every 2 min for
--      suspicious patterns and inserts matching alert rows.
--   2. A trigger on site_audit_findings that fires alerts when a new
--      critical finding lands (e.g., wp-config disclosure, vulnerable plugin
--      with active exploit).
--   3. pg_cron schedule for the detector.
--
-- Once alerts land, the existing trg_fire_ai_soc_orchestrate trigger on
-- public.alerts kicks off the multi-agent classifier — Triage, Verification,
-- Adversarial, Response, Comms — automatically.

BEGIN;

-- ============================================================================
-- 1. Detector function
-- ============================================================================
--
-- Each detector returns the count of new alerts inserted. The overall fn
-- aggregates them. Idempotent on dedup window: re-running within the dedup
-- window for the same (org, alert_type, target) does NOT re-insert.

CREATE OR REPLACE FUNCTION public.detect_wordpress_alerts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now                  timestamptz := now();
    v_fast_window          interval    := interval '5 minutes';
    v_slow_window          interval    := interval '60 minutes';
    v_stuffing_window      interval    := interval '15 minutes';
    v_plugin_window        interval    := interval '5 minutes';
    v_dedup_window         interval    := interval '30 minutes';
    v_brute_threshold      int         := 5;
    v_slow_brute_threshold int         := 5;
    v_stuffing_min_sites   int         := 2;
    v_stuffing_min_events  int         := 5;

    v_brute_count       int := 0;
    v_slow_brute_count  int := 0;
    v_stuffing_count    int := 0;
    v_plugin_count      int := 0;

    v_row record;
BEGIN
    -- 1a. WordPress brute force (FAST): 5+ failed logins for same (site, user)
    --     in the last 5 min. High severity.
    FOR v_row IN
        SELECT
            l.organization_id,
            l.site_id,
            l.actor_user_login,
            count(*)                                  AS attempts,
            count(DISTINCT l.actor_ip)                AS distinct_ips,
            max(l.event_time)                         AS last_attempt
          FROM public.site_event_logs l
         WHERE l.event_type = 'login_failed'
           AND l.event_time >= v_now - v_fast_window
           AND l.actor_user_login IS NOT NULL
         GROUP BY l.organization_id, l.site_id, l.actor_user_login
        HAVING count(*) >= v_brute_threshold
    LOOP
        -- Dedup: skip if we fired this alert recently for the same target.
        IF NOT EXISTS (
            SELECT 1 FROM public.alerts a
             WHERE a.alert_type = 'wordpress_brute_force'
               AND a.organization_id = v_row.organization_id
               AND a.created_at >= v_now - v_dedup_window
               AND a.message LIKE '%' || v_row.site_id::text || '%'
               AND a.message LIKE '%' || v_row.actor_user_login || '%'
        ) THEN
            INSERT INTO public.alerts (organization_id, endpoint_id, alert_type, severity, title, message)
            VALUES (
                v_row.organization_id, NULL,
                'wordpress_brute_force', 'high',
                format('WordPress brute force: %s failed logins for %s', v_row.attempts, v_row.actor_user_login),
                format(
                    'site_id=%s user=%s attempts=%s distinct_ips=%s window=5m last=%s. ' ||
                    'Look at site_event_logs for site_id=%s where event_type=login_failed.',
                    v_row.site_id, v_row.actor_user_login, v_row.attempts,
                    v_row.distinct_ips, v_row.last_attempt, v_row.site_id
                )
            );
            v_brute_count := v_brute_count + 1;
        END IF;
    END LOOP;

    -- 1b. WordPress slow brute force: 5+ failures for same (site, user) in
    --     60 min, NOT already caught by the fast pattern. Moderate severity.
    FOR v_row IN
        SELECT
            l.organization_id,
            l.site_id,
            l.actor_user_login,
            count(*)                                  AS attempts,
            count(DISTINCT l.actor_ip)                AS distinct_ips,
            max(l.event_time)                         AS last_attempt
          FROM public.site_event_logs l
         WHERE l.event_type = 'login_failed'
           AND l.event_time >= v_now - v_slow_window
           AND l.event_time <  v_now - v_fast_window  -- gap so fast detector handles fresh ones
           AND l.actor_user_login IS NOT NULL
         GROUP BY l.organization_id, l.site_id, l.actor_user_login
        HAVING count(*) >= v_slow_brute_threshold
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.alerts a
             WHERE a.alert_type IN ('wordpress_brute_force','wordpress_slow_brute_force')
               AND a.organization_id = v_row.organization_id
               AND a.created_at >= v_now - v_dedup_window
               AND a.message LIKE '%' || v_row.site_id::text || '%'
               AND a.message LIKE '%' || v_row.actor_user_login || '%'
        ) THEN
            INSERT INTO public.alerts (organization_id, endpoint_id, alert_type, severity, title, message)
            VALUES (
                v_row.organization_id, NULL,
                'wordpress_slow_brute_force', 'medium',
                format('WordPress slow brute force: %s failed logins for %s', v_row.attempts, v_row.actor_user_login),
                format(
                    'site_id=%s user=%s attempts=%s distinct_ips=%s window=60m last=%s.',
                    v_row.site_id, v_row.actor_user_login, v_row.attempts,
                    v_row.distinct_ips, v_row.last_attempt
                )
            );
            v_slow_brute_count := v_slow_brute_count + 1;
        END IF;
    END LOOP;

    -- 1c. WordPress credential stuffing: same actor_ip across 2+ sites with
    --     login_failed events in the last 15 min. Critical when the actor_ip
    --     hits multiple orgs (cross-tenant campaign), high otherwise. One
    --     alert per affected org so each tenant gets their own visibility.
    FOR v_row IN
        WITH stuffing AS (
            SELECT
                l.actor_ip,
                count(DISTINCT l.site_id)             AS distinct_sites,
                count(DISTINCT l.organization_id)     AS distinct_orgs,
                count(*)                              AS attempts,
                max(l.event_time)                     AS last_attempt
              FROM public.site_event_logs l
             WHERE l.event_type = 'login_failed'
               AND l.event_time >= v_now - v_stuffing_window
               AND l.actor_ip IS NOT NULL
             GROUP BY l.actor_ip
            HAVING count(DISTINCT l.site_id) >= v_stuffing_min_sites
               AND count(*) >= v_stuffing_min_events
        )
        SELECT DISTINCT
               s.actor_ip, l.organization_id,
               s.distinct_sites, s.distinct_orgs, s.attempts, s.last_attempt
          FROM stuffing s
          JOIN public.site_event_logs l
            ON l.actor_ip = s.actor_ip
           AND l.event_time >= v_now - v_stuffing_window
           AND l.event_type = 'login_failed'
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.alerts a
             WHERE a.alert_type = 'wordpress_credential_stuffing'
               AND a.organization_id = v_row.organization_id
               AND a.created_at >= v_now - v_dedup_window
               AND a.message LIKE '%' || host(v_row.actor_ip) || '%'
        ) THEN
            INSERT INTO public.alerts (organization_id, endpoint_id, alert_type, severity, title, message)
            VALUES (
                v_row.organization_id, NULL,
                'wordpress_credential_stuffing',
                CASE WHEN v_row.distinct_orgs >= 2 THEN 'critical' ELSE 'high' END,
                format('Credential stuffing from %s — %s sites across %s tenants',
                       host(v_row.actor_ip), v_row.distinct_sites, v_row.distinct_orgs),
                format(
                    'actor_ip=%s sites_hit=%s tenants_hit=%s attempts=%s window=15m last=%s. ' ||
                    'Cross-tenant pattern = active campaign. Consider blocking %s at firewall.',
                    host(v_row.actor_ip), v_row.distinct_sites, v_row.distinct_orgs,
                    v_row.attempts, v_row.last_attempt, host(v_row.actor_ip)
                )
            );
            v_stuffing_count := v_stuffing_count + 1;
        END IF;
    END LOOP;

    -- 1d. Plugin activation events: any plugin_activated in the last 5 min
    --     gets an alert. Moderate severity — Triage decides if benign
    --     (operator-initiated) or malicious (compromised admin).
    FOR v_row IN
        SELECT l.organization_id, l.site_id, l.summary, l.event_time, l.actor_user_login
          FROM public.site_event_logs l
         WHERE l.event_type = 'plugin_activated'
           AND l.event_time >= v_now - v_plugin_window
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.alerts a
             WHERE a.alert_type = 'wordpress_plugin_activated'
               AND a.organization_id = v_row.organization_id
               AND a.created_at >= v_now - v_dedup_window
               AND a.message LIKE '%' || v_row.site_id::text || '%'
               AND a.message LIKE '%' || substr(v_row.summary, 1, 60) || '%'
        ) THEN
            INSERT INTO public.alerts (organization_id, endpoint_id, alert_type, severity, title, message)
            VALUES (
                v_row.organization_id, NULL,
                'wordpress_plugin_activated', 'medium',
                format('WordPress plugin activated: %s', substr(v_row.summary, 1, 100)),
                format(
                    'site_id=%s actor=%s at=%s. %s. ' ||
                    'Verify the actor + timing matches an expected change window.',
                    v_row.site_id,
                    COALESCE(v_row.actor_user_login, '(unknown)'),
                    v_row.event_time,
                    v_row.summary
                )
            );
            v_plugin_count := v_plugin_count + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'as_of', v_now,
        'brute_force_fired', v_brute_count,
        'slow_brute_force_fired', v_slow_brute_count,
        'credential_stuffing_fired', v_stuffing_count,
        'plugin_activated_fired', v_plugin_count
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.detect_wordpress_alerts() FROM public;
GRANT  EXECUTE ON FUNCTION public.detect_wordpress_alerts() TO service_role;

-- ============================================================================
-- 2. Critical site_audit_findings trigger
-- ============================================================================
--
-- When the WP audit scanner inserts a row with severity='critical' (e.g.,
-- wp-config disclosure, exploitable vulnerable plugin), fire an alert
-- immediately. No detector needed — the trigger catches it inline.

CREATE OR REPLACE FUNCTION public.fire_alert_for_critical_audit_finding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.severity = 'critical' AND NEW.status = 'open' THEN
        -- Dedup on (finding_key, site_id) within 24h.
        IF NOT EXISTS (
            SELECT 1 FROM public.alerts
             WHERE alert_type = 'wordpress_critical_finding'
               AND organization_id = NEW.organization_id
               AND created_at >= now() - interval '24 hours'
               AND message LIKE '%' || NEW.finding_key || '%'
               AND message LIKE '%' || NEW.site_id::text || '%'
        ) THEN
            INSERT INTO public.alerts (organization_id, endpoint_id, alert_type, severity, title, message)
            VALUES (
                NEW.organization_id, NULL,
                'wordpress_critical_finding', 'high',
                format('WordPress critical finding: %s', NEW.title),
                format(
                    'site_id=%s finding_key=%s category=%s. %s. Recommendation: %s',
                    NEW.site_id, NEW.finding_key, NEW.category,
                    COALESCE(NEW.description, ''), COALESCE(NEW.recommendation, '')
                )
            );
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fire_alert_for_critical_audit_finding ON public.site_audit_findings;
CREATE TRIGGER trg_fire_alert_for_critical_audit_finding
    AFTER INSERT OR UPDATE OF severity, status ON public.site_audit_findings
    FOR EACH ROW
    EXECUTE FUNCTION public.fire_alert_for_critical_audit_finding();

-- ============================================================================
-- 3. Cron schedule — every 2 minutes
-- ============================================================================

DO $$ BEGIN PERFORM cron.unschedule('wordpress-alert-detector'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
    PERFORM cron.schedule(
        'wordpress-alert-detector',
        '*/2 * * * *',
        $cron$ SELECT public.detect_wordpress_alerts(); $cron$
    );
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron unavailable, detector needs manual trigger';
END $$;

COMMIT;
