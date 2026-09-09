-- Create subscription plan enum
CREATE TYPE public.subscription_plan AS ENUM ('free', 'pro', 'business');

-- Add subscription plan to organizations
ALTER TABLE public.organizations 
ADD COLUMN subscription_plan public.subscription_plan NOT NULL DEFAULT 'free';

-- Update partners to always have business plan
UPDATE public.organizations 
SET subscription_plan = 'business' 
WHERE organization_type = 'partner';

-- Create a table to define plan features/limits
CREATE TABLE public.plan_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan public.subscription_plan NOT NULL UNIQUE,
  max_devices INTEGER, -- NULL means unlimited
  ai_security_advisor BOOLEAN NOT NULL DEFAULT false,
  compliance_reporting BOOLEAN NOT NULL DEFAULT false,
  advanced_threat_analytics BOOLEAN NOT NULL DEFAULT false,
  custom_policies BOOLEAN NOT NULL DEFAULT false,
  priority_support BOOLEAN NOT NULL DEFAULT false,
  api_access BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.plan_features ENABLE ROW LEVEL SECURITY;

-- Everyone can read plan features
CREATE POLICY "Anyone can view plan features"
ON public.plan_features FOR SELECT
USING (true);

-- Only super admins can modify plan features
CREATE POLICY "Super admins can manage plan features"
ON public.plan_features FOR ALL
USING (public.is_super_admin(auth.uid()));

-- Insert default plan features
INSERT INTO public.plan_features (plan, max_devices, ai_security_advisor, compliance_reporting, advanced_threat_analytics, custom_policies, priority_support, api_access)
VALUES 
  ('free', 2, false, false, false, false, false, false),
  ('pro', 25, false, false, true, true, false, false),
  ('business', NULL, true, true, true, true, true, true);

-- Create trigger for updated_at
CREATE TRIGGER update_plan_features_updated_at
  BEFORE UPDATE ON public.plan_features
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Function to check if an org can add more devices based on their plan
CREATE OR REPLACE FUNCTION public.can_add_device(_org_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_count INTEGER;
  max_allowed INTEGER;
  org_plan public.subscription_plan;
  parent_id UUID;
BEGIN
  -- Get org's plan and parent
  SELECT o.subscription_plan, o.parent_partner_id 
  INTO org_plan, parent_id
  FROM public.organizations o
  WHERE o.id = _org_id;

  -- If org has a partner parent, they inherit business plan
  IF parent_id IS NOT NULL THEN
    RETURN true;
  END IF;

  -- Get max devices for the plan
  SELECT pf.max_devices INTO max_allowed
  FROM public.plan_features pf
  WHERE pf.plan = org_plan;

  -- NULL means unlimited
  IF max_allowed IS NULL THEN
    RETURN true;
  END IF;

  -- Count current devices
  SELECT COUNT(*) INTO current_count
  FROM public.endpoints
  WHERE organization_id = _org_id;

  RETURN current_count < max_allowed;
END;
$$;

-- Function to get effective plan for an org (considers partner parent)
CREATE OR REPLACE FUNCTION public.get_effective_plan(_org_id UUID)
RETURNS public.subscription_plan
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_plan public.subscription_plan;
  parent_id UUID;
BEGIN
  SELECT o.subscription_plan, o.parent_partner_id 
  INTO org_plan, parent_id
  FROM public.organizations o
  WHERE o.id = _org_id;

  -- If org has a partner parent, they get business plan
  IF parent_id IS NOT NULL THEN
    RETURN 'business'::public.subscription_plan;
  END IF;

  RETURN org_plan;
END;
$$;