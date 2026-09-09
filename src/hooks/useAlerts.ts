import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface Alert {
  id: string;
  organization_id: string;
  endpoint_id: string | null;
  alert_type: string;
  severity: string;
  title: string;
  message: string;
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  created_at: string;
  endpoints?: { hostname: string } | null;
}

export function useAlerts() {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;

  return useQuery({
    queryKey: ["alerts", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alerts")
        .select(`*, endpoints(hostname)`)
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      return (data ?? []) as unknown as Alert[];
    },
    refetchInterval: 30000,
  });
}

export function useUnacknowledgedAlertCount() {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;

  return useQuery({
    queryKey: ["alert-count", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("alerts")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId!)
        .eq("acknowledged", false);

      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 30000,
  });
}

export function useAcknowledgeAlert() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (alertId: string) => {
      const { data: user } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("alerts")
        .update({
          acknowledged: true,
          acknowledged_by: user.user?.id,
          acknowledged_at: new Date().toISOString(),
        })
        .eq("id", alertId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      queryClient.invalidateQueries({ queryKey: ["alert-count"] });
    },
  });
}

export function useBulkAcknowledgeAlerts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (alertIds: string[]) => {
      const { data: user } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("alerts")
        .update({
          acknowledged: true,
          acknowledged_by: user.user?.id,
          acknowledged_at: new Date().toISOString(),
        })
        .in("id", alertIds);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      queryClient.invalidateQueries({ queryKey: ["alert-count"] });
    },
  });
}
