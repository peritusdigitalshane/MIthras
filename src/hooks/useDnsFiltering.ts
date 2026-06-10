import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";

export interface DnsPolicy {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  upstream_provider: string | null;
  upstream_doh_uri: string | null;
  block_malware: boolean;
  block_phishing: boolean;
  block_adult: boolean;
  block_gambling: boolean;
  block_social: boolean;
  custom_blocklist: string[];
  custom_allowlist: string[];
  disable_browser_doh: boolean;
  created_at: string;
  updated_at: string;
}

export interface DnsInternalScope {
  id: string;
  policy_id: string;
  suffix: string;
  forwarders: string[];
  description: string | null;
  display_order: number;
}

export interface DnsPolicyAssignment {
  id: string;
  policy_id: string;
  endpoint_id: string | null;
  endpoint_group_id: string | null;
  created_at: string;
}

export interface DnsQueryLog {
  id: string;
  organization_id: string;
  endpoint_id: string | null;
  policy_id: string | null;
  query_time: string;
  query_name: string;
  query_type: string | null;
  action: "allowed" | "blocked" | "forwarded";
  block_reason: string | null;
  client_ip: string | null;
  upstream_used: string | null;
  latency_ms: number | null;
  response_code: string | null;
}

export function useDnsPolicies() {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;
  return useQuery({
    queryKey: ["dns-policies", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dns_policies")
        .select("*")
        .eq("organization_id", orgId!)
        .order("is_default", { ascending: false })
        .order("name");
      if (error) throw new Error(error.message);
      return (data ?? []) as DnsPolicy[];
    },
  });
}

export function useDnsInternalScopes(policyId: string | null) {
  return useQuery({
    queryKey: ["dns-internal-scopes", policyId],
    enabled: !!policyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dns_internal_scopes")
        .select("*")
        .eq("policy_id", policyId!)
        .order("display_order");
      if (error) throw new Error(error.message);
      return (data ?? []) as DnsInternalScope[];
    },
  });
}

export function useCreateDnsPolicy() {
  const qc = useQueryClient();
  const { currentOrganization } = useTenant();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (input: Partial<DnsPolicy> & { name: string }) => {
      if (!currentOrganization?.id) throw new Error("No org selected");
      const { data, error } = await supabase
        .from("dns_policies")
        .insert({ ...input, organization_id: currentOrganization.id })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as DnsPolicy;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dns-policies"] });
      toast({ title: "DNS policy created" });
    },
    onError: (e: Error) =>
      toast({ title: "Failed to create policy", description: e.message, variant: "destructive" }),
  });
}

export function useUpdateDnsPolicy() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<DnsPolicy> & { id: string }) => {
      const { error } = await supabase.from("dns_policies").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dns-policies"] });
      toast({ title: "Policy saved" });
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });
}

export function useDeleteDnsPolicy() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("dns_policies").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dns-policies"] });
      toast({ title: "Policy deleted" });
    },
    onError: (e: Error) =>
      toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });
}

export function useUpsertInternalScope() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (scope: Partial<DnsInternalScope> & { policy_id: string; suffix: string; forwarders: string[] }) => {
      if (scope.id) {
        const { error } = await supabase
          .from("dns_internal_scopes")
          .update({
            suffix: scope.suffix,
            forwarders: scope.forwarders,
            description: scope.description,
            display_order: scope.display_order,
          })
          .eq("id", scope.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from("dns_internal_scopes").insert({
          policy_id: scope.policy_id,
          suffix: scope.suffix,
          forwarders: scope.forwarders,
          description: scope.description,
          display_order: scope.display_order ?? 100,
        });
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dns-internal-scopes"] });
      toast({ title: "Internal scope saved" });
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });
}

export function useDeleteInternalScope() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("dns_internal_scopes").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dns-internal-scopes"] });
      toast({ title: "Scope removed" });
    },
    onError: (e: Error) =>
      toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });
}

export interface DnsInsights {
  total: number;
  blocked: number;
  forwarded: number;
  unique_domains: number;
  unique_endpoints: number;
  top_blocked: { name: string; count: number }[];
  top_queried: { name: string; count: number }[];
}

export function useDnsInsights(since?: string) {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;
  return useQuery({
    queryKey: ["dns-insights", orgId, since],
    enabled: !!orgId,
    queryFn: async (): Promise<DnsInsights> => {
      const cutoff = since ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data, error } = await supabase
        .from("dns_query_logs")
        .select("query_name, action, endpoint_id")
        .eq("organization_id", orgId!)
        .gte("query_time", cutoff)
        .limit(20000);
      if (error) throw new Error(error.message);

      const rows = (data ?? []) as Pick<DnsQueryLog, "query_name" | "action" | "endpoint_id">[];
      const total = rows.length;
      const blocked = rows.filter((r) => r.action === "blocked").length;
      const forwarded = rows.filter((r) => r.action === "forwarded").length;
      const uniqueDomains = new Set(rows.map((r) => r.query_name)).size;
      const uniqueEndpoints = new Set(rows.map((r) => r.endpoint_id).filter(Boolean)).size;

      const countBy = (list: string[]) => {
        const m = new Map<string, number>();
        for (const k of list) m.set(k, (m.get(k) ?? 0) + 1);
        return Array.from(m.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);
      };

      return {
        total,
        blocked,
        forwarded,
        unique_domains: uniqueDomains,
        unique_endpoints: uniqueEndpoints,
        top_blocked: countBy(rows.filter((r) => r.action === "blocked").map((r) => r.query_name)),
        top_queried: countBy(rows.map((r) => r.query_name)),
      };
    },
  });
}
