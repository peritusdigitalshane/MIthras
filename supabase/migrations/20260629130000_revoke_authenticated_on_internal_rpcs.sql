-- =========================================================================
-- 2026-06-29 — Lock down internal SECURITY DEFINER RPCs
--
-- A broader sweep beyond the M365 RPCs patched on 2026-06-29 found 15
-- SECURITY DEFINER functions taking an org_id / endpoint_id argument with
-- NO caller-membership check, but with `EXECUTE TO authenticated` granted.
--
-- The risk model: any authenticated user could call these directly via
-- PostgREST by passing somebody else's org_id, bypassing the edge-function
-- layer that's the intended caller. Concrete attacks include
--
--   * api_issue_enrollment_token(other_org)  → forge an agent enrolment
--     token for another tenant, install an agent on attacker hardware,
--     gain a foothold in that tenant's command pipeline.
--   * api_create_customer(other_partner, …)  → create rogue customer orgs
--     under someone else's partner umbrella.
--   * m365_emit_alert(other_org, …)          → inject alerts into a
--     tenant's SOC feed.
--   * enqueue_event_for_destinations(other_org, …) → spray events into
--     another tenant's webhook destinations.
--   * apply_group_policies_to_endpoint(target_endpoint, attacker_group)
--     → attach attacker-controlled policies to victim endpoints.
--
-- All of these are only ever invoked from edge functions running as the
-- service_role bearer. Frontend code never calls them directly (verified
-- by `grep -rn <fn> src` returning only generated types.ts hits).
--
-- Fix: REVOKE EXECUTE from authenticated; the service_role grant remains.
-- service_role inherits all grants by default, but we re-issue the GRANT
-- explicitly to make the intent unambiguous.
--
-- This is the simplest robust fix — it requires no callsite changes.
-- =========================================================================

DO $$
DECLARE
    fn TEXT;
    fns CONSTANT TEXT[] := ARRAY[
        -- Tier 1: critical WRITE on cross-org state
        'public.api_issue_enrollment_token(uuid, uuid, text, text, text, timestamptz)',
        'public.api_create_customer(uuid, text, integer, uuid)',
        'public.apply_group_policies_to_endpoint(uuid, uuid)',
        'public.m365_emit_alert(uuid, text, text, text, text)',
        'public.m365_backfill_oauth_alert_names(uuid)',
        'public.enqueue_event_for_destinations(uuid, text, text, uuid, text, jsonb)',
        'public.next_invoice_number(uuid, date)',
        'public.increment_email_sweep_metrics(uuid, bigint, bigint, bigint, bigint, integer)',

        -- Tier 2: read-only info leak
        'public.ai_soc_budget_remaining_cents(uuid)',
        'public.ai_soc_try_lock_org(uuid)',
        'public.app_control_state_for_endpoint(uuid)',
        'public.effective_endpoint_policies(uuid)',
        'public.get_endpoint_dns_policy(uuid)',
        'public.endpoint_primary_user_upn(uuid)',
        'public.org_has_feature(uuid, text)'
    ];
BEGIN
    FOREACH fn IN ARRAY fns LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated, anon, public', fn);
        EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
END$$;
