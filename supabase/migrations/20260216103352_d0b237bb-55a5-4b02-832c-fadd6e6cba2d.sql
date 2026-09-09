
-- Add router module flag to organizations
ALTER TABLE public.organizations ADD COLUMN router_module_enabled BOOLEAN NOT NULL DEFAULT false;

-- ==========================================
-- ROUTERS TABLE
-- ==========================================
CREATE TABLE public.routers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL,
  vendor TEXT NOT NULL, -- 'cisco', 'vyos', 'edge', 'mikrotik', 'fortinet', 'pfsense', 'other'
  model TEXT,
  firmware_version TEXT,
  serial_number TEXT,
  management_ip TEXT,
  wan_ip TEXT,
  lan_subnets TEXT[],
  site_name TEXT,
  location TEXT,
  is_online BOOLEAN NOT NULL DEFAULT false,
  last_seen_at TIMESTAMPTZ,
  config_profile JSONB DEFAULT '{}'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.routers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view routers in their org" ON public.routers FOR SELECT
  USING (
    public.is_super_admin(auth.uid())
    OR public.is_member_of_org(auth.uid(), organization_id)
    OR public.is_partner_admin_of_org(auth.uid(), organization_id)
  );

CREATE POLICY "Admins can manage routers" ON public.routers FOR INSERT
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR public.is_admin_of_org(auth.uid(), organization_id)
    OR public.is_partner_admin_of_org(auth.uid(), organization_id)
  );

CREATE POLICY "Admins can update routers" ON public.routers FOR UPDATE
  USING (
    public.is_super_admin(auth.uid())
    OR public.is_admin_of_org(auth.uid(), organization_id)
    OR public.is_partner_admin_of_org(auth.uid(), organization_id)
  );

CREATE POLICY "Admins can delete routers" ON public.routers FOR DELETE
  USING (
    public.is_super_admin(auth.uid())
    OR public.is_admin_of_org(auth.uid(), organization_id)
    OR public.is_partner_admin_of_org(auth.uid(), organization_id)
  );

CREATE TRIGGER update_routers_updated_at BEFORE UPDATE ON public.routers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ==========================================
-- ROUTER DNS ZONES
-- ==========================================
CREATE TABLE public.router_dns_zones (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  router_id UUID NOT NULL REFERENCES public.routers(id) ON DELETE CASCADE,
  zone_name TEXT NOT NULL,
  zone_type TEXT NOT NULL DEFAULT 'forward', -- 'forward', 'reverse', 'stub'
  upstream_servers TEXT[],
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.router_dns_zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view dns zones" ON public.router_dns_zones FOR SELECT
  USING (
    public.is_super_admin(auth.uid())
    OR public.is_member_of_org(auth.uid(), organization_id)
    OR public.is_partner_admin_of_org(auth.uid(), organization_id)
  );

CREATE POLICY "Admins can insert dns zones" ON public.router_dns_zones FOR INSERT
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR public.is_admin_of_org(auth.uid(), organization_id)
    OR public.is_partner_admin_of_org(auth.uid(), organization_id)
  );

CREATE POLICY "Admins can update dns zones" ON public.router_dns_zones FOR UPDATE
  USING (
    public.is_super_admin(auth.uid())
    OR public.is_admin_of_org(auth.uid(), organization_id)
    OR public.is_partner_admin_of_org(auth.uid(), organization_id)
  );

CREATE POLICY "Admins can delete dns zones" ON public.router_dns_zones FOR DELETE
  USING (
    public.is_super_admin(auth.uid())
    OR public.is_admin_of_org(auth.uid(), organization_id)
    OR public.is_partner_admin_of_org(auth.uid(), organization_id)
  );

CREATE TRIGGER update_dns_zones_updated_at BEFORE UPDATE ON public.router_dns_zones
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ==========================================
-- ROUTER DNS RECORDS
-- ==========================================
CREATE TABLE public.router_dns_records (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  zone_id UUID NOT NULL REFERENCES public.router_dns_zones(id) ON DELETE CASCADE,
  record_name TEXT NOT NULL,
  record_type TEXT NOT NULL DEFAULT 'A', -- 'A', 'AAAA', 'CNAME', 'MX', 'TXT', 'PTR', 'SRV'
  record_value TEXT NOT NULL,
  ttl INTEGER NOT NULL DEFAULT 3600,
  priority INTEGER,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.router_dns_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view dns records" ON public.router_dns_records FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.router_dns_zones z
      WHERE z.id = zone_id
      AND (
        public.is_super_admin(auth.uid())
        OR public.is_member_of_org(auth.uid(), z.organization_id)
        OR public.is_partner_admin_of_org(auth.uid(), z.organization_id)
      )
    )
  );

CREATE POLICY "Admins can insert dns records" ON public.router_dns_records FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.router_dns_zones z
      WHERE z.id = zone_id
      AND (
        public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), z.organization_id)
        OR public.is_partner_admin_of_org(auth.uid(), z.organization_id)
      )
    )
  );

CREATE POLICY "Admins can update dns records" ON public.router_dns_records FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.router_dns_zones z
      WHERE z.id = zone_id
      AND (
        public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), z.organization_id)
        OR public.is_partner_admin_of_org(auth.uid(), z.organization_id)
      )
    )
  );

