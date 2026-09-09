-- Create endpoint_groups table
CREATE TABLE public.endpoint_groups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  defender_policy_id UUID REFERENCES public.defender_policies(id) ON DELETE SET NULL,
  wdac_policy_id UUID REFERENCES public.wdac_policies(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create endpoint_group_memberships junction table
CREATE TABLE public.endpoint_group_memberships (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  endpoint_id UUID NOT NULL REFERENCES public.endpoints(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.endpoint_groups(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(endpoint_id, group_id)
);

-- Enable RLS
ALTER TABLE public.endpoint_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.endpoint_group_memberships ENABLE ROW LEVEL SECURITY;

-- RLS policies for endpoint_groups
CREATE POLICY "Users can view groups in their orgs"
  ON public.endpoint_groups FOR SELECT
  USING (is_member_of_org(auth.uid(), organization_id));

CREATE POLICY "Admins can create groups"
  ON public.endpoint_groups FOR INSERT
  WITH CHECK (is_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Admins can update groups"
  ON public.endpoint_groups FOR UPDATE
  USING (is_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Admins can delete groups"
  ON public.endpoint_groups FOR DELETE
  USING (is_admin_of_org(auth.uid(), organization_id));

CREATE POLICY "Super admins can manage all groups"
  ON public.endpoint_groups FOR ALL
  USING (is_super_admin(auth.uid()));

-- RLS policies for endpoint_group_memberships
CREATE POLICY "Users can view memberships for their org endpoints"
  ON public.endpoint_group_memberships FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.endpoint_groups g
    WHERE g.id = group_id AND is_member_of_org(auth.uid(), g.organization_id)
  ));

CREATE POLICY "Admins can manage memberships"
  ON public.endpoint_group_memberships FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.endpoint_groups g
    WHERE g.id = group_id AND is_admin_of_org(auth.uid(), g.organization_id)
  ));

CREATE POLICY "Super admins can manage all memberships"
  ON public.endpoint_group_memberships FOR ALL
  USING (is_super_admin(auth.uid()));

-- Add updated_at trigger
CREATE TRIGGER update_endpoint_groups_updated_at
  BEFORE UPDATE ON public.endpoint_groups
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes for performance
CREATE INDEX idx_endpoint_groups_org_id ON public.endpoint_groups(organization_id);
CREATE INDEX idx_endpoint_group_memberships_endpoint_id ON public.endpoint_group_memberships(endpoint_id);
CREATE INDEX idx_endpoint_group_memberships_group_id ON public.endpoint_group_memberships(group_id);