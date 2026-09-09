import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/hooks/useActivityLogs";
import { useTenant } from "@/contexts/TenantContext";

interface Organization {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
  event_log_retention_days: number;
  network_module_enabled: boolean;
  router_module_enabled: boolean;
  legacy_hardening_enabled: boolean;
  ai_soc_enabled?: boolean;                  // derived from per-agent flags
  ai_triage_enabled?: boolean;
  ai_investigation_enabled?: boolean;
  ai_soc_daily_cap_cents?: number;
  ai_email_remediation_enabled?: boolean;
  ai_endpoint_remediation_enabled?: boolean;
  subscription_plan?: "free" | "pro" | "business";
  device_quota_override?: number | null;
  parent_partner_id?: string | null;
}

interface OrganizationWithStats extends Organization {
  endpoint_count: number;
  member_count: number;
}

export function useAllOrganizations() {
  return useQuery({
    queryKey: ["admin-organizations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("*")
        .order("name");

      if (error) throw error;
      return data as Organization[];
    },
  });
}

export function useOrganizationsWithStats() {
  return useQuery({
    queryKey: ["admin-organizations-with-stats"],
    queryFn: async () => {
      // Get all organizations
      const { data: orgs, error: orgsError } = await supabase
        .from("organizations")
        .select("*")
        .order("name");

      if (orgsError) throw orgsError;

      // Get endpoint counts per org — live only
      const { data: endpoints } = await supabase
        .from("endpoints")
        .select("organization_id")
        .is("deleted_at", null);

      // Get member counts per org
      const { data: members } = await supabase
        .from("organization_memberships")
        .select("organization_id");

      // Calculate counts
      const endpointCounts = (endpoints || []).reduce((acc, e) => {
        acc[e.organization_id] = (acc[e.organization_id] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const memberCounts = (members || []).reduce((acc, m) => {
        acc[m.organization_id] = (acc[m.organization_id] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      return (orgs || []).map((org) => ({
        ...org,
        endpoint_count: endpointCounts[org.id] || 0,
        member_count: memberCounts[org.id] || 0,
      })) as OrganizationWithStats[];
    },
  });
}

export function useCreateOrganization() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useTenant();

  return useMutation({
    mutationFn: async ({ name, slug }: { name: string; slug: string }) => {
      const { data, error } = await supabase
        .from("organizations")
        .insert({ name, slug })
        .select()
        .single();

      if (error) throw error;
      
      // Log activity
      if (currentOrganization?.id) {
        await logActivity(currentOrganization.id, "create", "organization", data.id, { name, slug });
      }
      
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["admin-organizations-with-stats"] });
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
    },
  });
}

export function useUpdateOrganization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, name, slug }: { id: string; name: string; slug: string }) => {
      const { data, error } = await supabase
        .from("organizations")
        .update({ name, slug })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["admin-organizations-with-stats"] });
    },
  });
}

export function useUpdateOrganizationRetention() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useTenant();

  return useMutation({
    mutationFn: async ({ id, retentionDays }: { id: string; retentionDays: number }) => {
      const { data, error } = await supabase
        .from("organizations")
        .update({ event_log_retention_days: retentionDays })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      
      // Log activity
      if (currentOrganization?.id) {
        await logActivity(currentOrganization.id, "update", "organization_retention", id, { 
          retention_days: retentionDays 
        });
      }
      
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["admin-organizations-with-stats"] });
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
    },
  });
}

export function useUpdateOrganizationNetworkModule() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useTenant();

  return useMutation({
    mutationFn: async ({ id, networkModuleEnabled }: { id: string; networkModuleEnabled: boolean }) => {
      const { data, error } = await supabase
        .from("organizations")
        .update({ network_module_enabled: networkModuleEnabled })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      
      // Log activity
      if (currentOrganization?.id) {
        await logActivity(currentOrganization.id, "update", "organization_network_module", id, { 
          network_module_enabled: networkModuleEnabled 
        });
      }
      
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["admin-organizations-with-stats"] });
      queryClient.invalidateQueries({ queryKey: ["direct-customers"] });
      queryClient.invalidateQueries({ queryKey: ["partner-customers"] });
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
    },
  });
}

export function useUpdateOrganizationRouterModule() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useTenant();

  return useMutation({
    mutationFn: async ({ id, routerModuleEnabled }: { id: string; routerModuleEnabled: boolean }) => {
      const { data, error } = await supabase
        .from("organizations")
        .update({ router_module_enabled: routerModuleEnabled } as any)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      
      if (currentOrganization?.id) {
        await logActivity(currentOrganization.id, "update", "organization_router_module", id, { 
          router_module_enabled: routerModuleEnabled 
        });
      }
      
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["admin-organizations-with-stats"] });
      queryClient.invalidateQueries({ queryKey: ["direct-customers"] });
      queryClient.invalidateQueries({ queryKey: ["partner-customers"] });
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
    },
  });
}

export function useUpdateOrganizationLegacyHardening() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useTenant();

  return useMutation({
    mutationFn: async ({ id, legacyHardeningEnabled }: { id: string; legacyHardeningEnabled: boolean }) => {
      const { data, error } = await supabase
        .from("organizations")
        .update({ legacy_hardening_enabled: legacyHardeningEnabled } as any)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      
      if (currentOrganization?.id) {
        await logActivity(currentOrganization.id, "update", "organization_legacy_hardening", id, { 
          legacy_hardening_enabled: legacyHardeningEnabled 
        });
      }
      
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["admin-organizations-with-stats"] });
      queryClient.invalidateQueries({ queryKey: ["direct-customers"] });
      queryClient.invalidateQueries({ queryKey: ["partner-customers"] });
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
    },
  });
}

