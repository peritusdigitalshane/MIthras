import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { logActivity } from "@/hooks/useActivityLogs";
import type { Json } from "@/integrations/supabase/types";

export type PolicyType = "defender" | "gpo" | "wdac" | "uac" | "windows_update";
export type AuditStatus = "active" | "completed" | "cancelled";

export interface AuditSession {
  id: string;
  organization_id: string;
  policy_type: PolicyType;
  policy_id: string;
  status: AuditStatus;
  planned_duration_days: number;
  started_at: string;
  completed_at: string | null;
  started_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditFinding {
  id: string;
  session_id: string;
  finding_type: string;
  source_endpoint_id: string | null;
  value: string;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  details: Json | null;
  is_approved: boolean;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  endpoints?: { hostname: string } | null;
}

export function useAuditSessions(policyType?: PolicyType) {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;

  return useQuery({
    queryKey: ["audit-sessions", orgId, policyType],
    enabled: !!orgId,
    queryFn: async () => {
      let query = supabase
        .from("policy_audit_sessions")
        .select("*")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false });

      if (policyType) {
        query = query.eq("policy_type", policyType);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as AuditSession[];
    },
  });
}

export function useActiveAuditSession(policyType: PolicyType, policyId: string | undefined) {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;

  return useQuery({
    queryKey: ["audit-session-active", orgId, policyType, policyId],
    enabled: !!orgId && !!policyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("policy_audit_sessions")
        .select("*")
        .eq("organization_id", orgId!)
        .eq("policy_type", policyType)
        .eq("policy_id", policyId!)
        .eq("status", "active")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data as AuditSession | null;
    },
  });
}

export function useAuditFindings(sessionId: string | undefined) {
  return useQuery({
    queryKey: ["audit-findings", sessionId],
    enabled: !!sessionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("policy_audit_findings")
        .select(`*, endpoints:source_endpoint_id(hostname)`)
        .eq("session_id", sessionId!)
        .order("occurrence_count", { ascending: false });

      if (error) throw error;
      return (data ?? []) as AuditFinding[];
    },
  });
}

export function useStartAuditSession() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useTenant();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      policyType,
      policyId,
      durationDays = 30,
      notes,
    }: {
      policyType: PolicyType;
      policyId: string;
      durationDays?: number;
      notes?: string;
    }) => {
      const { data, error } = await supabase
        .from("policy_audit_sessions")
        .insert({
          organization_id: currentOrganization!.id,
          policy_type: policyType,
          policy_id: policyId,
          planned_duration_days: durationDays,
          started_by: user?.id || null,
          notes: notes || null,
        })
        .select()
        .single();

      if (error) throw error;

      await logActivity(
        currentOrganization!.id,
        "audit_started",
        "policy_audit",
        data.id,
        { policy_type: policyType, policy_id: policyId, duration_days: durationDays }
      );

      return data as AuditSession;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["audit-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["audit-session-active"] });
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
    },
  });
}

export function useCompleteAuditSession() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useTenant();

  return useMutation({
    mutationFn: async ({ sessionId, status = "completed" }: { sessionId: string; status?: "completed" | "cancelled" }) => {
      const { data, error } = await supabase
        .from("policy_audit_sessions")
        .update({
          status,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", sessionId)
        .select()
        .single();

      if (error) throw error;

      if (currentOrganization?.id) {
        await logActivity(
          currentOrganization.id,
          `audit_${status}`,
          "policy_audit",
          sessionId,
          { policy_type: data.policy_type, policy_id: data.policy_id }
        );
      }

      return data as AuditSession;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["audit-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["audit-session-active"] });
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
    },
  });
}

export function useApproveFinding() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ findingId, approve }: { findingId: string; approve: boolean }) => {
      const { data, error } = await supabase
        .from("policy_audit_findings")
        .update({
          is_approved: approve,
          approved_by: approve ? user?.id || null : null,
          approved_at: approve ? new Date().toISOString() : null,
        })
        .eq("id", findingId)
        .select()
        .single();

      if (error) throw error;
      return data as AuditFinding;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["audit-findings"] });
    },
  });
}

export function useBulkApproveFindings() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ findingIds, approve }: { findingIds: string[]; approve: boolean }) => {
      const { error } = await supabase
        .from("policy_audit_findings")
        .update({
          is_approved: approve,
          approved_by: approve ? user?.id || null : null,
          approved_at: approve ? new Date().toISOString() : null,
        })
        .in("id", findingIds);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["audit-findings"] });
    },
  });
}
