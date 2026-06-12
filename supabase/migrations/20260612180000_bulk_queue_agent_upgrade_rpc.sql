-- =============================================================================
-- bulk_queue_agent_upgrade()
--
-- Bulk-issues an upgrade_agent command for every endpoint that's behind the
-- latest stable PowerShell agent version. Replaces walking the endpoints
-- table by hand from the dashboard.
--
-- Scope rules:
--   * Super-admins can target any org (or all orgs if p_org_id IS NULL)
--   * Org admins can only target their own org
--   * Anyone else: 0 rows updated
--
-- Idempotency: skips endpoints that already have a queued or dispatched
-- upgrade_agent command, so re-clicking the button doesn't double-queue.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.bulk_queue_agent_upgrade(
    p_org_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid        uuid := auth.uid();
    v_is_super   boolean;
    v_latest     record;
    v_queued     int := 0;
    v_already    int := 0;
    v_orgs       uuid[];
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
    END IF;

    -- Pull the latest active stable PS agent.
    SELECT version, download_url, sha256
      INTO v_latest
      FROM public.agent_versions
     WHERE runtime  = 'powershell'
       AND channel  = 'stable'
       AND is_active = true
     ORDER BY published_at DESC
     LIMIT 1;
    IF v_latest IS NULL THEN
        RETURN jsonb_build_object(
            'queued', 0, 'already_queued', 0,
            'error', 'no_active_stable_agent_version'
        );
    END IF;

    -- Resolve permission + target orgs.
    SELECT EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = v_uid)
      INTO v_is_super;

    IF v_is_super THEN
        IF p_org_id IS NULL THEN
            v_orgs := NULL;            -- NULL means "no org filter"
        ELSE
            v_orgs := ARRAY[p_org_id];
        END IF;
    ELSE
        SELECT array_agg(organization_id)
          INTO v_orgs
          FROM public.organization_memberships
         WHERE user_id = v_uid AND role IN ('owner','admin');
        IF v_orgs IS NULL OR array_length(v_orgs, 1) = 0 THEN
            RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
        END IF;
        IF p_org_id IS NOT NULL AND NOT (p_org_id = ANY (v_orgs)) THEN
            RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
        END IF;
        IF p_org_id IS NOT NULL THEN
            v_orgs := ARRAY[p_org_id];
        END IF;
    END IF;

    -- Queue upgrades. Filter:
    --   * agent_version IS NOT NULL (an unenrolled endpoint can't be upgraded)
    --   * agent_version <> latest (already up to date — skip)
    --   * no in-flight upgrade_agent command (skip those, count as already_queued)
    --   * endpoint not soft-deleted
    --   * endpoint org is in scope (or no scope filter for super)
    WITH eligible AS (
        SELECT e.id, e.organization_id
          FROM public.endpoints e
         WHERE e.agent_version IS NOT NULL
           AND e.agent_version <> v_latest.version
           AND COALESCE(e.is_active, true) = true
           -- Only PowerShell endpoints — never push a Windows agent ZIP to
           -- a Linux box. NULL runtime = legacy (pre-runtime-column) PS.
           AND COALESCE(e.runtime, 'powershell') = 'powershell'
           AND (v_orgs IS NULL OR e.organization_id = ANY (v_orgs))
    ),
    already_queued AS (
        SELECT DISTINCT c.endpoint_id
          FROM public.agent_commands c
          JOIN eligible e ON e.id = c.endpoint_id
         WHERE c.command_type = 'upgrade_agent'
           AND c.status IN ('queued','dispatched')
    ),
    to_queue AS (
        SELECT e.id, e.organization_id
          FROM eligible e
         WHERE e.id NOT IN (SELECT endpoint_id FROM already_queued)
    ),
    inserted AS (
        INSERT INTO public.agent_commands (
            endpoint_id, organization_id, command_type, params, status, correlation_id
        )
        SELECT
            t.id,
            t.organization_id,
            'upgrade_agent',
            jsonb_build_object(
                'target_version', v_latest.version,
                'download_url',   v_latest.download_url,
                'sha256',         v_latest.sha256,
                'reason',         'bulk_upgrade'
            ),
            'queued',
            'bulk-upgrade-' || t.id::text || '-' || extract(epoch from now())::bigint
          FROM to_queue t
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_queued FROM inserted;
    SELECT COUNT(*) INTO v_already FROM (
        SELECT endpoint_id FROM public.agent_commands c
         WHERE c.command_type = 'upgrade_agent'
           AND c.status IN ('queued','dispatched')
           AND c.endpoint_id IN (
               SELECT id FROM public.endpoints
                WHERE agent_version IS NOT NULL
                  AND agent_version <> v_latest.version
                  AND COALESCE(is_active, true) = true
                  AND COALESCE(runtime, 'powershell') = 'powershell'
                  AND (v_orgs IS NULL OR organization_id = ANY (v_orgs))
           )
    ) sub;

    RETURN jsonb_build_object(
        'queued', v_queued,
        'already_queued', v_already,
        'target_version', v_latest.version
    );
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_queue_agent_upgrade(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.bulk_queue_agent_upgrade(uuid) TO authenticated;
