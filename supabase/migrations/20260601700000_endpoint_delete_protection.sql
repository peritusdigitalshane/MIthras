-- Prevent endpoints from disappearing silently.
--
-- Background: on 2026-05-29 an endpoint was enrolled into the Capable
-- Spaces customer, added to a group, and at some point later was deleted
-- without trace. No backend code path deletes from public.endpoints, and
-- Postgres only logs DDL — so a stray DELETE (direct SQL during a
-- migration, Studio query, manual cleanup) can wipe an endpoint and the
-- audit trail with it. Group memberships, enrollment_tokens.used_by_endpoint
-- and activity_logs.endpoint_id all SET NULL or CASCADE, leaving nothing.
--
-- This migration adds three layers of protection:
--   1. Soft-delete columns (deleted_at, deleted_by, deletion_reason) so
--      "removal" is a flag, not a row-disappearance.
--   2. A BEFORE DELETE trigger on endpoints that RAISES unless the caller
--      explicitly sets a session-level opt-in flag. That blocks every
--      accidental or unintentional DELETE — UI bugs, runaway migrations,
--      stray Studio queries, cascade slip-ups (none today, but defense in
--      depth).
--   3. An AFTER trigger on the soft-delete column that writes an
--      activity_logs row with WHO did it, WHEN, and WHY.
--
-- App queries should filter `deleted_at IS NULL`. A partial index keeps
-- the live-endpoint lookups fast.
--
-- Safe to re-run; idempotent.

-- =============================================================================
-- Soft-delete columns
-- =============================================================================
ALTER TABLE public.endpoints
    ADD COLUMN IF NOT EXISTS deleted_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS deletion_reason  TEXT;

COMMENT ON COLUMN public.endpoints.deleted_at IS
    'Soft-delete timestamp. NULL = live endpoint. Set via public.endpoint_soft_delete(); never via direct UPDATE from app code.';

-- Live-endpoint partial index — keeps the existing hot paths fast.
CREATE INDEX IF NOT EXISTS idx_endpoints_org_live
    ON public.endpoints(organization_id) WHERE deleted_at IS NULL;

-- =============================================================================
-- Hard-DELETE guard. The trigger refuses to delete any endpoint row
-- unless the session has opted in via:
--   SELECT set_config('mithras.allow_endpoint_hard_delete', 'true', true);
-- This blocks every accidental or unintentional DELETE.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.endpoints_guard_hard_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
DECLARE
    _allowed TEXT;
BEGIN
    _allowed := current_setting('mithras.allow_endpoint_hard_delete', true);
    IF COALESCE(_allowed, '') <> 'true' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'restrict_violation',
            MESSAGE = 'Hard DELETE on public.endpoints is blocked.',
            DETAIL  = format(
                'Attempted to delete endpoint id=%s hostname=%s organization_id=%s.',
                OLD.id, OLD.hostname, OLD.organization_id
            ),
            HINT    = 'Use public.endpoint_soft_delete(id, reason) for normal removal. For a genuine purge, set mithras.allow_endpoint_hard_delete=''true'' for the session first.';
    END IF;
    RETURN OLD;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_endpoints_guard_hard_delete ON public.endpoints;
CREATE TRIGGER trg_endpoints_guard_hard_delete
    BEFORE DELETE ON public.endpoints
    FOR EACH ROW EXECUTE FUNCTION public.endpoints_guard_hard_delete();

-- =============================================================================
-- Soft-delete + restore RPCs. Both go through these helpers so we always
-- capture WHO did it and WHY.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.endpoint_soft_delete(
    p_endpoint_id UUID,
    p_reason      TEXT DEFAULT 'no reason supplied'
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
    _user_id UUID := auth.uid();
    _ep      RECORD;
BEGIN
    SELECT id, organization_id, hostname, deleted_at INTO _ep
      FROM public.endpoints WHERE id = p_endpoint_id;
    IF _ep IS NULL THEN
        RAISE EXCEPTION 'endpoint_not_found' USING ERRCODE = 'no_data_found';
    END IF;
    IF _ep.deleted_at IS NOT NULL THEN
        RETURN false;       -- already soft-deleted
    END IF;

    -- Permission: super-admin OR admin of the endpoint's org.
    IF NOT (
        public.is_super_admin(_user_id)
        OR public.is_admin_of_org(_user_id, _ep.organization_id)
    ) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
    END IF;

    UPDATE public.endpoints
       SET deleted_at = now(),
           deleted_by = _user_id,
           deletion_reason = LEFT(COALESCE(p_reason, ''), 500),
           is_active = false
     WHERE id = p_endpoint_id;
    RETURN true;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.endpoint_restore(p_endpoint_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
    _user_id UUID := auth.uid();
    _ep      RECORD;
BEGIN
    SELECT id, organization_id, deleted_at INTO _ep
      FROM public.endpoints WHERE id = p_endpoint_id;
    IF _ep IS NULL THEN
        RAISE EXCEPTION 'endpoint_not_found' USING ERRCODE = 'no_data_found';
    END IF;
    IF _ep.deleted_at IS NULL THEN
        RETURN false;       -- already live
    END IF;

    IF NOT (
        public.is_super_admin(_user_id)
        OR public.is_admin_of_org(_user_id, _ep.organization_id)
    ) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
    END IF;

    UPDATE public.endpoints
       SET deleted_at = NULL,
           deleted_by = NULL,
           deletion_reason = NULL,
           is_active = true
     WHERE id = p_endpoint_id;
    RETURN true;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.endpoint_soft_delete(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.endpoint_restore(UUID)           TO authenticated;

-- =============================================================================
-- Audit trail. Fires on the soft-delete transition AND on every hard
-- DELETE that somehow gets past the guard. Records hostname so the row
-- is recoverable from the activity log even if the endpoint id is gone.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.endpoints_log_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
    -- Determine event kind.
    IF TG_OP = 'DELETE' THEN
        INSERT INTO public.activity_logs (
            organization_id, user_id, endpoint_id, action, resource_type, resource_id, details
        ) VALUES (
            OLD.organization_id,
            NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'sub',
            NULL,                                    -- FK already gone
            'endpoint_hard_deleted',
            'endpoint',
            OLD.id::text,
            jsonb_build_object(
                'hostname', OLD.hostname,
                'runtime',  OLD.runtime,
                'os',       OLD.os_version,
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

DROP TRIGGER IF EXISTS trg_endpoints_audit_delete ON public.endpoints;
CREATE TRIGGER trg_endpoints_audit_delete
    AFTER DELETE OR UPDATE OF deleted_at ON public.endpoints
    FOR EACH ROW EXECUTE FUNCTION public.endpoints_log_delete();

-- =============================================================================
-- View that surfaces only live endpoints to the app layer. The existing
-- table stays unrestricted (so the service role + admin RPCs can see
-- everything for restore), but the app should read from this view.
-- security_invoker so RLS applies as the calling user.
-- =============================================================================
CREATE OR REPLACE VIEW public.endpoints_live
    WITH (security_invoker = true) AS
    SELECT * FROM public.endpoints WHERE deleted_at IS NULL;

GRANT SELECT ON public.endpoints_live TO authenticated;
