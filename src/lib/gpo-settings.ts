export interface GpoPolicy {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;

  // Password Policy
  password_min_length: number;
  password_complexity_enabled: boolean;
  password_max_age_days: number;
  password_min_age_days: number;
  password_history_count: number;
  password_reversible_encryption: boolean;

  // Account Lockout
  lockout_threshold: number;
  lockout_duration_minutes: number;
  lockout_reset_minutes: number;

  // Audit Policy
  audit_logon_events: string;
  audit_object_access: string;
  audit_privilege_use: string;
  audit_policy_change: string;
  audit_account_management: string;
  audit_process_tracking: string;
  audit_system_events: string;
  audit_account_logon: string;
  audit_ds_access: string;

  // Security Options
  interactive_logon_message_title: string;
  interactive_logon_message_text: string;
  interactive_logon_require_ctrl_alt_del: boolean;
  interactive_logon_dont_display_last_user: boolean;
  network_access_restrict_anonymous: boolean;
  network_security_lan_manager_level: number;
  network_security_min_session_security_ntlm: boolean;
  shutdown_clear_virtual_memory: boolean;
  devices_restrict_cd_rom: boolean;
  devices_restrict_floppy: boolean;
  system_objects_strengthen_default_permissions: boolean;

  // User Rights Assignment
  right_network_logon: string[];
  right_deny_network_logon: string[];
  right_local_logon: string[];
  right_deny_local_logon: string[];
  right_remote_desktop_logon: string[];
  right_deny_remote_desktop_logon: string[];
  right_shut_down_system: string[];
  right_change_system_time: string[];
  right_debug_programs: string[];

  // Admin Templates - System
  disable_registry_tools: boolean;
  disable_task_manager: boolean;
  disable_cmd_prompt: boolean;
  disable_run_command: boolean;
  disable_control_panel: boolean;
  disable_lock_screen_camera: boolean;

  // Admin Templates - Network
  disable_ipv6: boolean;
  disable_wifi_sense: boolean;
  enable_windows_firewall_domain: boolean;
  enable_windows_firewall_private: boolean;
  enable_windows_firewall_public: boolean;

  // Admin Templates - Windows Components
  disable_telemetry: boolean;
  telemetry_level: number;
  disable_cortana: boolean;
  disable_consumer_features: boolean;
  disable_store_apps: boolean;
  disable_onedrive: boolean;
  disable_game_bar: boolean;

  // Power Settings
  screen_timeout_ac_minutes: number;
  screen_timeout_dc_minutes: number;
  sleep_timeout_ac_minutes: number;
  sleep_timeout_dc_minutes: number;
  require_password_on_wake: boolean;

  // Remote Desktop
  remote_desktop_enabled: boolean;
  remote_desktop_nla_required: boolean;
  remote_desktop_max_sessions: number;

  // Custom registry
  custom_registry_settings: CustomRegistrySetting[];
}

export interface CustomRegistrySetting {
  hive: string;
  path: string;
  name: string;
  type: "REG_SZ" | "REG_DWORD" | "REG_QWORD" | "REG_MULTI_SZ" | "REG_EXPAND_SZ";
  value: string;
}

export const AUDIT_OPTIONS = [
  { value: "none", label: "No Auditing" },
  { value: "success", label: "Success" },
  { value: "failure", label: "Failure" },
  { value: "success_failure", label: "Success & Failure" },
];

export const LAN_MANAGER_LEVELS = [
  { value: 0, label: "Level 0 - Send LM & NTLM responses" },
  { value: 1, label: "Level 1 - Send LM & NTLM, use NTLMv2 if negotiated" },
  { value: 2, label: "Level 2 - Send NTLM response only" },
  { value: 3, label: "Level 3 - Send NTLMv2 response only" },
  { value: 4, label: "Level 4 - Send NTLMv2, refuse LM" },
  { value: 5, label: "Level 5 - Send NTLMv2, refuse LM & NTLM (Most Secure)" },
];

export const TELEMETRY_LEVELS = [
  { value: 0, label: "0 - Security (Enterprise only)" },
  { value: 1, label: "1 - Basic" },
  { value: 2, label: "2 - Enhanced" },
  { value: 3, label: "3 - Full" },
];

