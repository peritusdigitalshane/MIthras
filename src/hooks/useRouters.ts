import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "sonner";

// Types
export interface Router {
  id: string;
  organization_id: string;
  hostname: string;
  vendor: string;
  model: string | null;
  firmware_version: string | null;
  serial_number: string | null;
  management_ip: string | null;
  wan_ip: string | null;
  lan_subnets: string[] | null;
  site_name: string | null;
  location: string | null;
  is_online: boolean;
  last_seen_at: string | null;
  config_profile: Record<string, any>;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface RouterDnsZone {
  id: string;
  organization_id: string;
  router_id: string;
  zone_name: string;
  zone_type: string;
  upstream_servers: string[] | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface RouterDnsRecord {
  id: string;
  zone_id: string;
  record_name: string;
  record_type: string;
  record_value: string;
  ttl: number;
  priority: number | null;
  enabled: boolean;
  created_at: string;
}

export interface RouterTunnel {
  id: string;
  organization_id: string;
  name: string;
  tunnel_type: string;
  router_a_id: string;
  router_b_id: string | null;
  router_a_endpoint: string | null;
  router_b_endpoint: string | null;
  router_a_subnet: string | null;
  router_b_subnet: string | null;
  psk_hint: string | null;
  encryption: string | null;
  status: string;
  config_data: Record<string, any>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface RouterFirewallRule {
  id: string;
  organization_id: string;
  router_id: string;
  name: string;
  direction: string;
  action: string;
  protocol: string | null;
  source_address: string | null;
  source_port: string | null;
  destination_address: string | null;
  destination_port: string | null;
  interface: string | null;
  order_priority: number;
  enabled: boolean;
  log_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export const VENDOR_OPTIONS = [
  { value: "cisco", label: "Cisco" },
  { value: "vyos", label: "VyOS" },
  { value: "ubiquiti-udm", label: "Ubiquiti Dream Machine" },
  { value: "ubiquiti-edgerouter", label: "Ubiquiti EdgeRouter" },
  { value: "ubiquiti-usg", label: "Ubiquiti USG" },
  { value: "ubiquiti-switch", label: "Ubiquiti Switch" },
  { value: "mikrotik", label: "MikroTik" },
  { value: "fortinet", label: "Fortinet" },
  { value: "pfsense", label: "pfSense" },
  { value: "other", label: "Other" },
];

// ==========================================
// ROUTERS
// ==========================================
export function useRouters() {
  const { currentOrganization } = useTenant();
  return useQuery({
    queryKey: ["routers", currentOrganization?.id],
    enabled: !!currentOrganization?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("routers")
        .select("*")
        .eq("organization_id", currentOrganization!.id)
        .order("hostname");
      if (error) throw error;
      return data as Router[];
    },
  });
}

export function useCreateRouter() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useTenant();
  return useMutation({
    mutationFn: async (router: Partial<Router>) => {
      const { data, error } = await supabase
        .from("routers")
        .insert({ ...router, organization_id: currentOrganization!.id } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["routers"] });
      toast.success("Router added");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useUpdateRouter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Router> & { id: string }) => {
      const { data, error } = await supabase
        .from("routers")
        .update(updates as any)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["routers"] });
      toast.success("Router updated");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteRouter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("routers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["routers"] });
      // CASCADE deletes drop tunnels + firewall rules at the DB but the
      // junction caches stay populated until invalidated.
      queryClient.invalidateQueries({ queryKey: ["router-tunnels"] });
      queryClient.invalidateQueries({ queryKey: ["router-fw-rules"] });
      queryClient.invalidateQueries({ queryKey: ["dns-zones"] });
      toast.success("Router deleted");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// ==========================================
// DNS ZONES
// ==========================================
export function useDnsZones(routerId?: string) {
  const { currentOrganization } = useTenant();
  return useQuery({
    queryKey: ["dns-zones", currentOrganization?.id, routerId],
    enabled: !!currentOrganization?.id,
    queryFn: async () => {
      let query = supabase
        .from("router_dns_zones")
        .select("*")
        .eq("organization_id", currentOrganization!.id)
        .order("zone_name");
      if (routerId) query = query.eq("router_id", routerId);
      const { data, error } = await query;
      if (error) throw error;
      return data as RouterDnsZone[];
    },
  });
}

export function useCreateDnsZone() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useTenant();
  return useMutation({
    mutationFn: async (zone: Partial<RouterDnsZone>) => {
      const { data, error } = await supabase
        .from("router_dns_zones")
        .insert({ ...zone, organization_id: currentOrganization!.id } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dns-zones"] });
      toast.success("DNS zone created");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteDnsZone() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("router_dns_zones").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dns-zones"] });
      toast.success("DNS zone deleted");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// ==========================================
// DNS RECORDS
// ==========================================
export function useDnsRecords(zoneId?: string) {
  return useQuery({
    queryKey: ["dns-records", zoneId],
    enabled: !!zoneId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("router_dns_records")
        .select("*")
        .eq("zone_id", zoneId!)
        .order("record_name");
      if (error) throw error;
      return data as RouterDnsRecord[];
    },
  });
}

export function useCreateDnsRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (record: Partial<RouterDnsRecord>) => {
      const { data, error } = await supabase
        .from("router_dns_records")
        .insert(record as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dns-records"] });
      toast.success("DNS record added");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteDnsRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("router_dns_records").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dns-records"] });
      toast.success("DNS record deleted");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// ==========================================
// TUNNELS
// ==========================================
export function useTunnels() {
  const { currentOrganization } = useTenant();
  return useQuery({
    queryKey: ["router-tunnels", currentOrganization?.id],
    enabled: !!currentOrganization?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("router_tunnels")
        .select("*")
        .eq("organization_id", currentOrganization!.id)
        .order("name");
      if (error) throw error;
      return data as RouterTunnel[];
    },
  });
}

export function useCreateTunnel() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useTenant();
  return useMutation({
    mutationFn: async (tunnel: Partial<RouterTunnel>) => {
      const { data, error } = await supabase
        .from("router_tunnels")
        .insert({ ...tunnel, organization_id: currentOrganization!.id } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["router-tunnels"] });
      toast.success("Tunnel created");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteTunnel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("router_tunnels").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["router-tunnels"] });
      toast.success("Tunnel deleted");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// ==========================================
// FIREWALL RULES
// ==========================================
export function useRouterFirewallRules(routerId?: string) {
  const { currentOrganization } = useTenant();
  return useQuery({
    queryKey: ["router-fw-rules", currentOrganization?.id, routerId],
    enabled: !!currentOrganization?.id,
    queryFn: async () => {
      let query = supabase
        .from("router_firewall_rules")
        .select("*")
        .eq("organization_id", currentOrganization!.id)
        .order("order_priority");
      if (routerId) query = query.eq("router_id", routerId);
      const { data, error } = await query;
      if (error) throw error;
      return data as RouterFirewallRule[];
    },
  });
}

export function useCreateRouterFirewallRule() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useTenant();
  return useMutation({
    mutationFn: async (rule: Partial<RouterFirewallRule>) => {
      const { data, error } = await supabase
        .from("router_firewall_rules")
        .insert({ ...rule, organization_id: currentOrganization!.id } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["router-fw-rules"] });
      toast.success("Firewall rule added");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteRouterFirewallRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("router_firewall_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["router-fw-rules"] });
      toast.success("Firewall rule deleted");
    },
    onError: (e: any) => toast.error(e.message),
  });
}
