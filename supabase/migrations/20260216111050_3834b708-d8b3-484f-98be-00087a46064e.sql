
-- Recreate INSERT policy that also allows super admins
DROP POLICY IF EXISTS "Org members can create router enrollment tokens" ON public.router_enrollment_tokens;

CREATE POLICY "Org members can create router enrollment tokens"
ON public.router_enrollment_tokens
FOR INSERT
WITH CHECK (
  organization_id IN (
    SELECT organization_memberships.organization_id
    FROM organization_memberships
    WHERE organization_memberships.user_id = auth.uid()
  )
  OR
  public.is_super_admin(auth.uid())
);

-- Fix SELECT policy for super admins
DROP POLICY IF EXISTS "Org members can view router enrollment tokens" ON public.router_enrollment_tokens;

CREATE POLICY "Org members can view router enrollment tokens"
ON public.router_enrollment_tokens
FOR SELECT
USING (
  organization_id IN (
    SELECT organization_memberships.organization_id
    FROM organization_memberships
    WHERE organization_memberships.user_id = auth.uid()
  )
  OR
  public.is_super_admin(auth.uid())
);

-- Fix UPDATE policy for super admins
DROP POLICY IF EXISTS "Org members can update router enrollment tokens" ON public.router_enrollment_tokens;

CREATE POLICY "Org members can update router enrollment tokens"
ON public.router_enrollment_tokens
FOR UPDATE
USING (
  organization_id IN (
    SELECT organization_memberships.organization_id
    FROM organization_memberships
    WHERE organization_memberships.user_id = auth.uid()
  )
  OR
  public.is_super_admin(auth.uid())
);

-- Fix DELETE policy for super admins
DROP POLICY IF EXISTS "Org members can delete router enrollment tokens" ON public.router_enrollment_tokens;

CREATE POLICY "Org members can delete router enrollment tokens"
ON public.router_enrollment_tokens
FOR DELETE
USING (
  organization_id IN (
    SELECT organization_memberships.organization_id
    FROM organization_memberships
    WHERE organization_memberships.user_id = auth.uid()
  )
  OR
  public.is_super_admin(auth.uid())
);
