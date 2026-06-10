import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type DealStage = "qualified" | "demo" | "poc" | "quote" | "won" | "lost" | "expired";
export type DealStatus = "active" | "won" | "lost" | "expired";

export interface DealRegistration {
  id: string;
  created_at: string;
  updated_at: string;
  reseller_org_id: string;
  distributor_org_id: string | null;
  registered_by: string | null;
  prospect_name: string;
  prospect_email: string | null;
  prospect_industry: string | null;
  prospect_region: string | null;
  estimated_endpoints: number;
  estimated_close_date: string | null;
  notes: string | null;
  stage: DealStage;
  protection_starts_at: string;
  protection_expires_at: string;
  status: DealStatus;
  won_customer_org_id: string | null;
  won_at: string | null;
  lost_at: string | null;
  lost_reason: string | null;
  locked_unit_cost_cents: number | null;
  locked_retail_cents:    number | null;
  locked_currency_code:   string;
}

export interface AdminDealOverview {
  generated_at:   string;
  totals: {
    active:               number;
    pipeline_endpoints:   number;
    won_total:            number;
    lost_total:           number;
    expired_total:        number;
    conflicts_count:      number;
  };
  by_distributor: Array<{
    distributor_id:   string;
    distributor_name: string;
    active_count:     number;
    active_pipeline:  number;
    won_count:        number;
    reseller_count:   number;
  }>;
  conflicts: Array<{
    prospect_key:        string;
    prospect_name:       string;
    distributor_org_id:  string;
    deal_count:          number;
    reseller_ids:        string[];
  }>;
  recent: Array<{
    id:                  string;
    prospect_name:       string;
    stage:               string;
    status:              string;
    created_at:          string;
    estimated_endpoints: number;
    estimated_close_date: string | null;
    reseller_name:       string | null;
    distributor_name:    string | null;
  }>;
}

export interface AdminPartnerDealPerformance {
  reseller_id:           string;
  reseller_name:         string;
  distributor_id:        string | null;
  distributor_name:      string | null;
  active_count:          number;
  won_count:             number;
  lost_count:            number;
  expired_count:         number;
  total_completed:       number;
  win_rate_pct:          number | null;
  active_pipeline_eps:   number;
  won_endpoints:         number;
  avg_deal_eps:          number | null;
  estimated_mrr_cents:   number;
  last_deal_at:          string | null;
}

export function useAdminPartnerDealPerformance() {
  return useQuery({
    queryKey: ["admin-partner-deal-performance"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_admin_partner_deal_performance" as any);
      if (error) throw error;
      return (data ?? []) as AdminPartnerDealPerformance[];
    },
    staleTime: 60_000,
  });
}

export function useAdminDealOverview() {
  return useQuery({
    queryKey: ["admin-deal-overview"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_admin_deal_overview" as any);
      if (error) throw error;
      return data as unknown as AdminDealOverview;
    },
    staleTime: 60_000,
  });
}

// Reseller view: all deals where reseller_org_id = self.
export function useResellerDeals(resellerOrgId: string | null | undefined) {
  return useQuery({
    queryKey: ["reseller-deals", resellerOrgId],
    enabled: !!resellerOrgId,
    queryFn: async () => {
      if (!resellerOrgId) return [];
      const { data, error } = await supabase
        .from("deal_registrations" as any)
        .select("*")
        .eq("reseller_org_id", resellerOrgId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as DealRegistration[];
    },
    staleTime: 30_000,
  });
}

// Distributor view: all deals their resellers have registered. RLS filters
// to deals where distributor_org_id matches an org the user admins.
export function useDistributorDeals(distId: string | null | undefined) {
  return useQuery({
    queryKey: ["distributor-deals", distId],
    enabled: !!distId,
    queryFn: async () => {
      if (!distId) return [];
      const { data, error } = await supabase
        .from("deal_registrations" as any)
        .select(`*, reseller:reseller_org_id (name, slug)` as any)
        .eq("distributor_org_id", distId)
        .order("status", { ascending: true })  // active first
        .order("protection_expires_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Array<DealRegistration & { reseller?: { name: string; slug: string } }>;
    },
    staleTime: 30_000,
  });
}

export function useRegisterDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      resellerOrgId: string;
      prospectName: string;
      estimatedEndpoints?: number;
      estimatedCloseDate?: string | null;
      prospectEmail?: string | null;
      prospectIndustry?: string | null;
      prospectRegion?: string | null;
      notes?: string | null;
    }) => {
      const { data, error } = await supabase.rpc("register_deal" as any, {
        _reseller_org_id:      args.resellerOrgId,
        _prospect_name:        args.prospectName,
        _estimated_endpoints:  args.estimatedEndpoints ?? 0,
        _estimated_close_date: args.estimatedCloseDate ?? null,
        _prospect_email:       args.prospectEmail ?? null,
        _prospect_industry:    args.prospectIndustry ?? null,
        _prospect_region:      args.prospectRegion ?? null,
        _notes:                args.notes ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reseller-deals"] });
      qc.invalidateQueries({ queryKey: ["distributor-deals"] });
    },
  });
}

export function useUpdateDealStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ dealId, newStage }: { dealId: string; newStage: DealStage }) => {
      const { data, error } = await supabase.rpc("update_deal_stage" as any, {
        _deal_id:   dealId,
        _new_stage: newStage,
      });
      if (error) throw error;
      return data as DealRegistration;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reseller-deals"] });
      qc.invalidateQueries({ queryKey: ["distributor-deals"] });
    },
  });
}

// Convert a registered deal to a paying customer. Server-side this can
// either link to an existing customer org (pass customerOrgId) or create a
// new one (pass newCustomerName — defaults to the deal's prospect_name).
// Either way the deal is marked won and the customer's wholesale_price_cents
// inherits the deal's locked_retail.
export function useConvertDealToCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { dealId: string; customerOrgId?: string | null; newCustomerName?: string | null }) => {
      const { data, error } = await supabase.rpc("convert_deal_to_customer" as any, {
        _deal_id:           args.dealId,
        _customer_org_id:   args.customerOrgId ?? null,
        _new_customer_name: args.newCustomerName ?? null,
      });
      if (error) throw error;
      return data as DealRegistration;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reseller-deals"] });
      qc.invalidateQueries({ queryKey: ["distributor-deals"] });
      qc.invalidateQueries({ queryKey: ["reseller-customers"] });
      qc.invalidateQueries({ queryKey: ["partner-customers"] });
    },
  });
}

export function useLoseDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ dealId, reason }: { dealId: string; reason?: string | null }) => {
      const { data, error } = await supabase.rpc("lose_deal" as any, {
        _deal_id: dealId,
        _reason:  reason ?? null,
      });
      if (error) throw error;
      return data as DealRegistration;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reseller-deals"] });
      qc.invalidateQueries({ queryKey: ["distributor-deals"] });
    },
  });
}
