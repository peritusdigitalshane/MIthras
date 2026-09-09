import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DefenderPolicy } from "@/lib/defender-settings";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { logActivity } from "@/hooks/useActivityLogs";

export interface PolicyOption {
  id: string;
  name: string;
  organization_id: string;
  is_default: boolean;
}

export function usePolicyOptions() {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;

  return useQuery({
    queryKey: ["policy-options", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      let query = supabase
        .from("defender_policies")
        .select("id, name, organization_id, is_default")
        .order("name");

      if (orgId) {
        query = query.eq("organization_id", orgId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as PolicyOption[];
    },
  });
}

export function usePolicies() {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;

  return useQuery({
    queryKey: ["policies", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      let query = supabase
        .from("defender_policies")
        .select("*")
        .order("created_at", { ascending: false });

      if (orgId) {
        query = query.eq("organization_id", orgId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as DefenderPolicy[];
    },
  });
}

export function useCreatePolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      orgId,
      userId,
      policy,
    }: {
      orgId: string;
      userId: string;
      policy: Partial<DefenderPolicy>;
    }) => {
      const insertData = {
        ...policy,
        organization_id: orgId,
        created_by: userId,
      };

      const { data, error } = await supabase
        .from("defender_policies")
        // supabase types in this project are strict; cast to allow partials + rely on DB defaults
        .insert(insertData as any)
        .select("*")
        .single();

      if (error) throw error;
      
      // Log activity
      await logActivity(orgId, "create", "policy", data.id, { name: data.name });
      
      return data as DefenderPolicy;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["policies"] });
      queryClient.invalidateQueries({ queryKey: ["policy-options"] });
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
    },
  });
}

export function useUpdatePolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<DefenderPolicy>;
    }) => {
      const { data, error } = await supabase
        .from("defender_policies")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("*")
        .single();

      if (error) throw error;
      
      // Log activity
      await logActivity(data.organization_id, "update", "policy", id, { name: data.name });
      
      return data as DefenderPolicy;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["policies"] });
      queryClient.invalidateQueries({ queryKey: ["policy-options"] });
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
    },
  });
}

export function useDeletePolicy() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useTenant();

  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name?: string }) => {
      const { error } = await supabase.from("defender_policies").delete().eq("id", id);
      if (error) throw error;
      
      // Log activity
      if (currentOrganization?.id) {
        await logActivity(currentOrganization.id, "delete", "policy", id, { name: name || "Unknown" });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["policies"] });
      queryClient.invalidateQueries({ queryKey: ["policy-options"] });
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
    },
  });
}

export function useAssignPolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      endpointId,
      policyId,
      orgId,
      endpointName,
      policyName,
    }: {
      endpointId: string;
      policyId: string | null;
      orgId?: string;
      endpointName?: string;
      policyName?: string;
    }) => {
      const { error } = await supabase
        .from("endpoints")
        .update({ policy_id: policyId })
        .eq("id", endpointId);

      if (error) throw error;
      
      // Log activity
      if (orgId) {
        await logActivity(
          orgId, 
          "policy_applied", 
          "endpoint", 
          endpointId, 
          { endpoint: endpointName, policy: policyName || "None" },
          endpointId
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["endpoints"] });
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
    },
  });
}

export function useAddPolicyExclusion() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useTenant();

  return useMutation({
    mutationFn: async ({
      policyId,
      exclusionType,
      value,
      policyName,
    }: {
      policyId: string;
      exclusionType: "path" | "process";
      value: string;
      policyName?: string;
    }) => {
      // First fetch the current policy to get existing exclusions
      const { data: policy, error: fetchError } = await supabase
        .from("defender_policies")
        .select("exclusion_paths, exclusion_processes, organization_id")
        .eq("id", policyId)
        .single();

      if (fetchError) throw fetchError;

      // Build the update based on exclusion type
      const updateData: { exclusion_paths?: string[]; exclusion_processes?: string[]; updated_at: string } = {
        updated_at: new Date().toISOString(),
      };

      if (exclusionType === "path") {
        const currentPaths = policy.exclusion_paths ?? [];
        if (!currentPaths.includes(value)) {
          updateData.exclusion_paths = [...currentPaths, value];
        }
      } else {
        const currentProcesses = policy.exclusion_processes ?? [];
        if (!currentProcesses.includes(value)) {
          updateData.exclusion_processes = [...currentProcesses, value];
        }
      }

      // Update the policy
      const { data, error } = await supabase
        .from("defender_policies")
        .update(updateData)
        .eq("id", policyId)
        .select("*")
        .single();

      if (error) throw error;

      // Log activity
      if (policy.organization_id) {
        await logActivity(
          policy.organization_id,
          "exclusion_added",
          "policy",
          policyId,
          { policy: policyName, exclusion_type: exclusionType, value }
        );
      }

      return data as DefenderPolicy;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["policies"] });
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
    },
  });
}
