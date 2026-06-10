-- Microsoft 365 ITDR — detection rule engine.
--
-- Two flavours of detection:
--   1. Trigger-based — fire the moment a row is inserted/updated. Used for
--      "new mailbox forwarding rule", "suspicious sign-in", "MFA weakened",
--      "privileged role granted", "suspicious OAuth grant".
--   2. Scheduled aggregate — pg_cron runs every 5 minutes to look at
--      windowed counts. Used for "failed sign-in spike" and "mass download".
--
-- Every detection produces a row in public.alerts with alert_type beginning
-- 'm365_' and links back to the M365 tenant via raw JSON metadata in the
-- message (we don't carve a separate FK because alerts is already org-scoped).

-- =============================================================================
-- High-risk OAuth scopes — used by both the trigger and the poller.
-- Maintained as a SQL function so we can update it in one place.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.m365_high_risk_scopes()
RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $fn$
    SELECT ARRAY[
        'Mail.ReadWrite', 'Mail.Send', 'Mail.ReadWrite.All', 'Mail.Send.Shared',
        'MailboxSettings.ReadWrite', 'full_access_as_app',
        'Files.ReadWrite.All', 'Sites.FullControl.All',
        'User.ReadWrite.All', 'Directory.ReadWrite.All',
        'Application.ReadWrite.All', 'AppRoleAssignment.ReadWrite.All',
        'RoleManagement.ReadWrite.Directory', 'Policy.ReadWrite.ConditionalAccess'
    ]
$fn$;

-- =============================================================================
-- Privileged role names — Entra ID built-in admin roles we flag on assignment.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.m365_privileged_role_names()
RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $fn$
    SELECT ARRAY[
        'Global Administrator', 'Company Administrator',
        'Privileged Role Administrator', 'Privileged Authentication Administrator',
        'Exchange Administrator', 'SharePoint Administrator',
        'User Administrator', 'Application Administrator',
        'Cloud Application Administrator', 'Authentication Administrator',
        'Conditional Access Administrator', 'Security Administrator',
        'Helpdesk Administrator'
    ]
$fn$;

-- =============================================================================
-- Common alert insert helper
-- =============================================================================
CREATE OR REPLACE FUNCTION public.m365_emit_alert(
    p_org_id UUID,
    p_severity TEXT,
    p_alert_type TEXT,
    p_title TEXT,
    p_message TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
    _alert_id UUID;
BEGIN
    INSERT INTO public.alerts (organization_id, alert_type, severity, title, message)
    VALUES (p_org_id, p_alert_type, p_severity, p_title, p_message)
    RETURNING id INTO _alert_id;
    RETURN _alert_id;
END;
$fn$;

-- =============================================================================
-- Detection 1 + 2: sign-in events trigger
--   1a. risk_level >= medium → 'm365_suspicious_signin'
--   1b. anonymous-proxy / TOR / impossible-travel via risk_event_types
-- =============================================================================
CREATE OR REPLACE FUNCTION public.m365_detect_signin()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
    _sev TEXT;
    _reason TEXT;
BEGIN
    IF NEW.risk_level IN ('medium', 'high') THEN
        _sev := CASE WHEN NEW.risk_level = 'high' THEN 'critical' ELSE 'high' END;
        _reason := 'Entra ID risk score = ' || NEW.risk_level;
        IF NEW.risk_event_types IS NOT NULL AND array_length(NEW.risk_event_types, 1) > 0 THEN
            _reason := _reason || ' (' || array_to_string(NEW.risk_event_types, ', ') || ')';
        END IF;

        PERFORM public.m365_emit_alert(
            NEW.organization_id,
            _sev,
            'm365_suspicious_signin',
            'Suspicious M365 sign-in: ' || COALESCE(NEW.user_principal_name, 'unknown user'),
            'Sign-in flagged by Entra ID risk detection. ' || _reason ||
            COALESCE('. Source: ' || NEW.ip_address::text, '') ||
            COALESCE(' (' || NEW.city || ', ' || NEW.country || ')', '') ||
            COALESCE('. App: ' || NEW.app_display_name, '') ||
            '. Review at https://portal.azure.com → Entra ID → Sign-in logs.'
        );
    END IF;
    RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_m365_detect_signin
    AFTER INSERT ON public.m365_sign_in_events
    FOR EACH ROW EXECUTE FUNCTION public.m365_detect_signin();

-- =============================================================================
-- Detection 3: external mailbox forwarding rule
-- Fires when a row arrives in m365_mailbox_rules with forwards_externally=true
-- and is_active=true (insert OR update transition).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.m365_detect_mailbox_external_forward()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
    IF NEW.forwards_externally IS TRUE AND NEW.is_active IS TRUE THEN
        -- Don't re-fire on every poll for the same rule: only when this is
        -- a brand-new row, or when forwards_externally flipped to true.
        IF (TG_OP = 'INSERT')
           OR (TG_OP = 'UPDATE' AND COALESCE(OLD.forwards_externally, false) = false)
           OR (TG_OP = 'UPDATE' AND COALESCE(OLD.is_active, false) = false)
        THEN
            PERFORM public.m365_emit_alert(
                NEW.organization_id,
                'critical',
                'm365_external_mailbox_forward',
                'Mailbox rule forwards mail externally: ' || NEW.user_principal_name,
                'A new inbox rule on ' || NEW.user_principal_name ||
                ' forwards mail to external address(es): ' ||
                COALESCE(array_to_string(NEW.forward_to_addresses, ', '), 'unknown') ||
                '. Rule name: "' || COALESCE(NEW.rule_name, '(unnamed)') || '".' ||
                ' This is the single strongest indicator of business email compromise (BEC).' ||
                ' Verify with the user and disable the rule immediately if unauthorised.'
            );
        END IF;
    END IF;
    RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_m365_detect_mailbox_external_forward
    AFTER INSERT OR UPDATE ON public.m365_mailbox_rules
    FOR EACH ROW EXECUTE FUNCTION public.m365_detect_mailbox_external_forward();

-- =============================================================================
-- Detection 4: MFA weakened / disabled
-- Fires on audit events with activityDisplayName matching MFA management
-- and a non-success outcome that materially weakens posture.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.m365_detect_mfa_weakened()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
    _target_upn TEXT;
BEGIN
    IF NEW.category = 'UserManagement'
       AND NEW.activity_display_name IN (
           'Disable Strong Authentication',
           'Update user',
           'Reset user password',
           'Update authentication methods',
           'User registered security info',
           'User deleted security info'
       )
    THEN
        -- Try to surface the affected UPN from target_resources.
        _target_upn := NULL;
        IF NEW.target_resources IS NOT NULL THEN
            SELECT tr->>'userPrincipalName'
              INTO _target_upn
              FROM jsonb_array_elements(NEW.target_resources) tr
             LIMIT 1;
        END IF;

        IF NEW.activity_display_name IN ('Disable Strong Authentication', 'User deleted security info') THEN
            PERFORM public.m365_emit_alert(
                NEW.organization_id,
                'high',
                'm365_mfa_weakened',
                'MFA weakened: ' || COALESCE(_target_upn, 'unknown user'),
                'Audit event "' || NEW.activity_display_name || '" by ' ||
                COALESCE(NEW.initiated_by_user_upn, NEW.initiated_by_app_name, 'unknown actor') ||
                ' affected ' || COALESCE(_target_upn, 'a user') ||
                '. This either removed MFA or downgraded the auth method.' ||
                ' If unexpected, treat as account-compromise.'
            );
        END IF;
    END IF;

    -- Conditional Access policy disabled is a separate signal.
    IF NEW.category = 'Policy' AND NEW.activity_display_name = 'Update conditional access policy' THEN
        IF NEW.additional_details::text ILIKE '%"state":"disabled"%' THEN
            PERFORM public.m365_emit_alert(
                NEW.organization_id,
                'high',
                'm365_ca_policy_disabled',
                'Conditional Access policy disabled',
                'Conditional Access policy was disabled by ' ||
                COALESCE(NEW.initiated_by_user_upn, NEW.initiated_by_app_name, 'unknown actor') ||
                '. This commonly precedes attacker persistence. Verify the change is intentional.'
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_m365_detect_mfa_weakened
    AFTER INSERT ON public.m365_audit_events
    FOR EACH ROW EXECUTE FUNCTION public.m365_detect_mfa_weakened();

-- =============================================================================
-- Detection 5: privileged role granted
-- =============================================================================
CREATE OR REPLACE FUNCTION public.m365_detect_privileged_role()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
    _role_name TEXT;
    _target_upn TEXT;
    _privileged_roles TEXT[];
BEGIN
    IF NEW.category = 'RoleManagement'
       AND NEW.activity_display_name IN ('Add member to role', 'Add eligible member to role')
       AND NEW.target_resources IS NOT NULL
    THEN
        _privileged_roles := public.m365_privileged_role_names();

        -- The role being assigned typically appears as a target resource of
        -- type 'Role'. Find it and check the display name.
        SELECT tr->>'displayName'
          INTO _role_name
          FROM jsonb_array_elements(NEW.target_resources) tr
         WHERE tr->>'type' = 'Role'
         LIMIT 1;

        -- The user being assigned is a separate target_resources entry.
        SELECT tr->>'userPrincipalName'
          INTO _target_upn
          FROM jsonb_array_elements(NEW.target_resources) tr
         WHERE tr->>'type' = 'User'
         LIMIT 1;

        IF _role_name IS NOT NULL AND _role_name = ANY(_privileged_roles) THEN
            PERFORM public.m365_emit_alert(
                NEW.organization_id,
                'critical',
                'm365_privileged_role_assigned',
                'Privileged role granted: ' || _role_name,
                'The role "' || _role_name || '" was granted to ' ||
                COALESCE(_target_upn, 'a user') || ' by ' ||
                COALESCE(NEW.initiated_by_user_upn, NEW.initiated_by_app_name, 'unknown actor') ||
                '. Privileged role assignments are a top attacker objective — verify this' ||
                ' change with the affected admins before continuing.'
            );
        END IF;
    END IF;
    RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_m365_detect_privileged_role
    AFTER INSERT ON public.m365_audit_events
    FOR EACH ROW EXECUTE FUNCTION public.m365_detect_privileged_role();

-- =============================================================================
-- Detection 6: suspicious OAuth grant (illicit consent)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.m365_detect_oauth_grant()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
    IF NEW.has_high_risk_scope IS TRUE AND NEW.is_active IS TRUE THEN
        IF (TG_OP = 'INSERT')
           OR (TG_OP = 'UPDATE' AND COALESCE(OLD.has_high_risk_scope, false) = false)
        THEN
            PERFORM public.m365_emit_alert(
                NEW.organization_id,
                'high',
                'm365_high_risk_oauth_grant',
                'Suspicious OAuth grant: ' || COALESCE(NEW.client_display_name, NEW.client_id),
                'The OAuth app "' || COALESCE(NEW.client_display_name, NEW.client_id) || '"' ||
                ' was granted high-risk scope(s): ' ||
                COALESCE(array_to_string(NEW.high_risk_scopes_matched, ', '), NEW.scope) ||
                CASE WHEN NEW.principal_upn IS NOT NULL
                     THEN '. Granted by user: ' || NEW.principal_upn
                     ELSE '. Tenant-wide consent.'
                END ||
                '. This is the classic "illicit consent" attack pattern. If the app is unknown' ||
                ' or unexpected, revoke the grant from Entra ID → Enterprise applications.'
            );
        END IF;
    END IF;
    RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_m365_detect_oauth_grant
    AFTER INSERT OR UPDATE ON public.m365_oauth_grants
    FOR EACH ROW EXECUTE FUNCTION public.m365_detect_oauth_grant();

-- =============================================================================
-- Detection 7: failed sign-in spike (password spray)
-- Aggregate query, run by pg_cron every 5 minutes.
-- Thresholds: 50 failures for a single user in 15 min, OR 500 across the
-- tenant in 15 min.
-- We dedup by remembering when we last fired for a given tenant — kept as
-- a row in a tiny side table.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.m365_detection_dedup (
    detection_key   TEXT PRIMARY KEY,
    last_fired_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.m365_detect_signin_spikes()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
    _r RECORD;
    _dedup_key TEXT;
    _alerts_emitted INTEGER := 0;
    _now TIMESTAMPTZ := now();
    _window_start TIMESTAMPTZ := _now - INTERVAL '15 minutes';
    _cooldown TIMESTAMPTZ := _now - INTERVAL '1 hour';
BEGIN
    -- Per-user spike.
    FOR _r IN
        SELECT m365_tenant_id, organization_id, user_principal_name, COUNT(*) AS failures
          FROM public.m365_sign_in_events
         WHERE occurred_at >= _window_start
           AND status_error_code IS NOT NULL
           AND status_error_code <> 0
           AND user_principal_name IS NOT NULL
         GROUP BY m365_tenant_id, organization_id, user_principal_name
        HAVING COUNT(*) >= 50
    LOOP
        _dedup_key := 'signin_user:' || _r.m365_tenant_id::text || ':' || _r.user_principal_name;
        IF NOT EXISTS (
            SELECT 1 FROM public.m365_detection_dedup
             WHERE detection_key = _dedup_key AND last_fired_at >= _cooldown
        ) THEN
            PERFORM public.m365_emit_alert(
                _r.organization_id,
                'high',
                'm365_signin_spike_user',
                'Failed sign-in spike: ' || _r.user_principal_name,
                _r.failures || ' failed sign-ins for ' || _r.user_principal_name ||
                ' in the last 15 minutes. Strong indicator of password-spray or' ||
                ' brute-force activity. Check the source IPs and consider blocking,' ||
                ' temporarily disabling the account, or forcing password reset.'
            );
            INSERT INTO public.m365_detection_dedup (detection_key, last_fired_at)
            VALUES (_dedup_key, _now)
            ON CONFLICT (detection_key) DO UPDATE SET last_fired_at = _now;
            _alerts_emitted := _alerts_emitted + 1;
        END IF;
    END LOOP;

    -- Tenant-wide spike.
    FOR _r IN
        SELECT m365_tenant_id, organization_id, COUNT(*) AS failures
          FROM public.m365_sign_in_events
         WHERE occurred_at >= _window_start
           AND status_error_code IS NOT NULL
           AND status_error_code <> 0
         GROUP BY m365_tenant_id, organization_id
        HAVING COUNT(*) >= 500
    LOOP
        _dedup_key := 'signin_tenant:' || _r.m365_tenant_id::text;
        IF NOT EXISTS (
            SELECT 1 FROM public.m365_detection_dedup
             WHERE detection_key = _dedup_key AND last_fired_at >= _cooldown
        ) THEN
            PERFORM public.m365_emit_alert(
                _r.organization_id,
                'critical',
                'm365_signin_spike_tenant',
                'Failed sign-in spike (tenant-wide)',
                _r.failures || ' failed sign-ins across the tenant in the last 15 minutes.' ||
                ' Strong indicator of distributed password-spray. Review the source IPs' ||
                ' and consider tenant-level conditional access (block country / require' ||
                ' MFA) until the activity dies down.'
            );
            INSERT INTO public.m365_detection_dedup (detection_key, last_fired_at)
            VALUES (_dedup_key, _now)
            ON CONFLICT (detection_key) DO UPDATE SET last_fired_at = _now;
            _alerts_emitted := _alerts_emitted + 1;
        END IF;
    END LOOP;

    RETURN _alerts_emitted;
END;
$fn$;

-- =============================================================================
-- pg_cron schedule for the aggregate detections
-- =============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        -- Run every 5 minutes, off-phase from the poller.
        PERFORM cron.unschedule('m365-detect-signin-spikes');
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.schedule(
            'm365-detect-signin-spikes',
            '2-59/5 * * * *',
            $cron$ SELECT public.m365_detect_signin_spikes(); $cron$
        );
    END IF;
END $$;
