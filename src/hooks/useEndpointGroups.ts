import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";

export interface EndpointGroup {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  defender_policy_id: string | null;
  wdac_policy_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  defender_policy?: { id: string; name: string } | null;
  wdac_policy?: { id: string; name: string; mode: string } | null;
  endpoint_count?: number;
}

export interface EndpointGroupMembership {
  id: string;
  endpoint_id: string;
  group_id: string;
  created_at: string;
}

export function useEndpointGroups() {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;

  return useQuery({
    queryKey: ["endpoint-groups", orgId],
    queryFn: async () => {
      if (!orgId) return [];

      const { data, error } = await supabase
        .from("endpoint_groups")
        .select(`
          *,
          defender_policy:defender_policies(id, name),
          wdac_policy:wdac_policies(id, name, mode),
          uac_policy:uac_policies(id, name),
          windows_update_policy:windows_update_policies(id, name),
          gpo_policy:gpo_policies(id, name)
        `)
        .eq("organization_id", orgId)
        .order("name");

      if (error) throw error;

      // Get member counts for each group
      const groupIds = data.map((g) => g.id);
      const { data: memberships } = await supabase
        .from("endpoint_group_memberships")
        .select("group_id")
        .in("group_id", groupIds);

      const countMap = new Map<string, number>();
      memberships?.forEach((m) => {
        countMap.set(m.group_id, (countMap.get(m.group_id) || 0) + 1);
      });

      return data.map((group) => ({
        ...group,
        endpoint_count: countMap.get(group.id) || 0,
      })) as EndpointGroup[];
    },
    enabled: !!orgId,
  });
}

export function useEndpointGroupMemberships(endpointId?: string) {
  return useQuery({
    queryKey: ["endpoint-group-memberships", endpointId],
    queryFn: async () => {
      if (!endpointId) return [];

      const { data, error } = await supabase
        .from("endpoint_group_memberships")
        .select(`
          *,
          group:endpoint_groups(id, name, defender_policy_id, wdac_policy_id)
        `)
        .eq("endpoint_id", endpointId);

      if (error) throw error;
      return data;
    },
    enabled: !!endpointId,
  });
}

export function useGroupMembers(groupId?: string) {
  return useQuery({
    queryKey: ["group-members", groupId],
    queryFn: async () => {
      if (!groupId) return [];

      const { data, error } = await supabase
        .from("endpoint_group_memberships")
        .select(`
          *,
          endpoint:endpoints(id, hostname, is_online, last_seen_at, os_version)
        `)
        .eq("group_id", groupId);

      if (error) throw error;
      return data;
    },
    enabled: !!groupId,
  });
}

