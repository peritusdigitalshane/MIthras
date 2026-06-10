import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";

export type Severity = "low" | "moderate" | "high" | "severe";

export interface AlertRecipient {
  id: string;
  organization_id: string;
  email: string;
  name: string | null;
  role_label: string | null;
  min_severity: Severity;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export function useAlertRecipients() {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id ?? null;
  return useQuery({
    queryKey: ["org-alert-recipients", orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<AlertRecipient[]> => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("org_alert_recipients")
        .select("*")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as AlertRecipient[];
    },
  });
}

export function useAddAlertRecipient() {
  const qc = useQueryClient();
  const { currentOrganization } = useTenant();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (input: {
      email: string;
      name?: string;
      role_label?: string;
      min_severity?: Severity;
    }) => {
      if (!currentOrganization?.id) throw new Error("No organisation selected");
      const { data, error } = await supabase
        .from("org_alert_recipients")
        .insert({
          organization_id: currentOrganization.id,
          email: input.email.trim().toLowerCase(),
          name: input.name?.trim() || null,
          role_label: input.role_label?.trim() || null,
          min_severity: input.min_severity ?? "high",
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as AlertRecipient;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org-alert-recipients"] });
      toast({ title: "Alert recipient added" });
    },
    onError: (e: Error) =>
      toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
}

export function useUpdateAlertRecipient() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string } & Partial<AlertRecipient>) => {
      const { error } = await supabase.from("org_alert_recipients").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org-alert-recipients"] }),
    onError: (e: Error) =>
      toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });
}

export function useDeleteAlertRecipient() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("org_alert_recipients").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org-alert-recipients"] });
      toast({ title: "Recipient removed" });
    },
    onError: (e: Error) =>
      toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });
}
