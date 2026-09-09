
-- Add legacy hardening module toggle to organizations
ALTER TABLE public.organizations 
ADD COLUMN IF NOT EXISTS legacy_hardening_enabled boolean NOT NULL DEFAULT false;

-- Hardening profiles (templates for legacy OS hardening)
CREATE TABLE public.hardening_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  os_target text NOT NULL DEFAULT 'all' CHECK (os_target IN ('all', 'win10', 'server2012r2', 'server2012', 'win7', 'win81')),
  is_system_default boolean NOT NULL DEFAULT false,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hardening_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view hardening profiles" ON public.hardening_profiles
  FOR SELECT USING (is_member_of_org(auth.uid(), organization_id));
CREATE POLICY "Admins can create hardening profiles" ON public.hardening_profiles
  FOR INSERT WITH CHECK (is_admin_of_org(auth.uid(), organization_id));
CREATE POLICY "Admins can update hardening profiles" ON public.hardening_profiles
  FOR UPDATE USING (is_admin_of_org(auth.uid(), organization_id));
CREATE POLICY "Admins can delete hardening profiles" ON public.hardening_profiles
  FOR DELETE USING (is_admin_of_org(auth.uid(), organization_id));
CREATE POLICY "Partners can manage customer hardening profiles" ON public.hardening_profiles
  FOR ALL USING (is_partner_admin_of_org(auth.uid(), organization_id));
CREATE POLICY "Super admins can manage all hardening profiles" ON public.hardening_profiles
  FOR ALL USING (is_super_admin(auth.uid()));

CREATE TRIGGER update_hardening_profiles_updated_at
  BEFORE UPDATE ON public.hardening_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Endpoint hardening status (per-endpoint assessment)
