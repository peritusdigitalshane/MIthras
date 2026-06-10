-- 20260604070000_agent_commands_add_mesh_emergency.sql
--
-- Extend agent_commands.command_type CHECK to allow the three command types
-- that have been wired into the agent + UI but were never added to the DB
-- constraint:
--   - emergency_unlock     (Defender lockdown recovery, shipped earlier)
--   - install_mesh_agent   (v0.7.4 opt-in Remote Access install)
--   - uninstall_mesh_agent (v0.7.4 opt-in Remote Access uninstall)
--
-- Without this, every Install / Uninstall click in the Remote Access card
-- (and any Emergency Unlock button click on a lockdown-bricked endpoint)
-- fails with Postgres 23514 check_violation and the operator sees a
-- generic "Failed to queue command" toast.

ALTER TABLE public.agent_commands
    DROP CONSTRAINT IF EXISTS agent_commands_command_type_check;

ALTER TABLE public.agent_commands
    ADD CONSTRAINT agent_commands_command_type_check
    CHECK (command_type IN (
        'isolate_network',
        'release_isolation',
        'kill_process',
        'quarantine_file',
        'collect_persistence',
        'run_quick_scan',
        'run_full_scan',
        'restart_agent',
        'upgrade_agent',
        'emergency_unlock',
        'install_mesh_agent',
        'uninstall_mesh_agent'
    ));
