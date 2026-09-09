-- WDAC Policies table (per organization)
CREATE TABLE public.wdac_policies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  mode TEXT NOT NULL DEFAULT 'audit' CHECK (mode IN ('audit', 'enforced')),
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Discovered applications from endpoints
CREATE TABLE public.wdac_discovered_apps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  endpoint_id UUID NOT NULL REFERENCES public.endpoints(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_hash TEXT,
  publisher TEXT,
  product_name TEXT,
  file_version TEXT,
  discovery_source TEXT NOT NULL CHECK (discovery_source IN ('agent_inventory', 'event_log', 'both')),
  first_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  execution_count INTEGER NOT NULL DEFAULT 1,
  raw_data JSONB,
  UNIQUE(endpoint_id, file_path, file_hash)
);

-- WDAC rules (allow/block decisions)
CREATE TABLE public.wdac_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  policy_id UUID NOT NULL REFERENCES public.wdac_policies(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('publisher', 'path', 'hash', 'file_name')),
  action TEXT NOT NULL CHECK (action IN ('allow', 'block')),
  value TEXT NOT NULL,
  publisher_name TEXT,
  product_name TEXT,
  file_version_min TEXT,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Policy baselines (snapshots of allowed apps)
CREATE TABLE public.wdac_baselines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  policy_id UUID NOT NULL REFERENCES public.wdac_policies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  snapshot_data JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Endpoint to WDAC policy assignment
ALTER TABLE public.endpoints ADD COLUMN IF NOT EXISTS wdac_policy_id UUID REFERENCES public.wdac_policies(id);

-- Enable RLS
ALTER TABLE public.wdac_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wdac_discovered_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wdac_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wdac_baselines ENABLE ROW LEVEL SECURITY;

-- WDAC Policies RLS
CREATE POLICY "Users can view WDAC policies in their orgs"
  ON public.wdac_policies FOR SELECT
  USING (is_member_of_org(auth.uid(), organization_id));

CREATE POLICY "Admins can create WDAC policies"
  ON public.wdac_policies FOR INSERT
  WITH CHECK (is_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Admins can update WDAC policies"
  ON public.wdac_policies FOR UPDATE
  USING (is_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Admins can delete WDAC policies"
  ON public.wdac_policies FOR DELETE
  USING (is_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Super admins can manage all WDAC policies"
  ON public.wdac_policies FOR ALL
  USING (is_super_admin(auth.uid()));

-- Discovered Apps RLS
CREATE POLICY "Users can view discovered apps in their orgs"
  ON public.wdac_discovered_apps FOR SELECT
  USING (is_member_of_org(auth.uid(), organization_id));

CREATE POLICY "Super admins can view all discovered apps"
  ON public.wdac_discovered_apps FOR SELECT
  USING (is_super_admin(auth.uid()));

-- WDAC Rules RLS
CREATE POLICY "Users can view rules for policies in their orgs"
  ON public.wdac_rules FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.wdac_policies p 
    WHERE p.id = wdac_rules.policy_id 
    AND is_member_of_org(auth.uid(), p.organization_id)
  ));

CREATE POLICY "Admins can manage rules"
  ON public.wdac_rules FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.wdac_policies p 
    WHERE p.id = wdac_rules.policy_id 
    AND is_admin_of_org(auth.uid(), p.organization_id)
  ));

CREATE POLICY "Super admins can manage all rules"
  ON public.wdac_rules FOR ALL
  USING (is_super_admin(auth.uid()));

-- Baselines RLS
CREATE POLICY "Users can view baselines for policies in their orgs"
  ON public.wdac_baselines FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.wdac_policies p 
    WHERE p.id = wdac_baselines.policy_id 
    AND is_member_of_org(auth.uid(), p.organization_id)
  ));

CREATE POLICY "Admins can manage baselines"
  ON public.wdac_baselines FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.wdac_policies p 
    WHERE p.id = wdac_baselines.policy_id 
    AND is_admin_of_org(auth.uid(), p.organization_id)
  ));

CREATE POLICY "Super admins can manage all baselines"
  ON public.wdac_baselines FOR ALL
  USING (is_super_admin(auth.uid()));

-- Indexes for performance
CREATE INDEX idx_wdac_discovered_apps_org ON public.wdac_discovered_apps(organization_id);
CREATE INDEX idx_wdac_discovered_apps_endpoint ON public.wdac_discovered_apps(endpoint_id);
CREATE INDEX idx_wdac_rules_policy ON public.wdac_rules(policy_id);
CREATE INDEX idx_wdac_baselines_policy ON public.wdac_baselines(policy_id);

-- Update trigger for wdac_policies
CREATE TRIGGER update_wdac_policies_updated_at
  BEFORE UPDATE ON public.wdac_policies
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();