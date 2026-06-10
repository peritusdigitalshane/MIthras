-- Hardening sweep for M365 ITDR + AI SOC, from the post-build security review.
--
-- This migration is purely additive / fix-up — no destructive changes,
-- safe to re-run.
--
-- Findings addressed:
--   * M3  — dedup race in m365_detect_signin_spikes (atomic claim)
--   * M4  — token columns of m365_tenants exposed to authenticated role
--   * M7  — m365_detect_mfa_weakened outer branch matches more activities
--           than the inner block handles
--   * M9  — concurrent polls clobbering refresh tokens (advisory lock RPC)
--   * A6  — ai_triage_decisions reviewed_by_user_id can be spoofed
--   * A7  — fire_ai_triage_on_alert crashes on null organization_id
--   * A6b — ai_investigations missing equivalent reviewer WITH CHECK
--   * generic — ai_soc_budget_remaining_cents atomic-claim helper

-- =============================================================================
-- M4: revoke direct base-table SELECT on m365_tenants from authenticated.
-- The token columns must only be reachable via the service-role poller;
-- app code reads through m365_tenants_view (security_invoker=true) which
-- excludes the token columns.
-- =============================================================================
REVOKE SELECT ON public.m365_tenants FROM authenticated;
-- The view grant from the original migration stays in effect; service role
-- bypasses RLS and continues to read tokens for polling.

-- =============================================================================
-- M3: rewrite m365_detect_signin_spikes with an atomic dedup claim.
-- The previous version did SELECT EXISTS ... then INSERT, which two
-- concurrent cron invocations could both pass before either inserted.
-- The new version uses INSERT ... ON CONFLICT DO UPDATE WHERE — the WHERE
-- predicate means the row only updates when the cooldown has passed, and
-- RETURNING tells us whether THIS call won the race.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.m365_detect_signin_spikes()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
    _r RECORD;
    _dedup_key TEXT;
    _alerts_emitted INTEGER := 0;
    _now TIMESTAMPTZ := now();
    _window_start TIMESTAMPTZ := _now - INTERVAL '15 minutes';
    _cooldown TIMESTAMPTZ := _now - INTERVAL '1 hour';
    _claimed BOOLEAN;
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

        -- Atomic claim: insert OR conditionally-update. Returns the row
        -- only when this call's last_fired_at write actually happened.
        WITH claim AS (
            INSERT INTO public.m365_detection_dedup (detection_key, last_fired_at)
            VALUES (_dedup_key, _now)
            ON CONFLICT (detection_key) DO UPDATE
                SET last_fired_at = _now
              WHERE m365_detection_dedup.last_fired_at < _cooldown
            RETURNING 1
        )
        SELECT EXISTS (SELECT 1 FROM claim) INTO _claimed;

        IF _claimed THEN
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

        WITH claim AS (
            INSERT INTO public.m365_detection_dedup (detection_key, last_fired_at)
            VALUES (_dedup_key, _now)
            ON CONFLICT (detection_key) DO UPDATE
                SET last_fired_at = _now
              WHERE m365_detection_dedup.last_fired_at < _cooldown
            RETURNING 1
        )
        SELECT EXISTS (SELECT 1 FROM claim) INTO _claimed;

        IF _claimed THEN
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
            _alerts_emitted := _alerts_emitted + 1;
        END IF;
    END LOOP;

    RETURN _alerts_emitted;
END;
$fn$;

-- =============================================================================
-- M7: collapse m365_detect_mfa_weakened so the outer filter only admits
-- activities the inner block actually acts on. Stops the trigger from
-- doing work on every "Update user" audit event (very common) and silently
-- exiting.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.m365_detect_mfa_weakened()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
    _target_upn TEXT;
BEGIN
    -- Only react to the activities we actually emit alerts for.
    IF NEW.category = 'UserManagement' AND NEW.activity_display_name IN (
        'Disable Strong Authentication', 'User deleted security info'
    ) THEN
        _target_upn := NULL;
        IF NEW.target_resources IS NOT NULL THEN
            SELECT tr->>'userPrincipalName'
              INTO _target_upn
              FROM jsonb_array_elements(NEW.target_resources) tr
             LIMIT 1;
        END IF;

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

    -- Conditional Access policy disabled is the parallel signal.
    IF NEW.category = 'Policy' AND NEW.activity_display_name = 'Update conditional access policy'
       AND NEW.additional_details::text ILIKE '%"state":"disabled"%' THEN
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

    RETURN NEW;
END;
$fn$;

