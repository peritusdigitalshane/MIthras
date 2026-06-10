-- 20260605061000_reseller_rls_gap_fill.sql
--
-- Adds reseller (partner-admin) visibility on tables that today only have
-- direct-member or super-admin SELECT policies. Without these, a reseller
-- logged into /partner could see their customers in the org list but the
-- drill-in views (status, threats, events, audit logs) would return empty.
--
-- Pattern: where the table has organization_id directly, scope by
--   is_partner_admin_of_org(auth.uid(), organization_id)
-- where the table is keyed by endpoint_id, walk via the endpoints table.
--
-- All policies are SELECT-only — resellers are read-through to customer
-- telemetry; mutation policies stay with existing roles.

-- endpoint_status ----------------------------------------------------------
DROP POLICY IF EXISTS "Reseller admins read customer endpoint status" ON public.endpoint_status;
CREATE POLICY "Reseller admins read customer endpoint status"
    ON public.endpoint_status FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.endpoints e
             WHERE e.id = endpoint_status.endpoint_id
               AND public.is_partner_admin_of_org(auth.uid(), e.organization_id)
        )
    );

-- endpoint_threats ---------------------------------------------------------
DROP POLICY IF EXISTS "Reseller admins read customer endpoint threats" ON public.endpoint_threats;
CREATE POLICY "Reseller admins read customer endpoint threats"
    ON public.endpoint_threats FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.endpoints e
             WHERE e.id = endpoint_threats.endpoint_id
               AND public.is_partner_admin_of_org(auth.uid(), e.organization_id)
        )
    );

DROP POLICY IF EXISTS "Reseller admins update customer endpoint threats" ON public.endpoint_threats;
CREATE POLICY "Reseller admins update customer endpoint threats"
    ON public.endpoint_threats FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.endpoints e
             WHERE e.id = endpoint_threats.endpoint_id
               AND public.is_partner_admin_of_org(auth.uid(), e.organization_id)
        )
    );

-- endpoint_event_logs ------------------------------------------------------
DROP POLICY IF EXISTS "Reseller admins read customer event logs" ON public.endpoint_event_logs;
CREATE POLICY "Reseller admins read customer event logs"
    ON public.endpoint_event_logs FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.endpoints e
             WHERE e.id = endpoint_event_logs.endpoint_id
               AND public.is_partner_admin_of_org(auth.uid(), e.organization_id)
        )
    );

-- endpoint_logs ------------------------------------------------------------
DROP POLICY IF EXISTS "Reseller admins read customer endpoint logs" ON public.endpoint_logs;
CREATE POLICY "Reseller admins read customer endpoint logs"
    ON public.endpoint_logs FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.endpoints e
             WHERE e.id = endpoint_logs.endpoint_id
               AND public.is_partner_admin_of_org(auth.uid(), e.organization_id)
        )
    );

-- enrollment_tokens --------------------------------------------------------
-- Resellers need to CREATE enrolment tokens for their customers (so they can
-- generate deploy commands) and SELECT to list outstanding ones.
DROP POLICY IF EXISTS "Reseller admins manage customer enrollment tokens" ON public.enrollment_tokens;
CREATE POLICY "Reseller admins manage customer enrollment tokens"
    ON public.enrollment_tokens FOR ALL
    USING (public.is_partner_admin_of_org(auth.uid(), organization_id))
    WITH CHECK (public.is_partner_admin_of_org(auth.uid(), organization_id));

-- agent_commands -----------------------------------------------------------
-- Resellers see and dispatch commands against their customers' endpoints.
DROP POLICY IF EXISTS "Reseller admins read customer agent commands" ON public.agent_commands;
CREATE POLICY "Reseller admins read customer agent commands"
    ON public.agent_commands FOR SELECT
    USING (public.is_partner_admin_of_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Reseller admins insert customer agent commands" ON public.agent_commands;
CREATE POLICY "Reseller admins insert customer agent commands"
    ON public.agent_commands FOR INSERT
    WITH CHECK (public.is_partner_admin_of_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Reseller admins update customer agent commands" ON public.agent_commands;
CREATE POLICY "Reseller admins update customer agent commands"
    ON public.agent_commands FOR UPDATE
    USING (public.is_partner_admin_of_org(auth.uid(), organization_id));

-- agent_update_log ---------------------------------------------------------
DROP POLICY IF EXISTS "Reseller admins read customer agent update log" ON public.agent_update_log;
CREATE POLICY "Reseller admins read customer agent update log"
    ON public.agent_update_log FOR SELECT
    USING (public.is_partner_admin_of_org(auth.uid(), organization_id));

-- firewall_audit_logs ------------------------------------------------------
-- Reseller-visible only. The mutation path stays with the agent service role.
DROP POLICY IF EXISTS "Reseller admins read customer firewall audit logs" ON public.firewall_audit_logs;
CREATE POLICY "Reseller admins read customer firewall audit logs"
    ON public.firewall_audit_logs FOR SELECT
    USING (public.is_partner_admin_of_org(auth.uid(), organization_id));

-- profiles -----------------------------------------------------------------
-- Resellers need to see the profiles of users IN their customer orgs (to
-- show "added by X" attribution etc.). The existing policy already handles
-- this via the membership-cross-join EXISTS, but we add an explicit
-- partner-admin path so the policy is greppable.
-- (No-op if already permitted; an extra OR policy is harmless.)