export function useCreateEndpointGroup() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { currentOrganization } = useTenant();

  return useMutation({
    mutationFn: async (group: {
      name: string;
      description?: string;
      defender_policy_id?: string | null;
      wdac_policy_id?: string | null;
      uac_policy_id?: string | null;
      windows_update_policy_id?: string | null;
      gpo_policy_id?: string | null;
      update_ring_id?: string | null;
    }) => {
      if (!currentOrganization) throw new Error("No organization selected");

      const { data, error } = await supabase
        .from("endpoint_groups")
        .insert({
          organization_id: currentOrganization.id,
          name: group.name,
          description: group.description || null,
          defender_policy_id: group.defender_policy_id || null,
          wdac_policy_id: group.wdac_policy_id || null,
          uac_policy_id: group.uac_policy_id || null,
          windows_update_policy_id: group.windows_update_policy_id || null,
          gpo_policy_id: group.gpo_policy_id || null,
          update_ring_id: group.update_ring_id || null,
        } as any)
        .select()
        .single();

      if (error) throw error;

      // Log activity
      await supabase.rpc("log_activity", {
        _org_id: currentOrganization.id,
        _action: "group_created",
        _resource_type: "endpoint_group",
        _resource_id: data.id,
        _details: { name: group.name },
      });

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["endpoint-groups"] });
      toast({
        title: "Group created",
        description: "The endpoint group has been created.",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to create group",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useUpdateEndpointGroup() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { currentOrganization } = useTenant();

  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: {
      id: string;
      name?: string;
      description?: string | null;
      defender_policy_id?: string | null;
      wdac_policy_id?: string | null;
      uac_policy_id?: string | null;
      windows_update_policy_id?: string | null;
      gpo_policy_id?: string | null;
      update_ring_id?: string | null;
    }) => {
      const { data, error } = await supabase
        .from("endpoint_groups")
        .update(updates as any)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      if (currentOrganization) {
        await supabase.rpc("log_activity", {
          _org_id: currentOrganization.id,
          _action: "group_updated",
          _resource_type: "endpoint_group",
          _resource_id: id,
          _details: updates,
        });
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["endpoint-groups"] });
      toast({
        title: "Group updated",
        description: "The endpoint group has been updated.",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to update group",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useDeleteEndpointGroup() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { currentOrganization } = useTenant();

  return useMutation({
    mutationFn: async (groupId: string) => {
      const { error } = await supabase
        .from("endpoint_groups")
        .delete()
        .eq("id", groupId);

      if (error) throw error;

      if (currentOrganization) {
        await supabase.rpc("log_activity", {
          _org_id: currentOrganization.id,
          _action: "group_deleted",
          _resource_type: "endpoint_group",
          _resource_id: groupId,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["endpoint-groups"] });
      toast({
        title: "Group deleted",
        description: "The endpoint group has been deleted.",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to delete group",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useAddEndpointToGroup() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { currentOrganization } = useTenant();

  return useMutation({
    mutationFn: async ({
      endpointId,
      groupId,
    }: {
      endpointId: string;
      groupId: string;
    }) => {
      const { data, error } = await supabase
        .from("endpoint_group_memberships")
        .insert({
          endpoint_id: endpointId,
          group_id: groupId,
        })
        .select()
        .single();

      if (error) throw error;

      if (currentOrganization) {
        await supabase.rpc("log_activity", {
          _org_id: currentOrganization.id,
          _action: "endpoint_added_to_group",
          _resource_type: "endpoint_group_membership",
          _resource_id: data.id,
          _details: { endpoint_id: endpointId, group_id: groupId },
          _endpoint_id: endpointId,
        });
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["endpoint-groups"] });
      queryClient.invalidateQueries({ queryKey: ["endpoint-group-memberships"] });
      queryClient.invalidateQueries({ queryKey: ["group-members"] });
    },
    onError: (error) => {
      toast({
        title: "Failed to add endpoint to group",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useRemoveEndpointFromGroup() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { currentOrganization } = useTenant();

  return useMutation({
    mutationFn: async ({
      endpointId,
      groupId,
    }: {
      endpointId: string;
      groupId: string;
    }) => {
      const { error } = await supabase
        .from("endpoint_group_memberships")
        .delete()
        .eq("endpoint_id", endpointId)
        .eq("group_id", groupId);

      if (error) throw error;

      if (currentOrganization) {
        await supabase.rpc("log_activity", {
          _org_id: currentOrganization.id,
          _action: "endpoint_removed_from_group",
          _resource_type: "endpoint_group_membership",
          _details: { endpoint_id: endpointId, group_id: groupId },
          _endpoint_id: endpointId,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["endpoint-groups"] });
      queryClient.invalidateQueries({ queryKey: ["endpoint-group-memberships"] });
      queryClient.invalidateQueries({ queryKey: ["group-members"] });
    },
    onError: (error) => {
      toast({
        title: "Failed to remove endpoint from group",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useBulkAddEndpointsToGroup() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { currentOrganization } = useTenant();

  return useMutation({
    mutationFn: async ({
      endpointIds,
      groupId,
    }: {
      endpointIds: string[];
      groupId: string;
    }) => {
      const memberships = endpointIds.map((endpointId) => ({
        endpoint_id: endpointId,
        group_id: groupId,
      }));

      const { error } = await supabase
        .from("endpoint_group_memberships")
        .upsert(memberships, { onConflict: "endpoint_id,group_id" });

      if (error) throw error;

      if (currentOrganization) {
        await supabase.rpc("log_activity", {
          _org_id: currentOrganization.id,
          _action: "bulk_endpoints_added_to_group",
          _resource_type: "endpoint_group",
          _resource_id: groupId,
          _details: { endpoint_count: endpointIds.length },
        });
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["endpoint-groups"] });
      queryClient.invalidateQueries({ queryKey: ["endpoint-group-memberships"] });
      queryClient.invalidateQueries({ queryKey: ["group-members"] });
      toast({
        title: "Endpoints added",
        description: `${variables.endpointIds.length} endpoint(s) added to the group.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to add endpoints",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
