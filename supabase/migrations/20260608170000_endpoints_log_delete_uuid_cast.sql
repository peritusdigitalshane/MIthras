-- Wave 16: endpoints_log_delete() casts the JWT 'sub' claim (text) into
-- activity_logs.user_id (uuid) without an explicit cast. Every hard-delete
-- on endpoints raises:
--   column "user_id" is of type uuid but expression is of type text
-- which blocks the row from being removed even after the operator opts in
-- via mithras.allow_endpoint_hard_delete. The intent of the hard-delete
-- path is operator cleanup of test rows, so silent blockage is wrong.
--
-- Fix: add ::uuid to the expression. Defensive guard via NULLIF on the
-- inner subscript so a malformed 'sub' claim becomes NULL rather than
-- failing the cast.

CREATE OR REPLACE FUNCTION public.endpoints_log_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO public.activity_logs (
            organization_id, user_id, endpoint_id, action, resource_type, resource_id, details
        ) VALUES (
            OLD.organization_id,
            -- Cast the JWT sub claim to uuid. The two NULLIFs guard
            -- against (a) missing claims setting at all, and (b) a
            -- malformed/empty sub claim. A non-uuid sub still raises;
            -- that's preferable to silently logging the wrong user.
            NULLIF(
                NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'sub',
                ''
            )::uuid,
            NULL,
            'endpoint_hard_deleted',
            'endpoint',
            OLD.id::text,
            jsonb_build_object(
                'hostname',     OLD.hostname,
                'runtime',      OLD.runtime,
                'os',           OLD.os_version,
                'last_seen_at', OLD.last_seen_at
            )
        );
    ELSIF TG_OP = 'UPDATE'
       AND OLD.deleted_at IS NULL
       AND NEW.deleted_at IS NOT NULL
    THEN
        INSERT INTO public.activity_logs (
            organization_id, user_id, endpoint_id, action, resource_type, resource_id, details
        ) VALUES (
            NEW.organization_id,
            NEW.deleted_by,
            NEW.id,
            'endpoint_soft_deleted',
            'endpoint',
            NEW.id::text,
            jsonb_build_object(
                'hostname', NEW.hostname,
                'reason',   NEW.deletion_reason
            )
        );
    ELSIF TG_OP = 'UPDATE'
       AND OLD.deleted_at IS NOT NULL
       AND NEW.deleted_at IS NULL
    THEN
        INSERT INTO public.activity_logs (
            organization_id, user_id, endpoint_id, action, resource_type, resource_id, details
        ) VALUES (
            NEW.organization_id,
            auth.uid(),
            NEW.id,
            'endpoint_restored',
            'endpoint',
            NEW.id::text,
            jsonb_build_object('hostname', NEW.hostname)
        );
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$fn$;
