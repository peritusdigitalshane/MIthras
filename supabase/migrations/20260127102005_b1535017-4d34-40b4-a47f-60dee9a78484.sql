-- Create partner organizations table to track MSP/reseller relationships
-- Partners are organizations that can manage other customer organizations

-- Add organization_type to distinguish between partner and customer orgs
ALTER TABLE public.organizations 
ADD COLUMN organization_type text NOT NULL DEFAULT 'customer' CHECK (organization_type IN ('partner', 'customer'));

-- Add parent_partner_id to link customers to their managing partner
ALTER TABLE public.organizations 
ADD COLUMN parent_partner_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

-- Create index for efficient partner->customer lookups
CREATE INDEX idx_organizations_parent_partner ON public.organizations(parent_partner_id);

-- Create a function to check if user is a partner admin (admin of a partner org)
CREATE OR REPLACE FUNCTION public.is_partner_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_memberships om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = _user_id
      AND om.role IN ('admin', 'owner')
      AND o.organization_type = 'partner'
  )
$$;

-- Create a function to get customer org IDs that a partner user can access
CREATE OR REPLACE FUNCTION public.get_partner_customer_org_ids(_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id
  FROM public.organizations c
  JOIN public.organizations p ON c.parent_partner_id = p.id
  JOIN public.organization_memberships om ON om.organization_id = p.id
  WHERE om.user_id = _user_id
    AND om.role IN ('admin', 'owner')
    AND p.organization_type = 'partner'
$$;

-- Create a function to check if user is admin of a partner that owns this org
CREATE OR REPLACE FUNCTION public.is_partner_admin_of_org(_user_id uuid, _org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organizations c
    JOIN public.organizations p ON c.parent_partner_id = p.id
    JOIN public.organization_memberships om ON om.organization_id = p.id
    WHERE c.id = _org_id
      AND om.user_id = _user_id
      AND om.role IN ('admin', 'owner')
      AND p.organization_type = 'partner'
  )
$$;

-- Update the handle_new_user function to auto-create organization for new signups
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  user_count INTEGER;
  enrollment_code TEXT;
  code_org_id UUID;
  code_role public.org_role;
  new_org_id UUID;
BEGIN
  -- Create profile
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );

  -- Get enrollment code from metadata
  enrollment_code := NEW.raw_user_meta_data->>'enrollment_code';

  IF enrollment_code IS NOT NULL AND enrollment_code != '' THEN
    -- Use the enrollment code to add user to organization
    PERFORM public.use_enrollment_code(enrollment_code, NEW.id);
  ELSE
    -- Check if this is the first user
    SELECT COUNT(*) INTO user_count FROM auth.users;
    
    -- If this is the first user, make them a super admin
    IF user_count = 1 THEN
      INSERT INTO public.super_admins (user_id) VALUES (NEW.id);
      
      -- Create a default partner organization for the super admin
      INSERT INTO public.organizations (name, slug, organization_type)
      VALUES ('Platform Admin', 'platform-admin-' || substr(gen_random_uuid()::text, 1, 8), 'partner')
      RETURNING id INTO new_org_id;
      
      INSERT INTO public.organization_memberships (user_id, organization_id, role)
      VALUES (NEW.id, new_org_id, 'owner');
    ELSE
      -- Create a new customer organization for this individual signup
      INSERT INTO public.organizations (name, slug, organization_type)
      VALUES (
        COALESCE(NEW.raw_user_meta_data->>'company_name', split_part(NEW.email, '@', 1) || '''s Organization'),
        'org-' || substr(gen_random_uuid()::text, 1, 8),
        'customer'
      )
      RETURNING id INTO new_org_id;
      
      INSERT INTO public.organization_memberships (user_id, organization_id, role)
      VALUES (NEW.id, new_org_id, 'owner');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Add RLS policy for partners to view their customer organizations
CREATE POLICY "Partners can view their customer organizations"
ON public.organizations
FOR SELECT
USING (is_partner_admin_of_org(auth.uid(), id));

-- Add RLS policy for partners to update their customer organizations
CREATE POLICY "Partners can update their customer organizations"
ON public.organizations
FOR UPDATE
USING (is_partner_admin_of_org(auth.uid(), id));

-- Update endpoints RLS to allow partner access
CREATE POLICY "Partners can view customer endpoints"
ON public.endpoints
FOR SELECT
USING (is_partner_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Partners can manage customer endpoints"
ON public.endpoints
FOR ALL
USING (is_partner_admin_of_org(auth.uid(), organization_id));

-- Update defender_policies RLS for partner access
CREATE POLICY "Partners can view customer policies"
ON public.defender_policies
FOR SELECT
USING (is_partner_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Partners can manage customer policies"
ON public.defender_policies
FOR ALL
USING (is_partner_admin_of_org(auth.uid(), organization_id));

-- Update endpoint_groups RLS for partner access
CREATE POLICY "Partners can view customer groups"
ON public.endpoint_groups
FOR SELECT
USING (is_partner_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Partners can manage customer groups"
ON public.endpoint_groups
FOR ALL
USING (is_partner_admin_of_org(auth.uid(), organization_id));

-- Update organization_memberships RLS for partner access
CREATE POLICY "Partners can view customer memberships"
ON public.organization_memberships
FOR SELECT
USING (is_partner_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Partners can manage customer memberships"
ON public.organization_memberships
FOR ALL
USING (is_partner_admin_of_org(auth.uid(), organization_id));

-- Update activity_logs RLS for partner access
CREATE POLICY "Partners can view customer activity logs"
ON public.activity_logs
FOR SELECT
USING (is_partner_admin_of_org(auth.uid(), organization_id));

-- Update UAC policies RLS for partner access
CREATE POLICY "Partners can view customer UAC policies"
ON public.uac_policies
FOR SELECT
USING (is_partner_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Partners can manage customer UAC policies"
ON public.uac_policies
FOR ALL
USING (is_partner_admin_of_org(auth.uid(), organization_id));

-- Update WDAC policies RLS for partner access
CREATE POLICY "Partners can view customer WDAC policies"
ON public.wdac_policies
FOR SELECT
USING (is_partner_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Partners can manage customer WDAC policies"
ON public.wdac_policies
FOR ALL
USING (is_partner_admin_of_org(auth.uid(), organization_id));

-- Update Windows Update policies RLS for partner access
CREATE POLICY "Partners can view customer WU policies"
ON public.windows_update_policies
FOR SELECT
USING (is_partner_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Partners can manage customer WU policies"
ON public.windows_update_policies
FOR ALL
USING (is_partner_admin_of_org(auth.uid(), organization_id));

-- Update enrollment_codes RLS for partner access
CREATE POLICY "Partners can view customer enrollment codes"
ON public.enrollment_codes
FOR SELECT
USING (is_partner_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Partners can manage customer enrollment codes"
ON public.enrollment_codes
FOR ALL
USING (is_partner_admin_of_org(auth.uid(), organization_id));