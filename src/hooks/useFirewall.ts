import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";

// Types
export interface FirewallPolicy {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FirewallServiceRule {
  id: string;
  policy_id: string;
  endpoint_group_id: string;
  service_name: string;
  port: string;
  protocol: "tcp" | "udp" | "both";
  action: "block" | "allow" | "allow_from_groups";
  allowed_source_groups: string[];
  allowed_source_ips: string[];
  mode: "audit" | "enforce";
  enabled: boolean;
  order_priority: number;
  created_at: string;
}

export interface FirewallAuditLog {
  id: string;
  organization_id: string;
  endpoint_id: string;
  rule_id: string | null;
  service_name: string;
  local_port: number;
  remote_address: string;
  remote_port: number | null;
  protocol: string;
  direction: "inbound" | "outbound";
  event_time: string;
  created_at: string;
  endpoint?: {
    hostname: string;
  };
}

export interface FirewallTemplate {
  id: string;
  name: string;
  description: string | null;
  category: "lateral-movement" | "lockdown" | "compliance" | "security";
  rules_json: TemplateRule[];
  default_mode: "audit" | "enforce";
  created_at: string;
}

export interface TemplateRule {
  service_name: string;
  port: string;
  protocol: string;
  action: string;
}

// Common services definition
export const COMMON_SERVICES = [
  { name: "RDP", port: "3389", protocol: "tcp" as const, description: "Remote Desktop Protocol" },
  { name: "SMB", port: "445,139", protocol: "tcp" as const, description: "File Sharing" },
  { name: "WinRM", port: "5985,5986", protocol: "tcp" as const, description: "Windows Remote Management" },
  { name: "SSH", port: "22", protocol: "tcp" as const, description: "Secure Shell" },
  { name: "HTTP/S", port: "80,443", protocol: "tcp" as const, description: "Web Traffic" },
] as const;

// Hooks
export function useFirewallPolicies() {
  const { currentOrganization } = useTenant();

  return useQuery({
    queryKey: ["firewall-policies", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization?.id) return [];
      
      const { data, error } = await supabase
        .from("firewall_policies")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as FirewallPolicy[];
    },
    enabled: !!currentOrganization?.id,
  });
}

export function useFirewallServiceRules(policyId?: string) {
  const { currentOrganization } = useTenant();

  return useQuery({
    queryKey: ["firewall-service-rules", currentOrganization?.id, policyId],
    queryFn: async () => {
      if (!currentOrganization?.id) return [];
      
      let query = supabase
        .from("firewall_service_rules")
        .select(`
          *,
          firewall_policies!inner(organization_id)
        `)
        .eq("firewall_policies.organization_id", currentOrganization.id);

      if (policyId) {
        query = query.eq("policy_id", policyId);
      }

      const { data, error } = await query.order("order_priority", { ascending: true });

      if (error) throw error;
      return data as FirewallServiceRule[];
    },
    enabled: !!currentOrganization?.id,
  });
}

export function useFirewallAuditLogs(filters?: {
  endpointId?: string;
  serviceName?: string;
  limit?: number;
}) {
  const { currentOrganization } = useTenant();

  return useQuery({
    queryKey: ["firewall-audit-logs", currentOrganization?.id, filters],
    queryFn: async () => {
      if (!currentOrganization?.id) return [];
      
      let query = supabase
        .from("firewall_audit_logs")
        .select(`
          *,
          endpoint:endpoints(hostname)
        `)
        .eq("organization_id", currentOrganization.id)
        .order("event_time", { ascending: false });

      if (filters?.endpointId) {
        query = query.eq("endpoint_id", filters.endpointId);
      }
      if (filters?.serviceName) {
        query = query.eq("service_name", filters.serviceName);
      }
      if (filters?.limit) {
        query = query.limit(filters.limit);
      } else {
        query = query.limit(100);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as FirewallAuditLog[];
    },
    enabled: !!currentOrganization?.id,
  });
}

export function useFirewallTemplates() {
  return useQuery({
    queryKey: ["firewall-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("firewall_templates")
        .select("*")
        .order("category", { ascending: true });

      if (error) throw error;
      
      // Transform the data to properly type rules_json
      return (data || []).map((template) => ({
        ...template,
        category: template.category as FirewallTemplate["category"],
        default_mode: template.default_mode as FirewallTemplate["default_mode"],
        rules_json: (template.rules_json as unknown as TemplateRule[]) || [],
      })) as FirewallTemplate[];
    },
  });
}

// Mutations
export function useCreateFirewallPolicy() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useTenant();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (policy: { name: string; description?: string }) => {
      if (!currentOrganization?.id) throw new Error("No organization selected");

      // Check if any policies exist — first one should be default
      const { count } = await supabase
        .from("firewall_policies")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", currentOrganization.id);

      const { data, error } = await supabase
        .from("firewall_policies")
        .insert({
          organization_id: currentOrganization.id,
          name: policy.name,
          description: policy.description || null,
          is_default: (count ?? 0) === 0,
        })
        .select()
        .single();

      if (error) throw error;
      return data as FirewallPolicy;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["firewall-policies"] });
      toast({ title: "Policy created successfully" });
    },
    onError: (error) => {
      toast({ title: "Failed to create policy", description: error.message, variant: "destructive" });
    },
  });
}

