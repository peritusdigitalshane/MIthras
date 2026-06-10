import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface SysmonEvent {
  id: string;
  organization_id: string;
  endpoint_id: string;
  event_time: string;
  event_id: number;

  user_name: string | null;
  // Process (event 1)
  process_guid: string | null;
  process_id: number | null;
  parent_process_guid: string | null;
  parent_process_id: number | null;
  image: string | null;
  parent_image: string | null;
  command_line: string | null;
  parent_command_line: string | null;
  current_directory: string | null;
  hashes: Record<string, string> | null;
  integrity_level: string | null;
  // Network (event 3)
  protocol: string | null;
  initiated: boolean | null;
  source_ip: string | null;
  source_port: number | null;
  destination_ip: string | null;
  destination_port: number | null;
  destination_hostname: string | null;
  // File (event 11)
  target_filename: string | null;

  endpoint?: { hostname: string };
}

export interface SysmonFilters {
  endpointId?: string;
  eventId?: number;
  image?: string;
  search?: string; // matches command_line, image, target_filename, dest IP/host
  limit?: number;
  since?: string;
}

export function useSysmonEvents(filters: SysmonFilters = {}) {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id ?? null;

  return useQuery({
    queryKey: ["sysmon-events", orgId, filters],
    enabled: !!orgId,
    queryFn: async (): Promise<SysmonEvent[]> => {
      if (!orgId) return [];
      let q = supabase
        .from("sysmon_events")
        .select(`
          id, organization_id, endpoint_id, event_time, event_id,
          user_name,
          process_guid, process_id, parent_process_guid, parent_process_id,
          image, parent_image, command_line, parent_command_line,
          current_directory, hashes, integrity_level,
          protocol, initiated, source_ip, source_port,
          destination_ip, destination_port, destination_hostname,
          target_filename,
          endpoint:endpoints(hostname)
        `)
        .eq("organization_id", orgId)
        .order("event_time", { ascending: false });

      if (filters.endpointId) q = q.eq("endpoint_id", filters.endpointId);
      if (filters.eventId)    q = q.eq("event_id", filters.eventId);
      if (filters.image)      q = q.ilike("image", `%${filters.image}%`);
      if (filters.since)      q = q.gte("event_time", filters.since);
      if (filters.search) {
        const term = `%${filters.search}%`;
        q = q.or(
          `image.ilike.${term},command_line.ilike.${term},target_filename.ilike.${term},destination_ip.ilike.${term},destination_hostname.ilike.${term}`,
        );
      }
      q = q.limit(filters.limit ?? 200);

      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as SysmonEvent[];
    },
  });
}

export interface SysmonSummary {
  total: number;
  process_create: number;
  network_connect: number;
  file_create: number;
  endpoints_reporting: number;
}

export function useSysmonSummary(since?: string) {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id ?? null;

  return useQuery({
    queryKey: ["sysmon-summary", orgId, since],
    enabled: !!orgId,
    queryFn: async (): Promise<SysmonSummary> => {
      if (!orgId) return { total: 0, process_create: 0, network_connect: 0, file_create: 0, endpoints_reporting: 0 };
      const cutoff = since ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString();

      const [allCount, p, n, f, endpoints] = await Promise.all([
        supabase.from("sysmon_events").select("id", { count: "exact", head: true })
          .eq("organization_id", orgId).gte("event_time", cutoff),
        supabase.from("sysmon_events").select("id", { count: "exact", head: true })
          .eq("organization_id", orgId).eq("event_id", 1).gte("event_time", cutoff),
        supabase.from("sysmon_events").select("id", { count: "exact", head: true })
          .eq("organization_id", orgId).eq("event_id", 3).gte("event_time", cutoff),
        supabase.from("sysmon_events").select("id", { count: "exact", head: true })
          .eq("organization_id", orgId).eq("event_id", 11).gte("event_time", cutoff),
        supabase.from("sysmon_events").select("endpoint_id")
          .eq("organization_id", orgId).gte("event_time", cutoff).limit(10000),
      ]);

      const uniqueEndpoints = new Set(
        (endpoints.data ?? []).map((r: Record<string, unknown>) => String(r.endpoint_id)),
      );

      return {
        total:               allCount.count ?? 0,
        process_create:      p.count ?? 0,
        network_connect:     n.count ?? 0,
        file_create:         f.count ?? 0,
        endpoints_reporting: uniqueEndpoints.size,
      };
    },
  });
}
