
-- Software inventory collected from endpoints
CREATE TABLE public.endpoint_software_inventory (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  endpoint_id UUID NOT NULL REFERENCES public.endpoints(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  software_name TEXT NOT NULL,
  software_version TEXT,
  publisher TEXT,
  install_date TEXT,
  architecture TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_software_inventory_endpoint ON public.endpoint_software_inventory(endpoint_id);
CREATE INDEX idx_software_inventory_org ON public.endpoint_software_inventory(organization_id);
CREATE INDEX idx_software_inventory_name ON public.endpoint_software_inventory(software_name);

ALTER TABLE public.endpoint_software_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view org software inventory"
  ON public.endpoint_software_inventory FOR SELECT
  TO authenticated
  USING (
    organization_id IN (SELECT public.get_user_org_ids(auth.uid()))
    OR public.is_super_admin(auth.uid())
    OR public.is_partner_admin_of_org(auth.uid(), organization_id)
  );

-- Vulnerability findings (CVE matches)
CREATE TABLE public.vulnerability_findings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  endpoint_id UUID NOT NULL REFERENCES public.endpoints(id) ON DELETE CASCADE,
  cve_id TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  cvss_score NUMERIC(3,1),
  affected_software TEXT NOT NULL,
  affected_version TEXT,
  fixed_version TEXT,
  description TEXT,
  remediation TEXT,
  source TEXT NOT NULL DEFAULT 'nvd',
  status TEXT NOT NULL DEFAULT 'open',
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id),
  scan_job_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_vuln_findings_org ON public.vulnerability_findings(organization_id);
CREATE INDEX idx_vuln_findings_endpoint ON public.vulnerability_findings(endpoint_id);
CREATE INDEX idx_vuln_findings_cve ON public.vulnerability_findings(cve_id);
CREATE INDEX idx_vuln_findings_severity ON public.vulnerability_findings(severity);
CREATE INDEX idx_vuln_findings_status ON public.vulnerability_findings(status);

ALTER TABLE public.vulnerability_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view org vulnerability findings"
  ON public.vulnerability_findings FOR SELECT
  TO authenticated
  USING (
    organization_id IN (SELECT public.get_user_org_ids(auth.uid()))
    OR public.is_super_admin(auth.uid())
    OR public.is_partner_admin_of_org(auth.uid(), organization_id)
  );

CREATE POLICY "Admins can update vulnerability findings"
  ON public.vulnerability_findings FOR UPDATE
  TO authenticated
  USING (
    public.is_admin_of_org(auth.uid(), organization_id)
    OR public.is_super_admin(auth.uid())
    OR public.is_partner_admin_of_org(auth.uid(), organization_id)
  );

-- Scan jobs
CREATE TABLE public.vulnerability_scan_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  scan_type TEXT NOT NULL DEFAULT 'full',
  status TEXT NOT NULL DEFAULT 'pending',
  total_endpoints INTEGER DEFAULT 0,
  scanned_endpoints INTEGER DEFAULT 0,
  findings_count INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  started_by UUID REFERENCES auth.users(id),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_vuln_scan_jobs_org ON public.vulnerability_scan_jobs(organization_id);

ALTER TABLE public.vulnerability_scan_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view org scan jobs"
  ON public.vulnerability_scan_jobs FOR SELECT
  TO authenticated
  USING (
    organization_id IN (SELECT public.get_user_org_ids(auth.uid()))
    OR public.is_super_admin(auth.uid())
    OR public.is_partner_admin_of_org(auth.uid(), organization_id)
  );

CREATE POLICY "Admins can create scan jobs"
  ON public.vulnerability_scan_jobs FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin_of_org(auth.uid(), organization_id)
    OR public.is_super_admin(auth.uid())
    OR public.is_partner_admin_of_org(auth.uid(), organization_id)
  );

CREATE POLICY "Admins can update scan jobs"
  ON public.vulnerability_scan_jobs FOR UPDATE
  TO authenticated
  USING (
    public.is_admin_of_org(auth.uid(), organization_id)
    OR public.is_super_admin(auth.uid())
    OR public.is_partner_admin_of_org(auth.uid(), organization_id)
  );

-- Add foreign key from findings to scan jobs
ALTER TABLE public.vulnerability_findings
  ADD CONSTRAINT vulnerability_findings_scan_job_id_fkey
  FOREIGN KEY (scan_job_id) REFERENCES public.vulnerability_scan_jobs(id) ON DELETE SET NULL;

-- Triggers for updated_at
CREATE TRIGGER update_software_inventory_updated_at
  BEFORE UPDATE ON public.endpoint_software_inventory
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_vulnerability_findings_updated_at
  BEFORE UPDATE ON public.vulnerability_findings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_vulnerability_scan_jobs_updated_at
  BEFORE UPDATE ON public.vulnerability_scan_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