-- =============================================================================
-- M9: advisory-lock helper for tenant polling. Edge fn calls this at the
-- top of pollTenant; if it returns false, another instance is already
-- polling this tenant (e.g., cron + manual button) so we skip.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.m365_try_lock_tenant(p_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public AS $fn$
    SELECT pg_try_advisory_xact_lock(hashtextextended(p_id::text, 0));
$fn$;

GRANT EXECUTE ON FUNCTION public.m365_try_lock_tenant(UUID) TO service_role;

-- =============================================================================
-- AI SOC: A7 — fire_ai_triage_on_alert returns immediately when
-- organization_id is null (defensive; alerts.organization_id is NOT NULL
-- in the current schema but a future migration could relax it).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fire_ai_triage_on_alert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
    _enabled   BOOLEAN;
    _remaining INTEGER;
    _fn_url    TEXT;
    _secret    TEXT;
BEGIN
    -- Belt-and-braces for a NULL organization_id; the column is NOT NULL
    -- today but a future migration could break that assumption.
    IF NEW.organization_id IS NULL THEN RETURN NEW; END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
        RETURN NEW;
    END IF;

    SELECT ai_soc_enabled INTO _enabled
      FROM public.organizations WHERE id = NEW.organization_id;
    IF _enabled IS NOT TRUE THEN RETURN NEW; END IF;

    SELECT public.ai_soc_budget_remaining_cents(NEW.organization_id) INTO _remaining;
    IF _remaining <= 0 THEN
        INSERT INTO public.ai_triage_decisions (alert_id, organization_id, status, error_message)
        VALUES (NEW.id, NEW.organization_id, 'budget_exceeded',
                'Daily AI SOC cost cap reached; auto-triage paused until 00:00 UTC.')
        ON CONFLICT (alert_id) DO NOTHING;
        RETURN NEW;
    END IF;

    SELECT value INTO _fn_url FROM public.platform_settings WHERE key = 'ai_soc_triage_url';
    SELECT value INTO _secret FROM public.platform_settings WHERE key = 'ai_soc_poll_secret';
    IF _fn_url IS NULL OR _fn_url = '' THEN RETURN NEW; END IF;

    INSERT INTO public.ai_triage_decisions (alert_id, organization_id, status)
    VALUES (NEW.id, NEW.organization_id, 'pending')
    ON CONFLICT (alert_id) DO NOTHING;

    PERFORM net.http_post(
        url := _fn_url,
        headers := jsonb_build_object(
            'content-type', 'application/json',
            'x-mithras-soc-secret', COALESCE(_secret, '')
        ),
        body := jsonb_build_object('alert_id', NEW.id::text, 'trigger', 'auto')
    );
    RETURN NEW;
END;
$fn$;

-- =============================================================================
-- A6: ai_triage_decisions UPDATE — restrict so the reviewer_id MUST equal
-- the calling user. Org admins can no longer attribute their reviews to
-- another user.
-- =============================================================================
DROP POLICY IF EXISTS "Org admins review triage decisions" ON public.ai_triage_decisions;
CREATE POLICY "Org admins review triage decisions"
    ON public.ai_triage_decisions FOR UPDATE
    USING (is_admin_of_org(auth.uid(), organization_id))
    WITH CHECK (
        is_admin_of_org(auth.uid(), organization_id)
        AND (reviewed_by_user_id IS NULL OR reviewed_by_user_id = auth.uid())
    );

-- =============================================================================
-- A6b: ai_investigations equivalent — investigation reviews also bound to
-- the calling user (the original policy only checked is_admin_of_org).
-- =============================================================================
DROP POLICY IF EXISTS "Org admins update investigations" ON public.ai_investigations;
CREATE POLICY "Org admins update investigations"
    ON public.ai_investigations FOR UPDATE
    USING (is_admin_of_org(auth.uid(), organization_id))
    WITH CHECK (
        is_admin_of_org(auth.uid(), organization_id)
        AND (reviewed_by_user_id IS NULL OR reviewed_by_user_id = auth.uid())
    );

-- =============================================================================
-- A1 staging: atomic budget claim helper. Until we add a persistent
-- counter column, this RPC takes an advisory lock keyed on the org's
-- UUID for the duration of a transaction — callers must run inside a
-- transaction. Coupled with the existing "decrement on completion" via
-- cost_cents, this prevents two parallel calls from both passing the
-- budget gate.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.ai_soc_try_lock_org(p_org_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public AS $fn$
    SELECT pg_try_advisory_xact_lock(hashtextextended('ai_soc_budget:' || p_org_id::text, 0));
$fn$;

GRANT EXECUTE ON FUNCTION public.ai_soc_try_lock_org(UUID) TO service_role;
