-- Create reports table for historical reference
CREATE TABLE public.security_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  report_type TEXT NOT NULL CHECK (report_type IN ('monthly_security', 'cyber_insurance')),
  report_title TEXT NOT NULL,
  report_period_start DATE NOT NULL,
  report_period_end DATE NOT NULL,
  generated_by UUID REFERENCES public.profiles(id),
  generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  report_data JSONB NOT NULL DEFAULT '{}',
  section_visibility JSONB NOT NULL DEFAULT '{}',
  pdf_storage_path TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.security_reports ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view reports for their organization"
  ON public.security_reports
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_memberships 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create reports for their organization"
  ON public.security_reports
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.organization_memberships 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete reports for their organization"
  ON public.security_reports
  FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_memberships 
      WHERE user_id = auth.uid()
    )
  );

-- Index for fast lookups
CREATE INDEX idx_security_reports_org_type ON public.security_reports(organization_id, report_type);
CREATE INDEX idx_security_reports_period ON public.security_reports(report_period_start, report_period_end);