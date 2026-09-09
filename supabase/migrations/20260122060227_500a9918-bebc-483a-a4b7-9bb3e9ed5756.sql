-- Create wdac_rule_sets table - named collections of rules
CREATE TABLE public.wdac_rule_sets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Create wdac_rule_set_rules table - rules within a rule set
CREATE TABLE public.wdac_rule_set_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rule_set_id UUID NOT NULL REFERENCES public.wdac_rule_sets(id) ON DELETE CASCADE,
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

-- Create junction table for endpoint rule set assignments
CREATE TABLE public.endpoint_rule_set_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  endpoint_id UUID NOT NULL REFERENCES public.endpoints(id) ON DELETE CASCADE,
  rule_set_id UUID NOT NULL REFERENCES public.wdac_rule_sets(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 0,
  assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  assigned_by UUID REFERENCES auth.users(id),
  UNIQUE(endpoint_id, rule_set_id)
);

-- Create junction table for group rule set assignments  
CREATE TABLE public.group_rule_set_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES public.endpoint_groups(id) ON DELETE CASCADE,
  rule_set_id UUID NOT NULL REFERENCES public.wdac_rule_sets(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 0,
  assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  assigned_by UUID REFERENCES auth.users(id),
  UNIQUE(group_id, rule_set_id)
);

-- Enable RLS on all tables
ALTER TABLE public.wdac_rule_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wdac_rule_set_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.endpoint_rule_set_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_rule_set_assignments ENABLE ROW LEVEL SECURITY;

-- RLS policies for wdac_rule_sets
CREATE POLICY "Users can view rule sets in their organizations"
  ON public.wdac_rule_sets FOR SELECT
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));

CREATE POLICY "Admins can create rule sets"
  ON public.wdac_rule_sets FOR INSERT
  WITH CHECK (public.is_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Admins can update rule sets"
  ON public.wdac_rule_sets FOR UPDATE
  USING (public.is_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Admins can delete rule sets"
  ON public.wdac_rule_sets FOR DELETE
  USING (public.is_admin_of_org(auth.uid(), organization_id));

-- RLS policies for wdac_rule_set_rules
CREATE POLICY "Users can view rules in their rule sets"
  ON public.wdac_rule_set_rules FOR SELECT
  USING (rule_set_id IN (
    SELECT id FROM public.wdac_rule_sets 
    WHERE organization_id IN (SELECT public.get_user_org_ids(auth.uid()))
  ));

CREATE POLICY "Admins can create rules"
  ON public.wdac_rule_set_rules FOR INSERT
  WITH CHECK (rule_set_id IN (
    SELECT id FROM public.wdac_rule_sets rs
    WHERE public.is_admin_of_org(auth.uid(), rs.organization_id)
  ));

CREATE POLICY "Admins can update rules"
  ON public.wdac_rule_set_rules FOR UPDATE
  USING (rule_set_id IN (
    SELECT id FROM public.wdac_rule_sets rs
    WHERE public.is_admin_of_org(auth.uid(), rs.organization_id)
  ));

CREATE POLICY "Admins can delete rules"
  ON public.wdac_rule_set_rules FOR DELETE
  USING (rule_set_id IN (
    SELECT id FROM public.wdac_rule_sets rs
    WHERE public.is_admin_of_org(auth.uid(), rs.organization_id)
  ));

-- RLS policies for endpoint_rule_set_assignments
CREATE POLICY "Users can view endpoint assignments"
  ON public.endpoint_rule_set_assignments FOR SELECT
  USING (endpoint_id IN (
    SELECT id FROM public.endpoints 
    WHERE organization_id IN (SELECT public.get_user_org_ids(auth.uid()))
  ));

CREATE POLICY "Admins can manage endpoint assignments"
  ON public.endpoint_rule_set_assignments FOR ALL
  USING (endpoint_id IN (
    SELECT id FROM public.endpoints e
    WHERE public.is_admin_of_org(auth.uid(), e.organization_id)
  ));

-- RLS policies for group_rule_set_assignments
CREATE POLICY "Users can view group assignments"
  ON public.group_rule_set_assignments FOR SELECT
  USING (group_id IN (
    SELECT id FROM public.endpoint_groups 
    WHERE organization_id IN (SELECT public.get_user_org_ids(auth.uid()))
  ));

CREATE POLICY "Admins can manage group assignments"
  ON public.group_rule_set_assignments FOR ALL
  USING (group_id IN (
    SELECT id FROM public.endpoint_groups g
    WHERE public.is_admin_of_org(auth.uid(), g.organization_id)
  ));

-- Indexes for performance
CREATE INDEX idx_wdac_rule_sets_org ON public.wdac_rule_sets(organization_id);
CREATE INDEX idx_wdac_rule_set_rules_set ON public.wdac_rule_set_rules(rule_set_id);
CREATE INDEX idx_endpoint_rule_set_assignments_endpoint ON public.endpoint_rule_set_assignments(endpoint_id);
CREATE INDEX idx_endpoint_rule_set_assignments_ruleset ON public.endpoint_rule_set_assignments(rule_set_id);
CREATE INDEX idx_group_rule_set_assignments_group ON public.group_rule_set_assignments(group_id);
CREATE INDEX idx_group_rule_set_assignments_ruleset ON public.group_rule_set_assignments(rule_set_id);

-- Trigger for updated_at
CREATE TRIGGER update_wdac_rule_sets_updated_at
  BEFORE UPDATE ON public.wdac_rule_sets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();