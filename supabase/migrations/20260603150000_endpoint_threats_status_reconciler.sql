-- 20260603150000_endpoint_threats_status_reconciler.sql
--
-- Problem: endpoint_threats rows drift to status='Active' permanently because
-- Get-MpThreatDetection (used by the agent) only surfaces *new* detections.
-- Defender's silent IsActive=false transition is never emitted as an event.
--
-- Fix: endpoints.defender_state (added 20260603140000) carries an
-- active_threats array populated from Get-MpThreat on every heartbeat.
-- This migration adds a reconciler function that compares open threat rows
-- against that authoritative list and marks any absent row as Removed.
--
-- Safety gate: only reconcile when defender_state_updated_at is within the
-- last 15 minutes. Stale / offline endpoints are skipped entirely -- their
-- active_threats cannot be trusted and must not cause false Removals.
--
-- Cron interval: 5 minutes (*/5 * * * *). Matches the heartbeat cadence so
-- status drift stays under one polling window.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Reconciler function
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reconcile_endpoint_threat_status()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_reconciled integer := 0;
BEGIN
    WITH fresh_endpoints AS (
        SELECT
            e.id                                          AS endpoint_id,
            COALESCE(e.defender_state->'active_threats', '[]'::jsonb) AS active_threats_raw
        FROM public.endpoints e
        WHERE
            e.defender_state_updated_at > now() - interval '15 minutes'
            AND e.defender_state IS NOT NULL
            AND jsonb_typeof(
                    COALESCE(e.defender_state->'active_threats', '[]'::jsonb)
                ) = 'array'
    ),
    active_threat_ids AS (
        SELECT
            fe.endpoint_id,
            elem->>'threat_id' AS threat_id
        FROM fresh_endpoints fe
        CROSS JOIN LATERAL jsonb_array_elements(fe.active_threats_raw) AS elem
        WHERE elem->>'threat_id' IS NOT NULL
    ),
    to_close AS (
        SELECT et.id
        FROM public.endpoint_threats et
        WHERE
            et.status IN ('Active', 'Cleaning')
            AND et.endpoint_id IN (SELECT endpoint_id FROM fresh_endpoints)
            AND NOT EXISTS (
                SELECT 1
                FROM active_threat_ids ati
                WHERE ati.endpoint_id = et.endpoint_id
                  AND ati.threat_id   = et.threat_id
            )
    )
    UPDATE public.endpoint_threats
    SET
        status                         = 'Removed',
        last_threat_status_change_time = now()
    WHERE id IN (SELECT id FROM to_close);

    GET DIAGNOSTICS v_reconciled = ROW_COUNT;

    IF v_reconciled > 0 THEN
        RAISE NOTICE 'reconcile_endpoint_threat_status: marked % threat row(s) as Removed', v_reconciled;
    END IF;

    RETURN v_reconciled;
END;
$$;

REVOKE ALL    ON FUNCTION public.reconcile_endpoint_threat_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_endpoint_threat_status() TO postgres;

COMMENT ON FUNCTION public.reconcile_endpoint_threat_status() IS
'Reconciles endpoint_threats.status against the live defender_state.active_threats '
'snapshot on each endpoint. Marks rows Active/Cleaning as Removed when they are '
'absent from the latest Defender active-threat list. Only runs against endpoints '
'with a fresh defender_state (updated within the last 15 minutes) to avoid '
'incorrectly clearing threats for offline endpoints. Scheduled every 5 minutes '
'via pg_cron. Added in 20260603150000.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. pg_cron schedule (idempotent)
-- ────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
    PERFORM cron.unschedule('endpoint-threat-reconciler');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
    'endpoint-threat-reconciler',
    '*/5 * * * *',
    $$SELECT public.reconcile_endpoint_threat_status();$$
);
