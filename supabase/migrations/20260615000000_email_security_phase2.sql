-- 20260615000000_email_security_phase2.sql
--
-- Phase 2 of email security:
--   - release_token on email_threats (uuid, unique) for the magic-link in
--     the warning email that lets a recipient self-release a flagged
--     message back to their Inbox
--   - quarantine_folder_id remembers where on the M365 mailbox the
--     message currently lives so release knows where to move it back
--     from (Junk Email vs. a Mithras-quarantine folder)
--   - one digest tracking table so we don't double-send a customer
--     org's daily digest if the cron fires twice
--   - a daily cron job
--
-- All additive; no existing column changes.

BEGIN;

ALTER TABLE public.email_threats
    ADD COLUMN IF NOT EXISTS release_token uuid DEFAULT gen_random_uuid(),
    ADD COLUMN IF NOT EXISTS quarantine_folder_id text,
    ADD COLUMN IF NOT EXISTS warning_sent_at timestamptz,
    ADD COLUMN IF NOT EXISTS released_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_threats_release_token
    ON public.email_threats(release_token)
    WHERE release_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_threats_action_taken
    ON public.email_threats(organization_id, action_taken, received_at DESC);


CREATE TABLE IF NOT EXISTS public.email_digest_runs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    -- Calendar day (UTC) the digest covers; one digest per org per day.
    digest_for_date date NOT NULL,
    threats_in_period int NOT NULL DEFAULT 0,
    recipients      text[] NOT NULL DEFAULT '{}'::text[],
    sent_at         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, digest_for_date)
);

ALTER TABLE public.email_digest_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_digest_runs_read ON public.email_digest_runs;
CREATE POLICY email_digest_runs_read ON public.email_digest_runs FOR SELECT
    USING (
        public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), organization_id)
        OR public.is_partner_admin_of_org(auth.uid(), organization_id)
    );

DROP POLICY IF EXISTS email_digest_runs_service_write ON public.email_digest_runs;
CREATE POLICY email_digest_runs_service_write ON public.email_digest_runs FOR ALL
    TO service_role USING (true) WITH CHECK (true);


-- Daily digest cron — 07:00 UTC (≈17:00 AEST). The function decides per-org
-- whether to actually send (only if there are threats and a recipient list).
CREATE OR REPLACE FUNCTION public.kick_email_security_digest()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_base text;
    v_key  text;
BEGIN
    v_base := current_setting('app.functions_base_url', true);
    v_key  := current_setting('app.service_role_key', true);
    IF v_base IS NULL OR v_base = '' OR v_key IS NULL OR v_key = '' THEN
        RETURN;
    END IF;
    PERFORM net.http_post(
        url     := v_base || '/m365-email-digest',
        headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || v_key
        ),
        body    := '{}'::jsonb,
        timeout_milliseconds := 60000
    );
END;
$$;

DO $$ BEGIN
    PERFORM cron.unschedule('mithras-email-security-digest');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
    'mithras-email-security-digest',
    '0 7 * * *',
    $kick$SELECT public.kick_email_security_digest();$kick$
);

COMMIT;
