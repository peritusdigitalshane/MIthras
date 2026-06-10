-- PoC review critical #1: public.log_activity allowed cross-tenant audit-log
-- forgery. SECURITY DEFINER + no caller-vs-_org_id guard + EXECUTE granted to
-- anon meant any authenticated user could plant arbitrary rows -- including
-- fake impersonation_start events -- in any customer org's audit log,
-- bypassing the RLS that otherwise restricts INSERT to service_role.
--
-- Fix: require the caller to be one of
--   (a) the service_role (edge functions, agent ingest path), or
--   (b) authenticated AND a member / partner_admin / super_admin of the target org.
-- Revoke EXECUTE from anon and PUBLIC -- no anonymous flow needs to write audit.

CREATE OR REPLACE FUNCTION public.log_activity(
    _org_id        uuid,
    _action        text,
    _resource_type text,
    _resource_id   text  DEFAULT NULL,
    _details       jsonb DEFAULT NULL,
    _endpoint_id   uuid  DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    new_id      uuid;
    caller_uid  uuid := auth.uid();
    caller_role text := coalesce(auth.role(), '');
BEGIN
    -- service_role bypasses the membership check (edge functions, bootstrap RPCs).
    IF caller_role <> 'service_role' THEN
        IF caller_uid IS NULL THEN
            RAISE EXCEPTION 'forbidden_audit_log_write'
                USING ERRCODE = 'insufficient_privilege',
                      DETAIL  = 'audit logging requires an authenticated session';
        END IF;
        IF NOT (
            public.is_member_of_org(caller_uid, _org_id)
            OR public.is_super_admin(caller_uid)
            OR public.is_partner_admin_of_org(caller_uid, _org_id)
        ) THEN
            RAISE EXCEPTION 'forbidden_audit_log_write'
                USING ERRCODE = 'insufficient_privilege',
                      DETAIL  = 'caller is not a member of the target organization';
        END IF;
    END IF;

    INSERT INTO public.activity_logs (organization_id, user_id, endpoint_id, action, resource_type, resource_id, details)
    VALUES (_org_id, caller_uid, _endpoint_id, _action, _resource_type, _resource_id, _details)
    RETURNING id INTO new_id;
    RETURN new_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.log_activity(uuid, text, text, text, jsonb, uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.log_activity(uuid, text, text, text, jsonb, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.log_activity(uuid, text, text, text, jsonb, uuid) IS
'Audit-log writer. SECURITY DEFINER but guarded: caller must be service_role, super_admin, partner_admin_of_org, or a member of the target org. Closes PoC critical #1 (cross-tenant forgery).';
