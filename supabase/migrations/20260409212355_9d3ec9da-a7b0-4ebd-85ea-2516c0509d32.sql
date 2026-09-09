
-- Create firewall audit sessions table
CREATE TABLE public.firewall_audit_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  policy_id UUID NOT NULL REFERENCES public.firewall_policies(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'auditing' CHECK (status IN ('auditing', 'completed', 'template_generated')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ NOT NULL,
  started_by UUID REFERENCES public.profiles(id),
  generated_template_id UUID REFERENCES public.firewall_templates(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.firewall_audit_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Members can view audit sessions in their org"
  ON public.firewall_audit_sessions FOR SELECT
  USING (is_member_of_org(auth.uid(), organization_id) OR is_super_admin(auth.uid()));

CREATE POLICY "Admins can create audit sessions"
  ON public.firewall_audit_sessions FOR INSERT
  WITH CHECK (is_admin_of_org(auth.uid(), organization_id) OR is_super_admin(auth.uid()));

CREATE POLICY "Admins can update audit sessions"
  ON public.firewall_audit_sessions FOR UPDATE
  USING (is_admin_of_org(auth.uid(), organization_id) OR is_super_admin(auth.uid()));

CREATE POLICY "Admins can delete audit sessions"
  ON public.firewall_audit_sessions FOR DELETE
  USING (is_admin_of_org(auth.uid(), organization_id) OR is_super_admin(auth.uid()));

CREATE POLICY "Partners can manage customer audit sessions"
  ON public.firewall_audit_sessions FOR ALL
  USING (is_partner_admin_of_org(auth.uid(), organization_id));

-- Trigger for updated_at
CREATE TRIGGER update_firewall_audit_sessions_updated_at
  BEFORE UPDATE ON public.firewall_audit_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Index for quick lookups
CREATE INDEX idx_firewall_audit_sessions_org_status
  ON public.firewall_audit_sessions(organization_id, status);
