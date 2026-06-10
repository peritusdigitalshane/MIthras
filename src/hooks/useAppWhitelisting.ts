import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export type AppWhitelistMode = "idle" | "auditing" | "enforcing";

export interface AppObservedRow {
  sha256: string;
  file_name: string | null;
  file_path: string | null;
  publisher: string | null;
  product_name: string | null;
  file_version: string | null;
  first_seen: string | null;
  last_seen: string | null;
  launches: number;
  blocked: number;
  whitelisted: boolean;
}

export interface AppWhitelistRule {
  id: string;
  match_type: "hash" | "publisher" | "path" | "trusted_path";
  match_value: string;
  app_name: string | null;
  publisher: string | null;
  file_path: string | null;
  sha256: string | null;
  enabled: boolean;
  created_at: string;
}

export interface EndpointAppWhitelistSnapshot {
  endpoint_id: string;
  mode: AppWhitelistMode;
  audit_started_at: string | null;
  enforce_started_at: string | null;
  observed: AppObservedRow[];
  rules: AppWhitelistRule[];
}

export function useEndpointAppWhitelist(endpointId: string | null | undefined) {
  return useQuery({
    queryKey: ["endpoint-app-whitelist", endpointId],
    enabled: !!endpointId,
    queryFn: async () => {
      if (!endpointId) return null;
      const { data, error } = await (supabase.rpc as any)("get_endpoint_app_whitelist", {
        p_endpoint_id: endpointId,
      });
      if (error) throw error;
      if (!data) return null;
      return {
        ...data,
        observed: ((data.observed ?? []) as any[]).map((r) => ({
          ...r,
          launches: Number(r.launches ?? 0),
          blocked: Number(r.blocked ?? 0),
          whitelisted: !!r.whitelisted,
        })),
        rules: (data.rules ?? []) as AppWhitelistRule[],
      } as EndpointAppWhitelistSnapshot;
    },
    refetchInterval: 30000,
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>, endpointId: string) {
  qc.invalidateQueries({ queryKey: ["endpoint-app-whitelist", endpointId] });
}

export function useStartAppAudit() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ endpointId }: { endpointId: string }) => {
      const { error } = await (supabase.rpc as any)("endpoint_app_whitelist_start_audit", {
        p_endpoint_id: endpointId,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      invalidate(qc, vars.endpointId);
      toast({
        title: "Audit started",
        description:
          "Agent will ship every process launch over the next learning window. Curate the list, then click Enforce.",
      });
    },
    onError: (e: Error) =>
      toast({ title: "Failed to start audit", description: e.message, variant: "destructive" }),
  });
}

export function useStopAppAudit() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ endpointId }: { endpointId: string }) => {
      const { error } = await (supabase.rpc as any)("endpoint_app_whitelist_stop", {
        p_endpoint_id: endpointId,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      invalidate(qc, vars.endpointId);
      toast({ title: "Stopped", description: "Endpoint is back to idle (no observation, no enforcement)." });
    },
    onError: (e: Error) =>
      toast({ title: "Failed to stop", description: e.message, variant: "destructive" }),
  });
}

export function useEnforceAppWhitelist() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ endpointId }: { endpointId: string }) => {
      const { error } = await (supabase.rpc as any)("endpoint_app_whitelist_enforce", {
        p_endpoint_id: endpointId,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      invalidate(qc, vars.endpointId);
      toast({
        title: "Enforcement applied",
        description:
          "Every app observed during audit was added to the whitelist plus OS path rules. Anything else will be blocked.",
      });
    },
    onError: (e: Error) =>
      toast({ title: "Failed to enforce", description: e.message, variant: "destructive" }),
  });
}

export function useAddObservedToWhitelist() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ endpointId, sha256 }: { endpointId: string; sha256: string }) => {
      const { error } = await (supabase.rpc as any)("endpoint_app_whitelist_add_observed", {
        p_endpoint_id: endpointId,
        p_sha256: sha256,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      invalidate(qc, vars.endpointId);
      toast({ title: "Added to whitelist", description: "App is now allowed under enforce mode." });
    },
    onError: (e: Error) =>
      toast({ title: "Failed to add", description: e.message, variant: "destructive" }),
  });
}

export function useDeleteAppWhitelistRule() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ endpointId, ruleId }: { endpointId: string; ruleId: string }) => {
      const { error } = await supabase.from("app_whitelist_rules").delete().eq("id", ruleId);
      if (error) throw error;
      void endpointId;
    },
    onSuccess: (_d, vars) => {
      invalidate(qc, vars.endpointId);
      toast({ title: "Rule removed" });
    },
    onError: (e: Error) =>
      toast({ title: "Failed to remove rule", description: e.message, variant: "destructive" }),
  });
}
