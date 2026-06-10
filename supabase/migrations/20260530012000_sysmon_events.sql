-- Sysmon event telemetry from Windows endpoints. We ship a tuned subset of
-- events from Microsoft-Windows-Sysmon/Operational:
--
--   Event ID 1  - ProcessCreate
--   Event ID 3  - NetworkConnect (per-process outbound)
--   Event ID 11 - FileCreate
--
-- Other Sysmon events (7 DLL load, 22 DNS query, 12/13/14 registry) are
-- captured by the config but not yet ingested. Wire them in once the v1
-- pipeline is proven.
--
-- Partitioning model matches firewall_audit_logs: monthly RANGE on event_time,
-- 90-day retention, monthly cron job to pre-create + drop old partitions.

BEGIN;

CREATE TABLE IF NOT EXISTS public.sysmon_events (
    id                    uuid                     NOT NULL DEFAULT gen_random_uuid(),
    organization_id       uuid                     NOT NULL,
    endpoint_id           uuid                     NOT NULL,
    event_time            timestamptz              NOT NULL,
    event_id              integer                  NOT NULL,
    -- Common Sysmon fields
    record_id             bigint,
    user_name             text,
    -- Process fields (Event 1)
    process_guid          text,
    process_id            bigint,
    parent_process_guid   text,
    parent_process_id     bigint,
    image                 text,
    parent_image          text,
    command_line          text,
    parent_command_line   text,
    current_directory     text,
    hashes                jsonb,
    integrity_level       text,
    -- Network fields (Event 3)
    protocol              text,
    initiated             boolean,
    source_ip             text,
    source_port           integer,
    source_hostname       text,
    destination_ip        text,
    destination_port      integer,
    destination_hostname  text,
    -- File fields (Event 11)
    target_filename       text,
    -- Forensic blob — original event in case we need fields we didn't extract
    raw                   jsonb,
    created_at            timestamptz              NOT NULL DEFAULT now(),
    PRIMARY KEY (id, event_time)
) PARTITION BY RANGE (event_time);

-- Foreign keys (parent table only; PostgreSQL propagates to all partitions)
ALTER TABLE public.sysmon_events
    ADD CONSTRAINT sysmon_events_endpoint_fkey
    FOREIGN KEY (endpoint_id) REFERENCES public.endpoints(id) ON DELETE CASCADE;
ALTER TABLE public.sysmon_events
    ADD CONSTRAINT sysmon_events_org_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- Indexes (on parent — propagate to partitions)
CREATE INDEX IF NOT EXISTS idx_sysmon_events_endpoint
    ON public.sysmon_events (endpoint_id, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_sysmon_events_org_time
    ON public.sysmon_events (organization_id, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_sysmon_events_event_id
    ON public.sysmon_events (organization_id, event_id, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_sysmon_events_image
    ON public.sysmon_events (organization_id, image);
CREATE INDEX IF NOT EXISTS idx_sysmon_events_destination
    ON public.sysmon_events (organization_id, destination_ip)
    WHERE destination_ip IS NOT NULL;
-- Hash lookups for IOC matching: index the SHA256 path expression
CREATE INDEX IF NOT EXISTS idx_sysmon_events_sha256
    ON public.sysmon_events ((hashes->>'SHA256'))
    WHERE hashes IS NOT NULL;

-- RLS
ALTER TABLE public.sysmon_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sysmon_events_insert_valid_endpoint"
ON public.sysmon_events FOR INSERT
WITH CHECK (EXISTS (
    SELECT 1 FROM public.endpoints e
    WHERE e.id = sysmon_events.endpoint_id
      AND e.organization_id = sysmon_events.organization_id
));

CREATE POLICY "sysmon_events_select_org_or_super"
ON public.sysmon_events FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.organization_memberships om
        WHERE om.organization_id = sysmon_events.organization_id
          AND om.user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = auth.uid())
);

-- Partition helpers
CREATE OR REPLACE FUNCTION public.ensure_sysmon_events_partition(p_month date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_start date := date_trunc('month', p_month)::date;
    v_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
    v_name  text := format('sysmon_events_%s', to_char(v_start, 'YYYY_MM'));
BEGIN
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.sysmon_events FOR VALUES FROM (%L) TO (%L);',
        v_name, v_start, v_end
    );
END
$$;

CREATE OR REPLACE FUNCTION public.drop_old_sysmon_events_partitions(p_keep interval DEFAULT interval '90 days')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_cutoff    timestamptz := now() - p_keep;
    v_partition text;
    v_dropped   int := 0;
BEGIN
    FOR v_partition IN
        SELECT child.relname
        FROM pg_inherits i
        JOIN pg_class parent ON i.inhparent = parent.oid
        JOIN pg_class child  ON i.inhrelid  = child.oid
        JOIN pg_namespace n  ON child.relnamespace = n.oid
        WHERE parent.relname = 'sysmon_events'
          AND n.nspname = 'public'
          AND (to_date(substring(child.relname FROM 'sysmon_events_(\d{4}_\d{2})'), 'YYYY_MM')
               + interval '1 month')::timestamptz < v_cutoff
    LOOP
        EXECUTE format('DROP TABLE public.%I;', v_partition);
        v_dropped := v_dropped + 1;
    END LOOP;
    RETURN v_dropped;
END
$$;

-- Initial partitions: prev / current / +2 future
SELECT public.ensure_sysmon_events_partition((date_trunc('month', now()) - interval '1 month')::date);
SELECT public.ensure_sysmon_events_partition(date_trunc('month', now())::date);
SELECT public.ensure_sysmon_events_partition((date_trunc('month', now()) + interval '1 month')::date);
SELECT public.ensure_sysmon_events_partition((date_trunc('month', now()) + interval '2 months')::date);

COMMIT;

-- Schedule pg_cron jobs
DO $$ BEGIN PERFORM cron.unschedule('sysmon-events-create-next-partition'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('sysmon-events-drop-old-partitions'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
    'sysmon-events-create-next-partition',
    '0 0 25 * *',
    $$SELECT public.ensure_sysmon_events_partition((date_trunc('month', now()) + interval '1 month')::date)$$
);

SELECT cron.schedule(
    'sysmon-events-drop-old-partitions',
    '15 3 * * *',
    $$SELECT public.drop_old_sysmon_events_partitions(interval '90 days')$$
);
