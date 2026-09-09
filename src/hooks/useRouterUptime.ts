import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface RouterUptimeStats {
  uptime_percent: number | null;
  total_downtime_minutes: number | null;
  last_offline_at: string | null;
  last_online_at: string | null;
  current_session_start: string | null;
}

export function useRouterUptime(routerId: string | undefined, days = 30) {
  return useQuery({
    queryKey: ["router-uptime", routerId, days],
    enabled: !!routerId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_router_uptime_stats", {
        _router_id: routerId!,
        _days: days,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row as RouterUptimeStats) ?? null;
    },
    staleTime: 30_000,
  });
}

export function useRouterUptimeBatch(routerIds: string[], days = 30) {
  return useQuery({
    queryKey: ["router-uptime-batch", routerIds, days],
    enabled: routerIds.length > 0,
    queryFn: async () => {
      const results: Record<string, RouterUptimeStats> = {};
      // Fetch in parallel
      await Promise.all(
        routerIds.map(async (id) => {
          const { data, error } = await supabase.rpc("get_router_uptime_stats", {
            _router_id: id,
            _days: days,
          });
          if (!error && data) {
            const row = Array.isArray(data) ? data[0] : data;
            if (row) results[id] = row as RouterUptimeStats;
          }
        })
      );
      return results;
    },
    staleTime: 30_000,
  });
}
