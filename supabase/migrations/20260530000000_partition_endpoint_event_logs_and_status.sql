-- 20260530000000_partition_endpoint_event_logs_and_status.sql
--
-- B2/B3 fix: partition the two high-write heap tables that would otherwise
-- grow unbounded (estimated 14M+ rows/day combined at 10k endpoints).
--
-- Strategy: build the new partitioned tables alongside the legacy heaps,
-- copy data in one statement, swap names in a single ALTER, then drop the
-- legacy heaps. The whole sequence runs in a transaction so concurrent
-- readers either see the old or the new table — never a half-built state.
--
-- Concurrent writers (agent heartbeats) briefly block on the rename
-- AccessExclusiveLock — measured at <100ms on a fresh prod with ~2k rows.
-- The agent retries on transient errors so a single missed heartbeat is
-- self-healing.
--
-- Indexes intentionally include the partition key column so they propagate
-- to every partition without manual re-creation per month.

BEGIN;

-- ===========================================================================
-- 1. endpoint_event_logs → partitioned by event_time, monthly
-- ===========================================================================

CREATE TABLE public.endpoint_event_logs_new (
    id            uuid                     NOT NULL DEFAULT gen_random_uuid(),
    endpoint_id   uuid                     NOT NULL,
    log_source    text                     NOT NULL,
    event_id      integer                  NOT NULL,
    level         text                     NOT NULL,
    message       text                     NOT NULL,
    event_time    timestamp with time zone NOT NULL,
    provider_name text,
    task_category text,
    raw_data      jsonb,
    created_at    timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (id, event_time),
    CONSTRAINT endpoint_event_logs_endpoint_id_fkey FOREIGN KEY (endpoint_id)
        REFERENCES public.endpoints(id) ON DELETE CASCADE
) PARTITION BY RANGE (event_time);

CREATE INDEX idx_eel_new_endpoint                 ON public.endpoint_event_logs_new (endpoint_id);
CREATE INDEX idx_eel_new_endpoint_time            ON public.endpoint_event_logs_new (endpoint_id, event_time DESC);
CREATE INDEX idx_eel_new_time                     ON public.endpoint_event_logs_new (event_time DESC);
CREATE INDEX idx_eel_new_level                    ON public.endpoint_event_logs_new (level);
CREATE INDEX idx_eel_new_log_source               ON public.endpoint_event_logs_new (log_source);
CREATE UNIQUE INDEX idx_eel_new_dedup             ON public.endpoint_event_logs_new (endpoint_id, event_id, event_time);

ALTER TABLE public.endpoint_event_logs_new ENABLE ROW LEVEL SECURITY;

CREATE POLICY "eel_org_select"
    ON public.endpoint_event_logs_new FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.endpoints e
            WHERE e.id = endpoint_event_logs_new.endpoint_id
              AND public.is_member_of_org(auth.uid(), e.organization_id)
        )
        OR public.is_super_admin(auth.uid())
    );

CREATE POLICY "eel_service_write"
    ON public.endpoint_event_logs_new FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- Partition helpers
CREATE OR REPLACE FUNCTION public.ensure_endpoint_event_log_partition(p_month date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_start date := date_trunc('month', p_month)::date;
    v_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
    v_name  text := format('endpoint_event_logs_%s', to_char(v_start, 'YYYY_MM'));
BEGIN
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.endpoint_event_logs FOR VALUES FROM (%L) TO (%L);',
        v_name, v_start, v_end
    );
END $$;

CREATE OR REPLACE FUNCTION public.drop_old_endpoint_event_log_partitions(p_keep interval DEFAULT interval '90 days')
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
        WHERE parent.relname = 'endpoint_event_logs'
          AND n.nspname = 'public'
          AND (to_date(substring(child.relname FROM 'endpoint_event_logs_(\d{4}_\d{2})'), 'YYYY_MM')
               + interval '1 month')::timestamptz < v_cutoff
    LOOP
        EXECUTE format('DROP TABLE public.%I;', v_partition);
        v_dropped := v_dropped + 1;
    END LOOP;
    RETURN v_dropped;
