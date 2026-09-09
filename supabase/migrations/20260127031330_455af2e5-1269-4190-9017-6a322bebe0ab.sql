-- Add event log retention column to organizations
ALTER TABLE public.organizations
ADD COLUMN event_log_retention_days INTEGER NOT NULL DEFAULT 30;

-- Add a comment for documentation
COMMENT ON COLUMN public.organizations.event_log_retention_days IS 'Number of days to retain event logs before purging. Default is 30 days.';