export function useCreateServiceRule() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (rule: Omit<FirewallServiceRule, "id" | "created_at">) => {
      const { data, error } = await supabase
        .from("firewall_service_rules")
        .insert(rule)
        .select()
        .single();

      if (error) throw error;
      return data as FirewallServiceRule;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["firewall-service-rules"] });
      toast({ title: "Rule created successfully" });
    },
    onError: (error) => {
      toast({ title: "Failed to create rule", description: error.message, variant: "destructive" });
    },
  });
}

export function useUpdateServiceRule() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<FirewallServiceRule> & { id: string }) => {
      const { data, error } = await supabase
        .from("firewall_service_rules")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as FirewallServiceRule;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["firewall-service-rules"] });
      toast({ title: "Rule updated successfully" });
    },
    onError: (error) => {
      toast({ title: "Failed to update rule", description: error.message, variant: "destructive" });
    },
  });
}

export function useDeleteServiceRule() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("firewall_service_rules")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["firewall-service-rules"] });
      toast({ title: "Rule deleted successfully" });
    },
    onError: (error) => {
      toast({ title: "Failed to delete rule", description: error.message, variant: "destructive" });
    },
  });
}

export function useToggleRuleMode() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, mode }: { id: string; mode: "audit" | "enforce" }) => {
      const { data, error } = await supabase
        .from("firewall_service_rules")
        .update({ mode })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as FirewallServiceRule;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["firewall-service-rules"] });
      toast({ 
        title: `Rule switched to ${data.mode === "enforce" ? "Enforce" : "Audit"} mode`,
        description: data.mode === "enforce" 
          ? "Traffic will now be blocked" 
          : "Traffic will be logged but not blocked"
      });
    },
    onError: (error) => {
      toast({ title: "Failed to update rule mode", description: error.message, variant: "destructive" });
    },
  });
}

// Audit Sessions
export interface FirewallAuditSession {
  id: string;
  organization_id: string;
  policy_id: string;
  status: "auditing" | "completed" | "template_generated";
  started_at: string;
  ends_at: string;
  started_by: string | null;
  generated_template_id: string | null;
  created_at: string;
  updated_at: string;
}

export function useFirewallAuditSessions() {
  const { currentOrganization } = useTenant();

  return useQuery({
    queryKey: ["firewall-audit-sessions", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization?.id) return [];

      const { data, error } = await supabase
        .from("firewall_audit_sessions")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as FirewallAuditSession[];
    },
    enabled: !!currentOrganization?.id,
  });
}

export function useStartFirewallAudit() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useTenant();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (policyId: string) => {
      if (!currentOrganization?.id) throw new Error("No organization selected");

      const now = new Date();
      const endsAt = new Date(now);
      endsAt.setDate(endsAt.getDate() + 30);

      const { data, error } = await supabase
        .from("firewall_audit_sessions")
        .insert({
          organization_id: currentOrganization.id,
          policy_id: policyId,
          started_at: now.toISOString(),
          ends_at: endsAt.toISOString(),
        })
        .select()
        .single();

      if (error) throw error;
      return data as FirewallAuditSession;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["firewall-audit-sessions"] });
      toast({
        title: "30-Day Audit Started",
        description: "Network traffic is now being monitored. A template will be auto-generated when the audit completes.",
      });
    },
    onError: (error) => {
      toast({ title: "Failed to start audit", description: error.message, variant: "destructive" });
    },
  });
}