CREATE POLICY "Admins can delete dns records" ON public.router_dns_records FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.router_dns_zones z
      WHERE z.id = zone_id
      AND (
        public.is_super_admin(auth.uid())
        OR public.is_admin_of_org(auth.uid(), z.organization_id)
        OR public.is_partner_admin_of_org(auth.uid(), z.organization_id)
      )
    )
  );

-- ==========================================
-- ROUTER TUNNELS
-- ==========================================
CREATE TABLE public.router_tunnels (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  tunnel_type TEXT NOT NULL DEFAULT 'ipsec', -- 'ipsec', 'wireguard', 'gre', 'vxlan', 'openvpn'
  router_a_id UUID NOT NULL REFERENCES public.routers(id) ON DELETE CASCADE,
  router_b_id UUID REFERENCES public.routers(id) ON DELETE SET NULL, -- NULL for external peer
  router_a_endpoint TEXT,
  router_b_endpoint TEXT,
  router_a_subnet TEXT,
  router_b_subnet TEXT,
  psk_hint TEXT, -- NOT the actual PSK, just a reference/hint
  encryption TEXT DEFAULT 'aes-256-gcm',
  status TEXT NOT NULL DEFAULT 'configured', -- 'configured', 'up', 'down', 'error'
  config_data JSONB DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.router_tunnels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view tunnels" ON public.router_tunnels FOR SELECT
  USING (
    public.is_super_admin(auth.uid())
    OR public.is_member_of_org(auth.uid(), organization_id)
    OR public.is_partner_admin_of_org(auth.uid(), organization_id)
  );

CREATE POLICY "Admins can insert tunnels" ON public.router_tunnels FOR INSERT
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR public.is_admin_of_org(auth.uid(), organization_id)
    OR public.is_partner_admin_of_org(auth.uid(), organization_id)
  );

CREATE POLICY "Admins can update tunnels" ON public.router_tunnels FOR UPDATE
  USING (
    public.is_super_admin(auth.uid())
    OR public.is_admin_of_org(auth.uid(), organization_id)
    OR public.is_partner_admin_of_org(auth.uid(), organization_id)
  );

CREATE POLICY "Admins can delete tunnels" ON public.router_tunnels FOR DELETE
  USING (
    public.is_super_admin(auth.uid())
    OR public.is_admin_of_org(auth.uid(), organization_id)
    OR public.is_partner_admin_of_org(auth.uid(), organization_id)
  );

CREATE TRIGGER update_tunnels_updated_at BEFORE UPDATE ON public.router_tunnels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ==========================================
-- ROUTER FIREWALL RULES
-- ==========================================
CREATE TABLE public.router_firewall_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  router_id UUID NOT NULL REFERENCES public.routers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'inbound', -- 'inbound', 'outbound', 'forward'
  action TEXT NOT NULL DEFAULT 'deny', -- 'allow', 'deny', 'reject', 'log'
  protocol TEXT DEFAULT 'any', -- 'tcp', 'udp', 'icmp', 'any'
  source_address TEXT DEFAULT 'any',
  source_port TEXT,
  destination_address TEXT DEFAULT 'any',
  destination_port TEXT,
  interface TEXT, -- 'wan', 'lan', 'dmz', etc.
  order_priority INTEGER NOT NULL DEFAULT 100,
  enabled BOOLEAN NOT NULL DEFAULT true,
  log_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.router_firewall_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view router fw rules" ON public.router_firewall_rules FOR SELECT
  USING (
    public.is_super_admin(auth.uid())
    OR public.is_member_of_org(auth.uid(), organization_id)
    OR public.is_partner_admin_of_org(auth.uid(), organization_id)
  );

CREATE POLICY "Admins can insert router fw rules" ON public.router_firewall_rules FOR INSERT
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR public.is_admin_of_org(auth.uid(), organization_id)
    OR public.is_partner_admin_of_org(auth.uid(), organization_id)
  );

CREATE POLICY "Admins can update router fw rules" ON public.router_firewall_rules FOR UPDATE
  USING (
    public.is_super_admin(auth.uid())
    OR public.is_admin_of_org(auth.uid(), organization_id)
    OR public.is_partner_admin_of_org(auth.uid(), organization_id)
  );

CREATE POLICY "Admins can delete router fw rules" ON public.router_firewall_rules FOR DELETE
  USING (
    public.is_super_admin(auth.uid())
    OR public.is_admin_of_org(auth.uid(), organization_id)
    OR public.is_partner_admin_of_org(auth.uid(), organization_id)
  );

CREATE TRIGGER update_router_fw_rules_updated_at BEFORE UPDATE ON public.router_firewall_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Index for performance
CREATE INDEX idx_routers_org ON public.routers(organization_id);
CREATE INDEX idx_dns_zones_router ON public.router_dns_zones(router_id);
CREATE INDEX idx_dns_records_zone ON public.router_dns_records(zone_id);
CREATE INDEX idx_tunnels_org ON public.router_tunnels(organization_id);
CREATE INDEX idx_tunnels_router_a ON public.router_tunnels(router_a_id);
CREATE INDEX idx_tunnels_router_b ON public.router_tunnels(router_b_id);
CREATE INDEX idx_router_fw_router ON public.router_firewall_rules(router_id);
