-- Enable required extensions for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 2026-06-14 scrubbed: this migration originally hard-coded the URL and
-- anon JWT for the now-abandoned cloud project (njdcyjxgtckgtzgzoctw).
-- The cron job is unscheduled below and the post-launch cleanup cron is
-- now configured via app settings on the self-hosted stack instead. The
-- old anon JWT is treated as revoked; rotation is not required because
-- the cloud project itself is frozen.
DO $$ BEGIN
    PERFORM cron.unschedule('daily-cleanup-old-data');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