/**
 * AI SOC per-org settings: per-agent toggles + daily cost cap. Used from
 * the Admin → customer row so super-admins enable specific agents per
 * customer based on tier. Two real toggles today: Triage + Investigation.
 * Auto-Response is a future-Phase placeholder.
 */
export function useUpdateOrganizationAiSoc() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useTenant();

  return useMutation({
    mutationFn: async ({
      id,
      aiTriageEnabled,
      aiInvestigationEnabled,
      aiSocDailyCapCents,
      aiEmailRemediationEnabled,
      aiEndpointRemediationEnabled,
    }: {
      id: string;
      aiTriageEnabled?: boolean;
      aiInvestigationEnabled?: boolean;
      aiSocDailyCapCents?: number;
      aiEmailRemediationEnabled?: boolean;
      aiEndpointRemediationEnabled?: boolean;
    }) => {
      const patch: Record<string, unknown> = {};
      if (typeof aiTriageEnabled === "boolean") patch.ai_triage_enabled = aiTriageEnabled;
      if (typeof aiInvestigationEnabled === "boolean") patch.ai_investigation_enabled = aiInvestigationEnabled;
      if (typeof aiSocDailyCapCents === "number" && aiSocDailyCapCents >= 0) {
        patch.ai_soc_daily_cap_cents = aiSocDailyCapCents;
      }
      if (typeof aiEmailRemediationEnabled === "boolean") {
        patch.ai_email_remediation_enabled = aiEmailRemediationEnabled;
      }
      if (typeof aiEndpointRemediationEnabled === "boolean") {
        patch.ai_endpoint_remediation_enabled = aiEndpointRemediationEnabled;
      }
      if (Object.keys(patch).length === 0) {
        throw new Error("nothing to update");
      }
      const { data, error } = await supabase
        .from("organizations")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      if (currentOrganization?.id) {
        await logActivity(currentOrganization.id, "update", "organization_ai_soc", id, patch);
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["admin-organizations-with-stats"] });
      queryClient.invalidateQueries({ queryKey: ["direct-customers"] });
      queryClient.invalidateQueries({ queryKey: ["partner-customers"] });
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
    },
  });
}

/**
 * Per-org subscription plan + device-quota override. Used from the
 * Admin → customer row so super-admins set plan tier and optionally cap
 * device count per customer (trial, contractual, lockout). Override of
 * null = use plan default. Override of 0 = block all new enrolments.
 */
export function useUpdateOrganizationPlan() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useTenant();

  return useMutation({
    mutationFn: async ({
      id,
      subscriptionPlan,
      deviceQuotaOverride,
    }: {
      id: string;
      subscriptionPlan?: "free" | "pro" | "business";
      // null = clear the override (back to plan default)
      // undefined = don't touch the column
      deviceQuotaOverride?: number | null;
    }) => {
      const patch: Record<string, unknown> = {};
      if (subscriptionPlan) patch.subscription_plan = subscriptionPlan;
      if (deviceQuotaOverride !== undefined) {
        patch.device_quota_override =
          deviceQuotaOverride === null || deviceQuotaOverride < 0
            ? null
            : Math.floor(deviceQuotaOverride);
      }
      if (Object.keys(patch).length === 0) {
        throw new Error("nothing to update");
      }
      const { data, error } = await supabase
        .from("organizations")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      if (currentOrganization?.id) {
        await logActivity(currentOrganization.id, "update", "organization_plan", id, patch);
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["admin-organizations-with-stats"] });
      queryClient.invalidateQueries({ queryKey: ["direct-customers"] });
      queryClient.invalidateQueries({ queryKey: ["partner-customers"] });
      queryClient.invalidateQueries({ queryKey: ["org-device-quota"] });
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
    },
  });
}

export interface OrganizationDeviceQuota {
  organization_id: string;
  organization_name: string;
  plan: "free" | "pro" | "business";
  override: number | null;
  plan_default: number | null;
  effective_cap: number | null;
  used: number;
  partner_child: boolean;
}

export function useOrganizationDeviceQuota(orgId: string | undefined) {
  return useQuery({
    queryKey: ["org-device-quota", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_device_quota")
        .select("*")
        .eq("organization_id", orgId!)
        .maybeSingle();
      if (error) throw error;
      return data as OrganizationDeviceQuota | null;
    },
  });
}

export function useOrganizationMembers(orgId: string | null) {
  return useQuery({
    queryKey: ["admin-org-members", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      if (!orgId) return [];

      const { data, error } = await supabase
        .from("organization_memberships")
        .select(`
          id,
          role,
          created_at,
          user_id,
          profiles!inner(id, email, display_name, avatar_url)
        `)
        .eq("organization_id", orgId);

      if (error) throw error;
      return data;
    },
  });
}

export function useOrganizationEndpoints(orgId: string | null) {
  return useQuery({
    queryKey: ["admin-org-endpoints", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      if (!orgId) return [];

      const { data, error } = await supabase
        .from("endpoints")
        .select("*")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("hostname");

      if (error) throw error;
      return data;
    },
  });
}

export function useOrganizationPolicies(orgId: string | null) {
  return useQuery({
    queryKey: ["admin-org-policies", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      if (!orgId) return [];

      const { data, error } = await supabase
        .from("defender_policies")
        .select("*")
        .eq("organization_id", orgId)
        .order("name");

      if (error) throw error;
      return data;
    },
  });
}