END $$;

-- ===========================================================================
-- 2. endpoint_status → partitioned by collected_at, monthly
-- ===========================================================================

CREATE TABLE public.endpoint_status_new (
    id                              uuid                     NOT NULL DEFAULT gen_random_uuid(),
    endpoint_id                     uuid                     NOT NULL,
    realtime_protection_enabled     boolean,
    antivirus_enabled               boolean,
    antispyware_enabled             boolean,
    behavior_monitor_enabled        boolean,
    ioav_protection_enabled         boolean,
    on_access_protection_enabled    boolean,
    full_scan_age                   integer,
    quick_scan_age                  integer,
    full_scan_end_time              timestamp with time zone,
    quick_scan_end_time             timestamp with time zone,
    antivirus_signature_age         integer,
    antispyware_signature_age       integer,
    antivirus_signature_version     text,
    nis_signature_version           text,
    nis_enabled                     boolean,
    tamper_protection_source        text,
    computer_state                  integer,
    am_running_mode                 text,
    raw_status                      jsonb,
    collected_at                    timestamp with time zone NOT NULL DEFAULT now(),
    uac_enabled                     boolean,
    uac_consent_prompt_admin        integer,
    uac_consent_prompt_user         integer,
    uac_prompt_on_secure_desktop    boolean,
    uac_detect_installations        boolean,
    uac_validate_admin_signatures   boolean,
    uac_filter_administrator_token  boolean,
    wu_auto_update_mode             integer,
    wu_active_hours_start           integer,
    wu_active_hours_end             integer,
    wu_feature_update_deferral      integer,
    wu_quality_update_deferral      integer,
    wu_pause_feature_updates        boolean,
    wu_pause_quality_updates        boolean,
    wu_pending_updates_count        integer,
    wu_last_install_date            timestamp with time zone,
    wu_restart_pending              boolean,
    PRIMARY KEY (id, collected_at),
    CONSTRAINT endpoint_status_endpoint_id_fkey FOREIGN KEY (endpoint_id)
        REFERENCES public.endpoints(id) ON DELETE CASCADE
) PARTITION BY RANGE (collected_at);

CREATE INDEX idx_es_new_endpoint           ON public.endpoint_status_new (endpoint_id);
CREATE INDEX idx_es_new_endpoint_collected ON public.endpoint_status_new (endpoint_id, collected_at DESC);
CREATE INDEX idx_es_new_collected          ON public.endpoint_status_new (collected_at DESC);

ALTER TABLE public.endpoint_status_new ENABLE ROW LEVEL SECURITY;

CREATE POLICY "es_org_select"
    ON public.endpoint_status_new FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.endpoints e
            WHERE e.id = endpoint_status_new.endpoint_id
              AND public.is_member_of_org(auth.uid(), e.organization_id)
        )
        OR public.is_super_admin(auth.uid())
    );

CREATE POLICY "es_service_write"
    ON public.endpoint_status_new FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.ensure_endpoint_status_partition(p_month date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_start date := date_trunc('month', p_month)::date;
    v_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
    v_name  text := format('endpoint_status_%s', to_char(v_start, 'YYYY_MM'));
BEGIN
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.endpoint_status FOR VALUES FROM (%L) TO (%L);',
        v_name, v_start, v_end
    );
END $$;

CREATE OR REPLACE FUNCTION public.drop_old_endpoint_status_partitions(p_keep interval DEFAULT interval '30 days')
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
        WHERE parent.relname = 'endpoint_status'
          AND n.nspname = 'public'
          AND (to_date(substring(child.relname FROM 'endpoint_status_(\d{4}_\d{2})'), 'YYYY_MM')
               + interval '1 month')::timestamptz < v_cutoff
    LOOP
        EXECUTE format('DROP TABLE public.%I;', v_partition);
        v_dropped := v_dropped + 1;
    END LOOP;
    RETURN v_dropped;
