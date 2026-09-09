-- Add Windows Update status columns to endpoint_status
ALTER TABLE public.endpoint_status
ADD COLUMN IF NOT EXISTS wu_auto_update_mode INTEGER,
ADD COLUMN IF NOT EXISTS wu_active_hours_start INTEGER,
ADD COLUMN IF NOT EXISTS wu_active_hours_end INTEGER,
ADD COLUMN IF NOT EXISTS wu_feature_update_deferral INTEGER,
ADD COLUMN IF NOT EXISTS wu_quality_update_deferral INTEGER,
ADD COLUMN IF NOT EXISTS wu_pause_feature_updates BOOLEAN,
ADD COLUMN IF NOT EXISTS wu_pause_quality_updates BOOLEAN,
ADD COLUMN IF NOT EXISTS wu_pending_updates_count INTEGER,
ADD COLUMN IF NOT EXISTS wu_last_install_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS wu_restart_pending BOOLEAN;

-- Create Windows Update policies table
CREATE TABLE public.windows_update_policies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  auto_update_mode INTEGER DEFAULT 4, -- 0=Notify, 1=Auto download, 2=Auto install, 3=Scheduled, 4=Local admin decides
  active_hours_start INTEGER DEFAULT 8, -- 0-23
  active_hours_end INTEGER DEFAULT 17, -- 0-23
  feature_update_deferral INTEGER DEFAULT 0, -- Days 0-365
  quality_update_deferral INTEGER DEFAULT 0, -- Days 0-30
  pause_feature_updates BOOLEAN DEFAULT false,
  pause_quality_updates BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add policy assignment columns to endpoints and groups
ALTER TABLE public.endpoints
ADD COLUMN IF NOT EXISTS windows_update_policy_id UUID REFERENCES public.windows_update_policies(id) ON DELETE SET NULL;

ALTER TABLE public.endpoint_groups
ADD COLUMN IF NOT EXISTS windows_update_policy_id UUID REFERENCES public.windows_update_policies(id) ON DELETE SET NULL;

-- Enable RLS
ALTER TABLE public.windows_update_policies ENABLE ROW LEVEL SECURITY;

-- RLS policies for windows_update_policies
CREATE POLICY "Users can view their org's WU policies"
ON public.windows_update_policies
FOR SELECT
USING (public.is_member_of_org(auth.uid(), organization_id) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Admins can insert WU policies"
ON public.windows_update_policies
FOR INSERT
WITH CHECK (public.is_admin_of_org(auth.uid(), organization_id) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Admins can update WU policies"
ON public.windows_update_policies
FOR UPDATE
USING (public.is_admin_of_org(auth.uid(), organization_id) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Admins can delete WU policies"
ON public.windows_update_policies
FOR DELETE
USING (public.is_admin_of_org(auth.uid(), organization_id) OR public.is_super_admin(auth.uid()));

-- Add updated_at trigger
CREATE TRIGGER update_windows_update_policies_updated_at
BEFORE UPDATE ON public.windows_update_policies
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();