export const PASSWORD_SETTINGS = [
  { id: "password_complexity_enabled", name: "Password Complexity", description: "Require uppercase, lowercase, digits, and special characters" },
  { id: "password_reversible_encryption", name: "Reversible Encryption", description: "Store passwords using reversible encryption (not recommended)" },
];

export const SECURITY_OPTION_TOGGLES = [
  { id: "interactive_logon_require_ctrl_alt_del", name: "Require Ctrl+Alt+Del", description: "Require secure attention sequence for logon", category: "Interactive Logon" },
  { id: "interactive_logon_dont_display_last_user", name: "Don't Display Last User", description: "Hide last signed-in user name on logon screen", category: "Interactive Logon" },
  { id: "network_access_restrict_anonymous", name: "Restrict Anonymous Access", description: "Restrict anonymous access to named pipes and shares", category: "Network Access" },
  { id: "network_security_min_session_security_ntlm", name: "Require 128-bit NTLM Session Security", description: "Require NTLMv2 and 128-bit encryption for sessions", category: "Network Security" },
  { id: "shutdown_clear_virtual_memory", name: "Clear Virtual Memory Pagefile", description: "Clear pagefile on shutdown to prevent data leakage", category: "Shutdown" },
  { id: "devices_restrict_cd_rom", name: "Restrict CD-ROM Access", description: "Restrict CD-ROM access to locally logged-on user", category: "Devices" },
  { id: "devices_restrict_floppy", name: "Restrict Floppy Access", description: "Restrict floppy access to locally logged-on user", category: "Devices" },
  { id: "system_objects_strengthen_default_permissions", name: "Strengthen Default Permissions", description: "Strengthen default permissions of global system objects", category: "System Objects" },
];

export const ADMIN_TEMPLATE_SYSTEM = [
  { id: "disable_registry_tools", name: "Disable Registry Editor", description: "Prevent users from accessing regedit" },
  { id: "disable_task_manager", name: "Disable Task Manager", description: "Prevent users from accessing Task Manager" },
  { id: "disable_cmd_prompt", name: "Disable Command Prompt", description: "Prevent users from accessing cmd.exe" },
  { id: "disable_run_command", name: "Disable Run Command", description: "Remove Run from Start Menu" },
  { id: "disable_control_panel", name: "Disable Control Panel", description: "Prevent access to Control Panel and Settings" },
  { id: "disable_lock_screen_camera", name: "Disable Lock Screen Camera", description: "Prevent camera access from lock screen" },
];

export const ADMIN_TEMPLATE_NETWORK = [
  { id: "disable_ipv6", name: "Disable IPv6", description: "Disable IPv6 on all network adapters" },
  { id: "disable_wifi_sense", name: "Disable Wi-Fi Sense", description: "Prevent automatic connection to suggested hotspots" },
  { id: "enable_windows_firewall_domain", name: "Enable Domain Firewall", description: "Enable Windows Firewall for domain profile" },
  { id: "enable_windows_firewall_private", name: "Enable Private Firewall", description: "Enable Windows Firewall for private profile" },
  { id: "enable_windows_firewall_public", name: "Enable Public Firewall", description: "Enable Windows Firewall for public profile" },
];

export const ADMIN_TEMPLATE_COMPONENTS = [
  { id: "disable_telemetry", name: "Disable Telemetry", description: "Minimize data sent to Microsoft" },
  { id: "disable_cortana", name: "Disable Cortana", description: "Turn off Cortana digital assistant" },
  { id: "disable_consumer_features", name: "Disable Consumer Features", description: "Turn off Microsoft consumer experiences" },
  { id: "disable_store_apps", name: "Disable Store Apps", description: "Turn off the Microsoft Store" },
  { id: "disable_onedrive", name: "Disable OneDrive", description: "Prevent OneDrive from syncing" },
  { id: "disable_game_bar", name: "Disable Game Bar", description: "Turn off Game Bar and game recordings" },
];

export const REGISTRY_HIVES = ["HKLM", "HKCU", "HKCR", "HKU", "HKCC"];
export const REGISTRY_TYPES = ["REG_SZ", "REG_DWORD", "REG_QWORD", "REG_MULTI_SZ", "REG_EXPAND_SZ"] as const;
