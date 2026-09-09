-- Fix the permissive INSERT policy on firewall_audit_logs
-- Drop the overly permissive policy
DROP POLICY IF EXISTS "System can insert firewall audit logs" ON public.firewall_audit_logs;

-- Create a more specific policy that allows inserts only when the endpoint belongs to the organization
CREATE POLICY "Allow insert firewall audit logs for valid endpoints"
  ON public.firewall_audit_logs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.endpoints e
      WHERE e.id = firewall_audit_logs.endpoint_id
      AND e.organization_id = firewall_audit_logs.organization_id
    )
  );