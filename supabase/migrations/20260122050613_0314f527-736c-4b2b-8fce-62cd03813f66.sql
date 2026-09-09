-- Allow super admins to view all organizations
CREATE POLICY "Super admins can view all organizations"
ON public.organizations
FOR SELECT
USING (is_super_admin(auth.uid()));

-- Allow super admins to view all endpoints
CREATE POLICY "Super admins can view all endpoints"
ON public.endpoints
FOR SELECT
USING (is_super_admin(auth.uid()));

-- Allow super admins to manage all endpoints
CREATE POLICY "Super admins can manage all endpoints"
ON public.endpoints
FOR ALL
USING (is_super_admin(auth.uid()));

-- Allow super admins to view all organization memberships
CREATE POLICY "Super admins can view all memberships"
ON public.organization_memberships
FOR SELECT
USING (is_super_admin(auth.uid()));

-- Allow super admins to view all policies
CREATE POLICY "Super admins can view all policies"
ON public.defender_policies
FOR SELECT
USING (is_super_admin(auth.uid()));

-- Allow super admins to manage all policies
CREATE POLICY "Super admins can manage all policies"
ON public.defender_policies
FOR ALL
USING (is_super_admin(auth.uid()));

-- Allow super admins to view all endpoint statuses
CREATE POLICY "Super admins can view all endpoint statuses"
ON public.endpoint_status
FOR SELECT
USING (is_super_admin(auth.uid()));

-- Allow super admins to view all endpoint threats
CREATE POLICY "Super admins can view all endpoint threats"
ON public.endpoint_threats
FOR SELECT
USING (is_super_admin(auth.uid()));

-- Allow super admins to view all endpoint logs
CREATE POLICY "Super admins can view all endpoint logs"
ON public.endpoint_logs
FOR SELECT
USING (is_super_admin(auth.uid()));

-- Allow super admins to view all endpoint event logs
CREATE POLICY "Super admins can view all event logs"
ON public.endpoint_event_logs
FOR SELECT
USING (is_super_admin(auth.uid()));

-- Allow super admins to view all activity logs
CREATE POLICY "Super admins can view all activity logs"
ON public.activity_logs
FOR SELECT
USING (is_super_admin(auth.uid()));