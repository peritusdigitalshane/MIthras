-- Create firewall_policies table
CREATE TABLE public.firewall_policies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create firewall_service_rules table
CREATE TABLE public.firewall_service_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  policy_id UUID NOT NULL REFERENCES public.firewall_policies(id) ON DELETE CASCADE,
  endpoint_group_id UUID NOT NULL REFERENCES public.endpoint_groups(id) ON DELETE CASCADE,
  service_name TEXT NOT NULL,
  port TEXT NOT NULL,
  protocol TEXT NOT NULL DEFAULT 'tcp',
  action TEXT NOT NULL DEFAULT 'block',
  allowed_source_groups UUID[] DEFAULT '{}',
  allowed_source_ips TEXT[] DEFAULT '{}',
  mode TEXT NOT NULL DEFAULT 'audit',
  enabled BOOLEAN NOT NULL DEFAULT true,
  order_priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT valid_action CHECK (action IN ('block', 'allow', 'allow_from_groups')),
  CONSTRAINT valid_mode CHECK (mode IN ('audit', 'enforce')),
  CONSTRAINT valid_protocol CHECK (protocol IN ('tcp', 'udp', 'both'))
);

-- Create firewall_audit_logs table
CREATE TABLE public.firewall_audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  endpoint_id UUID NOT NULL REFERENCES public.endpoints(id) ON DELETE CASCADE,
  rule_id UUID REFERENCES public.firewall_service_rules(id) ON DELETE SET NULL,
  service_name TEXT NOT NULL,
  local_port INTEGER NOT NULL,
  remote_address TEXT NOT NULL,
  remote_port INTEGER,
  protocol TEXT NOT NULL DEFAULT 'tcp',
  direction TEXT NOT NULL DEFAULT 'inbound',
  event_time TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT valid_direction CHECK (direction IN ('inbound', 'outbound'))
);

-- Create firewall_templates table (global, not org-specific)
CREATE TABLE public.firewall_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'security',
  rules_json JSONB NOT NULL DEFAULT '[]',
  default_mode TEXT NOT NULL DEFAULT 'audit',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT valid_template_mode CHECK (default_mode IN ('audit', 'enforce')),
  CONSTRAINT valid_category CHECK (category IN ('lateral-movement', 'lockdown', 'compliance', 'security'))
);

-- Enable RLS on all tables
ALTER TABLE public.firewall_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firewall_service_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firewall_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firewall_templates ENABLE ROW LEVEL SECURITY;

-- RLS policies for firewall_policies
CREATE POLICY "Users can view firewall policies in their organization"
  ON public.firewall_policies FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_memberships om
      WHERE om.organization_id = firewall_policies.organization_id
      AND om.user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = auth.uid())
  );

CREATE POLICY "Admins can create firewall policies"
  ON public.firewall_policies FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_memberships om
      WHERE om.organization_id = firewall_policies.organization_id
      AND om.user_id = auth.uid()
      AND om.role IN ('owner', 'admin')
    )
    OR EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = auth.uid())
  );

CREATE POLICY "Admins can update firewall policies"
  ON public.firewall_policies FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_memberships om
      WHERE om.organization_id = firewall_policies.organization_id
      AND om.user_id = auth.uid()
      AND om.role IN ('owner', 'admin')
    )
    OR EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = auth.uid())
  );

CREATE POLICY "Admins can delete firewall policies"
  ON public.firewall_policies FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_memberships om
      WHERE om.organization_id = firewall_policies.organization_id
      AND om.user_id = auth.uid()
      AND om.role IN ('owner', 'admin')
    )
    OR EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = auth.uid())
  );

-- RLS policies for firewall_service_rules (through policy ownership)
CREATE POLICY "Users can view firewall rules in their organization"
  ON public.firewall_service_rules FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.firewall_policies fp
      JOIN public.organization_memberships om ON om.organization_id = fp.organization_id
      WHERE fp.id = firewall_service_rules.policy_id
      AND om.user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = auth.uid())
  );

