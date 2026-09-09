// ASR Rule definitions matching the PowerShell script
export const ASR_RULES = [
  {
    id: "asr_block_vulnerable_drivers",
    guid: "56a863a9-875e-4185-98a7-b882c64b5ce5",
    name: "Block abuse of exploited vulnerable signed drivers",
    description: "Prevents applications from writing a vulnerable signed driver to disk.",
    recommendedMode: "enabled" as const,
  },
  {
    id: "asr_block_email_executable",
    guid: "BE9BA2D9-53EA-4CDC-84E5-9B1EEEE46550",
    name: "Block executable content from email client and webmail",
    description: "Blocks executable files from being run or launched from an email.",
    recommendedMode: "enabled" as const,
  },
  {
    id: "asr_block_office_child_process",
    guid: "D4F940AB-401B-4EFC-AADC-AD5F3C50688A",
    name: "Block all Office applications from creating child processes",
    description: "Prevents Office apps from creating child processes.",
    recommendedMode: "enabled" as const,
  },
  {
    id: "asr_block_office_executable_content",
    guid: "3B576869-A4EC-4529-8536-B80A7769E899",
    name: "Block Office applications from creating executable content",
    description: "Prevents Office apps from creating executable content on disk.",
    recommendedMode: "enabled" as const,
  },
  {
    id: "asr_block_office_code_injection",
    guid: "75668C1F-73B5-4CF0-BB93-3ECF5CB7CC84",
    name: "Block Office applications from injecting code into other processes",
    description: "Prevents Office apps from injecting code into other processes.",
    recommendedMode: "enabled" as const,
  },
  {
    id: "asr_block_js_vbs_executable",
    guid: "D3E037E1-3EB8-44C8-A917-57927947596D",
    name: "Block JavaScript or VBScript from launching downloaded executable content",
    description: "Prevents JavaScript or VBScript from launching downloaded executables.",
    recommendedMode: "enabled" as const,
  },
  {
    id: "asr_block_obfuscated_scripts",
    guid: "5BEB7EFE-FD9A-4556-801D-275E5FFC04CC",
    name: "Block execution of potentially obfuscated scripts",
    description: "Detects and blocks potentially obfuscated scripts.",
    recommendedMode: "enabled" as const,
  },
  {
    id: "asr_block_office_macro_win32",
    guid: "92E97FA1-2EDF-4476-BDD6-9DD0B4DDDC7B",
    name: "Block Win32 API calls from Office macros",
    description: "Blocks VBA macros from calling Win32 APIs.",
    recommendedMode: "enabled" as const,
  },
  {
    id: "asr_block_untrusted_executables",
    guid: "01443614-cd74-433a-b99e-2ecdc07bfc25",
    name: "Block executable files from running unless they meet a prevalence, age, or trusted list criterion",
    description: "Blocks untrusted or unknown executable files from running.",
    recommendedMode: "enabled" as const,
  },
  {
    id: "asr_advanced_ransomware_protection",
    guid: "c1db55ab-c21a-4637-bb3f-a12568109d35",
    name: "Use advanced protection against ransomware",
    description: "Provides extra protection against ransomware.",
    recommendedMode: "enabled" as const,
  },
  {
    id: "asr_block_credential_stealing",
    guid: "9e6c4e1f-7d60-472f-ba1a-a39ef669e4b2",
    name: "Block credential stealing from the Windows local security authority subsystem (lsass.exe)",
    description: "Blocks credential-stealing tools from targeting LSASS.",
    recommendedMode: "audit" as const,
  },
  {
    id: "asr_block_psexec_wmi",
    guid: "d1e49aac-8f56-4280-b9ba-993a6d77406c",
    name: "Block process creations originating from PSExec and WMI commands",
    description: "Blocks processes created through PSExec and WMI.",
    recommendedMode: "enabled" as const,
  },
  {
    id: "asr_block_usb_untrusted",
    guid: "b2b3f03d-6a65-4f7b-a9c7-1c7ef74a9ba4",
    name: "Block untrusted and unsigned processes that run from USB",
    description: "Blocks untrusted executables from USB drives.",
    recommendedMode: "enabled" as const,
  },
  {
    id: "asr_block_office_comms_child_process",
    guid: "26190899-1602-49e8-8b27-eb1d0a1ce869",
    name: "Block Office communication application from creating child processes",
    description: "Blocks Outlook from creating child processes.",
    recommendedMode: "audit" as const,
  },
  {
    id: "asr_block_adobe_child_process",
    guid: "7674ba52-37eb-4a4f-a9a1-f0f9a1619a2c",
    name: "Block Adobe Reader from creating child processes",
    description: "Blocks Adobe Reader from creating child processes.",
    recommendedMode: "audit" as const,
  },
  {
    id: "asr_block_wmi_persistence",
    guid: "e6db77e5-3df2-4cf1-b95a-636979351e5b",
    name: "Block persistence through WMI event subscription",
    description: "Blocks persistence mechanisms using WMI.",
    recommendedMode: "enabled" as const,
  },
] as const;

