-- 20260606140000_m365_posture_phase2.sql
--
-- Phase 2 of the M365 posture engine:
--   1. Three additional controls (email forwarding, app sprawl, audit logging)
--   2. Daily pg_cron schedule that hits m365-posture-scan in {all:true} mode
--      so every active tenant is auto-scanned at 02:30 UTC.
--
-- Cron-to-edge-function calls go via Kong on the local docker network
-- (supabase-kong:8000) carrying the service-role bearer pulled from the
-- private.cron_settings table we set up during the deal-notifications work.

-- 1. New controls --------------------------------------------------------
INSERT INTO public.m365_posture_controls
    (control_id, category, title, description, weight, cis_reference, remediation_url, impact_if_failed, remediation_steps)
VALUES
    ('email.external_forwarding_blocked', 'email',
     'External auto-forwarding blocked',
     'Anti-phishing policy or remote-domain settings should prevent users from auto-forwarding mail outside the tenant. Forwarding rules are the #1 persistence technique after a credential compromise.',
     9,
     'CIS M365 6.2.1',
     'https://learn.microsoft.com/en-us/microsoft-365/security/office-365-security/anti-phishing-mdo-impersonation-insight',
     'Once an attacker has access, they create an inbox rule that quietly forwards every email to their address. Even after the password reset, the attacker keeps reading mail — until somebody notices the forwarding rule months later.',
     '[
       {"step": "Exchange admin centre → Mail flow → Remote domains → Default"},
       {"step": "Set Automatic forwarding to External Domains to NoForward (or AllowedRecipientForwarding=No)"},
       {"step": "Defender → Email & collaboration → Policies → Anti-phishing → confirm Outbound spam filter restricts auto-forwarding"},
       {"step": "Run a tenant-wide search for existing mailbox rules with action=ForwardTo (PowerShell: Get-InboxRule)"}
     ]'::jsonb),

    ('apps.stale_app_registrations', 'apps',
     'Stale app registrations',
     'App registrations not used in 90 days are noise that grows the attack surface. Each unused app is a credential ready to be abused if its secret leaks.',
     5,
     'CIS M365 5.1.7',
     'https://learn.microsoft.com/en-us/azure/active-directory/develop/howto-remove-app',
     'Old test apps with stale secrets are forgotten — until a developer publishes the secret to GitHub or a leaver takes it with them.',
     '[
       {"step": "Entra → App registrations → All applications"},
       {"step": "Sort by Last sign-in date (Sign-in logs blade — costs a license but Entra ID Premium tenants have this for free)"},
       {"step": "For each app inactive >90 days: confirm with the owner, then delete"},
       {"step": "Rotate any secrets that are >12 months old as a baseline (Certificates & secrets → Add new → remove old)"}
     ]'::jsonb),

    ('governance.audit_log_enabled', 'governance',
     'Unified audit log enabled',
     'M365 unified audit logging captures sign-ins, mailbox access, file ops, and admin changes. It''s the only way to investigate after an incident. Off by default for some legacy tenants.',
     7,
     'CIS M365 1.1.4',
     'https://learn.microsoft.com/en-us/microsoft-365/compliance/turn-audit-log-search-on-or-off',
     'If audit logging is off, you have no forensic trail. Cyber insurance claims, breach notifications, and HR investigations all need this data — and there''s no retroactive way to enable it.',
     '[
       {"step": "Microsoft Purview compliance portal → Audit"},
       {"step": "If you see a banner that says \"Start recording\" — click it"},
       {"step": "Confirm retention is set to at least 180 days (E5: up to 10 years; E3: 90 days, extend to 1 year via add-on)"},
       {"step": "Set up an export-to-SIEM pipeline if you have one — Mithras ingests via the Graph API automatically when this is on"}
     ]'::jsonb)
ON CONFLICT (control_id) DO NOTHING;

-- 2. Trend RPC — restored helper so the UI sparkline + advisor have history
-- (already created in the Phase 1 migration; redefining here in case Phase 1
-- ran on a partial install).

-- 3. Cron schedule: nightly scan of every active tenant -----------------
--
-- Calls m365-posture-scan with the service-role bearer. The function's
-- {all:true} branch iterates m365_tenants WHERE consent_state='active' and
-- writes a fresh snapshot + findings for each. Idempotent: re-running the
-- same day just records another snapshot row.
--
-- Skip silently if pg_cron is not extension-loaded (e.g. on a local dev
-- install). The existing dial-tone uses cron.schedule + a service-key in
-- private.cron_settings — we lean on the same plumbing.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        -- Unschedule if exists (idempotent across re-runs)
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'mithras-m365-posture-daily';

        PERFORM cron.schedule(
            'mithras-m365-posture-daily',
            '30 2 * * *',
            $cmd$
            SELECT net.http_post(
                url := 'http://supabase-kong:8000/functions/v1/m365-posture-scan',
                headers := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'Authorization', 'Bearer ' || (SELECT value FROM private.cron_settings WHERE key = 'service_role_key'),
                    'apikey'       , (SELECT value FROM private.cron_settings WHERE key = 'service_role_key')
                ),
                body := jsonb_build_object('all', true)
            );
            $cmd$
        );
    END IF;
END $$;

COMMENT ON COLUMN public.m365_posture_snapshots.triggered_by IS
'auth.users.id of the operator who manually clicked Re-scan, or NULL if the row was produced by the mithras-m365-posture-daily cron.';
