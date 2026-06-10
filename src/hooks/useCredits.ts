import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CreditTransaction {
  id: string;
  created_at: string;
  from_org_id: string | null;
  to_org_id: string;
  quantity: number;
  reason: "mithras_issue" | "distributor_cut" | "enrolment_consume" | "monthly_consume" | "admin_adjust";
  customer_org_id: string | null;
  endpoint_id: string | null;
  unit_price_cents: number | null;
  notes: string | null;
  created_by: string | null;
}

export interface CreditPackTier {
  id: string;
  name: string;
  min_quantity: number;
  per_credit_cents: number;
  description: string | null;
  is_active: boolean;
}

export interface ResellerCreditRow {
  reseller_id: string;
  reseller_name: string;
  distributor_id: string;
  credit_balance: number;
  is_active: boolean;
  created_at: string;
  active_endpoint_count: number;
}

export interface ResellerCreditHealth {
  balance:              number;
  active_endpoints:     number;
  consumed_this_month:  number;
  runway_months:        number | null;
  is_overdrawn:         boolean;
  is_low_runway:        boolean;
  is_midmonth_warning:  boolean;
  generated_at:         string;
}

export interface ResellerHealthRow {
  reseller_id:       string;
  reseller_name:     string;
  created_at:        string;
  credit_balance:    number;
  customer_count:    number;
  active_endpoints:  number;
  last_transaction:  string | null;
  runway_months:     number | null;
  is_stalled:        boolean;
  is_overdrawn:      boolean;
  is_low_runway:     boolean;
  is_dormant:        boolean;
  is_healthy:        boolean;
  attention_score:   number;
}

// Live credit balance for the active org (whoever the user is scoped to).
export function useCreditBalance(orgId: string | null | undefined) {
  return useQuery({
    queryKey: ["credit-balance", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      if (!orgId) return 0;
      const { data, error } = await supabase
        .from("organizations")
        .select("credit_balance" as any)
        .eq("id", orgId)
        .maybeSingle();
      if (error) throw error;
      return Number((data as any)?.credit_balance ?? 0);
    },
    staleTime: 30_000,
  });
}

// Transaction ledger for an org (both inbound and outbound).
export function useCreditTransactions(orgId: string | null | undefined, limit = 200) {
  return useQuery({
    queryKey: ["credit-transactions", orgId, limit],
    enabled: !!orgId,
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("credit_transactions" as any)
        .select("*")
        .or(`from_org_id.eq.${orgId},to_org_id.eq.${orgId}`)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as CreditTransaction[];
    },
    staleTime: 30_000,
  });
}

// List of resellers visible to the caller. RLS filters to the distributor's
// own resellers; super-admin sees all.
export function useDistributorResellersForCredits(distributorId: string | null | undefined) {
  return useQuery({
    queryKey: ["distributor-reseller-credits", distributorId],
    enabled: !!distributorId,
    queryFn: async () => {
      if (!distributorId) return [];
      const { data, error } = await supabase
        .from("distributor_reseller_credits" as any)
        .select("*")
        .eq("distributor_id", distributorId)
        .order("reseller_name");
      if (error) throw error;
      return (data ?? []) as ResellerCreditRow[];
    },
    staleTime: 30_000,
  });
}

// Pack tier price schedule (read-only, used by both the super-admin issue UI
// and the disty's "how much would Mithras charge me" copy).
export function useCreditPackTiers() {
  return useQuery({
    queryKey: ["credit-pack-tiers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("credit_pack_tiers")
        .select("*")
        .eq("is_active", true)
        .order("min_quantity");
      if (error) throw error;
      return (data ?? []) as CreditPackTier[];
    },
    staleTime: 5 * 60_000,
  });
}

// Quote the price for a given quantity (uses the RPC for fidelity).
export function useCreditPackQuote(quantity: number | null) {
  return useQuery({
    queryKey: ["credit-pack-quote", quantity],
    enabled: !!quantity && quantity > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_credit_pack_price" as any, { _quantity: quantity });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as any;
      if (!row) return null;
      return {
        quantity:         Number(row.quantity),
        per_credit_cents: Number(row.per_credit_cents),
        total_cents:      Number(row.total_cents),
        tier_name:        String(row.tier_name),
      };
    },
    staleTime: 60_000,
  });
}

