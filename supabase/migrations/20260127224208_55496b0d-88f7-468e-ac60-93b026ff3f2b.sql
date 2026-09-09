-- Allow Super Admins to insert new super admins
CREATE POLICY "Super admins can insert super_admins"
ON public.super_admins
FOR INSERT
WITH CHECK (is_super_admin(auth.uid()));

-- Allow Super Admins to delete super admins (revoke)
CREATE POLICY "Super admins can delete super_admins"
ON public.super_admins
FOR DELETE
USING (is_super_admin(auth.uid()));