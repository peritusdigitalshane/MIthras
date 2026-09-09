-- Update handle_new_user function to create organization on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  user_count INTEGER;
  new_org_id UUID;
  org_name_val TEXT;
  org_slug_val TEXT;
BEGIN
  -- Create profile
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );

  -- Get organization name from metadata, default to user's email domain
  org_name_val := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'org_name'), ''),
    split_part(NEW.email, '@', 2)
  );
  
  -- Generate a slug from the org name
  org_slug_val := lower(regexp_replace(org_name_val, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(gen_random_uuid()::text, 1, 8);

  -- Create organization for the new user
  INSERT INTO public.organizations (name, slug)
  VALUES (org_name_val, org_slug_val)
  RETURNING id INTO new_org_id;

  -- Add user as owner of the organization
  INSERT INTO public.organization_memberships (user_id, organization_id, role)
  VALUES (NEW.id, new_org_id, 'owner');

  -- Check if this is the first user
  SELECT COUNT(*) INTO user_count FROM auth.users;
  
  -- If this is the first user, make them a super admin
  IF user_count = 1 THEN
    INSERT INTO public.super_admins (user_id) VALUES (NEW.id);
  END IF;

  RETURN NEW;
END;
$function$;

-- Add RLS policy for users to insert their own organization (needed for the trigger)
CREATE POLICY "System can insert organizations"
ON public.organizations
FOR INSERT
WITH CHECK (true);

-- Allow the trigger to insert memberships
DROP POLICY IF EXISTS "Admins can insert memberships" ON public.organization_memberships;
CREATE POLICY "Users can insert own membership or admins can insert"
ON public.organization_memberships
FOR INSERT
WITH CHECK (
  user_id = auth.uid() 
  OR is_admin_of_org(auth.uid(), organization_id)
);