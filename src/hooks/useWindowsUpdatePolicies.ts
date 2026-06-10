import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "sonner";
import { logActivity } from "@/hooks/useActivityLogs";

export interface WindowsUpdatePolicy {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  auto_update_mode: number;
  active_hours_start: number;
  active_hours_end: number;
  feature_update_deferral: number;
  quality_update_deferral: number;
  pause_feature_updates: boolean;
  pause_quality_updates: boolean;
  created_at: string;
  updated_at: string;
}

export interface WindowsUpdatePolicyFormData {
  name: string;
  description?: string;
  auto_update_mode: number;
  active_hours_start: number;
  active_hours_end: number;
  feature_update_deferral: number;
  quality_update_deferral: number;
  pause_feature_updates: boolean;
  pause_quality_updates: boolean;
}

export interface EndpointWindowsUpdateStatus {
  endpoint_id: string;
  hostname: string;
  wu_auto_update_mode: number | null;
  wu_active_hours_start: number | null;
  wu_active_hours_end: number | null;
  wu_feature_update_deferral: number | null;
  wu_quality_update_deferral: number | null;
  wu_pause_feature_updates: boolean | null;
  wu_pause_quality_updates: boolean | null;
  wu_pending_updates_count: number | null;
  wu_last_install_date: string | null;
  wu_restart_pending: boolean | null;
  windows_update_policy_id: string | null;
  windows_update_policy_name: string | null;
  collected_at: string | null;
}

export const AUTO_UPDATE_MODES: Record<number, { label: string; description: string }> = {
  0: { label: "Notify to download", description: "Notify before downloading updates" },
  1: { label: "Auto download", description: "Download automatically, notify to install" },
  2: { label: "Auto download & install", description: "Download and install automatically" },
  3: { label: "Scheduled install", description: "Install on a schedule" },
  4: { label: "Local admin decides", description: "Allow local admin to configure (default)" },
};

export function useWindowsUpdatePolicies() {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;

  return useQuery({
    queryKey: ["windows_update_policies", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("windows_update_policies")
        .select("*")
        .eq("organization_id", orgId!)
        .order("name");

      if (error) throw error;
      return data as WindowsUpdatePolicy[];
    },
  });
}

export function useCreateWindowsUpdatePolicy() {
  const { currentOrganization } = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: WindowsUpdatePolicyFormData) => {
      const { data: policy, error } = await supabase
        .from("windows_update_policies")
        .insert({
          ...data,
          organization_id: currentOrganization!.id,
        })
        .select()
        .single();

      if (error) throw error;
      await logActivity(currentOrganization!.id, "create", "windows_update_policy", policy.id, { name: data.name });
      return policy;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["windows_update_policies"] });
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
      toast.success("Windows Update policy created");
    },
    onError: (error) => {
      toast.error("Failed to create policy: " + error.message);
    },
  });
}

export function useUpdateWindowsUpdatePolicy() {
  const { currentOrganization } = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<WindowsUpdatePolicyFormData> }) => {
      const { error } = await supabase
        .from("windows_update_policies")
        .update(data)
        .eq("id", id);

      if (error) throw error;
      if (currentOrganization?.id) {
        await logActivity(currentOrganization.id, "update", "windows_update_policy", id, { name: data.name });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["windows_update_policies"] });
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
      toast.success("Windows Update policy updated");
    },
    onError: (error) => {
      toast.error("Failed to update policy: " + error.message);
    },
  });
}

export function useDeleteWindowsUpdatePolicy() {
  const { currentOrganization } = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name?: string }) => {
      const { error } = await supabase.from("windows_update_policies").delete().eq("id", id);
      if (error) throw error;
      if (currentOrganization?.id) {
        await logActivity(currentOrganization.id, "delete", "windows_update_policy", id, { name: name || "Unknown" });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["windows_update_policies"] });
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
      toast.success("Windows Update policy deleted");
    },
    onError: (error) => {
      toast.error("Failed to delete policy: " + error.message);
    },
  });
}

export function useEndpointWindowsUpdateStatuses() {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;

  return useQuery({
    queryKey: ["endpoint_windows_update_statuses", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data: endpoints, error: endpointsError } = await supabase
        .from("endpoints")
        .select(`id, hostname, windows_update_policy_id, windows_update_policies(name)`)
        .eq("organization_id", orgId!)
        .is("deleted_at", null);

      if (endpointsError) throw endpointsError;
      if (!endpoints?.length) return [];

      const { data: statuses, error: statusError } = await supabase
        .from("endpoint_status")
        .select(`endpoint_id, wu_auto_update_mode, wu_active_hours_start, wu_active_hours_end, wu_feature_update_deferral, wu_quality_update_deferral, wu_pause_feature_updates, wu_pause_quality_updates, wu_pending_updates_count, wu_last_install_date, wu_restart_pending, collected_at`)
        .in("endpoint_id", endpoints.map(e => e.id))
        .order("collected_at", { ascending: false });

      if (statusError) throw statusError;

      const latestStatusByEndpoint = new Map<string, typeof statuses[0]>();
      for (const status of statuses || []) {
        if (!latestStatusByEndpoint.has(status.endpoint_id)) {
          latestStatusByEndpoint.set(status.endpoint_id, status);
        }
      }

      return endpoints.map((endpoint): EndpointWindowsUpdateStatus => {
        const status = latestStatusByEndpoint.get(endpoint.id);
        const wuPolicies = endpoint.windows_update_policies as { name: string } | null;
        return {
          endpoint_id: endpoint.id,
          hostname: endpoint.hostname,
          wu_auto_update_mode: status?.wu_auto_update_mode ?? null,
          wu_active_hours_start: status?.wu_active_hours_start ?? null,
          wu_active_hours_end: status?.wu_active_hours_end ?? null,
          wu_feature_update_deferral: status?.wu_feature_update_deferral ?? null,
          wu_quality_update_deferral: status?.wu_quality_update_deferral ?? null,
          wu_pause_feature_updates: status?.wu_pause_feature_updates ?? null,
          wu_pause_quality_updates: status?.wu_pause_quality_updates ?? null,
          wu_pending_updates_count: status?.wu_pending_updates_count ?? null,
          wu_last_install_date: status?.wu_last_install_date ?? null,
          wu_restart_pending: status?.wu_restart_pending ?? null,
          windows_update_policy_id: endpoint.windows_update_policy_id,
          windows_update_policy_name: wuPolicies?.name ?? null,
          collected_at: status?.collected_at ?? null,
        };
      });
    },
    refetchInterval: 30000,
  });
}

export function useAssignWindowsUpdatePolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ endpointId, policyId }: { endpointId: string; policyId: string | null }) => {
      const { error } = await supabase
        .from("endpoints")
        .update({ windows_update_policy_id: policyId })
        .eq("id", endpointId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["endpoint_windows_update_statuses"] });
      queryClient.invalidateQueries({ queryKey: ["endpoints"] });
      toast.success("Windows Update policy assigned");
    },
    onError: (error) => {
      toast.error("Failed to assign policy: " + error.message);
    },
  });
}
