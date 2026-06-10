-- Close the remaining two WITH CHECK (true) INSERT policies from the
-- 2026-05-14 prod-readiness review item #8 — audit-trail / alert poisoning.
--
-- alerts.System can insert alerts and policy_audit_findings.System can insert findings
-- both used WITH CHECK (true) for INSERT TO public. The only real writers are
-- agent-api (service_role) and the create_finding_for_violation trigger (SECURITY
-- DEFINER, owner-level). Both bypass RLS regardless of role grants, so restricting
-- the published policy to service_role is safe and removes the cross-tenant
-- write hole for any authenticated session.

DROP POLICY IF EXISTS "System can insert alerts" ON public.alerts;
CREATE POLICY "Service role can insert alerts"
ON public.alerts FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "System can insert findings" ON public.policy_audit_findings;
CREATE POLICY "Service role can insert findings"
ON public.policy_audit_findings FOR INSERT TO service_role WITH CHECK (true);
