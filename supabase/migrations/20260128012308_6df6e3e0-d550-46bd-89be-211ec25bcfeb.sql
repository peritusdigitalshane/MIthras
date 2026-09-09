-- Create function to add default defender policies for new organizations
CREATE OR REPLACE FUNCTION public.create_default_defender_policies()
RETURNS TRIGGER AS $$
BEGIN
  -- Secure Policy Template - Most ASR rules in block mode
  INSERT INTO public.defender_policies (
    organization_id,
    name,
    description,
    is_default,
    -- Basic Protection
    realtime_monitoring,
    cloud_delivered_protection,
    maps_reporting,
    sample_submission,
    check_signatures_before_scan,
    behavior_monitoring,
    ioav_protection,
    script_scanning,
    removable_drive_scanning,
    block_at_first_seen,
    pua_protection,
    signature_update_interval,
    archive_scanning,
    email_scanning,
    -- Advanced
    cloud_block_level,
    cloud_extended_timeout,
    controlled_folder_access,
    network_protection,
    exploit_protection_enabled,
    -- ASR Rules - Most in block mode for maximum security
    asr_block_vulnerable_drivers,
    asr_block_email_executable,
    asr_block_office_child_process,
    asr_block_office_executable_content,
    asr_block_office_code_injection,
    asr_block_js_vbs_executable,
    asr_block_obfuscated_scripts,
    asr_block_office_macro_win32,
    asr_block_untrusted_executables,
    asr_advanced_ransomware_protection,
    asr_block_credential_stealing,
    asr_block_psexec_wmi,
    asr_block_usb_untrusted,
    asr_block_office_comms_child_process,
    asr_block_adobe_child_process,
    asr_block_wmi_persistence
  ) VALUES (
    NEW.id,
    'Secure Policy',
    'Maximum security settings with most ASR rules in block mode. Recommended for high-security environments.',
    true,
    -- Basic Protection
    true,  -- realtime_monitoring
    true,  -- cloud_delivered_protection
    'Advanced',  -- maps_reporting
    'SendAllSamples',  -- sample_submission
    true,  -- check_signatures_before_scan
    true,  -- behavior_monitoring
    true,  -- ioav_protection
    true,  -- script_scanning
    true,  -- removable_drive_scanning
    true,  -- block_at_first_seen
    true,  -- pua_protection
    4,     -- signature_update_interval (every 4 hours)
    true,  -- archive_scanning
    true,  -- email_scanning
    -- Advanced
    'High',  -- cloud_block_level
    50,      -- cloud_extended_timeout
    true,    -- controlled_folder_access
    true,    -- network_protection
    true,    -- exploit_protection_enabled
    -- ASR Rules - Block mode for maximum security
    'enabled',  -- asr_block_vulnerable_drivers
    'enabled',  -- asr_block_email_executable
    'enabled',  -- asr_block_office_child_process
    'enabled',  -- asr_block_office_executable_content
    'enabled',  -- asr_block_office_code_injection
    'enabled',  -- asr_block_js_vbs_executable
    'enabled',  -- asr_block_obfuscated_scripts
    'enabled',  -- asr_block_office_macro_win32
    'enabled',  -- asr_block_untrusted_executables
    'enabled',  -- asr_advanced_ransomware_protection
    'enabled',  -- asr_block_credential_stealing
    'enabled',  -- asr_block_psexec_wmi
    'enabled',  -- asr_block_usb_untrusted
    'enabled',  -- asr_block_office_comms_child_process
    'enabled',  -- asr_block_adobe_child_process
    'enabled'   -- asr_block_wmi_persistence
  );

  -- Standard Policy Template - ASR rules in audit mode for visibility without blocking
  INSERT INTO public.defender_policies (
    organization_id,
    name,
    description,
    is_default,
    -- Basic Protection
    realtime_monitoring,
    cloud_delivered_protection,
    maps_reporting,
    sample_submission,
    check_signatures_before_scan,
    behavior_monitoring,
    ioav_protection,
    script_scanning,
    removable_drive_scanning,
    block_at_first_seen,
    pua_protection,
    signature_update_interval,
    archive_scanning,
    email_scanning,
    -- Advanced
    cloud_block_level,
    cloud_extended_timeout,
    controlled_folder_access,
    network_protection,
    exploit_protection_enabled,
    -- ASR Rules - All in audit mode for monitoring without blocking
    asr_block_vulnerable_drivers,
    asr_block_email_executable,
    asr_block_office_child_process,
    asr_block_office_executable_content,
    asr_block_office_code_injection,
    asr_block_js_vbs_executable,
    asr_block_obfuscated_scripts,
    asr_block_office_macro_win32,
    asr_block_untrusted_executables,
    asr_advanced_ransomware_protection,
    asr_block_credential_stealing,
    asr_block_psexec_wmi,
    asr_block_usb_untrusted,
    asr_block_office_comms_child_process,
    asr_block_adobe_child_process,
    asr_block_wmi_persistence
  ) VALUES (
    NEW.id,
    'Standard Policy',
    'Balanced security settings with ASR rules in audit mode. Good for initial deployment and testing.',
    false,
    -- Basic Protection
    true,  -- realtime_monitoring
    true,  -- cloud_delivered_protection
    'Advanced',  -- maps_reporting
    'SendAllSamples',  -- sample_submission
    true,  -- check_signatures_before_scan
    true,  -- behavior_monitoring
    true,  -- ioav_protection
    true,  -- script_scanning
    true,  -- removable_drive_scanning
    true,  -- block_at_first_seen
    true,  -- pua_protection
    8,     -- signature_update_interval (every 8 hours)
    true,  -- archive_scanning
    true,  -- email_scanning
    -- Advanced
    'Moderate',  -- cloud_block_level
    50,          -- cloud_extended_timeout
    false,       -- controlled_folder_access
    true,        -- network_protection
    true,        -- exploit_protection_enabled
    -- ASR Rules - Audit mode for visibility without blocking
    'audit',  -- asr_block_vulnerable_drivers
    'audit',  -- asr_block_email_executable
    'audit',  -- asr_block_office_child_process
    'audit',  -- asr_block_office_executable_content
    'audit',  -- asr_block_office_code_injection
    'audit',  -- asr_block_js_vbs_executable
    'audit',  -- asr_block_obfuscated_scripts
    'audit',  -- asr_block_office_macro_win32
    'audit',  -- asr_block_untrusted_executables
    'audit',  -- asr_advanced_ransomware_protection
    'audit',  -- asr_block_credential_stealing
    'audit',  -- asr_block_psexec_wmi
    'audit',  -- asr_block_usb_untrusted
    'audit',  -- asr_block_office_comms_child_process
    'audit',  -- asr_block_adobe_child_process
    'audit'   -- asr_block_wmi_persistence
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger to run after organization insert
DROP TRIGGER IF EXISTS create_default_policies_trigger ON public.organizations;
CREATE TRIGGER create_default_policies_trigger
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.create_default_defender_policies();

-- Create default policies for existing organizations that don't have any
INSERT INTO public.defender_policies (
  organization_id, name, description, is_default,
  realtime_monitoring, cloud_delivered_protection, maps_reporting, sample_submission,
  check_signatures_before_scan, behavior_monitoring, ioav_protection, script_scanning,
  removable_drive_scanning, block_at_first_seen, pua_protection, signature_update_interval,
  archive_scanning, email_scanning, cloud_block_level, cloud_extended_timeout,
  controlled_folder_access, network_protection, exploit_protection_enabled,
  asr_block_vulnerable_drivers, asr_block_email_executable, asr_block_office_child_process,
  asr_block_office_executable_content, asr_block_office_code_injection, asr_block_js_vbs_executable,
  asr_block_obfuscated_scripts, asr_block_office_macro_win32, asr_block_untrusted_executables,
  asr_advanced_ransomware_protection, asr_block_credential_stealing, asr_block_psexec_wmi,
  asr_block_usb_untrusted, asr_block_office_comms_child_process, asr_block_adobe_child_process,
  asr_block_wmi_persistence
)
SELECT 
  o.id, 'Secure Policy', 'Maximum security settings with most ASR rules in block mode. Recommended for high-security environments.', true,
  true, true, 'Advanced', 'SendAllSamples', true, true, true, true, true, true, true, 4, true, true,
  'High', 50, true, true, true,
  'enabled', 'enabled', 'enabled', 'enabled', 'enabled', 'enabled', 'enabled', 'enabled', 'enabled',
  'enabled', 'enabled', 'enabled', 'enabled', 'enabled', 'enabled', 'enabled'
FROM public.organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM public.defender_policies dp 
  WHERE dp.organization_id = o.id AND dp.name = 'Secure Policy'
);

