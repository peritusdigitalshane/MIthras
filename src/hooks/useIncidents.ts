import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export type IncidentStatus = "open" | "triaging" | "in_progress" | "resolved" | "false_positive";
export type IncidentSeverity = "Severe" | "High" | "Moderate" | "Low";

export interface Incident {
  id: string;
  organization_id: string;
  endpoint_id: string | null;
  alert_id: string | null;
  threat_id: string | null;
  kind: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  title: string;
  description: string | null;
  assignee_id: string | null;
  assigned_at: string | null;
  opened_at: string;
  sla_due_at: string;
  triaged_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_notes: string | null;
  created_at: string;
  updated_at: string;
  // AI Commander surface (populated by ai-incident-commander)
  commander_summary: string | null;
  commander_kind: string | null;
  commander_model: string | null;
  commander_cost_microcents: number | null;
  commander_last_action_at: string | null;
  playbook_step: string | null;
  playbook_state: Record<string, unknown> | null;
  triage_decision_id: string | null;
  investigation_id: string | null;
  endpoint?: { id: string; hostname: string } | null;
}

/**
 * Single-incident loader used by /incidents/:id. Fetches the row with
 * endpoint join; the page composes the rest (triage / investigation /
 * response / comms) from their own hooks keyed on alert_id.
 */
export function useIncident(incidentId: string | undefined) {
  return useQuery({
    queryKey: ["incident", incidentId],
    enabled: !!incidentId,
    queryFn: async (): Promise<Incident | null> => {
      const { data, error } = await supabase
        .from("incidents")
        .select("*, endpoint:endpoints!incidents_endpoint_id_fkey(id, hostname)")
        .eq("id", incidentId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as unknown as Incident | null;
    },
    refetchInterval: 30_000,
  });
}

const OPEN_STATUSES: IncidentStatus[] = ["open", "triaging", "in_progress"];

export function useIncidents(opts?: { onlyOpen?: boolean }) {
  const { currentOrganization, isSuperAdmin } = useTenant();
  const orgId = currentOrganization?.id ?? null;
  const enabled = !!orgId || isSuperAdmin;
  const onlyOpen = opts?.onlyOpen ?? false;
  return useQuery({
    queryKey: ["incidents", orgId, isSuperAdmin, onlyOpen],
    enabled,
    queryFn: async (): Promise<Incident[]> => {
      let q = supabase
        .from("incidents")
        .select("*, endpoint:endpoints!incidents_endpoint_id_fkey(id, hostname)")
        .order("opened_at", { ascending: false })
        .limit(500);
      // Tenant scoping: non-super-admins are pinned to their current org.
      // Super-admins with an orgId in context see all orgs (RLS still
      // applies). The earlier unconditional second `.eq()` silently scoped
      // super-admins back to one org.
      if (orgId && !isSuperAdmin) q = q.eq("organization_id", orgId);
      if (onlyOpen) q = q.in("status", OPEN_STATUSES);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Incident[];
    },
    refetchInterval: 30_000,
  });
}

// In-flight status progression: open → triaging → in_progress.
// Terminal states (resolved / false_positive) still flow through useResolveIncident
// so the resolution_notes + resolved_by trail is captured.
export function useUpdateIncidentStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { incidentId: string; status: "open" | "triaging" | "in_progress" }) => {
      const patch: Record<string, unknown> = { status: args.status };
      if (args.status === "triaging" || args.status === "in_progress") {
        patch.triaged_at = new Date().toISOString();
      }
      const { error } = await supabase
        .from("incidents")
        .update(patch)
        .eq("id", args.incidentId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["incidents"] });
      // SOC counter strip displays active_threats / openAlerts which derive
      // from incident state. Without this the strip shows stale counts
      // until the 15s poll.
      qc.invalidateQueries({ queryKey: ["soc-counters"] });
    },
  });
}

// Org-member list for the assignee dropdown.
//
// There's no FK from organization_memberships.user_id → profiles.id (both
// reference auth.users.id), so we can't use PostgREST embed syntax. Two
// queries: memberships first, then profiles, joined client-side.
export function useOrgMembers() {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id ?? null;
  return useQuery({
    queryKey: ["org-members", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const memRes = await supabase
        .from("organization_memberships")
        .select("user_id, role")
        .eq("organization_id", orgId!);
      if (memRes.error) throw new Error(memRes.error.message);

      const userIds = (memRes.data ?? []).map((m: any) => m.user_id as string);
      if (userIds.length === 0) return [];

      const profRes = await supabase
        .from("profiles")
        .select("id, email, display_name")
        .in("id", userIds);
      if (profRes.error) throw new Error(profRes.error.message);

      const byId = new Map<string, { email: string | null; display_name: string | null }>();
      for (const p of (profRes.data ?? []) as any[]) {
        byId.set(p.id as string, { email: p.email, display_name: p.display_name });
      }

      return (memRes.data ?? []).map((r: any) => {
        const prof = byId.get(r.user_id as string);
        return {
          user_id: r.user_id as string,
          role: r.role as "owner" | "admin" | "member",
          email: prof?.email ?? null,
          display_name: prof?.display_name ?? null,
        };
      });
    },
  });
}

export function useAssignIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { incidentId: string; assignee: string | null }) => {
      const { data, error } = await supabase.rpc("assign_incident", {
        p_incident_id: args.incidentId,
        p_assignee: args.assignee,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["incidents"] });
      // SOC counter strip displays active_threats / openAlerts which derive
      // from incident state. Without this the strip shows stale counts
      // until the 15s poll.
      qc.invalidateQueries({ queryKey: ["soc-counters"] });
    },
  });
}

export function useResolveIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { incidentId: string; outcome: "resolved" | "false_positive"; notes?: string }) => {
      const { data, error } = await supabase.rpc("resolve_incident", {
        p_incident_id: args.incidentId,
        p_outcome: args.outcome,
        p_notes: args.notes ?? null,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["incidents"] });
      // SOC counter strip displays active_threats / openAlerts which derive
      // from incident state. Without this the strip shows stale counts
      // until the 15s poll.
      qc.invalidateQueries({ queryKey: ["soc-counters"] });
    },
  });
}
