import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";

export function useVulnerabilityFindings() {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;

  return useQuery({
    queryKey: ["vulnerability-findings", orgId],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("vulnerability_findings")
        .select("*, endpoints(hostname)")
        .eq("organization_id", orgId)
        .order("cvss_score", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
  });
}

export function useVulnerabilityStats() {
  const { data: findings, isLoading } = useVulnerabilityFindings();

  const stats = {
    total: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    open: 0,
    resolved: 0,
    affectedEndpoints: 0,
  };

  if (findings) {
    stats.total = findings.length;
    stats.critical = findings.filter((f) => f.severity === "critical").length;
    stats.high = findings.filter((f) => f.severity === "high").length;
    stats.medium = findings.filter((f) => f.severity === "medium").length;
    stats.low = findings.filter((f) => f.severity === "low").length;
    stats.open = findings.filter((f) => f.status === "open").length;
    stats.resolved = findings.filter((f) => f.status !== "open").length;
    const uniqueEndpoints = new Set(findings.filter((f) => f.status === "open").map((f) => f.endpoint_id));
    stats.affectedEndpoints = uniqueEndpoints.size;
  }

  return { stats, isLoading };
}

export function useSoftwareInventory() {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;

  return useQuery({
    queryKey: ["software-inventory", orgId],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("endpoint_software_inventory")
        .select("*, endpoints(hostname)")
        .eq("organization_id", orgId)
        .order("software_name");
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
  });
}

export function useVulnerabilityScanJobs() {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;

  return useQuery({
    queryKey: ["vulnerability-scan-jobs", orgId],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("vulnerability_scan_jobs")
        .select("*")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
  });
}

export function useUpdateFindingStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from("vulnerability_findings")
        .update({
          status,
          resolved_at: status !== "open" ? new Date().toISOString() : null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vulnerability-findings"] });
    },
  });
}

export function useBulkUpdateFindingStatus() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      const { error } = await supabase
        .from("vulnerability_findings")
        .update({
          status,
          resolved_at: status !== "open" ? new Date().toISOString() : null,
        })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["vulnerability-findings"] });
      toast({
        title: "Bulk update complete",
        description: `Updated ${vars.ids.length} findings to "${vars.status}".`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Bulk update failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });
}

export function usePatchDevice() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      endpointId,
      organizationId,
      cveId,
    }: {
      endpointId: string;
      organizationId: string;
      cveId: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("agent_commands")
        .insert({
          endpoint_id: endpointId,
          organization_id: organizationId,
          command_type: "install_updates",
          params: { triggered_by_cve: cveId },
          issued_by: user?.id,
          status: "queued",
        });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({
        title: "Patch command queued",
        description: "The device will install Security + Critical updates on its next check-in (within ~60s). Reboot may be required.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to queue patch command",
        description: err.message,
        variant: "destructive",
      });
    },
  });
}

export function useBulkPatchDevices() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (
      findings: Array<{ endpointId: string; organizationId: string; cveId: string }>
    ) => {
      const { data: { user } } = await supabase.auth.getUser();
      // Deduplicate by endpoint to avoid duplicate patch commands
      const uniqueEndpoints = new Map<string, { endpointId: string; organizationId: string; cveIds: string[] }>();
      for (const f of findings) {
        if (!uniqueEndpoints.has(f.endpointId)) {
          uniqueEndpoints.set(f.endpointId, { endpointId: f.endpointId, organizationId: f.organizationId, cveIds: [] });
        }
        uniqueEndpoints.get(f.endpointId)!.cveIds.push(f.cveId);
      }

      const commands = Array.from(uniqueEndpoints.values()).map((ep) => ({
        endpoint_id: ep.endpointId,
        organization_id: ep.organizationId,
        command_type: "install_updates",
        params: { triggered_by_cves: ep.cveIds },
        issued_by: user?.id,
        status: "queued",
      }));

      const { error } = await supabase.from("agent_commands").insert(commands);
      if (error) throw error;
      return commands.length;
    },
    onSuccess: (count) => {
      toast({
        title: "Bulk patch queued",
        description: `Patch commands queued for ${count} device(s).`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Bulk patch failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });
}
