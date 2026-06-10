import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type CommandType =
  | "isolate_network"
  | "release_isolation"
  | "kill_process"
  | "quarantine_file"
  | "run_quick_scan"
  | "run_full_scan"
  | "collect_persistence"
  | "restart_agent"
  | "emergency_unlock"
  | "upgrade_agent"
  | "install_mesh_agent"
  | "uninstall_mesh_agent";

export type CommandStatus = "queued" | "dispatched" | "succeeded" | "failed" | "expired" | "cancelled";

export interface AgentCommand {
  id: string;
  endpoint_id: string;
  organization_id: string;
  command_type: CommandType;
  params: Record<string, unknown>;
  status: CommandStatus;
  issued_by: string | null;
  issued_at: string;
  dispatched_at: string | null;
  completed_at: string | null;
  expires_at: string;
  result: Record<string, unknown> | null;
  error_message: string | null;
  correlation_id: string | null;
  incident_id: string | null;
}

export function useAgentCommands(endpointId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-commands", endpointId],
    enabled: !!endpointId,
    queryFn: async (): Promise<AgentCommand[]> => {
      const { data, error } = await supabase
        .from("agent_commands")
        .select("*")
        .eq("endpoint_id", endpointId!)
        .order("issued_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as AgentCommand[];
    },
    refetchInterval: 10_000,
  });
}

export function useEnqueueAgentCommand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      endpointId: string;
      commandType: CommandType;
      params?: Record<string, unknown>;
      incidentId?: string | null;
    }) => {
      const { data, error } = await supabase.rpc("enqueue_agent_command", {
        p_endpoint_id: args.endpointId,
        p_command_type: args.commandType,
        p_params: args.params ?? {},
        p_incident_id: args.incidentId ?? null,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (_, args) => {
      qc.invalidateQueries({ queryKey: ["agent-commands", args.endpointId] });
    },
  });
}
