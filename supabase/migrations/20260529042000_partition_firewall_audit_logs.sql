-- Partition public.firewall_audit_logs by month on event_time, schedule
-- create-next + drop-old jobs via pg_cron. Addresses the prod-readiness
-- review item: "firewall_audit_logs (12.8M rows) has no partitioning and
-- no retention job. Will grow unbounded."
--
-- Safe to run now because the table is currently empty (data was
-- intentionally excluded from the replica pg_dump in the Vultr standup).
--
-- Retention default: 90 days. Adjust via the cron job command if needed.

BEGIN;

-- 0. Drop the existing unpartitioned table. No FKs point at it; no data to preserve.
DROP TABLE IF EXISTS public.firewall_audit_logs CASCADE;

-- 1. Recreate as partitioned. PK must include the partition key (event_time).
CREATE TABLE public.firewall_audit_logs (
    id              uuid                     NOT NULL DEFAULT gen_random_uuid(),
    organization_id uuid                     NOT NULL,
    endpoint_id     uuid                     NOT NULL,
    rule_id         uuid,
    service_name    text                     NOT NULL,
    local_port      integer                  NOT NULL,
    remote_address  text                     NOT NULL,
    remote_port     integer,
    protocol        text                     NOT NULL DEFAULT 'tcp',
    direction       text                     NOT NULL DEFAULT 'inbound',
    event_time      timestamp with time zone NOT NULL,
    created_at      timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (id, event_time),
    CONSTRAINT valid_direction CHECK (direction IN ('inbound','outbound')),
    CONSTRAINT firewall_audit_logs_endpoint_id_fkey       FOREIGN KEY (endpoint_id)       REFERENCES public.endpoints(id)               ON DELETE CASCADE,
    CONSTRAINT firewall_audit_logs_organization_id_fkey   FOREIGN KEY (organization_id)   REFERENCES public.organizations(id)           ON DELETE CASCADE,
    CONSTRAINT firewall_audit_logs_rule_id_fkey           FOREIGN KEY (rule_id)           REFERENCES public.firewall_service_rules(id)  ON DELETE SET NULL
) PARTITION BY RANGE (event_time);

-- 2. Indexes — on the parent, automatically propagate to all partitions.
CREATE INDEX idx_firewall_audit_logs_endpoint            ON public.firewall_audit_logs (endpoint_id);
CREATE INDEX idx_firewall_audit_logs_endpoint_event_time ON public.firewall_audit_logs (endpoint_id, event_time DESC);
CREATE INDEX idx_firewall_audit_logs_org                 ON public.firewall_audit_logs (organization_id);
CREATE INDEX idx_firewall_audit_logs_rule_id             ON public.firewall_audit_logs (rule_id);
CREATE INDEX idx_firewall_audit_logs_time                ON public.firewall_audit_logs (event_time DESC);

-- 3. RLS.
ALTER TABLE public.firewall_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow insert firewall audit logs for valid endpoints"
ON public.firewall_audit_logs FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM public.endpoints e
  WHERE e.id = firewall_audit_logs.endpoint_id
    AND e.organization_id = firewall_audit_logs.organization_id
));

CREATE POLICY "Users can view firewall audit logs in their organization"
ON public.firewall_audit_logs FOR SELECT
USING (
  EXISTS (SELECT 1 FROM public.organization_memberships om
          WHERE om.organization_id = firewall_audit_logs.organization_id
            AND om.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = auth.uid())
);

-- 4. Helper to create a partition for a given month.
CREATE OR REPLACE FUNCTION public.ensure_firewall_audit_partition(p_month date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_name  text := format('firewall_audit_logs_%s', to_char(v_start, 'YYYY_MM'));
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.firewall_audit_logs FOR VALUES FROM (%L) TO (%L);',
    v_name, v_start, v_end
  );
END
$$;

-- 5. Helper to drop partitions whose end is older than the cutoff.
CREATE OR REPLACE FUNCTION public.drop_old_firewall_audit_partitions(p_keep interval DEFAULT interval '90 days')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
    WHERE parent.relname = 'firewall_audit_logs'
      AND n.nspname = 'public'
      -- partition name is YYYY_MM; treat first of NEXT month as the end of the range
      AND (to_date(substring(child.relname FROM 'firewall_audit_logs_(\d{4}_\d{2})'), 'YYYY_MM')
           + interval '1 month')::timestamptz < v_cutoff
  LOOP
    EXECUTE format('DROP TABLE public.%I;', v_partition);
    v_dropped := v_dropped + 1;
  END LOOP;
  RETURN v_dropped;
END
$$;

-- 6. Create initial partitions: previous month, current, +2 future.
SELECT public.ensure_firewall_audit_partition((date_trunc('month', now()) - interval '1 month')::date);
SELECT public.ensure_firewall_audit_partition(date_trunc('month', now())::date);
SELECT public.ensure_firewall_audit_partition((date_trunc('month', now()) + interval '1 month')::date);
SELECT public.ensure_firewall_audit_partition((date_trunc('month', now()) + interval '2 months')::date);

COMMIT;

-- 7. Schedule via pg_cron. Idempotent unschedule first.
DO $$
BEGIN
  PERFORM cron.unschedule('firewall-audit-create-next-partition');
EXCEPTION WHEN OTHERS THEN
  -- ignore: job did not exist
  NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('firewall-audit-drop-old-partitions');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'firewall-audit-create-next-partition',
  '0 0 25 * *',  -- 25th of each month at 00:00 UTC: pre-create next month's partition
  $$SELECT public.ensure_firewall_audit_partition((date_trunc('month', now()) + interval '1 month')::date)$$
);

SELECT cron.schedule(
  'firewall-audit-drop-old-partitions',
  '15 3 * * *',  -- daily 03:15 UTC
  $$SELECT public.drop_old_firewall_audit_partitions(interval '90 days')$$
);
