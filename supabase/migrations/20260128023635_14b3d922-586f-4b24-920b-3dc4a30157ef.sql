-- =============================================
-- IOC-Based Threat Hunting Tables
-- =============================================

-- Table: ioc_library - Store IOC definitions
CREATE TABLE public.ioc_library (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ioc_type TEXT NOT NULL CHECK (ioc_type IN ('file_hash', 'file_path', 'file_name', 'process_name')),
  value TEXT NOT NULL,
  hash_type TEXT CHECK (hash_type IN ('md5', 'sha1', 'sha256') OR hash_type IS NULL),
  threat_name TEXT,
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'virustotal', 'alienvault', 'misp', 'other')),
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.profiles(id)
);

-- Table: hunt_jobs - Track hunting operations
CREATE TABLE public.hunt_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  hunt_type TEXT NOT NULL CHECK (hunt_type IN ('ioc_sweep', 'quick_search', 'pattern_search')),
  parameters JSONB NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  total_endpoints INTEGER DEFAULT 0,
  matches_found INTEGER DEFAULT 0,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: hunt_matches - Individual match results
CREATE TABLE public.hunt_matches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  hunt_job_id UUID NOT NULL REFERENCES public.hunt_jobs(id) ON DELETE CASCADE,
  ioc_id UUID REFERENCES public.ioc_library(id) ON DELETE SET NULL,
  endpoint_id UUID NOT NULL REFERENCES public.endpoints(id) ON DELETE CASCADE,
  match_source TEXT NOT NULL CHECK (match_source IN ('discovered_apps', 'threats', 'event_logs')),
  matched_value TEXT NOT NULL,
  context JSONB DEFAULT '{}',
  reviewed BOOLEAN NOT NULL DEFAULT false,
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================
-- Indexes for Performance
-- =============================================

-- IOC Library indexes
CREATE INDEX idx_ioc_library_org ON public.ioc_library(organization_id);
CREATE INDEX idx_ioc_library_value ON public.ioc_library(LOWER(value));
CREATE INDEX idx_ioc_library_type ON public.ioc_library(ioc_type);
CREATE INDEX idx_ioc_library_active ON public.ioc_library(is_active) WHERE is_active = true;

-- Hunt Jobs indexes
CREATE INDEX idx_hunt_jobs_org ON public.hunt_jobs(organization_id);
CREATE INDEX idx_hunt_jobs_status ON public.hunt_jobs(status);
CREATE INDEX idx_hunt_jobs_created ON public.hunt_jobs(created_at DESC);

-- Hunt Matches indexes
CREATE INDEX idx_hunt_matches_job ON public.hunt_matches(hunt_job_id);
CREATE INDEX idx_hunt_matches_endpoint ON public.hunt_matches(endpoint_id);
CREATE INDEX idx_hunt_matches_reviewed ON public.hunt_matches(reviewed) WHERE reviewed = false;

-- =============================================
-- Row Level Security
-- =============================================

ALTER TABLE public.ioc_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hunt_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hunt_matches ENABLE ROW LEVEL SECURITY;

-- IOC Library Policies
CREATE POLICY "Users can view IOCs in their organization"
  ON public.ioc_library FOR SELECT
  USING (
    public.is_super_admin(auth.uid()) OR
    public.is_member_of_org(auth.uid(), organization_id) OR
    public.is_partner_admin_of_org(auth.uid(), organization_id)
  );

CREATE POLICY "Admins can create IOCs in their organization"
  ON public.ioc_library FOR INSERT
  WITH CHECK (
    public.is_super_admin(auth.uid()) OR
    public.is_admin_of_org(auth.uid(), organization_id) OR
    public.is_partner_admin_of_org(auth.uid(), organization_id)
  );

CREATE POLICY "Admins can update IOCs in their organization"
  ON public.ioc_library FOR UPDATE
  USING (
    public.is_super_admin(auth.uid()) OR
    public.is_admin_of_org(auth.uid(), organization_id) OR
    public.is_partner_admin_of_org(auth.uid(), organization_id)
  );

CREATE POLICY "Admins can delete IOCs in their organization"
  ON public.ioc_library FOR DELETE
  USING (
    public.is_super_admin(auth.uid()) OR
    public.is_admin_of_org(auth.uid(), organization_id) OR
    public.is_partner_admin_of_org(auth.uid(), organization_id)
  );

-- Hunt Jobs Policies
CREATE POLICY "Users can view hunt jobs in their organization"
  ON public.hunt_jobs FOR SELECT
  USING (
    public.is_super_admin(auth.uid()) OR
    public.is_member_of_org(auth.uid(), organization_id) OR
    public.is_partner_admin_of_org(auth.uid(), organization_id)
  );

CREATE POLICY "Admins can create hunt jobs in their organization"
  ON public.hunt_jobs FOR INSERT
  WITH CHECK (
    public.is_super_admin(auth.uid()) OR
    public.is_admin_of_org(auth.uid(), organization_id) OR
    public.is_partner_admin_of_org(auth.uid(), organization_id)
  );

CREATE POLICY "Admins can update hunt jobs in their organization"
  ON public.hunt_jobs FOR UPDATE
  USING (
    public.is_super_admin(auth.uid()) OR
    public.is_admin_of_org(auth.uid(), organization_id) OR
    public.is_partner_admin_of_org(auth.uid(), organization_id)
  );

CREATE POLICY "Admins can delete hunt jobs in their organization"
  ON public.hunt_jobs FOR DELETE
  USING (
    public.is_super_admin(auth.uid()) OR
    public.is_admin_of_org(auth.uid(), organization_id) OR
    public.is_partner_admin_of_org(auth.uid(), organization_id)
  );

-- Hunt Matches Policies (access via hunt_jobs organization)
CREATE POLICY "Users can view hunt matches for jobs in their organization"
  ON public.hunt_matches FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.hunt_jobs hj
      WHERE hj.id = hunt_job_id
      AND (
        public.is_super_admin(auth.uid()) OR
        public.is_member_of_org(auth.uid(), hj.organization_id) OR
        public.is_partner_admin_of_org(auth.uid(), hj.organization_id)
      )
    )
  );

CREATE POLICY "System can insert hunt matches"
  ON public.hunt_matches FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.hunt_jobs hj
      WHERE hj.id = hunt_job_id
      AND (
        public.is_super_admin(auth.uid()) OR
        public.is_admin_of_org(auth.uid(), hj.organization_id) OR
        public.is_partner_admin_of_org(auth.uid(), hj.organization_id)
      )
    )
  );

CREATE POLICY "Users can update hunt matches to mark as reviewed"
  ON public.hunt_matches FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.hunt_jobs hj
      WHERE hj.id = hunt_job_id
      AND (
        public.is_super_admin(auth.uid()) OR
        public.is_admin_of_org(auth.uid(), hj.organization_id) OR
        public.is_partner_admin_of_org(auth.uid(), hj.organization_id)
      )
    )
  );

CREATE POLICY "Admins can delete hunt matches"
  ON public.hunt_matches FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.hunt_jobs hj
      WHERE hj.id = hunt_job_id
      AND (
        public.is_super_admin(auth.uid()) OR
        public.is_admin_of_org(auth.uid(), hj.organization_id) OR
        public.is_partner_admin_of_org(auth.uid(), hj.organization_id)
      )
    )
  );