INSERT INTO public.defender_policies (
  organization_id, name, description, is_default,
  realtime_monitoring, cloud_delivered_protection, maps_reporting, sample_submission,
  check_signatures_before_scan, behavior_monitoring, ioav_protection, script_scanning,
  removable_drive_scanning, block_at_first_seen, pua_protection, signature_update_interval,
  archive_scanning, email_scanning, cloud_block_level, cloud_extended_timeout,
  controlled_folder_access, network_protection, exploit_protection_enabled,
  asr_block_vulnerable_drivers, asr_block_email_executable, asr_block_office_child_process,
  asr_block_office_executable_content, asr_block_office_code_injection, asr_block_js_vbs_executable,
  asr_block_obfuscated_scripts, asr_block_office_macro_win32, asr_block_untrusted_executables,
  asr_advanced_ransomware_protection, asr_block_credential_stealing, asr_block_psexec_wmi,
  asr_block_usb_untrusted, asr_block_office_comms_child_process, asr_block_adobe_child_process,
  asr_block_wmi_persistence
)
SELECT 
  o.id, 'Standard Policy', 'Balanced security settings with ASR rules in audit mode. Good for initial deployment and testing.', false,
  true, true, 'Advanced', 'SendAllSamples', true, true, true, true, true, true, true, 8, true, true,
  'Moderate', 50, false, true, true,
  'audit', 'audit', 'audit', 'audit', 'audit', 'audit', 'audit', 'audit', 'audit',
  'audit', 'audit', 'audit', 'audit', 'audit', 'audit', 'audit'
FROM public.organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM public.defender_policies dp 
  WHERE dp.organization_id = o.id AND dp.name = 'Standard Policy'
);