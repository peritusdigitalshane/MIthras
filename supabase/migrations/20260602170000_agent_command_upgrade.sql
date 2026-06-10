-- PoC review recommendation #4: auto-queue an upgrade command when an
-- outdated agent heartbeats. Existing agent_commands_command_type_check
-- does not include 'upgrade_agent' so the INSERT would fail. Expand it.
--
-- New verb semantics:
--   command_type='upgrade_agent', params={target_version, download_url, sha256}
--   The agent's Updater module picks it up alongside its own polling and
--   pulls + applies the new bundle.

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
        'upgrade_agent'
    ]));
