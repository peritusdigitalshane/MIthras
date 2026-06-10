import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AgentUpdateLogRow {
  id: string;
  endpoint_id: string;
  organization_id: string;
  from_version: string | null;
  to_version: string;
  channel: string;
  trigger: string;
  status: "started" | "downloaded" | "verified" | "swap_pending" | "completed" | "failed";
  error_message: string | null;
  download_url: string | null;
  download_sha256: string | null;
  bytes_downloaded: number | null;
  duration_ms: number | null;
  detected_at: string;
  completed_at: string | null;
  created_at: string;
}

/** Audit trail of every agent version transition for one endpoint, newest first. */
export function useAgentUpdateLog(endpointId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-update-log", endpointId],
    enabled: !!endpointId,
    queryFn: async () => {
      if (!endpointId) return [];
      const { data, error } = await supabase
        .from("agent_update_log")
        .select("*")
        .eq("endpoint_id", endpointId)
        .order("detected_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as AgentUpdateLogRow[];
    },
    refetchInterval: 60_000,
  });
}