CREATE TABLE public.endpoint_hardening_status (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  endpoint_id uuid NOT NULL REFERENCES public.endpoints(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  os_category text, -- 'legacy_win10', 'legacy_server2012r2', 'supported', etc.
  os_eol_date date,
  is_legacy boolean NOT NULL DEFAULT false,
  hardening_profile_id uuid REFERENCES public.hardening_profiles(id) ON DELETE SET NULL,
  compliance_score integer DEFAULT 0 CHECK (compliance_score >= 0 AND compliance_score <= 100),
  total_checks integer DEFAULT 0,
  passed_checks integer DEFAULT 0,
  failed_checks integer DEFAULT 0,
  last_assessed_at timestamptz,
  findings jsonb DEFAULT '[]'::jsonb,
  esu_estimated_annual_cost numeric(10,2) DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(endpoint_id)
);

ALTER TABLE public.endpoint_hardening_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view endpoint hardening status" ON public.endpoint_hardening_status
  FOR SELECT USING (is_member_of_org(auth.uid(), organization_id));
CREATE POLICY "Admins can update endpoint hardening status" ON public.endpoint_hardening_status
  FOR UPDATE USING (is_admin_of_org(auth.uid(), organization_id));
CREATE POLICY "Partners can view customer hardening status" ON public.endpoint_hardening_status
  FOR SELECT USING (is_partner_admin_of_org(auth.uid(), organization_id));
CREATE POLICY "Super admins can manage all hardening status" ON public.endpoint_hardening_status
  FOR ALL USING (is_super_admin(auth.uid()));
CREATE POLICY "System can insert hardening status" ON public.endpoint_hardening_status
  FOR INSERT WITH CHECK (true);
CREATE POLICY "System can update hardening status" ON public.endpoint_hardening_status
  FOR UPDATE USING (true);

CREATE TRIGGER update_endpoint_hardening_status_updated_at
  BEFORE UPDATE ON public.endpoint_hardening_status
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Hardening recommendations (individual checks per endpoint)
CREATE TABLE public.hardening_recommendations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  endpoint_id uuid NOT NULL REFERENCES public.endpoints(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  category text NOT NULL, -- 'network', 'authentication', 'services', 'encryption', 'application_control', 'firewall'
  title text NOT NULL,
  description text,
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  current_value text,
  recommended_value text,
  is_compliant boolean NOT NULL DEFAULT false,
  is_applied boolean NOT NULL DEFAULT false,
  applied_at timestamptz,
  applied_by uuid REFERENCES auth.users(id),
  remediation_action text, -- 'auto' or 'manual'
  policy_reference text, -- which policy type handles this (defender, gpo, wdac, uac, firewall)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hardening_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view hardening recommendations" ON public.hardening_recommendations
  FOR SELECT USING (is_member_of_org(auth.uid(), organization_id));
CREATE POLICY "Admins can manage hardening recommendations" ON public.hardening_recommendations
  FOR ALL USING (is_admin_of_org(auth.uid(), organization_id));
CREATE POLICY "Partners can view customer recommendations" ON public.hardening_recommendations
  FOR SELECT USING (is_partner_admin_of_org(auth.uid(), organization_id));
CREATE POLICY "Super admins can manage all recommendations" ON public.hardening_recommendations
  FOR ALL USING (is_super_admin(auth.uid()));
CREATE POLICY "System can insert recommendations" ON public.hardening_recommendations
  FOR INSERT WITH CHECK (true);
CREATE POLICY "System can update recommendations" ON public.hardening_recommendations
  FOR UPDATE USING (true);

CREATE TRIGGER update_hardening_recommendations_updated_at
  BEFORE UPDATE ON public.hardening_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes for performance
CREATE INDEX idx_endpoint_hardening_status_endpoint ON public.endpoint_hardening_status(endpoint_id);
CREATE INDEX idx_endpoint_hardening_status_org ON public.endpoint_hardening_status(organization_id);
CREATE INDEX idx_endpoint_hardening_status_legacy ON public.endpoint_hardening_status(is_legacy);
CREATE INDEX idx_hardening_recommendations_endpoint ON public.hardening_recommendations(endpoint_id);
CREATE INDEX idx_hardening_recommendations_org ON public.hardening_recommendations(organization_id);
CREATE INDEX idx_hardening_recommendations_category ON public.hardening_recommendations(category);
CREATE INDEX idx_hardening_profiles_org ON public.hardening_profiles(organization_id);

-- Function to create default hardening profiles when module is enabled
CREATE OR REPLACE FUNCTION public.create_default_hardening_profiles(_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Windows 10 Legacy Hardening Profile
  INSERT INTO public.hardening_profiles (organization_id, name, description, os_target, is_system_default, settings)
  VALUES (
    _org_id,
    'Windows 10 Maximum Hardening',
    'Comprehensive hardening for Windows 10 endpoints past end-of-life. Replaces the need for Extended Security Updates (ESU) by applying defense-in-depth controls.',
    'win10',
    true,
    jsonb_build_object(
      'defender', jsonb_build_object(
        'realtime_monitoring', true,
        'cloud_delivered_protection', true,
        'cloud_block_level', 'High',
        'block_at_first_seen', true,
        'pua_protection', true,
        'network_protection', true,
        'controlled_folder_access', true,
        'exploit_protection', true,
        'all_asr_rules', 'enabled'
      ),
      'network', jsonb_build_object(
        'disable_smb_v1', true,
        'disable_smb_v2_guest_access', true,
        'disable_llmnr', true,
        'disable_netbios', true,
        'disable_wpad', true,
        'enable_smb_signing', true,
        'enable_ldap_signing', true,
        'restrict_ntlm', true,
        'isolate_from_modern_os', false
      ),
      'services', jsonb_build_object(
        'disable_remote_registry', true,
        'disable_print_spooler', true,
        'disable_wmi_remote', false,
        'disable_powershell_v2', true,
        'constrained_language_mode', false,
        'disable_unnecessary_services', true
      ),
      'authentication', jsonb_build_object(
        'enforce_nla', true,
        'disable_wdigest', true,
        'enable_credential_guard', false,
        'lsa_protection', true,
        'block_mimikatz_patterns', true
      ),
      'application_control', jsonb_build_object(
        'wdac_enforced', true,
        'applocker_fallback', true,
        'block_unsigned_scripts', true,
        'block_macro_execution', true
      ),
      'encryption', jsonb_build_object(
        'enforce_bitlocker', true,
        'tls_min_version', '1.2',
        'disable_ssl3', true,
        'disable_tls10', true,
        'disable_tls11', true
      )
    )
  );

  -- Server 2012 R2 Legacy Hardening Profile
  INSERT INTO public.hardening_profiles (organization_id, name, description, os_target, is_system_default, settings)
  VALUES (
    _org_id,
    'Server 2012 R2 Maximum Hardening',
    'Comprehensive hardening for Windows Server 2012 R2 past end-of-life. Applies maximum security controls to mitigate risks without ESU.',
    'server2012r2',
    true,
    jsonb_build_object(
      'defender', jsonb_build_object(
        'realtime_monitoring', true,
        'cloud_delivered_protection', true,
        'cloud_block_level', 'High',
        'block_at_first_seen', true,
        'pua_protection', true,
        'network_protection', true
      ),
      'network', jsonb_build_object(
        'disable_smb_v1', true,
        'disable_llmnr', true,
        'disable_netbios', true,
        'disable_wpad', true,
        'enable_smb_signing', true,
        'enable_ldap_signing', true,
        'restrict_ntlm', true,
        'isolate_from_modern_os', true,
        'restrict_rpc_remote', true
      ),
      'services', jsonb_build_object(
        'disable_remote_registry', true,
        'disable_print_spooler', true,
        'disable_telnet', true,
        'disable_ftp', true,
        'disable_powershell_v2', true,
        'disable_unnecessary_roles', true,
        'harden_iis', true
      ),
      'authentication', jsonb_build_object(
        'enforce_nla', true,
        'disable_wdigest', true,
        'lsa_protection', true,
        'restrict_admin_logon', true,
        'kerberos_armoring', true
      ),
      'application_control', jsonb_build_object(
        'applocker_enforced', true,
        'srp_fallback', true,
        'block_unsigned_scripts', true
      ),
      'encryption', jsonb_build_object(
        'tls_min_version', '1.2',
        'disable_ssl3', true,
        'disable_tls10', true,
        'disable_tls11', true,
        'disable_rc4', true,
        'disable_3des', true
      )
    )
  );

  -- Balanced hardening profile (less aggressive, for compatibility)
  INSERT INTO public.hardening_profiles (organization_id, name, description, os_target, is_system_default, settings)
  VALUES (
    _org_id,
    'Balanced Legacy Hardening',
    'Moderate hardening that balances security with application compatibility. Good starting point before moving to maximum hardening.',
    'all',
    true,
    jsonb_build_object(
      'defender', jsonb_build_object(
        'realtime_monitoring', true,
        'cloud_delivered_protection', true,
        'cloud_block_level', 'Moderate',
        'pua_protection', true,
        'network_protection', true,
        'all_asr_rules', 'audit'
      ),
      'network', jsonb_build_object(
        'disable_smb_v1', true,
        'disable_llmnr', true,
        'enable_smb_signing', true,
        'restrict_ntlm', false
      ),
      'services', jsonb_build_object(
        'disable_remote_registry', true,
        'disable_powershell_v2', true
      ),
      'authentication', jsonb_build_object(
        'enforce_nla', true,
        'disable_wdigest', true
      ),
      'application_control', jsonb_build_object(
        'wdac_audit', true,
        'block_unsigned_scripts', false
      ),
      'encryption', jsonb_build_object(
        'tls_min_version', '1.2',
        'disable_ssl3', true,
        'disable_tls10', true
      )
    )
  );
END;
$$;