// Distributor admin cuts credits to a reseller.
export function useCutCredits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      resellerOrgId, quantity, unitPriceCents, notes,
    }: { resellerOrgId: string; quantity: number; unitPriceCents?: number | null; notes?: string | null }) => {
      const { data, error } = await supabase.rpc("cut_credits_to_reseller" as any, {
        _reseller_org_id:    resellerOrgId,
        _quantity:           quantity,
        _unit_price_cents:   unitPriceCents ?? null,
        _notes:              notes ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["credit-balance"] });
      qc.invalidateQueries({ queryKey: ["credit-transactions"] });
      qc.invalidateQueries({ queryKey: ["distributor-reseller-credits"] });
    },
  });
}

// Reseller credit-health snapshot — balance, runway, mid-month consumption flag.
export function useResellerCreditHealth(resellerOrgId: string | null | undefined) {
  return useQuery({
    queryKey: ["reseller-credit-health", resellerOrgId],
    enabled: !!resellerOrgId,
    queryFn: async () => {
      if (!resellerOrgId) return null;
      const { data, error } = await supabase.rpc("get_reseller_credit_health" as any, {
        _reseller_org_id: resellerOrgId,
      });
      if (error) throw error;
      return data as unknown as ResellerCreditHealth;
    },
    staleTime: 30_000,
  });
}

// Super-admin: every reseller across every distributor with the same
// health buckets distys see for their own resellers, plus distributor info.
export interface AdminResellerHealthRow extends ResellerHealthRow {
  reseller_slug:    string;
  distributor_id:   string | null;
  distributor_name: string | null;
}

export function useAdminResellerHealthOverview() {
  return useQuery({
    queryKey: ["admin-reseller-health-overview"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_admin_reseller_health_overview" as any);
      if (error) throw error;
      return (data ?? []) as AdminResellerHealthRow[];
    },
    staleTime: 60_000,
  });
}

// Super-admin: paginated platform-wide credit ledger with org names resolved.
export interface AdminCreditLedgerRow {
  id:                string;
  created_at:        string;
  reason:            CreditTransaction["reason"];
  quantity:          number;
  unit_price_cents:  number | null;
  total_cents:       number;
  from_org_id:       string | null;
  from_org_name:     string | null;
  from_org_type:     string | null;
  to_org_id:         string;
  to_org_name:       string | null;
  to_org_type:       string | null;
  customer_org_id:   string | null;
  customer_org_name: string | null;
  endpoint_id:       string | null;
  notes:             string | null;
}

export function useAdminCreditLedger(opts?: { limit?: number; offset?: number; reason?: string | null; orgId?: string | null }) {
  const limit  = opts?.limit  ?? 100;
  const offset = opts?.offset ?? 0;
  const reason = opts?.reason ?? null;
  const orgId  = opts?.orgId  ?? null;
  return useQuery({
    queryKey: ["admin-credit-ledger", limit, offset, reason, orgId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_admin_credit_ledger" as any, {
        _limit:  limit,
        _offset: offset,
        _reason: reason,
        _org_id: orgId,
      });
      if (error) throw error;
      return (data ?? []) as AdminCreditLedgerRow[];
    },
    staleTime: 30_000,
  });
}

// ---- Credit purchase request flow ---------------------------------------
// A reseller asks their disty for N more credits. The disty sees the request
// in /distributor/credits → approves (cuts credits in one click) or declines.
// Reseller can cancel their own pending request.

export type CreditRequestStatus = "pending" | "approved" | "declined" | "canceled";

export interface CreditRequest {
  id:                         string;
  created_at:                 string;
  updated_at:                 string;
  reseller_org_id:            string;
  distributor_org_id:         string;
  requested_by:               string | null;
  quantity:                   number;
  notes:                      string | null;
  status:                     CreditRequestStatus;
  resolved_at:                string | null;
  resolved_by:                string | null;
  resolution_notes:           string | null;
  fulfilled_transaction_id:   string | null;
}

