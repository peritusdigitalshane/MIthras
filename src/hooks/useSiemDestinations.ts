import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";

export type SiemKind = "webhook" | "syslog_https" | "splunk_hec" | "sentinel_la" | "elastic_http";
export type SiemFormat = "json" | "cef" | "leef";

export interface SiemDestination {
  id: string;
  organization_id: string;
  name: string;
  kind: SiemKind;
  format: SiemFormat;
  endpoint_url: string;
  auth_token: string | null;
  extra: Record<string, unknown>;
  event_categories: string[];
  enabled: boolean;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface SiemDestinationInput {
  name: string;
  kind: SiemKind;
  format: SiemFormat;
  endpoint_url: string;
  auth_token?: string | null;
  extra?: Record<string, unknown>;
  event_categories: string[];
  enabled: boolean;
}

export interface OutboxRow {
  id: string;
  organization_id: string;
  destination_id: string;
  category: string;
  source_table: string;
  source_id: string | null;
  severity: string | null;
  payload: Record<string, unknown>;
  status: "pending" | "sent" | "failed_permanent";
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
  delivered_at: string | null;
}

export function useSiemDestinations() {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;
  return useQuery({
    queryKey: ["siem-destinations", orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<SiemDestination[]> => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("siem_destinations")
        .select("*")
        .eq("organization_id", orgId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as SiemDestination[];
    },
  });
}

export function useSiemOutboxRecent(destId: string | null) {
  return useQuery({
    queryKey: ["siem-outbox", destId],
    enabled: !!destId,
    queryFn: async (): Promise<OutboxRow[]> => {
      if (!destId) return [];
      const { data, error } = await supabase
        .from("event_outbox")
        .select("*")
        .eq("destination_id", destId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as OutboxRow[];
    },
  });
}

export function useUpsertSiemDestination() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { currentOrganization } = useTenant();
  return useMutation({
    mutationFn: async (args: { id?: string; values: SiemDestinationInput }) => {
      if (!currentOrganization?.id) throw new Error("No organisation selected");
      if (args.id) {
        const { error } = await supabase
          .from("siem_destinations")
          .update(args.values as any)
          .eq("id", args.id);
        if (error) throw error;
        return args.id;
      } else {
        const { data, error } = await supabase
          .from("siem_destinations")
          .insert({ ...args.values, organization_id: currentOrganization.id } as any)
          .select("id")
          .single();
        if (error) throw error;
        return (data as any).id as string;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["siem-destinations"] });
      toast({ title: "SIEM destination saved" });
    },
    onError: (e: any) => {
      toast({
        title: "Couldn't save destination",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });
}

export function useDeleteSiemDestination() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("siem_destinations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["siem-destinations"] });
      qc.invalidateQueries({ queryKey: ["siem-outbox"] });
      toast({ title: "Destination removed", description: "Any pending events for that destination will not be delivered." });
    },
    onError: (e: any) => {
      toast({
        title: "Couldn't remove destination",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });
}

// Posts a synthetic test event into the outbox so the forwarder will pick
// it up on the next cron tick. Useful for "Send test event" from the UI.
export function useSendTestEvent() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { currentOrganization } = useTenant();
  return useMutation({
    mutationFn: async (destId: string) => {
      if (!currentOrganization?.id) throw new Error("No organisation selected");
      const { error } = await supabase.from("event_outbox").insert({
        organization_id: currentOrganization.id,
        destination_id:  destId,
        category:        "test",
        source_table:    "console_test",
        source_id:       null,
        severity:        "low",
        payload: {
          message: "Mithras SIEM connectivity test",
          sent_by: "console",
          sent_at: new Date().toISOString(),
        },
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["siem-outbox"] });
      toast({ title: "Test event queued", description: "It'll ship on the next forwarder tick (≤60 seconds)." });
    },
    onError: (e: any) => {
      toast({ title: "Couldn't queue test event", description: e?.message ?? "Unknown error", variant: "destructive" });
    },
  });
}