CREATE POLICY "Admins can manage firewall rules"
  ON public.firewall_service_rules FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.firewall_policies fp
      JOIN public.organization_memberships om ON om.organization_id = fp.organization_id
      WHERE fp.id = firewall_service_rules.policy_id
      AND om.user_id = auth.uid()
      AND om.role IN ('owner', 'admin')
    )
    OR EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = auth.uid())
  );

-- RLS policies for firewall_audit_logs
CREATE POLICY "Users can view firewall audit logs in their organization"
  ON public.firewall_audit_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_memberships om
      WHERE om.organization_id = firewall_audit_logs.organization_id
      AND om.user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = auth.uid())
  );

CREATE POLICY "System can insert firewall audit logs"
  ON public.firewall_audit_logs FOR INSERT
  WITH CHECK (true);

-- RLS policies for firewall_templates (read-only for all authenticated users)
CREATE POLICY "Authenticated users can view firewall templates"
  ON public.firewall_templates FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Super admins can manage firewall templates"
  ON public.firewall_templates FOR ALL
  USING (EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = auth.uid()));

-- Create indexes for performance
CREATE INDEX idx_firewall_policies_org ON public.firewall_policies(organization_id);
CREATE INDEX idx_firewall_service_rules_policy ON public.firewall_service_rules(policy_id);
CREATE INDEX idx_firewall_service_rules_group ON public.firewall_service_rules(endpoint_group_id);
CREATE INDEX idx_firewall_audit_logs_org ON public.firewall_audit_logs(organization_id);
CREATE INDEX idx_firewall_audit_logs_endpoint ON public.firewall_audit_logs(endpoint_id);
CREATE INDEX idx_firewall_audit_logs_time ON public.firewall_audit_logs(event_time DESC);

-- Create trigger for updated_at on firewall_policies
CREATE TRIGGER update_firewall_policies_updated_at
  BEFORE UPDATE ON public.firewall_policies
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Seed default templates
INSERT INTO public.firewall_templates (name, description, category, rules_json, default_mode) VALUES
(
  'Block Lateral Movement',
  'Block SMB and RDP between workstations to prevent lateral movement attacks',
  'lateral-movement',
  '[
    {"service_name": "SMB", "port": "445,139", "protocol": "tcp", "action": "block"},
    {"service_name": "RDP", "port": "3389", "protocol": "tcp", "action": "block"}
  ]'::jsonb,
  'audit'
),
(
  'Admin Access Only',
  'Only allow RDP and WinRM connections from designated Admin PCs group',
  'lockdown',
  '[
    {"service_name": "RDP", "port": "3389", "protocol": "tcp", "action": "allow_from_groups"},
    {"service_name": "WinRM", "port": "5985,5986", "protocol": "tcp", "action": "allow_from_groups"}
  ]'::jsonb,
  'audit'
),
(
  'Isolate Endpoint',
  'Block all inbound connections except from management networks',
  'lockdown',
  '[
    {"service_name": "All Inbound", "port": "1-65535", "protocol": "both", "action": "block"}
  ]'::jsonb,
  'enforce'
),
(
  'Server Lockdown',
  'Servers only accept connections from Admin PCs for management',
  'lockdown',
  '[
    {"service_name": "RDP", "port": "3389", "protocol": "tcp", "action": "allow_from_groups"},
    {"service_name": "WinRM", "port": "5985,5986", "protocol": "tcp", "action": "allow_from_groups"},
    {"service_name": "SMB", "port": "445", "protocol": "tcp", "action": "allow_from_groups"},
    {"service_name": "SSH", "port": "22", "protocol": "tcp", "action": "allow_from_groups"}
  ]'::jsonb,
  'audit'
),
(
  'PCI Compliance Baseline',
  'Restrict access per PCI-DSS requirements for cardholder data environments',
  'compliance',
  '[
    {"service_name": "RDP", "port": "3389", "protocol": "tcp", "action": "block"},
    {"service_name": "Telnet", "port": "23", "protocol": "tcp", "action": "block"},
    {"service_name": "FTP", "port": "21", "protocol": "tcp", "action": "block"},
    {"service_name": "SMB", "port": "445,139", "protocol": "tcp", "action": "block"}
  ]'::jsonb,
  'audit'
);