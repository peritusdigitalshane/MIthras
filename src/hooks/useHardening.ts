import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { logActivity } from "@/hooks/useActivityLogs";

// ── Types ──────────────────────────────────────────────────────

export interface HardeningProfile {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  os_target: string;
  is_system_default: boolean;
  settings: Record<string, any>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EndpointHardeningStatus {
  id: string;
  endpoint_id: string;
  organization_id: string;
  os_category: string | null;
  os_eol_date: string | null;
  is_legacy: boolean;
  hardening_profile_id: string | null;
  compliance_score: number;
  total_checks: number;
  passed_checks: number;
  failed_checks: number;
  last_assessed_at: string | null;
  findings: any[];
  esu_estimated_annual_cost: number;
  created_at: string;
  updated_at: string;
  endpoints?: {
    hostname: string;
    os_version: string | null;
    os_build: string | null;
    is_online: boolean;
    last_seen_at: string | null;
    organization_id: string;
  };
  hardening_profiles?: {
    name: string;
    os_target: string;
  } | null;
}

export interface HardeningRecommendation {
  id: string;
  endpoint_id: string;
  organization_id: string;
  category: string;
  title: string;
  description: string | null;
  severity: string;
  current_value: string | null;
  recommended_value: string | null;
  is_compliant: boolean;
  is_applied: boolean;
  applied_at: string | null;
  remediation_action: string | null;
  policy_reference: string | null;
  created_at: string;
  endpoints?: {
    hostname: string;
  };
}

// ── Hardening Profiles ─────────────────────────────────────────

export function useHardeningProfiles() {
  const { currentOrganization } = useTenant();
  return useQuery({
    queryKey: ["hardening-profiles", currentOrganization?.id],
    enabled: !!currentOrganization?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hardening_profiles")
        .select("*")
        .eq("organization_id", currentOrganization!.id)
        .order("is_system_default", { ascending: false })
        .order("name");
      if (error) throw error;
      return data as HardeningProfile[];
    },
  });
}

export function useCreateHardeningProfile() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useTenant();

  return useMutation({
    mutationFn: async (profile: Partial<HardeningProfile>) => {
      const { data, error } = await supabase
        .from("hardening_profiles")
        .insert({ ...profile, organization_id: currentOrganization!.id } as any)
        .select()
        .single();
      if (error) throw error;
      if (currentOrganization?.id) {
        await logActivity(currentOrganization.id, "create", "hardening_profile", data.id, { name: profile.name });
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hardening-profiles"] });
    },
  });
}

export function useUpdateHardeningProfile() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useTenant();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<HardeningProfile> & { id: string }) => {
      const { data, error } = await supabase
        .from("hardening_profiles")
        .update(updates as any)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      if (currentOrganization?.id) {
        await logActivity(currentOrganization.id, "update", "hardening_profile", id, updates);
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hardening-profiles"] });
    },
  });
}

export function useDeleteHardeningProfile() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useTenant();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("hardening_profiles").delete().eq("id", id);
      if (error) throw error;
      if (currentOrganization?.id) {
        await logActivity(currentOrganization.id, "delete", "hardening_profile", id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hardening-profiles"] });
    },
  });
}

// ── Endpoint Hardening Status ──────────────────────────────────

export function useEndpointHardeningStatuses() {
  const { currentOrganization } = useTenant();
  return useQuery({
    queryKey: ["endpoint-hardening-status", currentOrganization?.id],
    enabled: !!currentOrganization?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("endpoint_hardening_status")
        .select(`
          *,
          endpoints!inner(hostname, os_version, os_build, is_online, last_seen_at, organization_id),
          hardening_profiles(name, os_target)
        `)
        .eq("organization_id", currentOrganization!.id)
        .order("is_legacy", { ascending: false })
        .order("compliance_score", { ascending: true });
      if (error) throw error;
      return data as EndpointHardeningStatus[];
    },
  });
}

export function useLegacyEndpointCount() {
  const { currentOrganization } = useTenant();
  return useQuery({
    queryKey: ["legacy-endpoint-count", currentOrganization?.id],
    enabled: !!currentOrganization?.id,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("endpoint_hardening_status")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", currentOrganization!.id)
        .eq("is_legacy", true);
      if (error) throw error;
      return count || 0;
    },
  });
}

