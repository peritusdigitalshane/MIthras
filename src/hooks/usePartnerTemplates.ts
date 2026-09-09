import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useResellerOrgId } from "@/hooks/useReseller";
import { useToast } from "@/hooks/use-toast";

export interface PartnerPolicyTemplate {
  id: string;
  owner_org_id: string;
  name: string;
  description: string | null;
  defender_policy: Record<string, unknown> | null;
  windows_update_policy: Record<string, unknown> | null;
  update_ring: Record<string, unknown> | null;
  is_archived: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// All templates this partner owns.
export function usePartnerTemplates() {
  const orgId = useResellerOrgId();
  return useQuery({
    queryKey: ["partner-policy-templates", orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<PartnerPolicyTemplate[]> => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("partner_policy_templates")
        .select("*")
        .eq("owner_org_id", orgId)
        .eq("is_archived", false)
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as PartnerPolicyTemplate[];
    },
  });
}

// Snapshot a customer endpoint_group's policies into a new template owned
// by the partner above that customer. p_group_id is the source group.
export function useCreateTemplateFromGroup() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (args: { groupId: string; name: string; description?: string }) => {
      const { data, error } = await supabase.rpc("create_partner_template_from_group", {
        p_group_id: args.groupId,
        p_template_name: args.name,
        p_description: args.description ?? null,
      } as any);
      if (error) throw error;
      return data as string; // returned template_id
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["partner-policy-templates"] });
      toast({ title: "Template saved", description: "You can apply it to any of your customers from this page." });
    },
    onError: (e: any) => {
      toast({
        title: "Couldn't save template",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });
}

// Apply one template to one customer. Optionally promote the new policies
// to defaults for that customer.
export function useApplyTemplateToCustomer() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (args: { templateId: string; customerOrgId: string; makeDefault: boolean }) => {
      const { data, error } = await supabase.rpc("apply_partner_template_to_customer", {
        p_template_id: args.templateId,
        p_customer_org_id: args.customerOrgId,
        p_make_default: args.makeDefault,
      } as any);
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["policies", vars.customerOrgId] });
      qc.invalidateQueries({ queryKey: ["windows-update-policies", vars.customerOrgId] });
      qc.invalidateQueries({ queryKey: ["update-rings", vars.customerOrgId] });
      toast({ title: "Template applied", description: vars.makeDefault ? "New defaults set for this customer." : "Template policies added to the customer." });
    },
    onError: (e: any) => {
      toast({
        title: "Couldn't apply template",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });
}

// Bulk apply to many customers in one call.
export function useApplyTemplateToCustomers() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (args: { templateId: string; customerOrgIds: string[]; makeDefault: boolean }) => {
      const { data, error } = await supabase.rpc("apply_partner_template_to_customers", {
        p_template_id: args.templateId,
        p_customer_ids: args.customerOrgIds,
        p_make_default: args.makeDefault,
      } as any);
      if (error) throw error;
      return data as { applied: number; failed: number; results: unknown[]; failures: { customer_org_id: string; error: string }[] };
    },
    onSuccess: (res, vars) => {
      for (const cid of vars.customerOrgIds) {
        qc.invalidateQueries({ queryKey: ["policies", cid] });
        qc.invalidateQueries({ queryKey: ["windows-update-policies", cid] });
        qc.invalidateQueries({ queryKey: ["update-rings", cid] });
      }
      const failed = res?.failed ?? 0;
      toast({
        title: failed === 0 ? "Template applied to all customers" : `Applied to ${res.applied}, ${failed} failed`,
        description: failed === 0
          ? `${res.applied} customer${res.applied === 1 ? "" : "s"} updated.`
          : `Check the failures list for details.`,
        variant: failed === 0 ? "default" : "destructive",
      });
    },
    onError: (e: any) => {
      toast({
        title: "Bulk apply failed",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });
}

export function useDeletePartnerTemplate() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (templateId: string) => {
      const { error } = await supabase.from("partner_policy_templates").delete().eq("id", templateId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["partner-policy-templates"] });
      toast({ title: "Template deleted" });
    },
    onError: (e: any) => {
      toast({
        title: "Couldn't delete template",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });
}
