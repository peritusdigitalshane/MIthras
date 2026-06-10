-- Add install_updates to the agent_commands command_type allow-list.
--
-- The Vulnerabilities page's "Patch device" / bulk-patch buttons now queue
-- a command for the agent to run Windows Update against the
-- "Security Updates" + "Critical Updates" categories. Bumped agent version
-- (0.7.11) implements the handler via Microsoft.Update.Session COM.
--
-- Pattern matches 20260602170000_agent_command_upgrade.sql which added
-- upgrade_agent — DROP + re-ADD the constraint with the expanded list.

ALTER TABLE public.agent_commands
    DROP CONSTRAINT IF EXISTS agent_commands_command_type_check;

ALTER TABLE public.agent_commands
    ADD CONSTRAINT agent_commands_command_type_check
    CHECK (command_type = ANY (ARRAY[
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
        'uninstall_mesh_agent',
        'install_updates'
    ]));
