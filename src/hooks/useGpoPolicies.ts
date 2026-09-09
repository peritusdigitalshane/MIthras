import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GpoPolicy } from "@/lib/gpo-settings";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { logActivity } from "@/hooks/useActivityLogs";

export function useGpoPolicies() {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;

  return useQuery({
    queryKey: ["gpo-policies", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gpo_policies")
        .select("*")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as unknown as GpoPolicy[];
    },
  });
}

export function useGpoPolicyOptions() {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;

  return useQuery({
    queryKey: ["gpo-policy-options", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gpo_policies")
        .select("id, name, organization_id, is_default")
        .eq("organization_id", orgId!)
        .order("name");

      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateGpoPolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      orgId,
      userId,
      policy,
    }: {
      orgId: string;
      userId: string;
      policy: Partial<GpoPolicy>;
    }) => {
      const { data, error } = await supabase
        .from("gpo_policies")
        .insert({ ...policy, organization_id: orgId, created_by: userId } as any)
        .select("*")
        .single();

      if (error) throw error;
      await logActivity(orgId, "create", "gpo_policy", data.id, { name: data.name });
      return data as unknown as GpoPolicy;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gpo-policies"] });
      queryClient.invalidateQueries({ queryKey: ["gpo-policy-options"] });
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
    },
  });
}

export function useUpdateGpoPolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<GpoPolicy> }) => {
      const { data, error } = await supabase
        .from("gpo_policies")
        .update({ ...patch, updated_at: new Date().toISOString() } as any)
        .eq("id", id)
        .select("*")
        .single();

      if (error) throw error;
      await logActivity(data.organization_id, "update", "gpo_policy", id, { name: data.name });
      return data as unknown as GpoPolicy;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gpo-policies"] });
      queryClient.invalidateQueries({ queryKey: ["gpo-policy-options"] });
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
    },
  });
}

export function useDeleteGpoPolicy() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useTenant();

  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name?: string }) => {
      const { error } = await supabase.from("gpo_policies").delete().eq("id", id);
      if (error) throw error;
      if (currentOrganization?.id) {
        await logActivity(currentOrganization.id, "delete", "gpo_policy", id, { name: name || "Unknown" });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gpo-policies"] });
      queryClient.invalidateQueries({ queryKey: ["gpo-policy-options"] });
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
    },
  });
}