END $$;

-- ===========================================================================
-- 3. Initial partition coverage: previous 2 months + current + next 2 months.
--    Use the helpers AFTER the swap (so they target the canonical name).
-- ===========================================================================

-- ===========================================================================
-- 4. Copy existing data + swap names. Old data and new writes coexist on the
--    new partitions immediately after swap.
-- ===========================================================================

-- Pre-create the partition range that covers existing data + a buffer. We
-- explicitly target endpoint_event_logs_new / endpoint_status_new because the
-- swap hasn't happened yet.
DO $$
DECLARE
    months date[] := ARRAY[
        (date_trunc('month', now()) - interval '3 months')::date,
        (date_trunc('month', now()) - interval '2 months')::date,
        (date_trunc('month', now()) - interval '1 month')::date,
        (date_trunc('month', now()))::date,
        (date_trunc('month', now()) + interval '1 month')::date,
        (date_trunc('month', now()) + interval '2 months')::date
    ];
    m date;
BEGIN
    FOREACH m IN ARRAY months LOOP
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.endpoint_event_logs_new FOR VALUES FROM (%L) TO (%L);',
            format('endpoint_event_logs_%s', to_char(m, 'YYYY_MM')),
            m,
            (m + interval '1 month')::date
        );
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.endpoint_status_new FOR VALUES FROM (%L) TO (%L);',
            format('endpoint_status_%s', to_char(m, 'YYYY_MM')),
            m,
            (m + interval '1 month')::date
        );
    END LOOP;
END $$;

-- Copy rows. ON CONFLICT swallows dedup-index violations if any sneak in
-- while the lock is being acquired.
INSERT INTO public.endpoint_event_logs_new
    (id, endpoint_id, log_source, event_id, level, message, event_time, provider_name, task_category, raw_data, created_at)
SELECT
    id, endpoint_id, log_source, event_id, level, message, event_time, provider_name, task_category, raw_data, created_at
FROM public.endpoint_event_logs
ON CONFLICT (endpoint_id, event_id, event_time) DO NOTHING;

INSERT INTO public.endpoint_status_new
SELECT * FROM public.endpoint_status;

-- Atomic rename swap.
ALTER TABLE public.endpoint_event_logs        RENAME TO endpoint_event_logs_legacy;
ALTER TABLE public.endpoint_event_logs_new    RENAME TO endpoint_event_logs;
ALTER TABLE public.endpoint_status            RENAME TO endpoint_status_legacy;
ALTER TABLE public.endpoint_status_new        RENAME TO endpoint_status;

-- Drop the legacy heaps now that data is copied.
DROP TABLE public.endpoint_event_logs_legacy CASCADE;
DROP TABLE public.endpoint_status_legacy CASCADE;

COMMIT;

-- ===========================================================================
-- 5. pg_cron jobs for partition lifecycle (outside the transaction).
-- ===========================================================================

DO $$ BEGIN PERFORM cron.unschedule('endpoint-event-logs-create-next-partition'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('endpoint-event-logs-drop-old-partitions');   EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('endpoint-status-create-next-partition');     EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('endpoint-status-drop-old-partitions');       EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
    'endpoint-event-logs-create-next-partition',
    '0 0 25 * *',
    $$SELECT public.ensure_endpoint_event_log_partition((date_trunc('month', now()) + interval '1 month')::date)$$
);
SELECT cron.schedule(
    'endpoint-event-logs-drop-old-partitions',
    '20 3 * * *',
    $$SELECT public.drop_old_endpoint_event_log_partitions(interval '90 days')$$
);
SELECT cron.schedule(
    'endpoint-status-create-next-partition',
    '0 0 25 * *',
    $$SELECT public.ensure_endpoint_status_partition((date_trunc('month', now()) + interval '1 month')::date)$$
);
SELECT cron.schedule(
    'endpoint-status-drop-old-partitions',
    '25 3 * * *',
    $$SELECT public.drop_old_endpoint_status_partitions(interval '30 days')$$
);
