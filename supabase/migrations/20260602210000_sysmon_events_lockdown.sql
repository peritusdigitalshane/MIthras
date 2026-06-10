-- PoC review rec #9: sysmon_events INSERT was granted to anon + authenticated
-- with an RLS policy that only checked endpoint <-> org membership. Any user
-- with org membership could craft a forged process_create / network_connect
-- event for any endpoint in their org -- poisoning the very stream the AI
-- triage and SOC dashboard read for decisions.
--
-- The agent ingests via /agent-api/sysmon-events which runs as service_role.
-- No legitimate user flow writes here, so we restrict INSERT/UPDATE/DELETE to
-- service_role at both the GRANT layer (belt) and the policy layer (braces).
-- SELECT stays open to org members so the SOC console keeps working.

-- 1. Drop the loose INSERT policy.
DROP POLICY IF EXISTS "sysmon_events_insert_valid_endpoint" ON public.sysmon_events;

-- 2. Recreate INSERT (and add UPDATE/DELETE -- previously ungated) with a
--    role check. WITH CHECK preserves the endpoint <-> org integrity test so
--    even service_role can't write rows that violate the FK semantics.
CREATE POLICY "sysmon_events_insert_service_role"
    ON public.sysmon_events FOR INSERT
    WITH CHECK (
        auth.role() = 'service_role'
        AND EXISTS (
            SELECT 1 FROM public.endpoints e
             WHERE e.id = sysmon_events.endpoint_id
               AND e.organization_id = sysmon_events.organization_id
        )
    );

CREATE POLICY "sysmon_events_update_service_role"
    ON public.sysmon_events FOR UPDATE
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "sysmon_events_delete_service_role"
    ON public.sysmon_events FOR DELETE
    USING (auth.role() = 'service_role');

-- 3. Revoke GRANT-level INSERT/UPDATE/DELETE from anon + authenticated. SELECT
--    stays so the existing select policy keeps working for org members.
REVOKE INSERT, UPDATE, DELETE ON public.sysmon_events FROM anon, authenticated, PUBLIC;
GRANT  INSERT, UPDATE, DELETE ON public.sysmon_events TO service_role;

COMMENT ON POLICY "sysmon_events_insert_service_role" ON public.sysmon_events IS
'Only service_role (agent ingest path) may insert sysmon events. Closes PoC rec #9 -- previously any org member could forge process telemetry intra-tenant.';
