import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { FirewallAuditSession } from "@/hooks/useFirewall";

// Per-endpoint audit finding
export interface EndpointAuditFinding {
  endpoint_id: string;
  hostname: string;
  services: {
    service_name: string;
    local_port: number;
    protocol: string;
    total_connections: number;
    unique_sources: number;
    sample_sources: string[];
    first_seen: string;
    last_seen: string;
  }[];
  total_connections: number;
  unique_services: number;
}

export function useAuditFindingsByEndpoint(session?: FirewallAuditSession | null) {
  const { currentOrganization } = useTenant();

  return useQuery({
    queryKey: ["firewall-audit-findings-by-endpoint", currentOrganization?.id, session?.id],
    queryFn: async () => {
      if (!currentOrganization?.id || !session) return [];

      const { data: logs, error } = await supabase
        .from("firewall_audit_logs")
        .select("endpoint_id, service_name, local_port, protocol, remote_address, event_time, endpoint:endpoints(hostname)")
        .eq("organization_id", currentOrganization.id)
        .gte("event_time", session.started_at)
        .lte("event_time", session.ends_at)
        .order("event_time", { ascending: true })
        .limit(5000);

      if (error) throw error;

      // Group by endpoint, then by service+port+protocol
      const endpointMap = new Map<string, {
        hostname: string;
        services: Map<string, {
          service_name: string;
          local_port: number;
          protocol: string;
          count: number;
          sources: Set<string>;
          first_seen: string;
          last_seen: string;
        }>;
      }>();

      (logs || []).forEach((log: any) => {
        const endpointId = log.endpoint_id;
        const hostname = log.endpoint?.hostname || "Unknown";

        if (!endpointMap.has(endpointId)) {
          endpointMap.set(endpointId, { hostname, services: new Map() });
        }

        const ep = endpointMap.get(endpointId)!;
        const serviceKey = `${log.service_name}:${log.local_port}:${log.protocol}`;

        if (!ep.services.has(serviceKey)) {
          ep.services.set(serviceKey, {
            service_name: log.service_name,
            local_port: log.local_port,
            protocol: log.protocol,
            count: 0,
            sources: new Set(),
            first_seen: log.event_time,
            last_seen: log.event_time,
          });
        }

        const svc = ep.services.get(serviceKey)!;
        svc.count++;
        svc.sources.add(log.remote_address);
        svc.last_seen = log.event_time;
      });

      return Array.from(endpointMap.entries())
        .map(([endpoint_id, data]) => ({
          endpoint_id,
          hostname: data.hostname,
          services: Array.from(data.services.values()).map((s) => ({
            service_name: s.service_name,
            local_port: s.local_port,
            protocol: s.protocol,
            total_connections: s.count,
            unique_sources: s.sources.size,
            sample_sources: Array.from(s.sources).slice(0, 5),
            first_seen: s.first_seen,
            last_seen: s.last_seen,
          })),
          total_connections: Array.from(data.services.values()).reduce((sum, s) => sum + s.count, 0),
          unique_services: data.services.size,
        }))
        .sort((a, b) => b.total_connections - a.total_connections) as EndpointAuditFinding[];
    },
    enabled: !!currentOrganization?.id && !!session,
  });
}

// Generate per-endpoint firewall rules from audit data
export function useGeneratePerEndpointRules() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useTenant();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ sessionId, policyId }: { sessionId: string; policyId: string }) => {
      if (!currentOrganization?.id) throw new Error("No organization selected");

      // Get the audit session
      const { data: session, error: sessionError } = await supabase
        .from("firewall_audit_sessions")
        .select("*")
        .eq("id", sessionId)
        .single();

      if (sessionError) throw sessionError;

      // Fetch audit logs with endpoint info
      const { data: logs, error: logsError } = await supabase
        .from("firewall_audit_logs")
        .select("endpoint_id, service_name, local_port, protocol, remote_address")
        .eq("organization_id", currentOrganization.id)
        .gte("event_time", session.started_at)
        .lte("event_time", session.ends_at)
        .limit(5000);

      if (logsError) throw logsError;

      // Get endpoint group memberships to map endpoints → groups
      const { data: memberships, error: memError } = await supabase
        .from("endpoint_group_memberships")
        .select("endpoint_id, group_id");

      if (memError) throw memError;

      // Build endpoint→groups map
      const endpointGroups = new Map<string, string[]>();
      (memberships || []).forEach((m) => {
        const groups = endpointGroups.get(m.endpoint_id) || [];
        groups.push(m.group_id);
        endpointGroups.set(m.endpoint_id, groups);
      });

      // Group by endpoint → unique services
      const endpointServices = new Map<string, Map<string, { port: string; protocol: string; service_name: string; sources: Set<string> }>>();
      (logs || []).forEach((log) => {
        if (!endpointServices.has(log.endpoint_id)) {
          endpointServices.set(log.endpoint_id, new Map());
        }
        const svcMap = endpointServices.get(log.endpoint_id)!;
        const key = `${log.service_name}:${log.local_port}:${log.protocol}`;
        if (!svcMap.has(key)) {
          svcMap.set(key, {
            port: String(log.local_port),
            protocol: log.protocol,
            service_name: log.service_name,
            sources: new Set(),
          });
        }
        svcMap.get(key)!.sources.add(log.remote_address);
      });

      // Create rules per endpoint's groups
      const rulesToInsert: any[] = [];
      const processedGroupService = new Set<string>();

      endpointServices.forEach((services, endpointId) => {
        const groups = endpointGroups.get(endpointId) || [];
        
        services.forEach((svc) => {
          groups.forEach((groupId) => {
            const dedupeKey = `${groupId}:${svc.service_name}:${svc.port}:${svc.protocol}`;
            if (processedGroupService.has(dedupeKey)) return;
            processedGroupService.add(dedupeKey);

            rulesToInsert.push({
              policy_id: policyId,
              endpoint_group_id: groupId,
              service_name: svc.service_name,
              port: svc.port,
              protocol: svc.protocol,
              action: "allow",
              allowed_source_ips: Array.from(svc.sources),
              mode: "audit",
              enabled: true,
              order_priority: 100,
            });
          });
        });
      });

      // Insert rules in batch
      if (rulesToInsert.length > 0) {
        const { error: insertError } = await supabase
          .from("firewall_service_rules")
          .insert(rulesToInsert);

        if (insertError) throw insertError;
      }

      // Update audit session
      const { error: updateError } = await supabase
        .from("firewall_audit_sessions")
        .update({ status: "template_generated" })
        .eq("id", sessionId);

      if (updateError) throw updateError;

      return {
        rulesCreated: rulesToInsert.length,
        endpointsProcessed: endpointServices.size,
        logCount: logs?.length || 0,
      };
    },
    onSuccess: ({ rulesCreated, endpointsProcessed }) => {
      queryClient.invalidateQueries({ queryKey: ["firewall-audit-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["firewall-service-rules"] });
      toast({
        title: "Per-Endpoint Rules Generated",
        description: `Created ${rulesCreated} rules from ${endpointsProcessed} endpoints. Rules are in Audit mode — review in the Firewall Matrix before enforcing.`,
      });
    },
    onError: (error) => {
      toast({ title: "Failed to generate rules", description: error.message, variant: "destructive" });
    },
  });
}