export function useCreditRequestsForReseller(resellerOrgId: string | null | undefined) {
  return useQuery({
    queryKey: ["credit-requests-reseller", resellerOrgId],
    enabled: !!resellerOrgId,
    queryFn: async () => {
      if (!resellerOrgId) return [];
      const { data, error } = await supabase
        .from("credit_requests" as any)
        .select("*")
        .eq("reseller_org_id", resellerOrgId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CreditRequest[];
    },
    staleTime: 30_000,
  });
}

export function useCreditRequestsForDistributor(distId: string | null | undefined) {
  return useQuery({
    queryKey: ["credit-requests-distributor", distId],
    enabled: !!distId,
    queryFn: async () => {
      if (!distId) return [];
      const { data, error } = await supabase
        .from("credit_requests" as any)
        .select(`*, reseller:reseller_org_id (name, slug)` as any)
        .eq("distributor_org_id", distId)
        .order("status", { ascending: true })  // pending first
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<CreditRequest & { reseller?: { name: string; slug: string } }>;
    },
    staleTime: 30_000,
  });
}

// Fire-and-forget email notify. Non-fatal — the request itself succeeds
// even if SMTP isn't configured yet; the function returns {error: "smtp_disabled"}
// in that case and we silently ignore.
async function notifyCreditRequest(requestId: string, action: "submitted" | "approved" | "declined"): Promise<void> {
  try {
    const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "");
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) return;
    await fetch(`${supabaseUrl}/functions/v1/send-credit-request-notification`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ request_id: requestId, action }),
    });
  } catch {
    // Intentionally swallowed — UI should never surface a notification failure.
  }
}

export function useRequestCredits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { resellerOrgId: string; quantity: number; notes?: string | null }) => {
      const { data, error } = await supabase.rpc("request_credits" as any, {
        _reseller_org_id: args.resellerOrgId,
        _quantity:        args.quantity,
        _notes:           args.notes ?? null,
      });
      if (error) throw error;
      const requestId = data as string;
      notifyCreditRequest(requestId, "submitted");
      return requestId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["credit-requests-reseller"] });
      qc.invalidateQueries({ queryKey: ["credit-requests-distributor"] });
    },
  });
}

export function useApproveCreditRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { requestId: string; notes?: string | null; unitPriceCents?: number | null }) => {
      const { data, error } = await supabase.rpc("approve_credit_request" as any, {
        _request_id:       args.requestId,
        _notes:            args.notes ?? null,
        _unit_price_cents: args.unitPriceCents ?? null,
      });
      if (error) throw error;
      notifyCreditRequest(args.requestId, "approved");
      return data as CreditRequest;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["credit-requests-reseller"] });
      qc.invalidateQueries({ queryKey: ["credit-requests-distributor"] });
      qc.invalidateQueries({ queryKey: ["credit-balance"] });
      qc.invalidateQueries({ queryKey: ["credit-transactions"] });
      qc.invalidateQueries({ queryKey: ["distributor-reseller-health"] });
    },
  });
}

export function useDeclineCreditRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { requestId: string; reason: string }) => {
      const { data, error } = await supabase.rpc("decline_credit_request" as any, {
        _request_id: args.requestId,
        _reason:     args.reason,
      });
      if (error) throw error;
      notifyCreditRequest(args.requestId, "declined");
      return data as CreditRequest;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["credit-requests-reseller"] });
      qc.invalidateQueries({ queryKey: ["credit-requests-distributor"] });
    },
  });
}

export function useCancelCreditRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string) => {
      const { data, error } = await supabase.rpc("cancel_credit_request" as any, {
        _request_id: requestId,
      });
      if (error) throw error;
      return data as CreditRequest;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["credit-requests-reseller"] });
      qc.invalidateQueries({ queryKey: ["credit-requests-distributor"] });
    },
  });
}

// Disty view of which resellers need attention (stalled/overdrawn/etc).
export function useDistributorResellerHealth(distId: string | null | undefined) {
  return useQuery({
    queryKey: ["distributor-reseller-health", distId],
    enabled: !!distId,
    queryFn: async () => {
      if (!distId) return [];
      const { data, error } = await supabase.rpc("get_distributor_reseller_health" as any, {
        _distributor_org_id: distId,
      });
      if (error) throw error;
      return (data ?? []) as ResellerHealthRow[];
    },
    staleTime: 60_000,
  });
}

// Super-admin issues credits to a distributor.
export function useIssueCredits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      distributorOrgId, quantity, notes,
    }: { distributorOrgId: string; quantity: number; notes?: string | null }) => {
      const { data, error } = await supabase.rpc("issue_credits_to_distributor" as any, {
        _distributor_org_id: distributorOrgId,
        _quantity:           quantity,
        _notes:              notes ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["credit-balance"] });
      qc.invalidateQueries({ queryKey: ["credit-transactions"] });
    },
  });
}