export function useAssignHardeningProfile() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useTenant();

  return useMutation({
    mutationFn: async ({ endpointId, profileId }: { endpointId: string; profileId: string | null }) => {
      const { data, error } = await supabase
        .from("endpoint_hardening_status")
        .update({ hardening_profile_id: profileId } as any)
        .eq("endpoint_id", endpointId)
        .select()
        .single();
      if (error) throw error;
      if (currentOrganization?.id) {
        await logActivity(currentOrganization.id, "update", "hardening_assignment", endpointId, { profile_id: profileId });
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["endpoint-hardening-status"] });
    },
  });
}

// ── Hardening Recommendations ──────────────────────────────────

export function useHardeningRecommendations(endpointId?: string) {
  const { currentOrganization } = useTenant();
  return useQuery({
    queryKey: ["hardening-recommendations", currentOrganization?.id, endpointId],
    enabled: !!currentOrganization?.id,
    queryFn: async () => {
      let query = supabase
        .from("hardening_recommendations")
        .select("*, endpoints(hostname)")
        .eq("organization_id", currentOrganization!.id)
        .order("severity")
        .order("is_compliant", { ascending: true });
      
      if (endpointId) {
        query = query.eq("endpoint_id", endpointId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as HardeningRecommendation[];
    },
  });
}

// ── Aggregate Stats ────────────────────────────────────────────

export function useHardeningStats() {
  const { data: statuses } = useEndpointHardeningStatuses();

  if (!statuses) return null;

  const legacyEndpoints = statuses.filter(s => s.is_legacy);
  const totalLegacy = legacyEndpoints.length;
  const avgScore = totalLegacy > 0
    ? Math.round(legacyEndpoints.reduce((sum, s) => sum + (s.compliance_score || 0), 0) / totalLegacy)
    : 0;
  const criticalCount = legacyEndpoints.filter(s => s.compliance_score < 50).length;
  const hardenedCount = legacyEndpoints.filter(s => s.compliance_score >= 80).length;
  const totalEsuSavings = legacyEndpoints.reduce((sum, s) => sum + (s.esu_estimated_annual_cost || 0), 0);
  const profileAssigned = legacyEndpoints.filter(s => s.hardening_profile_id).length;

  const osCategoryBreakdown = legacyEndpoints.reduce((acc, s) => {
    const cat = s.os_category || "unknown";
    acc[cat] = (acc[cat] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return {
    totalLegacy,
    totalEndpoints: statuses.length,
    avgScore,
    criticalCount,
    hardenedCount,
    totalEsuSavings,
    profileAssigned,
    osCategoryBreakdown,
  };
}

// ── Admin Module Toggle ────────────────────────────────────────

export function useUpdateOrganizationHardeningModule() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useTenant();

  return useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { data, error } = await supabase
        .from("organizations")
        .update({ legacy_hardening_enabled: enabled } as any)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;

      // Create default profiles if enabling for the first time
      if (enabled) {
        const { data: existing } = await supabase
          .from("hardening_profiles")
          .select("id")
          .eq("organization_id", id)
          .limit(1);

        if (!existing || existing.length === 0) {
          await supabase.rpc("create_default_hardening_profiles", { _org_id: id });
        }
      }

      if (currentOrganization?.id) {
        await logActivity(currentOrganization.id, "update", "organization_hardening_module", id, {
          legacy_hardening_enabled: enabled,
        });
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["admin-organizations-with-stats"] });
      queryClient.invalidateQueries({ queryKey: ["direct-customers"] });
      queryClient.invalidateQueries({ queryKey: ["partner-customers"] });
      queryClient.invalidateQueries({ queryKey: ["hardening-profiles"] });
      // First-enable triggers create_default_hardening_profiles() which
      // seeds endpoint_hardening_status rows via FK trigger. Refresh the
      // status list so the Hardening page reflects the new baseline.
      queryClient.invalidateQueries({ queryKey: ["endpoint-hardening-status"] });
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
    },
  });
}
