// Hooks for the /agents operator dashboard. Pulls aggregated KPIs +
// unified activity stream from the two SECURITY DEFINER RPCs that the
// migration ships.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

    // Comms Agent
    comms_emails_sent: number;
    comms_emails_failed: number;
    comms_confirm_clicks: number;
    comms_override_clicks: number;

    // Hunt Agent
    hunt_findings_open: number;
    hunt_findings_critical: number;
    hunt_findings_high: number;
    hunt_iocs_active: number;

    // Improvement Agent (super-admin only — both fields are null for tenants)
    improvement_reports_count: number | null;
    improvement_last_report_at: string | null;

    as_of: string;
}

// Improvement reports are super-admin only — exposed via get_improvement_reports RPC.
export interface ImprovementReport {
    id: string;
    period_start: string;
    period_end: string;
    agent_name: "triage"|"verification"|"adversarial"|"response"|"comms"|"hunt"|"overall";
    alerts_analyzed: number;
    accuracy_score: number | null;
    false_positive_rate: number | null;
    false_negative_rate: number | null;
    avg_confidence_calibration: number | null;
    top_failure_patterns: Array<{
        pattern: string;
        affected_alert_types: string[];
        frequency: number;
        likely_cause: string;
    }>;
    proposed_improvements: Array<{
        target_agent: string;
        improvement_kind: "prompt_update"|"threshold_change"|"playbook_change"|"schema_change"|"monitoring";
        recommendation: string;
        rationale: string;
        risk_level: "low"|"medium"|"high";
    }>;
    metrics_breakdown: Record<string, number>;
    summary: string | null;
    recommendations_summary: string | null;
    status: "drafted"|"reviewed"|"partially_applied"|"applied"|"dismissed"|"failed";
    reviewed_by: string | null;
    reviewed_at: string | null;
    reviewer_notes: string | null;
    cost_microcents: number;
    created_at: string;
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

// Super-admin only: list of improvement reports (last 30 by default).
export function useImprovementReports() {
    const { isSuperAdmin } = useTenant();
    return useQuery({
        queryKey: ["ai-improvement-reports"],
        queryFn: async () => {
            const { data, error } = await supabase.rpc("get_improvement_reports", { p_limit: 30 });
            if (error) throw error;
            return (data ?? []) as ImprovementReport[];
        },
        enabled: isSuperAdmin,
        refetchInterval: 60_000,
    });
}

// Super-admin only: fire the Improvement Agent manually.
export function useRunImprovementReview() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (args: { agent?: string; days?: number } = {}) => {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) throw new Error("not_signed_in");
            const url = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "");
            const resp = await fetch(`${url}/functions/v1/ai-improvement-review`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({
                    agent: args.agent ?? "overall",
                    days:  args.days  ?? 7,
                }),
            });
            const body = await resp.json();
            if (!resp.ok) throw new Error(body.error ?? `HTTP ${resp.status}`);
            return body;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["ai-improvement-reports"] });
            qc.invalidateQueries({ queryKey: ["ai-agent-dashboard"] });
        },
    });
}