export function useGenerateTemplateFromAudit() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useTenant();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      if (!currentOrganization?.id) throw new Error("No organization selected");

      // Get the audit session
      const { data: session, error: sessionError } = await supabase
        .from("firewall_audit_sessions")
        .select("*")
        .eq("id", sessionId)
        .single();

      if (sessionError) throw sessionError;

      // Fetch all audit logs during the audit period
      const { data: logs, error: logsError } = await supabase
        .from("firewall_audit_logs")
        .select("service_name, local_port, protocol, remote_address")
        .eq("organization_id", currentOrganization.id)
        .gte("event_time", session.started_at)
        .lte("event_time", session.ends_at)
        .limit(1000);

      if (logsError) throw logsError;

      // Aggregate observed services into unique rules
      const serviceMap = new Map<string, { port: string; protocol: string }>();
      (logs || []).forEach((log) => {
        const key = `${log.service_name}:${log.local_port}:${log.protocol}`;
        if (!serviceMap.has(key)) {
          serviceMap.set(key, {
            port: String(log.local_port),
            protocol: log.protocol,
          });
        }
      });

      const rules = Array.from(serviceMap.entries()).map(([key, val]) => ({
        service_name: key.split(":")[0],
        port: val.port,
        protocol: val.protocol,
        action: "allow",
      }));

      // Create a template from observed traffic
      const { data: template, error: templateError } = await supabase
        .from("firewall_templates")
        .insert([{
          name: `Auto-Generated: ${new Date(session.started_at).toLocaleDateString()} – ${new Date(session.ends_at).toLocaleDateString()}`,
          description: `Whitelist template generated from ${logs?.length || 0} observed connections during 30-day audit. Only observed traffic is allowed; all other inbound traffic will be blocked.`,
          category: "security",
          rules_json: JSON.parse(JSON.stringify(rules)),
          default_mode: "enforce",
        }])
        .select()
        .single();

      if (templateError) throw templateError;

      // Update audit session status
      const { error: updateError } = await supabase
        .from("firewall_audit_sessions")
        .update({
          status: "template_generated",
          generated_template_id: template.id,
        })
        .eq("id", sessionId);

      if (updateError) throw updateError;

      return { template, rules, logCount: logs?.length || 0 };
    },
    onSuccess: ({ logCount }) => {
      queryClient.invalidateQueries({ queryKey: ["firewall-audit-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["firewall-templates"] });
      toast({
        title: "Template Generated",
        description: `Created whitelist template from ${logCount} observed connections. Review and apply it via the Template Gallery.`,
      });
    },
    onError: (error) => {
      toast({ title: "Failed to generate template", description: error.message, variant: "destructive" });
    },
  });
}

export function useCompleteAuditSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      const { error } = await supabase
        .from("firewall_audit_sessions")
        .update({ status: "completed" })
        .eq("id", sessionId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["firewall-audit-sessions"] });
    },
  });
}

// Audit findings summary
export interface AuditFindingSummary {
  service_name: string;
  local_port: number;
  protocol: string;
  unique_sources: number;
  total_connections: number;
  first_seen: string;
  last_seen: string;
  sample_sources: string[];
}

export function useAuditFindings(session?: FirewallAuditSession | null) {
  const { currentOrganization } = useTenant();

  return useQuery({
    queryKey: ["firewall-audit-findings", currentOrganization?.id, session?.id],
    queryFn: async () => {
      if (!currentOrganization?.id || !session) return [];

      const { data: logs, error } = await supabase
        .from("firewall_audit_logs")
        .select("service_name, local_port, protocol, remote_address, event_time")
        .eq("organization_id", currentOrganization.id)
        .gte("event_time", session.started_at)
        .lte("event_time", session.ends_at)
        .order("event_time", { ascending: true })
        .limit(1000);

      if (error) throw error;

      // Aggregate by service+port+protocol
      const map = new Map<string, {
        service_name: string;
        local_port: number;
        protocol: string;
        sources: Set<string>;
        count: number;
        first_seen: string;
        last_seen: string;
      }>();

      (logs || []).forEach((log) => {
        const key = `${log.service_name}:${log.local_port}:${log.protocol}`;
        const existing = map.get(key);
        if (existing) {
          existing.sources.add(log.remote_address);
          existing.count++;
          existing.last_seen = log.event_time;
        } else {
          map.set(key, {
            service_name: log.service_name,
            local_port: log.local_port,
            protocol: log.protocol,
            sources: new Set([log.remote_address]),
            count: 1,
            first_seen: log.event_time,
            last_seen: log.event_time,
          });
        }
      });

      return Array.from(map.values())
        .map((entry) => ({
          service_name: entry.service_name,
          local_port: entry.local_port,
          protocol: entry.protocol,
          unique_sources: entry.sources.size,
          total_connections: entry.count,
          first_seen: entry.first_seen,
          last_seen: entry.last_seen,
          sample_sources: Array.from(entry.sources).slice(0, 5),
        }))
        .sort((a, b) => b.total_connections - a.total_connections) as AuditFindingSummary[];
    },
    enabled: !!currentOrganization?.id && !!session,
  });
}
