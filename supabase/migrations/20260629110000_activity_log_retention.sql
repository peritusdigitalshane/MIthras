-- =========================================================================
-- 2026-06-29 — Activity-log retention policy
--
-- Production-readiness item from PUNCHLIST.md: today nothing purges
-- activity_logs, so the table grows unbounded forever. Customer-facing
-- copy on /admin/audit-logs honestly disclosed "kept indefinitely",
-- but for a real SaaS that's a privacy + storage liability.
--
-- Policy: rolling 12-month window (365 days). Reasons:
--   * Long enough for any reasonable compliance review of recent activity
--     (most SOC 2 / ISO 27001 sample windows are 6-12 months).
--   * Long enough for incident retrospectives that cross fiscal quarters.
--   * Short enough that table growth stays bounded at SMB customer
--     volumes (a few thousand rows/customer/year at most).
--
-- Mechanism: nightly pg_cron at 03:30 UTC (sits between the
-- firewall-audit partition purge at 03:15 and the daily customer report
-- drain — both already-existing crons we don't want to contend with).
--
-- The purge function is SECURITY DEFINER so cron can run it under
-- postgres without granting DELETE to the cron role broadly. It returns
-- the deleted count so the cron job's history table records useful data.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.purge_old_activity_logs(p_retention INTERVAL DEFAULT '365 days'::interval)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    deleted_count INTEGER := 0;
BEGIN
    DELETE FROM public.activity_logs
    WHERE created_at < (now() - p_retention);
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    -- Best-effort log of the purge into activity_logs itself, scoped to
    -- NULL org so super-admins see it under the Mithras audit row.
    BEGIN
        INSERT INTO public.activity_logs(action, resource_type, details)
        VALUES (
            'activity_logs.retention_purge',
            'activity_logs',
            jsonb_build_object('deleted_count', deleted_count, 'retention', p_retention::text)
        );
    EXCEPTION WHEN OTHERS THEN
        -- swallow: this is a housekeeping log, never let it break the
        -- actual purge.
        NULL;
    END;
    RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_old_activity_logs(INTERVAL) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_old_activity_logs(INTERVAL) TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- pg_cron schedule
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    existing_id BIGINT;
BEGIN
    SELECT jobid INTO existing_id FROM cron.job WHERE jobname = 'activity-logs-retention-purge';
    IF existing_id IS NOT NULL THEN
        PERFORM cron.unschedule(existing_id);
    END IF;
    PERFORM cron.schedule(
        'activity-logs-retention-purge',
        '30 3 * * *',
        $cron$SELECT public.purge_old_activity_logs(interval '365 days')$cron$
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- Smoke verification
-- ---------------------------------------------------------------------------
-- Run a dry purge with a far-future retention so nothing is actually
-- removed but we exercise the function plan + permissions.
SELECT public.purge_old_activity_logs(interval '100 years') AS dry_run_deleted;
