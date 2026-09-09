
-- Fix endpoint_hardening_status: restrict system insert/update to valid endpoint-org pairs
DROP POLICY IF EXISTS "System can insert hardening status" ON public.endpoint_hardening_status;
DROP POLICY IF EXISTS "System can update hardening status" ON public.endpoint_hardening_status;

CREATE POLICY "Insert hardening status for valid endpoints" ON public.endpoint_hardening_status
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.endpoints e WHERE e.id = endpoint_id AND e.organization_id = organization_id)
  );
CREATE POLICY "Update hardening status for valid endpoints" ON public.endpoint_hardening_status
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.endpoints e WHERE e.id = endpoint_id AND e.organization_id = organization_id)
  );

-- Fix hardening_recommendations: restrict system insert/update to valid endpoint-org pairs
DROP POLICY IF EXISTS "System can insert recommendations" ON public.hardening_recommendations;
DROP POLICY IF EXISTS "System can update recommendations" ON public.hardening_recommendations;

CREATE POLICY "Insert recommendations for valid endpoints" ON public.hardening_recommendations
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.endpoints e WHERE e.id = endpoint_id AND e.organization_id = organization_id)
  );
CREATE POLICY "Update recommendations for valid endpoints" ON public.hardening_recommendations
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.endpoints e WHERE e.id = endpoint_id AND e.organization_id = organization_id)
  );

-- Fix search_path on create_default_hardening_profiles
DROP FUNCTION IF EXISTS public.create_default_hardening_profiles(_org_id uuid);
CREATE OR REPLACE FUNCTION public.create_default_hardening_profiles(_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.hardening_profiles (organization_id, name, description, os_target, is_system_default, settings)
  VALUES (
    _org_id, 'Windows 10 Maximum Hardening',
    'Comprehensive hardening for Windows 10 endpoints past end-of-life. Replaces ESU by applying defense-in-depth controls.',
    'win10', true,
    '{"defender":{"realtime_monitoring":true,"cloud_delivered_protection":true,"cloud_block_level":"High","block_at_first_seen":true,"pua_protection":true,"network_protection":true,"controlled_folder_access":true,"exploit_protection":true,"all_asr_rules":"enabled"},"network":{"disable_smb_v1":true,"disable_smb_v2_guest_access":true,"disable_llmnr":true,"disable_netbios":true,"disable_wpad":true,"enable_smb_signing":true,"enable_ldap_signing":true,"restrict_ntlm":true},"services":{"disable_remote_registry":true,"disable_print_spooler":true,"disable_powershell_v2":true,"disable_unnecessary_services":true},"authentication":{"enforce_nla":true,"disable_wdigest":true,"lsa_protection":true,"block_mimikatz_patterns":true},"application_control":{"wdac_enforced":true,"block_unsigned_scripts":true,"block_macro_execution":true},"encryption":{"enforce_bitlocker":true,"tls_min_version":"1.2","disable_ssl3":true,"disable_tls10":true,"disable_tls11":true}}'::jsonb
  );

  INSERT INTO public.hardening_profiles (organization_id, name, description, os_target, is_system_default, settings)
  VALUES (
    _org_id, 'Server 2012 R2 Maximum Hardening',
    'Comprehensive hardening for Windows Server 2012 R2 past end-of-life. Maximum security controls to mitigate risks without ESU.',
    'server2012r2', true,
    '{"defender":{"realtime_monitoring":true,"cloud_delivered_protection":true,"cloud_block_level":"High","block_at_first_seen":true,"pua_protection":true,"network_protection":true},"network":{"disable_smb_v1":true,"disable_llmnr":true,"disable_netbios":true,"disable_wpad":true,"enable_smb_signing":true,"enable_ldap_signing":true,"restrict_ntlm":true,"isolate_from_modern_os":true},"services":{"disable_remote_registry":true,"disable_print_spooler":true,"disable_powershell_v2":true,"disable_unnecessary_roles":true,"harden_iis":true},"authentication":{"enforce_nla":true,"disable_wdigest":true,"lsa_protection":true,"restrict_admin_logon":true},"application_control":{"applocker_enforced":true,"block_unsigned_scripts":true},"encryption":{"tls_min_version":"1.2","disable_ssl3":true,"disable_tls10":true,"disable_tls11":true,"disable_rc4":true,"disable_3des":true}}'::jsonb
  );

  INSERT INTO public.hardening_profiles (organization_id, name, description, os_target, is_system_default, settings)
  VALUES (
    _org_id, 'Balanced Legacy Hardening',
    'Moderate hardening that balances security with application compatibility. Good starting point before moving to maximum hardening.',
    'all', true,
    '{"defender":{"realtime_monitoring":true,"cloud_delivered_protection":true,"cloud_block_level":"Moderate","pua_protection":true,"network_protection":true,"all_asr_rules":"audit"},"network":{"disable_smb_v1":true,"disable_llmnr":true,"enable_smb_signing":true},"services":{"disable_remote_registry":true,"disable_powershell_v2":true},"authentication":{"enforce_nla":true,"disable_wdigest":true},"application_control":{"wdac_audit":true},"encryption":{"tls_min_version":"1.2","disable_ssl3":true,"disable_tls10":true}}'::jsonb
  );
END;
$$;
