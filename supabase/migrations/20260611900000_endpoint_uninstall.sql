-- Endpoint decommissioning support.
--
-- Adds an authorised "uninstall_self" command path so a SOC operator can
-- click "Decommission" on an endpoint and have the agent gracefully tear
-- itself down (disable tamper, stop the service, delete files, release
-- the licence seat). The break-glass path — a signed Force-Remove.ps1
-- bundled with the installer — covers the dead-agent case separately;
-- this migration is purely the in-platform path.

BEGIN;

-- 1. Allow 'uninstall_self' as an agent command type.
ALTER TABLE public.agent_commands
    DROP CONSTRAINT IF EXISTS agent_commands_command_type_check;

ALTER TABLE public.agent_commands
    ADD CONSTRAINT agent_commands_command_type_check
    CHECK (command_type = ANY (ARRAY[
        'isolate_network','release_isolation',
        'kill_process','quarantine_file',
        'collect_persistence',
        'run_quick_scan','run_full_scan',
        'restart_agent',
        'upgrade_agent',
        'emergency_unlock',
        'install_mesh_agent','uninstall_mesh_agent',
        'install_updates',
        'uninstall_self'
    ]));

-- 2. Track the decommissioning lifecycle on the endpoint row itself.
--    uninstall_authorized_*  : SOC operator action timestamp + who clicked
--    uninstall_reason        : freeform string the operator typed in the dialog
--    uninstalled_at          : agent confirmed via heartbeat or final command result
ALTER TABLE public.endpoints
    ADD COLUMN IF NOT EXISTS uninstall_authorized_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS uninstall_authorized_by  UUID REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS uninstall_reason         TEXT,
    ADD COLUMN IF NOT EXISTS uninstalled_at           TIMESTAMPTZ;

-- Quick lookup index for "endpoints in decommissioning state" admin views.
CREATE INDEX IF NOT EXISTS idx_endpoints_uninstall_authorized
    ON public.endpoints (uninstall_authorized_at)
    WHERE uninstall_authorized_at IS NOT NULL AND uninstalled_at IS NULL;

COMMIT;
