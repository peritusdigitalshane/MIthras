-- Allow admins to INSERT vulnerability findings (for CSV import)
CREATE POLICY "Admins can insert vulnerability findings"
ON public.vulnerability_findings
FOR INSERT
TO authenticated
WITH CHECK (
  is_admin_of_org(auth.uid(), organization_id)
  OR is_super_admin(auth.uid())
  OR is_partner_admin_of_org(auth.uid(), organization_id)
);

-- Allow admins to DELETE vulnerability findings
CREATE POLICY "Admins can delete vulnerability findings"
ON public.vulnerability_findings
FOR DELETE
TO authenticated
USING (
  is_admin_of_org(auth.uid(), organization_id)
  OR is_super_admin(auth.uid())
  OR is_partner_admin_of_org(auth.uid(), organization_id)
);

-- Allow admins to INSERT software inventory
CREATE POLICY "Admins can insert software inventory"
ON public.endpoint_software_inventory
FOR INSERT
TO authenticated
WITH CHECK (
  is_admin_of_org(auth.uid(), organization_id)
  OR is_super_admin(auth.uid())
  OR is_partner_admin_of_org(auth.uid(), organization_id)
);

-- Allow admins to UPDATE software inventory
CREATE POLICY "Admins can update software inventory"
ON public.endpoint_software_inventory
FOR UPDATE
TO authenticated
USING (
  is_admin_of_org(auth.uid(), organization_id)
  OR is_super_admin(auth.uid())
  OR is_partner_admin_of_org(auth.uid(), organization_id)
);

-- Allow admins to DELETE software inventory
CREATE POLICY "Admins can delete software inventory"
ON public.endpoint_software_inventory
FOR DELETE
TO authenticated
USING (
  is_admin_of_org(auth.uid(), organization_id)
  OR is_super_admin(auth.uid())
  OR is_partner_admin_of_org(auth.uid(), organization_id)
);