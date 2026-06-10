import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { logActivity } from "@/hooks/useActivityLogs";

export interface ResellerCustomer {
  id: string;
  name: string;
  slug: string;
  organization_type: "customer";
  parent_partner_id: string | null;
  is_active: boolean;
  wholesale_price_cents: number | null;
  currency_code: string;
  created_at: string;
  endpoint_count: number;
  active_endpoint_count: number;
  online_endpoint_count: number;
}

export interface ResellerBillingLine {
  customer_org_id: string;
  customer_name: string;
  endpoint_count: number;
  wholesale_price_cents: number;
  line_total_cents: number;
}

// Returns the reseller's own organization id (the partner org they admin).
//
// Two paths:
// - Real partner admin: their userOrganization IS the partner org.
// - Super-admin who has pivoted into a partner via tenant switcher: their
//   currentOrganization reflects the impersonation. Without this branch a
//   super-admin couldn't preview the reseller portal — they'd see "No
//   reseller account" because their own userOrganization isn't a partner.
//
// Mirrors useDistributorOrgId in src/hooks/useDistributor.ts.
export function useResellerOrgId(): string | null {
  const { userOrganization, isSuperAdmin, currentOrganization } = useTenant();
  if (isSuperAdmin && currentOrganization?.organization_type === "partner") {
    return currentOrganization.id;
  }
  if (userOrganization?.organization_type === "partner") {
    return userOrganization.id;
  }
  return null;
}

// The distributor sitting above this reseller (so we can show "Email Apex
// Cyber Distribution" instead of "Email your distributor"). Returns null
// for direct-signed resellers that don't have an upstream distributor.
export function useResellerDistributor() {
  const resellerOrgId = useResellerOrgId();

  return useQuery({
    queryKey: ["reseller-distributor", resellerOrgId],
    enabled: !!resellerOrgId,
    queryFn: async () => {
      if (!resellerOrgId) return null;
      const { data: reseller } = await supabase
        .from("organizations")
        .select("parent_partner_id")
        .eq("id", resellerOrgId)
        .maybeSingle();
      const parentId = (reseller as any)?.parent_partner_id;
      if (!parentId) return null;
      const { data: dist } = await supabase
        .from("organizations")
        .select("id, name, slug, billing_email")
        .eq("id", parentId)
        .maybeSingle();
      return dist as { id: string; name: string; slug: string; billing_email: string | null } | null;
    },
    staleTime: 5 * 60_000,
  });
}

// List every customer under this reseller, with current endpoint counts.
export function useResellerCustomers() {
  const resellerOrgId = useResellerOrgId();
  const { isSuperAdmin } = useTenant();

  return useQuery({
    queryKey: ["reseller-customers", resellerOrgId],
    enabled: !!resellerOrgId,
    queryFn: async () => {
      if (!resellerOrgId) return [];

      // Customers row. RLS already scopes this to parent_partner_id = self.
      const { data: customers, error } = await supabase
        .from("organizations")
        .select("id, name, slug, organization_type, parent_partner_id, is_active, wholesale_price_cents, currency_code, created_at" as any)
        .eq("parent_partner_id", resellerOrgId)
        .eq("organization_type", "customer")
        .order("name");
      if (error) throw error;

      const ids = (customers ?? []).map((c: any) => c.id);
      if (ids.length === 0) return [];

      // Counts: total active, online (last_seen_at < 10min ago).
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: endpoints } = await supabase
        .from("endpoints")
        .select("organization_id, is_active, deleted_at, last_seen_at")
        .in("organization_id", ids)
        .is("deleted_at", null);

      const total = new Map<string, number>();
      const active = new Map<string, number>();
      const online = new Map<string, number>();
      for (const e of endpoints ?? []) {
        total.set(e.organization_id, (total.get(e.organization_id) ?? 0) + 1);
        if (e.is_active !== false) {
          active.set(e.organization_id, (active.get(e.organization_id) ?? 0) + 1);
          if (e.last_seen_at && e.last_seen_at > tenMinAgo) {
            online.set(e.organization_id, (online.get(e.organization_id) ?? 0) + 1);
          }
        }
      }

      return (customers ?? []).map((c: any) => ({
        ...c,
        endpoint_count: total.get(c.id) ?? 0,
        active_endpoint_count: active.get(c.id) ?? 0,
        online_endpoint_count: online.get(c.id) ?? 0,
      })) as ResellerCustomer[];
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

// Per-customer wholesale billing rollup for the current cycle.
export function useResellerBillingSnapshot() {
  const resellerOrgId = useResellerOrgId();

  return useQuery({
    queryKey: ["reseller-billing-snapshot", resellerOrgId],
    enabled: !!resellerOrgId,
    queryFn: async () => {
      if (!resellerOrgId) return [];
      const { data, error } = await supabase.rpc("get_reseller_billing_snapshot" as any, {
        _reseller_org_id: resellerOrgId,
      });
      if (error) throw error;
      return (data ?? []) as ResellerBillingLine[];
    },
    staleTime: 60_000,
  });
}

// Reseller's own pricing record (what they pay Peritus per endpoint by default).
export function useResellerOrg() {
  const resellerOrgId = useResellerOrgId();

  return useQuery({
    queryKey: ["reseller-org", resellerOrgId],
    enabled: !!resellerOrgId,
    queryFn: async () => {
      if (!resellerOrgId) return null;
      const { data, error } = await supabase
        .from("organizations")
        .select("id, name, slug, wholesale_price_cents, currency_code, billing_email, billing_contact_name, is_active, created_at" as any)
        .eq("id", resellerOrgId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

// Create a customer under this reseller. Sets parent_partner_id automatically
// so RLS picks it up immediately. Slug is derived from name (lowercased, spaces
// → hyphens, max 60 chars) to avoid the user having to think about it.
export function useCreateResellerCustomer() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const resellerOrgId = useResellerOrgId();

  return useMutation({
    mutationFn: async ({ name, wholesale_price_cents }: { name: string; wholesale_price_cents?: number }) => {
      if (!resellerOrgId) throw new Error("Not a reseller admin");
      if (!user) throw new Error("Not signed in");
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Customer name is required");

      const slug = trimmed
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60);

      const { data, error } = await supabase
        .from("organizations")
        .insert({
          name: trimmed,
          slug,
          organization_type: "customer",
          parent_partner_id: resellerOrgId,
          wholesale_price_cents: wholesale_price_cents ?? null,
        } as any)
        .select()
        .single();
      if (error) throw error;

      // Audit the creation against the reseller's own org so it shows up in
      // the reseller's activity log, not the customer's.
      await logActivity(resellerOrgId, "create", "customer", data.id, { name: trimmed, slug });

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reseller-customers"] });
      queryClient.invalidateQueries({ queryKey: ["reseller-billing-snapshot"] });
    },
  });
}
