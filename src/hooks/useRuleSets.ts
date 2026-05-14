import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { logActivity } from "@/hooks/useActivityLogs";

export interface RuleSet {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  mode: "audit" | "enforced";
  created_at: string;
  updated_at: string;
  created_by: string | null;
  rule_count?: number;
  // App-Control Phase 1 columns (added 2026-05-15)
  audit_window_days: number;
  auto_promote: boolean;
  policy_version: number;
  feature_enabled: boolean;
}

export interface RuleSetRule {
  id: string;
  rule_set_id: string;
  rule_type: "publisher" | "path" | "hash" | "file_name";
  action: "allow" | "block";
  value: string;
  publisher_name: string | null;
  product_name: string | null;
  file_version_min: string | null;
  description: string | null;
  created_at: string;
  created_by: string | null;
}

export interface RuleSetBasic {
  id: string;
  name: string;
  description: string | null;
}

export interface EndpointRuleSetAssignment {
  id: string;
  endpoint_id: string;
  rule_set_id: string;
  priority: number;
  assigned_at: string;
  rule_set?: RuleSetBasic;
}

export interface GroupRuleSetAssignment {
  id: string;
  group_id: string;
  rule_set_id: string;
  priority: number;
  assigned_at: string;
  rule_set?: RuleSetBasic;
}

// Fetch all rule sets for the organization
export function useRuleSets() {
  const { currentOrganization } = useTenant();

  return useQuery({
    queryKey: ["rule-sets", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization?.id) return [];
      
      const { data, error } = await supabase
        .from("wdac_rule_sets")
        .select(`
          *,
          wdac_rule_set_rules(id)
        `)
        .eq("organization_id", currentOrganization.id)
        .order("name");

      if (error) throw error;
      
      return (data || []).map(rs => ({
        ...rs,
        rule_count: rs.wdac_rule_set_rules?.length || 0,
      })) as RuleSet[];
    },
    enabled: !!currentOrganization?.id,
  });
}

// Fetch all rules across all rule sets for an organization (for status indicators)
export function useAllRuleSetRules(ruleSetIds: string[]) {
  return useQuery({
    queryKey: ["all-rule-set-rules", ruleSetIds],
    queryFn: async () => {
      if (!ruleSetIds.length) return [];
      
      const { data, error } = await supabase
        .from("wdac_rule_set_rules")
        .select("*, wdac_rule_sets(name)")
        .in("rule_set_id", ruleSetIds);

      if (error) throw error;
      return (data || []).map(r => ({
        ...r,
        rule_set_name: (r as any).wdac_rule_sets?.name || "Unknown",
      }));
    },
    enabled: ruleSetIds.length > 0,
  });
}

