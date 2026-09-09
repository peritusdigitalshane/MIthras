-- Create enrollment_codes table
CREATE TABLE public.enrollment_codes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role public.org_role NOT NULL DEFAULT 'member',
  is_single_use BOOLEAN NOT NULL DEFAULT true,
  max_uses INTEGER, -- NULL means unlimited (for multi-use codes)
  use_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMP WITH TIME ZONE, -- NULL means no expiration
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- Enable RLS
ALTER TABLE public.enrollment_codes ENABLE ROW LEVEL SECURITY;

-- Super admins can manage all codes
CREATE POLICY "Super admins can manage all enrollment codes"
ON public.enrollment_codes
FOR ALL
USING (is_super_admin(auth.uid()));

-- Org admins can view codes for their org
CREATE POLICY "Admins can view org enrollment codes"
ON public.enrollment_codes
FOR SELECT
USING (is_admin_of_org(auth.uid(), organization_id));

-- Org admins can create codes for their org
CREATE POLICY "Admins can create org enrollment codes"
ON public.enrollment_codes
FOR INSERT
WITH CHECK (is_admin_of_org(auth.uid(), organization_id));

-- Org admins can update codes for their org
CREATE POLICY "Admins can update org enrollment codes"
ON public.enrollment_codes
FOR UPDATE
USING (is_admin_of_org(auth.uid(), organization_id));

-- Anyone can validate a code (for signup) - but only read specific fields
CREATE POLICY "Anyone can validate enrollment codes"
ON public.enrollment_codes
FOR SELECT
USING (true);

-- Create function to validate and use enrollment code
CREATE OR REPLACE FUNCTION public.validate_enrollment_code(_code TEXT)
RETURNS TABLE(
  organization_id UUID,
  organization_name TEXT,
  role public.org_role,
  is_valid BOOLEAN,
  error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  code_record RECORD;
BEGIN
  -- Find the code
  SELECT ec.*, o.name as org_name
  INTO code_record
  FROM public.enrollment_codes ec
  JOIN public.organizations o ON o.id = ec.organization_id
  WHERE ec.code = _code;

  -- Code not found
  IF code_record IS NULL THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::public.org_role, false, 'Invalid enrollment code'::TEXT;
    RETURN;
  END IF;

  -- Code is inactive
  IF NOT code_record.is_active THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::public.org_role, false, 'This enrollment code is no longer active'::TEXT;
    RETURN;
  END IF;

  -- Code has expired
  IF code_record.expires_at IS NOT NULL AND code_record.expires_at < now() THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::public.org_role, false, 'This enrollment code has expired'::TEXT;
    RETURN;
  END IF;

  -- Single-use code already used
  IF code_record.is_single_use AND code_record.use_count > 0 THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::public.org_role, false, 'This enrollment code has already been used'::TEXT;
    RETURN;
  END IF;

  -- Multi-use code exceeded max uses
  IF code_record.max_uses IS NOT NULL AND code_record.use_count >= code_record.max_uses THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::public.org_role, false, 'This enrollment code has reached its maximum uses'::TEXT;
    RETURN;
  END IF;

  -- Code is valid
  RETURN QUERY SELECT code_record.organization_id, code_record.org_name, code_record.role, true, NULL::TEXT;
END;
$$;

-- Create function to consume enrollment code (increment use count)
CREATE OR REPLACE FUNCTION public.use_enrollment_code(_code TEXT, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  code_record RECORD;
BEGIN
  -- Find and validate code
  SELECT * INTO code_record
  FROM public.enrollment_codes
  WHERE code = _code
    AND is_active = true
    AND (expires_at IS NULL OR expires_at > now())
    AND (NOT is_single_use OR use_count = 0)
    AND (max_uses IS NULL OR use_count < max_uses);

  IF code_record IS NULL THEN
    RETURN false;
  END IF;

  -- Increment use count
  UPDATE public.enrollment_codes
  SET use_count = use_count + 1
  WHERE id = code_record.id;

  -- Add user to organization
  INSERT INTO public.organization_memberships (user_id, organization_id, role)
  VALUES (_user_id, code_record.organization_id, code_record.role)
  ON CONFLICT (user_id, organization_id) DO NOTHING;

  RETURN true;
END;
$$;

-- Add unique constraint on user+org membership
ALTER TABLE public.organization_memberships 
ADD CONSTRAINT unique_user_org UNIQUE (user_id, organization_id);

-- Update handle_new_user to NOT create org automatically (we'll handle this in app)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  user_count INTEGER;
  enrollment_code TEXT;
  code_org_id UUID;
  code_role public.org_role;
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
  END IF;

  -- Check if this is the first user
  SELECT COUNT(*) INTO user_count FROM auth.users;
  
  -- If this is the first user, make them a super admin and create default org
  IF user_count = 1 THEN
    INSERT INTO public.super_admins (user_id) VALUES (NEW.id);
    
    -- Create a default organization for the first user
    INSERT INTO public.organizations (name, slug)
    VALUES ('Default Organization', 'default-org-' || substr(gen_random_uuid()::text, 1, 8))
    RETURNING id INTO code_org_id;
    
    INSERT INTO public.organization_memberships (user_id, organization_id, role)
    VALUES (NEW.id, code_org_id, 'owner');
  END IF;

  RETURN NEW;
END;
$$;