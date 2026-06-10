import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AdminOverviewTotals {
  distributors:        number;
  resellers:           number;
  customers:           number;
  endpoints_active:    number;
  endpoints_online:    number;
  estimated_mrr_cents: number;
  currency_code:       string;
}
export interface ChannelRow {
  distributor_id: string | null;
  distributor_name: string;
  is_active: boolean;
  created_at: string | null;
  reseller_count: number;
  customer_count: number;
  endpoint_count: number;
  distributor_mrr_to_peritus_cents: number;
}
export interface AtRiskRow {
  org_id: string;
  org_name: string;
  org_type: "distributor" | "partner" | "customer";
  reason: "suspended" | "expired" | "expiring" | "invoice_overdue";
  detail: string;
  severity_rank: number;
  days_overdue: number | null;
}
export interface PendingInviteRow {
  id: string;
  code: string;
  role: string;
  expires_at: string | null;
  created_at: string;
  org_id: string;
  org_name: string;
  org_type: string;
}
export interface RecentActivityRow {
  org_id: string;
  org_name: string;
  org_type: string;
  created_at: string;
}
export interface AdminOverview {
  generated_at:     string;
  totals:           AdminOverviewTotals;
  channel:          ChannelRow[];
  at_risk:          AtRiskRow[];
  pending_invites:  PendingInviteRow[];
  recent_activity:  RecentActivityRow[];
}

export function useAdminOverview() {
  return useQuery({
    queryKey: ["admin-channel-overview"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_admin_channel_overview" as any);
      if (error) throw error;
      return data as unknown as AdminOverview;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export interface ChannelVelocityWindow {
  new_customers:    number;
  new_endpoints:    number;
  deals_registered: number;
  deals_won:        number;
  credits_issued:   number;
  credits_consumed: number;
}
export interface ChannelVelocity {
  last_7_days:  ChannelVelocityWindow;
  last_30_days: ChannelVelocityWindow;
  generated_at: string;
}

export function useAdminChannelVelocity() {
  return useQuery({
    queryKey: ["admin-channel-velocity"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_admin_channel_velocity" as any);
      if (error) throw error;
      return data as unknown as ChannelVelocity;
    },
    staleTime: 60_000,
  });
}

export interface DistyEndpointHealth {
  distributor_id:        string;
  distributor_name:      string;
  reseller_count:        number;
  customer_count:        number;
  total_endpoints:       number;
  online_24h:            number;
  open_threats:          number;
  endpoints_with_threat: number;
}

export function useAdminEndpointHealthByDisty() {
  return useQuery({
    queryKey: ["admin-endpoint-health-by-disty"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_admin_endpoint_health_by_disty" as any);
      if (error) throw error;
      return (data ?? []) as DistyEndpointHealth[];
    },
    staleTime: 60_000,
  });
}
