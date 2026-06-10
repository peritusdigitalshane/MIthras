import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "sonner";
import { logActivity } from "@/hooks/useActivityLogs";

export interface UacPolicy {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  enable_lua: boolean;
  consent_prompt_admin: number;
  consent_prompt_user: number;
  prompt_on_secure_desktop: boolean;
  detect_installations: boolean;
  validate_admin_signatures: boolean;
  filter_administrator_token: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface UacPolicyFormData {
  name: string;
  description?: string;
  is_default?: boolean;
  enable_lua: boolean;
  consent_prompt_admin: number;
  consent_prompt_user: number;
  prompt_on_secure_desktop: boolean;
  detect_installations: boolean;
  validate_admin_signatures: boolean;
  filter_administrator_token: boolean;
}

export interface EndpointUacStatus {
  endpoint_id: string;
  hostname: string;
  uac_enabled: boolean | null;
  uac_consent_prompt_admin: number | null;
  uac_consent_prompt_user: number | null;
  uac_prompt_on_secure_desktop: boolean | null;
  uac_detect_installations: boolean | null;
  uac_validate_admin_signatures: boolean | null;
  uac_filter_administrator_token: boolean | null;
  uac_policy_id: string | null;
  uac_policy_name: string | null;
  collected_at: string | null;
}

export const UAC_ADMIN_PROMPTS: Record<number, { label: string; description: string }> = {
  0: { label: "Elevate without prompting", description: "No prompt for admin operations (least secure)" },
  1: { label: "Prompt for credentials on secure desktop", description: "Requires entering credentials on secure desktop" },
  2: { label: "Prompt for consent on secure desktop", description: "Yes/No prompt on secure desktop" },
  3: { label: "Prompt for credentials", description: "Requires entering credentials on normal desktop" },
  4: { label: "Prompt for consent", description: "Yes/No prompt on normal desktop" },
  5: { label: "Prompt for consent for non-Windows binaries", description: "Default - prompt only for unsigned apps" },
};

export const UAC_USER_PROMPTS: Record<number, { label: string; description: string }> = {
  0: { label: "Automatically deny", description: "Standard users cannot run elevated apps" },
  1: { label: "Prompt for credentials on secure desktop", description: "Requires admin credentials on secure desktop" },
  3: { label: "Prompt for credentials", description: "Requires admin credentials on normal desktop (default)" },
};

export function useUacPolicies() {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;

  return useQuery({
    queryKey: ["uac_policies", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("uac_policies")
        .select("*")
        .eq("organization_id", orgId!)
        .order("name");

      if (error) throw error;
      return data as UacPolicy[];
    },
  });
}

export function useCreateUacPolicy() {
  const { currentOrganization } = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UacPolicyFormData) => {
      const { data: user } = await supabase.auth.getUser();
      const { data: policy, error } = await supabase
        .from("uac_policies")
        .insert({
          ...data,
          organization_id: currentOrganization!.id,
          created_by: user.user?.id,
        })
        .select()
        .single();

      if (error) throw error;
      await logActivity(currentOrganization!.id, "create", "uac_policy", policy.id, { name: data.name });
      return policy;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["uac_policies"] });
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
      toast.success("UAC policy created");
    },
    onError: (error) => {
      toast.error("Failed to create policy: " + error.message);
    },
  });
}

export function useUpdateUacPolicy() {
  const { currentOrganization } = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<UacPolicyFormData> }) => {
      const { error } = await supabase
        .from("uac_policies")
        .update(data)
        .eq("id", id);

      if (error) throw error;
      if (currentOrganization?.id) {
        await logActivity(currentOrganization.id, "update", "uac_policy", id, { name: data.name });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["uac_policies"] });
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
      toast.success("UAC policy updated");
    },
    onError: (error) => {
      toast.error("Failed to update policy: " + error.message);
    },
  });
}

export function useDeleteUacPolicy() {
  const { currentOrganization } = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name?: string }) => {
      const { error } = await supabase.from("uac_policies").delete().eq("id", id);
      if (error) throw error;
      if (currentOrganization?.id) {
        await logActivity(currentOrganization.id, "delete", "uac_policy", id, { name: name || "Unknown" });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["uac_policies"] });
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
      toast.success("UAC policy deleted");
    },
    onError: (error) => {
      toast.error("Failed to delete policy: " + error.message);
    },
  });
}

export function useEndpointUacStatuses() {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;

  return useQuery({
    queryKey: ["endpoint_uac_statuses", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data: endpoints, error: endpointsError } = await supabase
        .from("endpoints")
        .select(`id, hostname, uac_policy_id, uac_policies(name)`)
        .eq("organization_id", orgId!)
        .is("deleted_at", null);

      if (endpointsError) throw endpointsError;
      if (!endpoints?.length) return [];

      const { data: statuses, error: statusError } = await supabase
        .from("endpoint_status")
        .select(`endpoint_id, uac_enabled, uac_consent_prompt_admin, uac_consent_prompt_user, uac_prompt_on_secure_desktop, uac_detect_installations, uac_validate_admin_signatures, uac_filter_administrator_token, collected_at`)
        .in("endpoint_id", endpoints.map(e => e.id))
        .order("collected_at", { ascending: false });

      if (statusError) throw statusError;

      const latestStatusByEndpoint = new Map<string, typeof statuses[0]>();
      for (const status of statuses || []) {
        if (!latestStatusByEndpoint.has(status.endpoint_id)) {
          latestStatusByEndpoint.set(status.endpoint_id, status);
        }
      }

      return endpoints.map((endpoint): EndpointUacStatus => {
        const status = latestStatusByEndpoint.get(endpoint.id);
        const uacPolicies = endpoint.uac_policies as { name: string } | null;
        return {
          endpoint_id: endpoint.id,
          hostname: endpoint.hostname,
          uac_enabled: status?.uac_enabled ?? null,
          uac_consent_prompt_admin: status?.uac_consent_prompt_admin ?? null,
          uac_consent_prompt_user: status?.uac_consent_prompt_user ?? null,
          uac_prompt_on_secure_desktop: status?.uac_prompt_on_secure_desktop ?? null,
          uac_detect_installations: status?.uac_detect_installations ?? null,
          uac_validate_admin_signatures: status?.uac_validate_admin_signatures ?? null,
          uac_filter_administrator_token: status?.uac_filter_administrator_token ?? null,
          uac_policy_id: endpoint.uac_policy_id,
          uac_policy_name: uacPolicies?.name ?? null,
          collected_at: status?.collected_at ?? null,
        };
      });
    },
    refetchInterval: 30000,
  });
}

export function useAssignUacPolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ endpointId, policyId }: { endpointId: string; policyId: string | null }) => {
      const { error } = await supabase
        .from("endpoints")
        .update({ uac_policy_id: policyId })
        .eq("id", endpointId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["endpoint_uac_statuses"] });
      queryClient.invalidateQueries({ queryKey: ["endpoints"] });
      toast.success("UAC policy assigned");
    },
    onError: (error) => {
      toast.error("Failed to assign policy: " + error.message);
    },
  });
}
