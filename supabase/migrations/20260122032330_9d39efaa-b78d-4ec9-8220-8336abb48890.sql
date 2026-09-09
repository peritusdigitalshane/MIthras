-- Create enum for ASR rule actions
CREATE TYPE public.asr_action AS ENUM ('disabled', 'enabled', 'audit');

-- Create defender_policies table for storing policy configurations
CREATE TABLE public.defender_policies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  
  -- Basic Protection Settings
  realtime_monitoring BOOLEAN NOT NULL DEFAULT true,
  cloud_delivered_protection BOOLEAN NOT NULL DEFAULT true,
  maps_reporting TEXT NOT NULL DEFAULT 'Advanced' CHECK (maps_reporting IN ('Disabled', 'Basic', 'Advanced')),
  sample_submission TEXT NOT NULL DEFAULT 'SendAllSamples' CHECK (sample_submission IN ('None', 'SendSafeSamples', 'SendAllSamples')),
  check_signatures_before_scan BOOLEAN NOT NULL DEFAULT true,
  behavior_monitoring BOOLEAN NOT NULL DEFAULT true,
  ioav_protection BOOLEAN NOT NULL DEFAULT true,
  script_scanning BOOLEAN NOT NULL DEFAULT true,
  removable_drive_scanning BOOLEAN NOT NULL DEFAULT true,
  block_at_first_seen BOOLEAN NOT NULL DEFAULT true,
  pua_protection BOOLEAN NOT NULL DEFAULT true,
  signature_update_interval INTEGER NOT NULL DEFAULT 8,
  archive_scanning BOOLEAN NOT NULL DEFAULT true,
  email_scanning BOOLEAN NOT NULL DEFAULT true,
  
  -- Advanced Settings
  cloud_block_level TEXT NOT NULL DEFAULT 'High' CHECK (cloud_block_level IN ('Default', 'Moderate', 'High', 'HighPlus', 'ZeroTolerance')),
  cloud_extended_timeout INTEGER NOT NULL DEFAULT 50,
  controlled_folder_access BOOLEAN NOT NULL DEFAULT true,
  network_protection BOOLEAN NOT NULL DEFAULT true,
  
  -- Attack Surface Reduction Rules
  asr_block_vulnerable_drivers asr_action NOT NULL DEFAULT 'enabled',
  asr_block_email_executable asr_action NOT NULL DEFAULT 'enabled',
  asr_block_office_child_process asr_action NOT NULL DEFAULT 'enabled',
  asr_block_office_executable_content asr_action NOT NULL DEFAULT 'enabled',
  asr_block_office_code_injection asr_action NOT NULL DEFAULT 'enabled',
  asr_block_js_vbs_executable asr_action NOT NULL DEFAULT 'enabled',
  asr_block_obfuscated_scripts asr_action NOT NULL DEFAULT 'enabled',
  asr_block_office_macro_win32 asr_action NOT NULL DEFAULT 'enabled',
  asr_block_untrusted_executables asr_action NOT NULL DEFAULT 'enabled',
  asr_advanced_ransomware_protection asr_action NOT NULL DEFAULT 'enabled',
  asr_block_credential_stealing asr_action NOT NULL DEFAULT 'audit',
  asr_block_psexec_wmi asr_action NOT NULL DEFAULT 'enabled',
  asr_block_usb_untrusted asr_action NOT NULL DEFAULT 'enabled',
  asr_block_office_comms_child_process asr_action NOT NULL DEFAULT 'audit',
  asr_block_adobe_child_process asr_action NOT NULL DEFAULT 'audit',
  asr_block_wmi_persistence asr_action NOT NULL DEFAULT 'enabled',
  
  -- Exploit Protection
  exploit_protection_enabled BOOLEAN NOT NULL DEFAULT true,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- Create index for faster lookups
CREATE INDEX idx_defender_policies_org ON public.defender_policies(organization_id);

-- Enable RLS
ALTER TABLE public.defender_policies ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view policies in their organizations"
  ON public.defender_policies FOR SELECT
  USING (public.is_member_of_org(auth.uid(), organization_id));

CREATE POLICY "Admins can create policies"
  ON public.defender_policies FOR INSERT
  WITH CHECK (public.is_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Admins can update policies"
  ON public.defender_policies FOR UPDATE
  USING (public.is_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Admins can delete policies"
  ON public.defender_policies FOR DELETE
  USING (public.is_admin_of_org(auth.uid(), organization_id));

-- Trigger for updated_at
CREATE TRIGGER update_defender_policies_updated_at
  BEFORE UPDATE ON public.defender_policies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();