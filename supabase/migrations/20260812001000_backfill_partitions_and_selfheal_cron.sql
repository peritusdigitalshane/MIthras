-- Wave: repair the partition hole created by the 2026-07-04 → 2026-08-11 outage,
-- and make the partition maintenance self-healing so a missed run cannot again
-- produce a permanent gap.
--
-- WHAT WENT WRONG
-- The six "create next partition" jobs run on `0 0 25 * *` and create the
-- partition for (now() + 1 month). The 25 July run never happened because the
-- database container did not exist between 4 July and 11 August. Consequently
-- no 2026_08 partition was ever created, and the next scheduled run (25 Aug)
-- would create 2026_09 — skipping August entirely and permanently.
--
-- IMPACT (confirmed on prod before this migration): any insert with
-- event_time in August failed with
--   ERROR: no partition of relation "firewall_audit_logs" found for row
-- i.e. ALL agent telemetry — firewall, event logs, endpoint status, sysmon,
-- DNS, site events — would be rejected for the remainder of August.
--
-- FIX
--   1. Create the missing current-month partitions immediately.
--   2. Create next month's too, so we are ahead.
--   3. Rewrite each cron command to ensure BOTH the current and next month.
--      A single missed run then self-repairs on the following run instead of
--      leaving a hole that nothing ever fills.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 + 2. Backfill current and next month for every partitioned table.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    m date;
BEGIN
    FOREACH m IN ARRAY ARRAY[
        date_trunc('month', now())::date,
        (date_trunc('month', now()) + interval '1 month')::date
    ] LOOP
        PERFORM public.ensure_firewall_audit_partition(m);
        PERFORM public.ensure_endpoint_event_log_partition(m);
        PERFORM public.ensure_endpoint_status_partition(m);
        PERFORM public.ensure_site_event_log_partition(m);
        PERFORM public.ensure_sysmon_events_partition(m);
        PERFORM public.ensure_dns_query_logs_partition(m);
        RAISE NOTICE 'ensured partitions for %', m;
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Make the scheduled maintenance self-healing.
-- ---------------------------------------------------------------------------
SELECT cron.alter_job(
    (SELECT jobid FROM cron.job WHERE jobname = 'firewall-audit-create-next-partition'),
    command := $cmd$SELECT public.ensure_firewall_audit_partition(date_trunc('month', now())::date),
       public.ensure_firewall_audit_partition((date_trunc('month', now()) + interval '1 month')::date);$cmd$
);

SELECT cron.alter_job(
    (SELECT jobid FROM cron.job WHERE jobname = 'endpoint-event-logs-create-next-partition'),
    command := $cmd$SELECT public.ensure_endpoint_event_log_partition(date_trunc('month', now())::date),
       public.ensure_endpoint_event_log_partition((date_trunc('month', now()) + interval '1 month')::date);$cmd$
);

SELECT cron.alter_job(
    (SELECT jobid FROM cron.job WHERE jobname = 'endpoint-status-create-next-partition'),
    command := $cmd$SELECT public.ensure_endpoint_status_partition(date_trunc('month', now())::date),
       public.ensure_endpoint_status_partition((date_trunc('month', now()) + interval '1 month')::date);$cmd$
);

SELECT cron.alter_job(
    (SELECT jobid FROM cron.job WHERE jobname = 'site-event-logs-create-next-partition'),
    command := $cmd$SELECT public.ensure_site_event_log_partition(date_trunc('month', now())::date),
       public.ensure_site_event_log_partition((date_trunc('month', now()) + interval '1 month')::date);$cmd$
);

SELECT cron.alter_job(
    (SELECT jobid FROM cron.job WHERE jobname = 'sysmon-events-create-next-partition'),
    command := $cmd$SELECT public.ensure_sysmon_events_partition(date_trunc('month', now())::date),
       public.ensure_sysmon_events_partition((date_trunc('month', now()) + interval '1 month')::date);$cmd$
);

SELECT cron.alter_job(
    (SELECT jobid FROM cron.job WHERE jobname = 'dns-query-logs-create-next-partition'),
    command := $cmd$SELECT public.ensure_dns_query_logs_partition(date_trunc('month', now())::date),
       public.ensure_dns_query_logs_partition((date_trunc('month', now()) + interval '1 month')::date);$cmd$
);

-- Run daily rather than monthly. These are cheap IF NOT EXISTS calls, and a
-- daily cadence means the window between a missed run and self-repair is one
-- day instead of one month.
DO $$
DECLARE
    j text;
BEGIN
    FOREACH j IN ARRAY ARRAY[
        'firewall-audit-create-next-partition',
        'endpoint-event-logs-create-next-partition',
        'endpoint-status-create-next-partition',
        'site-event-logs-create-next-partition',
        'sysmon-events-create-next-partition',
        'dns-query-logs-create-next-partition'
    ] LOOP
        PERFORM cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = j),
                               schedule := '0 1 * * *');
    END LOOP;
END $$;

COMMIT;