// Fetch rules for a specific rule set
export function useRuleSetRules(ruleSetId: string | null) {
  return useQuery({
    queryKey: ["rule-set-rules", ruleSetId],
    queryFn: async () => {
      if (!ruleSetId) return [];
      
      const { data, error } = await supabase
        .from("wdac_rule_set_rules")
        .select("*")
        .eq("rule_set_id", ruleSetId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as RuleSetRule[];
    },
    enabled: !!ruleSetId,
  });
}

// Fetch rule set assignments for an endpoint
export function useEndpointRuleSetAssignments(endpointId: string | null) {
  return useQuery({
    queryKey: ["endpoint-rule-set-assignments", endpointId],
    queryFn: async () => {
      if (!endpointId) return [];
      
      const { data, error } = await supabase
        .from("endpoint_rule_set_assignments")
        .select(`
          *,
          wdac_rule_sets(id, name, description)
        `)
        .eq("endpoint_id", endpointId)
        .order("priority", { ascending: false });

      if (error) throw error;
      return (data || []).map(a => ({
        ...a,
        rule_set: a.wdac_rule_sets,
      })) as EndpointRuleSetAssignment[];
    },
    enabled: !!endpointId,
  });
}

// Fetch rule set assignments for a group
export function useGroupRuleSetAssignments(groupId: string | null) {
  return useQuery({
    queryKey: ["group-rule-set-assignments", groupId],
    queryFn: async () => {
      if (!groupId) return [];
      
      const { data, error } = await supabase
        .from("group_rule_set_assignments")
        .select(`
          *,
          wdac_rule_sets(id, name, description)
        `)
        .eq("group_id", groupId)
        .order("priority", { ascending: false });

      if (error) throw error;
      return (data || []).map(a => ({
        ...a,
        rule_set: a.wdac_rule_sets,
      })) as GroupRuleSetAssignment[];
    },
    enabled: !!groupId,
  });
}

// Mutations
export function useRuleSetMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { currentOrganization } = useTenant();

  const createRuleSet = useMutation({
    mutationFn: async (data: { name: string; description?: string; mode?: "audit" | "enforced" }) => {
      const { data: result, error } = await supabase
        .from("wdac_rule_sets")
        .insert({
          organization_id: currentOrganization!.id,
          name: data.name,
          description: data.description,
          mode: data.mode || "audit",
        })
        .select()
        .single();

      if (error) throw error;
      return result;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["rule-sets"] });
      logActivity(currentOrganization!.id, "create", "rule_set", data.id, {
        rule_set_name: data.name,
      });
      toast({ title: "Rule set created" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create rule set", description: error.message, variant: "destructive" });
    },
  });

  const updateRuleSet = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; name?: string; description?: string; mode?: "audit" | "enforced" }) => {
      const { data, error } = await supabase
        .from("wdac_rule_sets")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["rule-sets"] });
      logActivity(currentOrganization!.id, "update", "rule_set", data.id, {
        rule_set_name: data.name,
      });
      toast({ title: "Rule set updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update rule set", description: error.message, variant: "destructive" });
    },
  });

  const deleteRuleSet = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("wdac_rule_sets").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["rule-sets"] });
      logActivity(currentOrganization!.id, "delete", "rule_set", id);
      toast({ title: "Rule set deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete rule set", description: error.message, variant: "destructive" });
    },
  });

  const addRule = useMutation({
    mutationFn: async (rule: Omit<RuleSetRule, "id" | "created_at" | "created_by">) => {
      const { data, error } = await supabase
        .from("wdac_rule_set_rules")
        .insert(rule)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["rule-set-rules", data.rule_set_id] });
      queryClient.invalidateQueries({ queryKey: ["rule-sets"] });
      toast({ title: "Rule added" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add rule", description: error.message, variant: "destructive" });
    },
  });

  const addRulesBulk = useMutation({
    mutationFn: async (rules: Omit<RuleSetRule, "id" | "created_at" | "created_by">[]) => {
      const { data, error } = await supabase
        .from("wdac_rule_set_rules")
        .insert(rules)
        .select();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      if (data?.[0]?.rule_set_id) {
        queryClient.invalidateQueries({ queryKey: ["rule-set-rules", data[0].rule_set_id] });
      }
      queryClient.invalidateQueries({ queryKey: ["rule-sets"] });
      toast({ title: `${data?.length || 0} rules added` });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add rules", description: error.message, variant: "destructive" });
    },
  });

  const deleteRule = useMutation({
    mutationFn: async ({ id, ruleSetId }: { id: string; ruleSetId: string }) => {
      const { error } = await supabase.from("wdac_rule_set_rules").delete().eq("id", id);
      if (error) throw error;
      return { id, ruleSetId };
    },
    onSuccess: ({ ruleSetId }) => {
      queryClient.invalidateQueries({ queryKey: ["rule-set-rules", ruleSetId] });
      queryClient.invalidateQueries({ queryKey: ["rule-sets"] });
      toast({ title: "Rule deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete rule", description: error.message, variant: "destructive" });
    },
  });

  const assignToEndpoint = useMutation({
    mutationFn: async ({ endpointId, ruleSetId, priority = 0 }: { endpointId: string; ruleSetId: string; priority?: number }) => {
      const { data, error } = await supabase
        .from("endpoint_rule_set_assignments")
        .insert({ endpoint_id: endpointId, rule_set_id: ruleSetId, priority })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["endpoint-rule-set-assignments", data.endpoint_id] });
      toast({ title: "Rule set assigned to endpoint" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to assign rule set", description: error.message, variant: "destructive" });
    },
  });

  const removeFromEndpoint = useMutation({
    mutationFn: async ({ endpointId, ruleSetId }: { endpointId: string; ruleSetId: string }) => {
      const { error } = await supabase
        .from("endpoint_rule_set_assignments")
        .delete()
        .eq("endpoint_id", endpointId)
        .eq("rule_set_id", ruleSetId);

      if (error) throw error;
      return { endpointId, ruleSetId };
    },
    onSuccess: ({ endpointId }) => {
      queryClient.invalidateQueries({ queryKey: ["endpoint-rule-set-assignments", endpointId] });
      toast({ title: "Rule set removed from endpoint" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove rule set", description: error.message, variant: "destructive" });
    },
  });

  const assignToGroup = useMutation({
    mutationFn: async ({ groupId, ruleSetId, priority = 0 }: { groupId: string; ruleSetId: string; priority?: number }) => {
      const { data, error } = await supabase
        .from("group_rule_set_assignments")
        .insert({ group_id: groupId, rule_set_id: ruleSetId, priority })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["group-rule-set-assignments", data.group_id] });
      toast({ title: "Rule set assigned to group" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to assign rule set", description: error.message, variant: "destructive" });
    },
  });

  const removeFromGroup = useMutation({
    mutationFn: async ({ groupId, ruleSetId }: { groupId: string; ruleSetId: string }) => {
      const { error } = await supabase
        .from("group_rule_set_assignments")
        .delete()
        .eq("group_id", groupId)
        .eq("rule_set_id", ruleSetId);

      if (error) throw error;
      return { groupId, ruleSetId };
    },
    onSuccess: ({ groupId }) => {
      queryClient.invalidateQueries({ queryKey: ["group-rule-set-assignments", groupId] });
      toast({ title: "Rule set removed from group" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove rule set", description: error.message, variant: "destructive" });
    },
  });

  return {
    createRuleSet,
    updateRuleSet,
    deleteRuleSet,
    addRule,
    addRulesBulk,
    deleteRule,
    assignToEndpoint,
    removeFromEndpoint,
    assignToGroup,
    removeFromGroup,
  };
}
