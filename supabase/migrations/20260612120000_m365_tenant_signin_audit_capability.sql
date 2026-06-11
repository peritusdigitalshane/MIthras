-- =============================================================================
-- m365_tenants.signin_audit_supported
--
-- Premium-only Graph endpoints (/auditLogs/signIns and /auditLogs/directoryAudits)
-- return 403 Authentication_RequestFromNonPremiumTenantOrB2CTenant on tenants
-- without Entra ID Premium P1. The poller catches that error and persists
-- this flag to false so subsequent cycles skip those two requests entirely
-- — both to spare the noisy `m365_section_failed[signins]` log every 5 min
-- and to stop wasting a Graph round-trip per cycle.
--
-- Defaults true; the poller flips it to false on first NonPremium response.
-- An operator can flip it back to true manually (or via a future "retry
-- capability check" UI control) once the tenant has upgraded.
-- =============================================================================

ALTER TABLE public.m365_tenants
    ADD COLUMN IF NOT EXISTS signin_audit_supported BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.m365_tenants.signin_audit_supported IS
    'False after a Graph NonPremium 403 on /auditLogs/signIns or /directoryAudits. Poller skips those endpoints when false. Flip back to true to re-probe after a Premium upgrade.';
