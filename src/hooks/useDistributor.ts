import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { logActivity } from "@/hooks/useActivityLogs";

export interface DistributorReseller {
  id: string;
  name: string;
  slug: string;
  parent_partner_id: string | null;
  is_active: boolean;
  wholesale_price_cents: number | null;
  currency_code: string;
  created_at: string;
  customer_count: number;
  endpoint_count: number;
  line_total_cents: number;
}

export interface DistributorBillingLine {
  reseller_org_id: string;
  reseller_name: string;
  customer_count: number;
  endpoint_count: number;
  wholesale_price_cents: number;
  line_total_cents: number;
}

// Returns the distributor org id the current viewer is scoped to.
// - Real distributor admin: their own org.
// - Super-admin impersonating a distributor: the impersonated org.
// - Anyone else: null.
export function useDistributorOrgId(): string | null {
  const { userOrganization, isSuperAdmin, currentOrganization } = useTenant();
  // Super-admin path: respect the org they pivoted into (must be distributor type).
  if (isSuperAdmin && currentOrganization?.organization_type === "distributor") {
    return currentOrganization.id;
  }
  // Real distributor admin path.
  if (userOrganization?.organization_type === "distributor") {
    return userOrganization.id;
  }
  return null;
}

export function useDistributorOrg() {
  const distId = useDistributorOrgId();
  return useQuery({
    queryKey: ["distributor-org", distId],
    enabled: !!distId,
    queryFn: async () => {
      if (!distId) return null;
      const { data, error } = await supabase
        .from("organizations")
        .select("id, name, slug, wholesale_price_cents, currency_code, billing_email, billing_contact_name, is_active, created_at" as any)
        .eq("id", distId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

// Per-reseller rollup via SECURITY DEFINER RPC — distributor never SELECTs
// the underlying customer/endpoint rows directly, only the aggregates.
export function useDistributorBillingSnapshot() {
  const distId = useDistributorOrgId();
  return useQuery({
    queryKey: ["distributor-billing-snapshot", distId],
    enabled: !!distId,
    queryFn: async () => {
      if (!distId) return [];
      const { data, error } = await supabase.rpc("get_distributor_billing_snapshot" as any, {
        _distributor_org_id: distId,
      });
      if (error) throw error;
      return (data ?? []) as DistributorBillingLine[];
    },
    staleTime: 60_000,
  });
}

// List of resellers under this distributor with their roll-up numbers.
// Combines the org rows (visible via RLS) with the aggregate from the RPC.
export function useDistributorResellers() {
  const distId = useDistributorOrgId();
  const snapshot = useDistributorBillingSnapshot();
  return useQuery({
    queryKey: ["distributor-resellers", distId, snapshot.data],
    enabled: !!distId && snapshot.isSuccess,
    queryFn: async () => {
      if (!distId) return [];
      const { data: orgs, error } = await supabase
        .from("organizations")
        .select("id, name, slug, parent_partner_id, is_active, wholesale_price_cents, currency_code, created_at" as any)
        .eq("parent_partner_id", distId)
        .eq("organization_type", "partner")
        .order("name");
      if (error) throw error;
      const lookup = new Map<string, DistributorBillingLine>();
      for (const line of snapshot.data ?? []) lookup.set(line.reseller_org_id, line);
      return (orgs ?? []).map((r: any) => {
        const line = lookup.get(r.id);
        return {
          ...r,
          customer_count: Number(line?.customer_count ?? 0),
          endpoint_count: Number(line?.endpoint_count ?? 0),
          line_total_cents: Number(line?.line_total_cents ?? 0),
        } as DistributorReseller;
      });
    },
  });
}

// Create a reseller under this distributor + generate a single-use admin
// enrolment code in the same flow. Returns the code so the caller can show
// the signup URL dialog.
export function useCreateDistributorReseller() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const distId = useDistributorOrgId();

  return useMutation({
    mutationFn: async ({
      name,
      wholesale_price_cents,
    }: {
      name: string;
      wholesale_price_cents?: number | null;
    }) => {
      if (!distId) throw new Error("Not a distributor admin");
      if (!user) throw new Error("Not signed in");
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Reseller name is required");

      const slug = trimmed
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60);

      // 1. Create the reseller org
      const { data: reseller, error: createErr } = await supabase
        .from("organizations")
        .insert({
          name: trimmed,
          slug,
          organization_type: "partner",
          parent_partner_id: distId,
          wholesale_price_cents: wholesale_price_cents ?? null,
        } as any)
        .select()
        .single();
      if (createErr) throw createErr;

      // 2. Generate a single-use admin enrolment code for them
      const code = generateCode();
      const { data: codeRow, error: codeErr } = await supabase
        .from("enrollment_codes")
        .insert({
          code,
          organization_id: (reseller as any).id,
          role: "admin",
          is_single_use: true,
          max_uses: 1,
        })
        .select()
        .single();
      if (codeErr) throw codeErr;

      // 3. Audit against the distributor's org
      await logActivity(distId, "create", "reseller", (reseller as any).id, {
        name: trimmed,
        slug,
        enrollment_code_id: (codeRow as any).id,
      });

      return { reseller, code: (codeRow as any).code as string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["distributor-resellers"] });
      queryClient.invalidateQueries({ queryKey: ["distributor-billing-snapshot"] });
    },
  });
}

// 12-char human-readable code (avoiding 0/O/1/I).
//
// Uses crypto.getRandomValues — these codes are auth bootstrap tokens (whoever
// redeems one becomes admin of the org), so they must NOT be predictable.
// Math.random is a PRNG and was the original bug here. 12 chars from a 32-char
// alphabet = ~60 bits of entropy, comfortably above brute-force territory
// while still being readable for the "type it manually" UX.
//
// A stronger version of this would generate the code server-side in the
// enrollment_codes insert (Postgres default `gen_random_bytes(9)` encoded),
// so a compromised browser couldn't influence the value at all — left as a
// follow-up since it requires schema + insert-path changes.
function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += chars.charAt(b % chars.length);
  return out;
}
