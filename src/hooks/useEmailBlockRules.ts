import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";

export type EmailBlockRuleKind   = "sender_email" | "sender_domain" | "subject_regex";
export type EmailBlockRuleAction = "quarantine" | "warn" | "drop";

export interface EmailBlockRule {
  id: string;
  organization_id: string;
  kind: EmailBlockRuleKind;
  value: string;
  action: EmailBlockRuleAction;
  reason: string | null;
  enabled: boolean;
  hit_count: number;
  last_hit_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export function useEmailBlockRules() {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;
  return useQuery({
    queryKey: ["email-block-rules", orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<EmailBlockRule[]> => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("email_block_rules")
        .select("*")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as EmailBlockRule[];
    },
  });
}

export function useCreateEmailBlockRule() {
  const qc = useQueryClient();
  const { currentOrganization } = useTenant();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (args: {
      kind: EmailBlockRuleKind;
      value: string;
      action: EmailBlockRuleAction;
      reason?: string | null;
    }) => {
      if (!currentOrganization?.id) throw new Error("No organization selected");
      const { data: user } = await supabase.auth.getUser();
      const { error } = await supabase.from("email_block_rules").insert({
        organization_id: currentOrganization.id,
        kind: args.kind,
        value: args.value,
        action: args.action,
        reason: args.reason ?? null,
        created_by: user.user?.id ?? null,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email-block-rules"] });
      toast({ title: "Rule added" });
    },
    onError: (e: any) => {
      const msg = String(e?.message ?? "");
      const friendly = msg.includes("email_block_rules_organization_id_kind_value_key")
        ? "A rule with that kind + value already exists for this organisation."
        : msg.includes("violates check constraint")
        ? "Pick a valid rule kind and action."
        : msg || "Couldn't save the rule.";
      toast({ title: "Couldn't add rule", description: friendly, variant: "destructive" });
    },
  });
}

export function useUpdateEmailBlockRule() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (args: { id: string; patch: Partial<Pick<EmailBlockRule, "action" | "reason" | "enabled">> }) => {
      const { error } = await supabase.from("email_block_rules").update(args.patch as any).eq("id", args.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email-block-rules"] });
      toast({ title: "Rule updated" });
    },
    onError: (e: any) => toast({ title: "Couldn't update rule", description: e?.message ?? "Unknown", variant: "destructive" }),
  });
}

export function useDeleteEmailBlockRule() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("email_block_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email-block-rules"] });
      toast({ title: "Rule deleted" });
    },
    onError: (e: any) => toast({ title: "Couldn't delete rule", description: e?.message ?? "Unknown", variant: "destructive" }),
  });
}
