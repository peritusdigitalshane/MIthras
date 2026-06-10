-- 20260605030000_refresh_endpoints_live_view.sql
--
-- Re-expand SELECT * on the endpoints_live view. Postgres freezes the
-- column list at CREATE-time, so this view was missing every column
-- added since the original 20260601700000 migration: defender_state,
-- defender_state_updated_at, isolation_mode, mesh_agent_state,
-- mesh_node_id, mesh_agent_error, mesh_agent_installed_at, et al.
-- Anything that queries the view (forward-compatible code, soft-delete-
-- aware paths) silently lost those columns.

CREATE OR REPLACE VIEW public.endpoints_live AS
    SELECT * FROM public.endpoints WHERE deleted_at IS NULL;

COMMENT ON VIEW public.endpoints_live IS
'Soft-delete-aware projection of public.endpoints. Re-create after adding '
'columns to the base table (Postgres freezes column lists at CREATE time). '
'Last refreshed 2026-06-05.';
