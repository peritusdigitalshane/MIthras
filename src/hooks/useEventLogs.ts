import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface EndpointEventLog {
  id: string;
  endpoint_id: string;
  event_id: number;
  log_source: string;
  level: string;
  message: string;
  event_time: string;
  provider_name: string | null;
  task_category: string | null;
  raw_data: Record<string, unknown> | null;
  created_at: string;
  endpoints?: {
    hostname: string;
    organization_id: string;
    policy_id: string | null;
  };
}

export function useEventLogs(limit = 100) {
  const { currentOrganization } = useTenant();
  
  return useQuery({
    queryKey: ["event-logs", limit, currentOrganization?.id],
    queryFn: async () => {
      let query = supabase
        .from("endpoint_event_logs")
        .select(`
          *,
          endpoints!inner(hostname, organization_id, policy_id)
        `)
        .order("event_time", { ascending: false })
        .limit(limit);

      // Filter by current organization if set
      if (currentOrganization?.id) {
        query = query.eq("endpoints.organization_id", currentOrganization.id);
      }

      const { data, error } = await query;

      if (error) throw error;
      return (data ?? []) as EndpointEventLog[];
    },
    enabled: !!currentOrganization?.id,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
    staleTime: 10000,
  });
}
