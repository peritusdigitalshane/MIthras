// Hooks for the /agents operator dashboard. Pulls aggregated KPIs +
// unified activity stream from the two SECURITY DEFINER RPCs that the
// migration ships.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface AgentDashboardData {
    window_hours: number;
    org_filter: string | null;
    alerts_orchestrated: number;
    autonomous_responses: number;
    auto_rollbacks: number;
    customer_confirmations: number;
    customer_overrides: number;
    avg_consensus_confidence: number | null;
    verification_agreement_rate: number | null;
    adversarial_fire_rate: number | null;
    adversarial_refutation_rate: number | null;
    disagreement_rate: number | null;
    verdict_distribution: Record<string, number> | null;
    final_verdict_distribution: Record<string, number> | null;
    total_cost_microcents: number;
    avg_cost_per_alert_microcents: number;
    as_of: string;
}

export interface AgentActivityRow {
    occurred_at: string;
    agent_name: "triage" | "verification" | "adversarial" | "response";
    event_kind: "verdict" | "action" | "rollback" | "confirm" | "override" | "orchestration";
    alert_id: string;
    triage_decision_id: string;
    organization_id: string;
    verdict: string | null;
    confidence: number | null;
    summary: string | null;
    extra: Record<string, unknown> | null;
}

export function useAgentDashboard(hours = 24) {
    const { currentOrganization, isSuperAdmin } = useTenant();
    const orgId = currentOrganization?.id ?? null;
    return useQuery({
        queryKey: ["ai-agent-dashboard", orgId, isSuperAdmin, hours],
        queryFn: async () => {
            // Super-admins pass null to see fleet-wide aggregates. Tenant
            // users pass their current org so non-super-admins always see
            // their own data.
            const p_org = isSuperAdmin ? null : orgId;
            const { data, error } = await supabase.rpc("get_ai_agent_dashboard", {
                p_org_id: p_org,
                p_hours: hours,
            });
            if (error) throw error;
            return data as AgentDashboardData;
        },
        enabled: !!orgId,
        refetchInterval: 15_000,
    });
}

export function useAgentActivity(limit = 100) {
    const { currentOrganization, isSuperAdmin } = useTenant();
    const orgId = currentOrganization?.id ?? null;
    return useQuery({
        queryKey: ["ai-agent-activity", orgId, isSuperAdmin, limit],
        queryFn: async () => {
            const p_org = isSuperAdmin ? null : orgId;
            const { data, error } = await supabase.rpc("get_ai_agent_activity", {
                p_org_id: p_org,
                p_limit: limit,
            });
            if (error) throw error;
            return (data ?? []) as AgentActivityRow[];
        },
        enabled: !!orgId,
        refetchInterval: 5_000,
    });
}
