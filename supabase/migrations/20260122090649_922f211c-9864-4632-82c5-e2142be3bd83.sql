-- Fix permissive RLS policy on organizations (WITH CHECK (true))
DROP POLICY IF EXISTS "System can insert organizations" ON public.organizations;

-- Restrict org creation to super admins (service_role bypasses RLS anyway)
CREATE POLICY "Super admins can create organizations"
ON public.organizations
FOR INSERT
WITH CHECK (is_super_admin(auth.uid()));