-- 20260530001000_close_service_role_rls_holes.sql
--
-- B8 fix: ten policies named "service role can..." actually had WITH CHECK (true)
-- on the write side, which means any authenticated user could write the row
-- without RLS rejecting it. The function-layer code does verify the caller's
-- JWT, but a misbehaving / compromised / outdated frontend bypass route would
-- shape-shift directly into the table via PostgREST.
--
-- This migration replaces those policies with explicit auth.role() = 'service_role'
-- gates so RLS itself is the second line of defence — the policy passes only
-- when PostgREST authenticates as the service_role JWT.

BEGIN;

-- ------------------------------------------------------------------
-- activity_logs
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS "Service role can insert activity logs" ON public.activity_logs;
CREATE POLICY "activity_logs_service_insert"
    ON public.activity_logs FOR INSERT
    WITH CHECK (auth.role() = 'service_role');

-- ------------------------------------------------------------------
-- agent_commands  (ALL with USING true / WITH CHECK true → catastrophic)
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS "agent_commands_service" ON public.agent_commands;
CREATE POLICY "agent_commands_service"
    ON public.agent_commands FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- ------------------------------------------------------------------
-- alerts
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS "Service role can insert alerts" ON public.alerts;
CREATE POLICY "alerts_service_insert"
    ON public.alerts FOR INSERT
    WITH CHECK (auth.role() = 'service_role');

-- ------------------------------------------------------------------
-- customer_reports  (INSERT + UPDATE were both wide-open)
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS "customer_reports_insert_service" ON public.customer_reports;
CREATE POLICY "customer_reports_insert_service"
    ON public.customer_reports FOR INSERT
    WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "customer_reports_update_service" ON public.customer_reports;
CREATE POLICY "customer_reports_update_service"
    ON public.customer_reports FOR UPDATE
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- ------------------------------------------------------------------
-- endpoint_persistence_snapshots
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS "persistence_insert_service" ON public.endpoint_persistence_snapshots;
CREATE POLICY "persistence_insert_service"
    ON public.endpoint_persistence_snapshots FOR INSERT
    WITH CHECK (auth.role() = 'service_role');

-- ------------------------------------------------------------------
-- firewall_audit_logs
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS "Service role can insert firewall audit logs" ON public.firewall_audit_logs;
DROP POLICY IF EXISTS "Allow insert firewall audit logs for valid endpoints" ON public.firewall_audit_logs;
CREATE POLICY "firewall_audit_service_insert"
    ON public.firewall_audit_logs FOR INSERT
    WITH CHECK (auth.role() = 'service_role');

-- ------------------------------------------------------------------
-- incident_ai_assessments  (ALL with USING true / WITH CHECK true → catastrophic)
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS "incident_ai_service" ON public.incident_ai_assessments;
CREATE POLICY "incident_ai_service"
    ON public.incident_ai_assessments FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- ------------------------------------------------------------------
-- incidents
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS "incidents_insert_service" ON public.incidents;
CREATE POLICY "incidents_insert_service"
    ON public.incidents FOR INSERT
    WITH CHECK (auth.role() = 'service_role');

-- ------------------------------------------------------------------
-- policy_audit_findings
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS "Service role can insert findings" ON public.policy_audit_findings;
CREATE POLICY "policy_audit_findings_service_insert"
    ON public.policy_audit_findings FOR INSERT
    WITH CHECK (auth.role() = 'service_role');

-- ------------------------------------------------------------------
-- hardening_recommendations had check (e.organization_id = e.organization_id)
-- which is always true — same hole. Replace with a real endpoint-org match.
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS "Insert recommendations for valid endpoints" ON public.hardening_recommendations;
CREATE POLICY "hardening_recommendations_service_insert"
    ON public.hardening_recommendations FOR INSERT
    WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Insert hardening status for valid endpoints" ON public.endpoint_hardening_status;
CREATE POLICY "endpoint_hardening_status_service_insert"
    ON public.endpoint_hardening_status FOR INSERT
    WITH CHECK (auth.role() = 'service_role');

COMMIT;
