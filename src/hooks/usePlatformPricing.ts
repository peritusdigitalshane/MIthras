import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PricingDefault {
  tier: "distributor" | "partner" | "customer";
  wholesale_price_cents: number;
  currency_code: string;
  description: string | null;
  updated_at: string;
}

export interface OrgPricingRow {
  id: string;
  name: string;
  slug: string;
  organization_type: "distributor" | "partner" | "customer";
  parent_partner_id: string | null;
  override_price_cents: number | null;
  tier_default_cents: number | null;
  effective_price_cents: number;
  currency_code: string;
  is_active: boolean;
}

export function usePricingDefaults() {
  return useQuery({
    queryKey: ["platform-pricing-defaults"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_pricing_defaults")
        .select("*")
        .order("tier");
      if (error) throw error;
      return (data ?? []) as PricingDefault[];
    },
  });
}

export function useUpdatePricingDefault() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ tier, wholesale_price_cents }: { tier: PricingDefault["tier"]; wholesale_price_cents: number }) => {
      const { error } = await supabase
        .from("platform_pricing_defaults")
        .update({ wholesale_price_cents, updated_at: new Date().toISOString() })
        .eq("tier", tier);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform-pricing-defaults"] });
      qc.invalidateQueries({ queryKey: ["organization-pricing"] });
      qc.invalidateQueries({ queryKey: ["reseller-billing-snapshot"] });
      qc.invalidateQueries({ queryKey: ["distributor-billing-snapshot"] });
    },
  });
}

export function useOrganizationPricing() {
  return useQuery({
    queryKey: ["organization-pricing"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_pricing" as any)
        .select("*")
        .order("organization_type")
        .order("name");
      if (error) throw error;
      return (data ?? []) as OrgPricingRow[];
    },
  });
}

export function useUpdateOrgPricing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ orgId, wholesale_price_cents }: { orgId: string; wholesale_price_cents: number | null }) => {
      const { error } = await supabase
        .from("organizations")
        .update({ wholesale_price_cents } as any)
        .eq("id", orgId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["organization-pricing"] });
      qc.invalidateQueries({ queryKey: ["reseller-billing-snapshot"] });
      qc.invalidateQueries({ queryKey: ["distributor-billing-snapshot"] });
      qc.invalidateQueries({ queryKey: ["reseller-org"] });
      qc.invalidateQueries({ queryKey: ["distributor-org"] });
    },
  });
}
