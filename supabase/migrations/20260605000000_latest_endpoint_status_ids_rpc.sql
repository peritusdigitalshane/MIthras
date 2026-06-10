-- 20260605000000_latest_endpoint_status_ids_rpc.sql
--
-- Server-side helper for the cleanup-old-data edge function. The old
-- approach fetched EVERY endpoint_status row (id, endpoint_id, collected_at)
-- into the edge function's 128MB memory and computed "latest per endpoint"
-- in JS. At fleet scale (1000 endpoints × 1440 heartbeats/day × 30 days =
-- ~43M rows) this blows the memory limit and cleanup silently fails -
-- retention is then violated.
--
-- This function returns ONLY the latest id per endpoint, computed via
-- DISTINCT ON, capped at sensible row counts. Cleanup edge fn calls it
-- once per pass.

CREATE OR REPLACE FUNCTION public.get_latest_endpoint_status_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT DISTINCT ON (endpoint_id) id
    FROM public.endpoint_status
    ORDER BY endpoint_id, collected_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_latest_endpoint_status_ids() TO service_role;

COMMENT ON FUNCTION public.get_latest_endpoint_status_ids() IS
'Returns the most-recent endpoint_status.id for every endpoint. Used by '
'cleanup-old-data to identify rows to preserve when pruning older statuses. '
'Replaces an unbounded select that OOM''ed at scale.';