export const BASIC_PROTECTION_SETTINGS = [
  { id: "realtime_monitoring", name: "Real-time Monitoring", description: "Enable continuous protection against malware" },
  { id: "cloud_delivered_protection", name: "Cloud-Delivered Protection", description: "Use Microsoft cloud for enhanced detection" },
  { id: "check_signatures_before_scan", name: "Check Signatures Before Scan", description: "Verify definitions before scanning" },
  { id: "behavior_monitoring", name: "Behavior Monitoring", description: "Monitor process behavior for threats" },
  { id: "ioav_protection", name: "IOAV Protection", description: "Scan files downloaded from the internet" },
  { id: "script_scanning", name: "Script Scanning", description: "Scan PowerShell and other scripts" },
  { id: "removable_drive_scanning", name: "Removable Drive Scanning", description: "Scan USB drives and external media" },
  { id: "block_at_first_seen", name: "Block at First Seen", description: "Block new threats immediately" },
  { id: "pua_protection", name: "PUA Protection", description: "Block potentially unwanted applications" },
  { id: "archive_scanning", name: "Archive Scanning", description: "Scan inside ZIP and other archives" },
  { id: "email_scanning", name: "Email Scanning", description: "Scan email attachments" },
] as const;

export const ADVANCED_SETTINGS = [
  { id: "controlled_folder_access", name: "Controlled Folder Access", description: "Protect folders from ransomware" },
  { id: "network_protection", name: "Network Protection", description: "Block connections to malicious domains" },
  { id: "exploit_protection_enabled", name: "Exploit Protection", description: "Apply process mitigation settings" },
] as const;

export const CLOUD_BLOCK_LEVELS = [
  { value: "Default", label: "Default", description: "Standard blocking level" },
  { value: "Moderate", label: "Moderate", description: "Moderate blocking with some false positives" },
  { value: "High", label: "High", description: "Aggressive blocking (recommended)" },
  { value: "HighPlus", label: "High Plus", description: "Very aggressive with cloud checks" },
  { value: "ZeroTolerance", label: "Zero Tolerance", description: "Block all unknown executables" },
] as const;

export const MAPS_REPORTING_OPTIONS = [
  { value: "Disabled", label: "Disabled", description: "No cloud reporting" },
  { value: "Basic", label: "Basic", description: "Send basic information" },
  { value: "Advanced", label: "Advanced", description: "Full telemetry (recommended)" },
] as const;

export const SAMPLE_SUBMISSION_OPTIONS = [
  { value: "None", label: "None", description: "Never send samples" },
  { value: "SendSafeSamples", label: "Safe Samples Only", description: "Send samples that don't contain PII" },
  { value: "SendAllSamples", label: "All Samples", description: "Send all samples for analysis (recommended)" },
] as const;

export type AsrAction = "disabled" | "enabled" | "audit";

export interface DefenderPolicy {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  
  // Basic Protection
  realtime_monitoring: boolean;
  cloud_delivered_protection: boolean;
  maps_reporting: string;
  sample_submission: string;
  check_signatures_before_scan: boolean;
  behavior_monitoring: boolean;
  ioav_protection: boolean;
  script_scanning: boolean;
  removable_drive_scanning: boolean;
  block_at_first_seen: boolean;
  pua_protection: boolean;
  signature_update_interval: number;
  archive_scanning: boolean;
  email_scanning: boolean;
  
  // Advanced
  cloud_block_level: string;
  cloud_extended_timeout: number;
  controlled_folder_access: boolean;
  network_protection: boolean;
  
  // ASR Rules
  asr_block_vulnerable_drivers: AsrAction;
  asr_block_email_executable: AsrAction;
  asr_block_office_child_process: AsrAction;
  asr_block_office_executable_content: AsrAction;
  asr_block_office_code_injection: AsrAction;
  asr_block_js_vbs_executable: AsrAction;
  asr_block_obfuscated_scripts: AsrAction;
  asr_block_office_macro_win32: AsrAction;
  asr_block_untrusted_executables: AsrAction;
  asr_advanced_ransomware_protection: AsrAction;
  asr_block_credential_stealing: AsrAction;
  asr_block_psexec_wmi: AsrAction;
  asr_block_usb_untrusted: AsrAction;
  asr_block_office_comms_child_process: AsrAction;
  asr_block_adobe_child_process: AsrAction;
  asr_block_wmi_persistence: AsrAction;
  
  // Exploit Protection
  exploit_protection_enabled: boolean;
  
  // Exclusions
  exclusion_paths: string[];
  exclusion_processes: string[];
  exclusion_extensions: string[];
  
  created_at: string;
  updated_at: string;
  created_by: string | null;
}
