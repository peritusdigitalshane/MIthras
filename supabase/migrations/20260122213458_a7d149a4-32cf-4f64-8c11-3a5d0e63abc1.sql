-- Add UAC status columns to endpoint_status table
ALTER TABLE public.endpoint_status
ADD COLUMN IF NOT EXISTS uac_enabled boolean NULL,
ADD COLUMN IF NOT EXISTS uac_consent_prompt_admin integer NULL,
ADD COLUMN IF NOT EXISTS uac_consent_prompt_user integer NULL,
ADD COLUMN IF NOT EXISTS uac_prompt_on_secure_desktop boolean NULL,
ADD COLUMN IF NOT EXISTS uac_detect_installations boolean NULL,
ADD COLUMN IF NOT EXISTS uac_validate_admin_signatures boolean NULL,
ADD COLUMN IF NOT EXISTS uac_filter_administrator_token boolean NULL;

-- Create UAC policies table
CREATE TABLE public.uac_policies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  -- EnableLUA (0=Disabled, 1=Enabled)
  enable_lua BOOLEAN NOT NULL DEFAULT true,
  -- ConsentPromptBehaviorAdmin (0-5)
  consent_prompt_admin INTEGER NOT NULL DEFAULT 5 CHECK (consent_prompt_admin >= 0 AND consent_prompt_admin <= 5),
  -- ConsentPromptBehaviorUser (0-3)
  consent_prompt_user INTEGER NOT NULL DEFAULT 3 CHECK (consent_prompt_user >= 0 AND consent_prompt_user <= 3),
  -- PromptOnSecureDesktop
  prompt_on_secure_desktop BOOLEAN NOT NULL DEFAULT true,
  -- EnableInstallerDetection
  detect_installations BOOLEAN NOT NULL DEFAULT true,
  -- ValidateAdminCodeSignatures
  validate_admin_signatures BOOLEAN NOT NULL DEFAULT false,
  -- FilterAdministratorToken
  filter_administrator_token BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add UAC policy reference to endpoints
ALTER TABLE public.endpoints
ADD COLUMN IF NOT EXISTS uac_policy_id UUID REFERENCES public.uac_policies(id) ON DELETE SET NULL;

-- Add UAC policy reference to endpoint_groups
ALTER TABLE public.endpoint_groups
ADD COLUMN IF NOT EXISTS uac_policy_id UUID REFERENCES public.uac_policies(id) ON DELETE SET NULL;

-- Enable RLS on uac_policies
ALTER TABLE public.uac_policies ENABLE ROW LEVEL SECURITY;

-- RLS policies for uac_policies
CREATE POLICY "Users can view UAC policies in their orgs"
ON public.uac_policies FOR SELECT
USING (is_member_of_org(auth.uid(), organization_id));

CREATE POLICY "Admins can create UAC policies"
ON public.uac_policies FOR INSERT
WITH CHECK (is_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Admins can update UAC policies"
ON public.uac_policies FOR UPDATE
USING (is_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Admins can delete UAC policies"
ON public.uac_policies FOR DELETE
USING (is_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Super admins can manage all UAC policies"
ON public.uac_policies FOR ALL
USING (is_super_admin(auth.uid()));

-- Trigger for updated_at
CREATE TRIGGER update_uac_policies_updated_at
BEFORE UPDATE ON public.uac_policies
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();