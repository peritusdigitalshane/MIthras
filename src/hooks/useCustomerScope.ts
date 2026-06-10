import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface CustomerOrgDetails {
  id: string;
  name: string;
  slug: string;
  parent_partner_id: string | null;
  is_active: boolean;
  wholesale_price_cents: number | null;
  currency_code: string;
  created_at: string;
}

export interface ResellerContact {
  id: string;
  name: string;
  slug: string;
  organization_type: string;
}

// Returns the currently-active customer org id, or null if the active org
// isn't a customer. Used by all /customer/* pages.
export function useCustomerOrgId(): string | null {
  const { currentOrganization } = useTenant();
  if (!currentOrganization) return null;
  if (currentOrganization.organization_type !== "customer") return null;
  return currentOrganization.id;
}

export function useCustomerOrg() {
  const orgId = useCustomerOrgId();
  return useQuery({
    queryKey: ["customer-org", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      if (!orgId) return null;
      const { data, error } = await supabase
        .from("organizations")
        .select("id, name, slug, parent_partner_id, is_active, wholesale_price_cents, currency_code, created_at" as any)
        .eq("id", orgId)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as CustomerOrgDetails | null;
    },
  });
}

// The reseller above this customer (so we can show "Need help? Contact your
// reseller" with their actual name).
export function useCustomerReseller() {
  const { data: org } = useCustomerOrg();
  return useQuery({
    queryKey: ["customer-reseller", org?.parent_partner_id],
    enabled: !!org?.parent_partner_id,
    queryFn: async () => {
      if (!org?.parent_partner_id) return null;
      const { data, error } = await supabase
        .from("organizations")
        .select("id, name, slug, organization_type" as any)
        .eq("id", org.parent_partner_id)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as ResellerContact | null;
    },
  });
}

// Endpoint summary for the customer dashboard.
export function useCustomerEndpointSummary() {
  const orgId = useCustomerOrgId();
  return useQuery({
    queryKey: ["customer-endpoint-summary", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      if (!orgId) return { total: 0, online: 0, offline: 0, outdated: 0 };
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("endpoints")
        .select("id, last_seen_at, is_active, deleted_at, agent_version")
        .eq("organization_id", orgId)
        .is("deleted_at", null);
      const list = (data ?? []).filter((e: any) => e.is_active !== false);
      const online = list.filter((e: any) => e.last_seen_at && e.last_seen_at > tenMinAgo).length;
      return {
        total:    list.length,
        online,
        offline:  list.length - online,
        outdated: 0, // a future enhancement once we wire agent_versions lookup here
      };
    },
    staleTime: 30_000,
  });
}

// Active threat count (status NOT in resolved/blocked/removed).
export function useCustomerThreatSummary() {
  const orgId = useCustomerOrgId();
  return useQuery({
    queryKey: ["customer-threat-summary", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      if (!orgId) return { active: 0, last7Days: 0 };
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      // Walk via endpoints join — RLS scopes to the customer org.
      const { data } = await supabase
        .from("endpoint_threats")
        .select("id, status, created_at, endpoints!inner(organization_id)" as any)
        .eq("endpoints.organization_id", orgId);
      const all = (data ?? []) as Array<{ id: string; status: string; created_at: string }>;
      const active = all.filter(t => !["Resolved","Blocked","Removed"].includes(t.status)).length;
      const last7Days = all.filter(t => t.created_at > sevenDaysAgo).length;
      return { active, last7Days };
    },
    staleTime: 30_000,
  });
}
