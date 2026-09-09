-- Drop the existing trigger first
DROP TRIGGER IF EXISTS create_default_policies_trigger ON public.organizations;

-- Replace the function to create all default policies
CREATE OR REPLACE FUNCTION public.create_default_defender_policies()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- ==========================================
  -- DEFENDER POLICIES
  -- ==========================================
  
  -- Secure Policy Template - Most ASR rules in block mode
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
  ) VALUES (
    NEW.id, 'Secure Policy', 'Maximum security with ASR rules in block mode.', true,
    true, true, 'Advanced', 'SendAllSamples',
    true, true, true, true,
    true, true, true, 4,
    true, true, 'High', 50,
    true, true, true,
    'enabled', 'enabled', 'enabled', 'enabled', 'enabled', 'enabled',
    'enabled', 'enabled', 'enabled', 'enabled', 'enabled', 'enabled',
    'enabled', 'enabled', 'enabled', 'enabled'
  );

  -- Standard Policy Template - ASR rules in audit mode
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
  ) VALUES (
    NEW.id, 'Standard Policy', 'Balanced security with ASR rules in audit mode.', false,
    true, true, 'Advanced', 'SendAllSamples',
    true, true, true, true,
    true, true, true, 8,
    true, true, 'Moderate', 50,
    false, true, true,
    'audit', 'audit', 'audit', 'audit', 'audit', 'audit',
    'audit', 'audit', 'audit', 'audit', 'audit', 'audit',
    'audit', 'audit', 'audit', 'audit'
  );

  -- ==========================================
  -- UAC POLICIES
  -- ==========================================
  
  -- Secure UAC Policy - Strict elevation prompts
  INSERT INTO public.uac_policies (
    organization_id, name, description, is_default,
    enable_lua, consent_prompt_admin, consent_prompt_user,
    prompt_on_secure_desktop, detect_installations,
    validate_admin_signatures, filter_administrator_token
  ) VALUES (
    NEW.id, 'Secure UAC Policy', 'Maximum UAC protection with credential prompts for all elevations.', true,
    true, 1, 3,  -- Admin: prompt for credentials, User: auto-deny
    true, true,
    true, true
  );

  -- Standard UAC Policy - Default Windows behavior
  INSERT INTO public.uac_policies (
    organization_id, name, description, is_default,
    enable_lua, consent_prompt_admin, consent_prompt_user,
    prompt_on_secure_desktop, detect_installations,
    validate_admin_signatures, filter_administrator_token
  ) VALUES (
    NEW.id, 'Standard UAC Policy', 'Default Windows UAC behavior with consent prompts.', false,
    true, 5, 3,  -- Admin: consent for non-Windows binaries, User: auto-deny
    true, true,
    false, false
  );

  -- ==========================================
  -- WINDOWS UPDATE POLICIES
  -- ==========================================
  
  -- Auto Update Policy - Automatic updates
  INSERT INTO public.windows_update_policies (
    organization_id, name, description,
    auto_update_mode, active_hours_start, active_hours_end,
    feature_update_deferral, quality_update_deferral,
    pause_feature_updates, pause_quality_updates
  ) VALUES (
    NEW.id, 'Auto Update Policy', 'Automatic download and install of updates outside active hours.',
    2, 8, 17,  -- Auto download & install, active 8am-5pm
    0, 0,      -- No deferral
    false, false
  );

  -- Deferred Update Policy - Delayed updates for testing
  INSERT INTO public.windows_update_policies (
    organization_id, name, description,
    auto_update_mode, active_hours_start, active_hours_end,
    feature_update_deferral, quality_update_deferral,
    pause_feature_updates, pause_quality_updates
  ) VALUES (
    NEW.id, 'Deferred Update Policy', 'Updates deferred for stability testing before deployment.',
    1, 8, 17,  -- Auto download, notify to install
    30, 7,     -- Feature updates deferred 30 days, quality 7 days
    false, false
  );

  RETURN NEW;
END;
$function$;

-- Recreate the trigger
CREATE TRIGGER create_default_policies_trigger
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.create_default_defender_policies();

-- ==========================================
-- BACKFILL EXISTING ORGANIZATIONS
-- ==========================================

-- Backfill UAC policies for existing orgs that don't have any
INSERT INTO public.uac_policies (organization_id, name, description, is_default, enable_lua, consent_prompt_admin, consent_prompt_user, prompt_on_secure_desktop, detect_installations, validate_admin_signatures, filter_administrator_token)
SELECT o.id, 'Secure UAC Policy', 'Maximum UAC protection with credential prompts for all elevations.', true, true, 1, 3, true, true, true, true
FROM public.organizations o
WHERE NOT EXISTS (SELECT 1 FROM public.uac_policies up WHERE up.organization_id = o.id AND up.name = 'Secure UAC Policy');

INSERT INTO public.uac_policies (organization_id, name, description, is_default, enable_lua, consent_prompt_admin, consent_prompt_user, prompt_on_secure_desktop, detect_installations, validate_admin_signatures, filter_administrator_token)
SELECT o.id, 'Standard UAC Policy', 'Default Windows UAC behavior with consent prompts.', false, true, 5, 3, true, true, false, false
FROM public.organizations o
WHERE NOT EXISTS (SELECT 1 FROM public.uac_policies up WHERE up.organization_id = o.id AND up.name = 'Standard UAC Policy');

-- Backfill Windows Update policies for existing orgs that don't have any
INSERT INTO public.windows_update_policies (organization_id, name, description, auto_update_mode, active_hours_start, active_hours_end, feature_update_deferral, quality_update_deferral, pause_feature_updates, pause_quality_updates)
SELECT o.id, 'Auto Update Policy', 'Automatic download and install of updates outside active hours.', 2, 8, 17, 0, 0, false, false
FROM public.organizations o
WHERE NOT EXISTS (SELECT 1 FROM public.windows_update_policies wup WHERE wup.organization_id = o.id AND wup.name = 'Auto Update Policy');

INSERT INTO public.windows_update_policies (organization_id, name, description, auto_update_mode, active_hours_start, active_hours_end, feature_update_deferral, quality_update_deferral, pause_feature_updates, pause_quality_updates)
SELECT o.id, 'Deferred Update Policy', 'Updates deferred for stability testing before deployment.', 1, 8, 17, 30, 7, false, false
FROM public.organizations o
WHERE NOT EXISTS (SELECT 1 FROM public.windows_update_policies wup WHERE wup.organization_id = o.id AND wup.name = 'Deferred Update Policy');