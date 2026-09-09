
-- Create GPO policies table with categorized settings
CREATE TABLE public.gpo_policies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Password Policy
  password_min_length INTEGER NOT NULL DEFAULT 8,
  password_complexity_enabled BOOLEAN NOT NULL DEFAULT true,
  password_max_age_days INTEGER NOT NULL DEFAULT 90,
  password_min_age_days INTEGER NOT NULL DEFAULT 1,
  password_history_count INTEGER NOT NULL DEFAULT 12,
  password_reversible_encryption BOOLEAN NOT NULL DEFAULT false,

  -- Account Lockout Policy
  lockout_threshold INTEGER NOT NULL DEFAULT 5,
  lockout_duration_minutes INTEGER NOT NULL DEFAULT 30,
  lockout_reset_minutes INTEGER NOT NULL DEFAULT 30,

  -- Audit Policy
  audit_logon_events TEXT NOT NULL DEFAULT 'success_failure',
  audit_object_access TEXT NOT NULL DEFAULT 'failure',
  audit_privilege_use TEXT NOT NULL DEFAULT 'failure',
  audit_policy_change TEXT NOT NULL DEFAULT 'success_failure',
  audit_account_management TEXT NOT NULL DEFAULT 'success_failure',
  audit_process_tracking TEXT NOT NULL DEFAULT 'none',
  audit_system_events TEXT NOT NULL DEFAULT 'success_failure',
  audit_account_logon TEXT NOT NULL DEFAULT 'success_failure',
  audit_ds_access TEXT NOT NULL DEFAULT 'none',

  -- Security Options
  interactive_logon_message_title TEXT NOT NULL DEFAULT '',
  interactive_logon_message_text TEXT NOT NULL DEFAULT '',
  interactive_logon_require_ctrl_alt_del BOOLEAN NOT NULL DEFAULT true,
  interactive_logon_dont_display_last_user BOOLEAN NOT NULL DEFAULT false,
  network_access_restrict_anonymous BOOLEAN NOT NULL DEFAULT true,
  network_security_lan_manager_level INTEGER NOT NULL DEFAULT 5,
  network_security_min_session_security_ntlm BOOLEAN NOT NULL DEFAULT true,
  shutdown_clear_virtual_memory BOOLEAN NOT NULL DEFAULT false,
  devices_restrict_cd_rom BOOLEAN NOT NULL DEFAULT false,
  devices_restrict_floppy BOOLEAN NOT NULL DEFAULT false,
  system_objects_strengthen_default_permissions BOOLEAN NOT NULL DEFAULT true,

  -- User Rights Assignment (stored as text arrays of SIDs/groups)
  right_network_logon TEXT[] NOT NULL DEFAULT '{}',
  right_deny_network_logon TEXT[] NOT NULL DEFAULT '{}',
  right_local_logon TEXT[] NOT NULL DEFAULT '{}',
  right_deny_local_logon TEXT[] NOT NULL DEFAULT '{}',
  right_remote_desktop_logon TEXT[] NOT NULL DEFAULT '{}',
  right_deny_remote_desktop_logon TEXT[] NOT NULL DEFAULT '{}',
  right_shut_down_system TEXT[] NOT NULL DEFAULT '{}',
  right_change_system_time TEXT[] NOT NULL DEFAULT '{}',
  right_debug_programs TEXT[] NOT NULL DEFAULT '{}',

  -- Administrative Templates - System
  disable_registry_tools BOOLEAN NOT NULL DEFAULT false,
  disable_task_manager BOOLEAN NOT NULL DEFAULT false,
  disable_cmd_prompt BOOLEAN NOT NULL DEFAULT false,
  disable_run_command BOOLEAN NOT NULL DEFAULT false,
  disable_control_panel BOOLEAN NOT NULL DEFAULT false,
  disable_lock_screen_camera BOOLEAN NOT NULL DEFAULT false,

  -- Administrative Templates - Network
  disable_ipv6 BOOLEAN NOT NULL DEFAULT false,
  disable_wifi_sense BOOLEAN NOT NULL DEFAULT true,
  enable_windows_firewall_domain BOOLEAN NOT NULL DEFAULT true,
  enable_windows_firewall_private BOOLEAN NOT NULL DEFAULT true,
  enable_windows_firewall_public BOOLEAN NOT NULL DEFAULT true,

  -- Administrative Templates - Windows Components
  disable_telemetry BOOLEAN NOT NULL DEFAULT false,
  telemetry_level INTEGER NOT NULL DEFAULT 1,
  disable_cortana BOOLEAN NOT NULL DEFAULT false,
  disable_consumer_features BOOLEAN NOT NULL DEFAULT true,
  disable_store_apps BOOLEAN NOT NULL DEFAULT false,
  disable_onedrive BOOLEAN NOT NULL DEFAULT false,
  disable_game_bar BOOLEAN NOT NULL DEFAULT true,

  -- Power Settings
  screen_timeout_ac_minutes INTEGER NOT NULL DEFAULT 15,
  screen_timeout_dc_minutes INTEGER NOT NULL DEFAULT 5,
  sleep_timeout_ac_minutes INTEGER NOT NULL DEFAULT 30,
  sleep_timeout_dc_minutes INTEGER NOT NULL DEFAULT 15,
  require_password_on_wake BOOLEAN NOT NULL DEFAULT true,

  -- Remote Desktop
  remote_desktop_enabled BOOLEAN NOT NULL DEFAULT false,
  remote_desktop_nla_required BOOLEAN NOT NULL DEFAULT true,
  remote_desktop_max_sessions INTEGER NOT NULL DEFAULT 2,

  -- Custom registry settings (key-value pairs for anything not covered above)
  custom_registry_settings JSONB NOT NULL DEFAULT '[]'::jsonb
);

-- Add gpo_policy_id to endpoint_groups
ALTER TABLE public.endpoint_groups
  ADD COLUMN gpo_policy_id UUID REFERENCES public.gpo_policies(id) ON DELETE SET NULL;

-- Enable RLS
ALTER TABLE public.gpo_policies ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view GPO policies in their orgs"
  ON public.gpo_policies FOR SELECT
  USING (is_member_of_org(auth.uid(), organization_id));

CREATE POLICY "Admins can create GPO policies"
  ON public.gpo_policies FOR INSERT
  WITH CHECK (is_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Admins can update GPO policies"
  ON public.gpo_policies FOR UPDATE
  USING (is_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Admins can delete GPO policies"
  ON public.gpo_policies FOR DELETE
  USING (is_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Partners can manage customer GPO policies"
  ON public.gpo_policies FOR ALL
  USING (is_partner_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Super admins can manage all GPO policies"
  ON public.gpo_policies FOR ALL
  USING (is_super_admin(auth.uid()));

CREATE POLICY "Super admins can view all GPO policies"
  ON public.gpo_policies FOR SELECT
  USING (is_super_admin(auth.uid()));
