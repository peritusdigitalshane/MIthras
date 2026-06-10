import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useTenant } from "@/contexts/TenantContext";

export interface ActivityLog {
  id: string;
  organization_id: string;
  user_id: string | null;
  endpoint_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: Json | null;
  ip_address: string | null;
  created_at: string;
  profiles?: { display_name: string | null; email: string } | null;
  endpoints?: { hostname: string } | null;
}

export function useActivityLogs() {
  // Belt-and-braces tenant scoping. Without this, the super-admin RLS
  // policy explicitly grants all rows, so the Activity Log page for any
  // selected customer org returned interleaved logs from every
  // organization — operationally confusing and a CLAUDE.md violation.
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id ?? null;

  return useQuery({
    queryKey: ["activity-logs", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_logs")
        .select(`
          *,
          profiles:user_id(display_name, email),
          endpoints:endpoint_id(hostname)
        `)
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false })
        .limit(500);

      if (error) throw error;
      return data as ActivityLog[];
    },
  });
}

export async function logActivity(
  orgId: string,
  action: string,
  resourceType: string,
  resourceId?: string,
  details?: Json,
  endpointId?: string
) {
  const { error } = await supabase.rpc("log_activity", {
    _org_id: orgId,
    _action: action,
    _resource_type: resourceType,
    _resource_id: resourceId || null,
    _details: details || null,
    _endpoint_id: endpointId || null,
  });

  if (error) {
    console.error("Failed to log activity:", error);
  }
}
