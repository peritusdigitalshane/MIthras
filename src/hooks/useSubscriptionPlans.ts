import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export type SubscriptionPlan = "free" | "pro" | "business";

export interface PlanFeatures {
  id: string;
  plan: SubscriptionPlan;
  max_devices: number | null;
  ai_security_advisor: boolean;
  compliance_reporting: boolean;
  advanced_threat_analytics: boolean;
  custom_policies: boolean;
  priority_support: boolean;
  api_access: boolean;
}

export function usePlanFeatures() {
  return useQuery({
    queryKey: ["plan-features"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plan_features")
        .select("*")
        .order("plan");

      if (error) throw error;
      return data as PlanFeatures[];
    },
  });
}

export function useCurrentOrgPlan() {
  const { currentOrganization } = useTenant();

  return useQuery({
    queryKey: ["org-plan", currentOrganization?.id],
    enabled: !!currentOrganization?.id,
    queryFn: async () => {
      // Get effective plan using RPC
      const { data: effectivePlan, error: planError } = await supabase
        .rpc("get_effective_plan", { _org_id: currentOrganization!.id });

      if (planError) throw planError;

      // Get plan features
      const { data: features, error: featuresError } = await supabase
        .from("plan_features")
        .select("*")
        .eq("plan", effectivePlan)
        .single();

      if (featuresError) throw featuresError;

      return {
        plan: effectivePlan as SubscriptionPlan,
        features: features as PlanFeatures,
        isPartnerManaged: !!currentOrganization?.parent_partner_id,
      };
    },
  });
}

export function useUpdateOrgPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ orgId, plan }: { orgId: string; plan: SubscriptionPlan }) => {
      const { error } = await supabase
        .from("organizations")
        .update({ subscription_plan: plan })
        .eq("id", orgId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-plan"] });
      queryClient.invalidateQueries({ queryKey: ["admin-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["admin-organizations-with-stats"] });
    },
  });
}

export function useCanAddDevice() {
  const { currentOrganization } = useTenant();

  return useQuery({
    queryKey: ["can-add-device", currentOrganization?.id],
    enabled: !!currentOrganization?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc("can_add_device", { _org_id: currentOrganization!.id });

      if (error) throw error;
      return data as boolean;
    },
  });
}
