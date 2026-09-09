
-- Policy audit sessions
CREATE TABLE public.policy_audit_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  policy_type text NOT NULL CHECK (policy_type IN ('defender', 'gpo', 'wdac', 'uac', 'windows_update')),
  policy_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  planned_duration_days integer NOT NULL DEFAULT 30,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  started_by uuid REFERENCES auth.users(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.policy_audit_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view audit sessions" ON public.policy_audit_sessions
  FOR SELECT USING (is_member_of_org(auth.uid(), organization_id));

CREATE POLICY "Admins can create audit sessions" ON public.policy_audit_sessions
  FOR INSERT WITH CHECK (is_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Admins can update audit sessions" ON public.policy_audit_sessions
  FOR UPDATE USING (is_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Super admins full access" ON public.policy_audit_sessions
  FOR ALL USING (is_super_admin(auth.uid()));

CREATE INDEX idx_audit_sessions_org ON public.policy_audit_sessions(organization_id);
CREATE INDEX idx_audit_sessions_policy ON public.policy_audit_sessions(policy_type, policy_id);
CREATE INDEX idx_audit_sessions_status ON public.policy_audit_sessions(status);

-- Policy audit findings
CREATE TABLE public.policy_audit_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.policy_audit_sessions(id) ON DELETE CASCADE,
  finding_type text NOT NULL,
  source_endpoint_id uuid REFERENCES public.endpoints(id) ON DELETE SET NULL,
  value text NOT NULL,
  occurrence_count integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  details jsonb,
  is_approved boolean DEFAULT false,
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.policy_audit_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view findings" ON public.policy_audit_findings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.policy_audit_sessions s
      WHERE s.id = policy_audit_findings.session_id
      AND is_member_of_org(auth.uid(), s.organization_id)
    )
  );

CREATE POLICY "Admins can manage findings" ON public.policy_audit_findings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.policy_audit_sessions s
      WHERE s.id = policy_audit_findings.session_id
      AND is_admin_of_org(auth.uid(), s.organization_id)
    )
  );

CREATE POLICY "Super admins full access findings" ON public.policy_audit_findings
  FOR ALL USING (is_super_admin(auth.uid()));

CREATE POLICY "System can insert findings" ON public.policy_audit_findings
  FOR INSERT WITH CHECK (true);

CREATE INDEX idx_audit_findings_session ON public.policy_audit_findings(session_id);
CREATE INDEX idx_audit_findings_type ON public.policy_audit_findings(finding_type);
CREATE INDEX idx_audit_findings_value ON public.policy_audit_findings(value);
CREATE INDEX idx_audit_findings_approved ON public.policy_audit_findings(is_approved);
