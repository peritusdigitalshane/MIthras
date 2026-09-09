-- Allow super admins to update any organization
CREATE POLICY "Super admins can update all organizations"
ON public.organizations
FOR UPDATE
USING (is_super_admin(auth.uid()));