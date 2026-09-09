-- 1) Ensure Shane Stephens is a member of the Peritus Digital org
-- (prevents tenant selector / users list from showing only other members)
INSERT INTO public.organization_memberships (user_id, organization_id, role)
SELECT
  '46c5e34c-df7b-4c92-9069-9d213ea26d29'::uuid AS user_id,
  'd84daf0b-45ea-4d93-8a0e-93b59a53b4ee'::uuid AS organization_id,
  'owner'::public.org_role AS role
WHERE NOT EXISTS (
  SELECT 1
  FROM public.organization_memberships om
  WHERE om.user_id = '46c5e34c-df7b-4c92-9069-9d213ea26d29'::uuid
    AND om.organization_id = 'd84daf0b-45ea-4d93-8a0e-93b59a53b4ee'::uuid
);

-- 2) Allow Super Admins (and Partner Admins for a customer org) to read profiles,
-- otherwise the Users page can't resolve display_name/email -> shows "Unknown".
DROP POLICY IF EXISTS "Users can view profiles in their organizations" ON public.profiles;

CREATE POLICY "Users can view profiles in their organizations"
ON public.profiles
FOR SELECT
USING (
  (id = auth.uid())
  OR is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.organization_memberships om1
    JOIN public.organization_memberships om2
      ON om1.organization_id = om2.organization_id
    WHERE om1.user_id = auth.uid()
      AND om2.user_id = public.profiles.id
  )
  OR EXISTS (
    -- Partner admins can view profiles for users in customer orgs they manage
    SELECT 1
    FROM public.organization_memberships om
    WHERE om.user_id = public.profiles.id
      AND is_partner_admin_of_org(auth.uid(), om.organization_id)
  )
);
