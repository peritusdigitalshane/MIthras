import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

const FUNCTIONS_BASE = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "");

/**
 * Every per-alert AI query is scoped by the user's current organisation
 * in the key. That way a) cache entries don't bleed across orgs on
 * impersonation/org-switch, and b) the global invalidate("ai-triage")
 * inside review mutations doesn't punch through every cached org.
 */

export interface Citation {
    table: string;
    row_id: string;
}

export interface KeyIndicator { indicator: string; citation: Citation; }
export interface ReasoningStep { step: string; citation: Citation; }

export interface AiTriageDecision {
    id: string;
    alert_id: string;
    organization_id: string;
    status: "pending" | "completed" | "failed" | "budget_exceeded" | "skipped";
    verdict: "true_positive" | "false_positive" | "needs_human" | "inconclusive" | null;
    confidence: number | null;
    summary: string | null;
    key_indicators: KeyIndicator[];
    reasoning_steps: ReasoningStep[];
    recommended_action: string | null;
    recommended_command: string | null;
    mitre_tags: string[];
    auto_closed: boolean;
    escalated_to_investigation: boolean;
    model: string | null;
    cost_cents: number;
    latency_ms: number | null;
    error_message: string | null;
    reviewed_by_user_id: string | null;
    reviewed_at: string | null;
    review_action: "approved" | "overridden" | "dismissed" | null;
    review_notes: string | null;
    created_at: string;
    completed_at: string | null;

    // Multi-agent consensus fields (phase 1 of autonomous SOC).
    // verdict/confidence above are now specifically "Triage agent's view".
    // final_verdict/final_confidence are the post-consensus answer that
    // drives auto-close + auto-response.
    final_verdict: "true_positive" | "false_positive" | "needs_human" | "inconclusive" | null;
    final_confidence: number | null;
    disagreement_detected: boolean;
    adversarial_refuted: boolean | null;
    consensus_reasoning: string | null;
    orchestration_state: "pending" | "triaged" | "verified" | "completed" | "failed" | "budget_exceeded";
}

// Per-agent verdict row. One per (triage_decision, agent_name) — see
// ai_agent_verdicts table.
export interface Refutation {
    argument: string;
    citation: Citation;
    strength: "weak" | "moderate" | "strong";
}

export interface AgentVerdict {
    id: string;
    triage_decision_id: string;
    alert_id: string;
    organization_id: string;
    agent_name: "triage" | "verification" | "adversarial";
    verdict:
        | "true_positive" | "false_positive" | "needs_human" | "inconclusive"
        | "refuted" | "not_refuted" | null;
    confidence: number | null;
    summary: string | null;
    key_indicators: KeyIndicator[];
    reasoning_steps: ReasoningStep[];
    refutations: Refutation[];
    model: string | null;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    cost_microcents: number;
    latency_ms: number | null;
    error_message: string | null;
    created_at: string;
}

export interface TimelineEntry {
    occurred_at: string;
    event_text: string;
    severity: "info" | "low" | "medium" | "high" | "critical";
    citation: Citation;
}

export interface AffectedAsset {
    asset_type: string;
    asset_id: string;
    asset_name: string;
    citation: Citation;
}

export interface RecommendedAction {
    action: string;
    rationale: string;
    citation: Citation;
}

export interface AiInvestigation {
    id: string;
    alert_id: string;
    organization_id: string;
    triage_decision_id: string | null;
    status: "pending" | "completed" | "failed" | "budget_exceeded";
    incident_summary: string | null;
    timeline: TimelineEntry[];
    affected_assets: AffectedAsset[];
    attack_chain_analysis: string | null;
    suggested_containment: RecommendedAction[];
    suggested_eradication: RecommendedAction[];
    customer_report_markdown: string | null;
    mitre_tags: string[];
    model: string | null;
    cost_cents: number;
    latency_ms: number | null;
    error_message: string | null;
    reviewed_by_user_id: string | null;
    reviewed_at: string | null;
    customer_notified_at: string | null;
    created_at: string;
    completed_at: string | null;
}

async function callFn(fn: string, body: Record<string, unknown>) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Not signed in");
    const resp = await fetch(`${FUNCTIONS_BASE}/functions/v1/${fn}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(body),
    });
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error ?? `HTTP ${resp.status}`);
    return json;
}

export function useAiTriageDecision(alertId: string | undefined) {
    const { currentOrganization } = useTenant();
    return useQuery({
        queryKey: ["ai-triage", alertId, currentOrganization?.id],
        queryFn: async () => {
            if (!alertId) return null;
            const { data, error } = await supabase
                .from("ai_triage_decisions").select("*")
                .eq("alert_id", alertId).maybeSingle();
            if (error) throw error;
            return (data as AiTriageDecision | null) ?? null;
        },
        enabled: !!alertId,
        // Poll while pending so the UI auto-updates when the agent finishes.
        refetchInterval: (q) => {
            const d = q.state.data as AiTriageDecision | null;
            return d?.status === "pending" ? 2_000 : false;
        },
    });
}

/**
 * Fetch the per-agent verdict trail for a triage decision.
 *
 * Returns one row per agent that has run (triage, verification, adversarial).
 * Empty array for pre-multi-agent decisions or in-flight decisions where the
 * orchestrator hasn't kicked in yet. The MultiAgentVerdictTrail component
 * handles both states (legacy single-agent vs full trail).
 */
export function useAgentVerdicts(triageDecisionId: string | undefined) {
    const { currentOrganization } = useTenant();
    return useQuery({
        queryKey: ["ai-agent-verdicts", triageDecisionId, currentOrganization?.id],
        queryFn: async () => {
            if (!triageDecisionId) return [] as AgentVerdict[];
            const { data, error } = await supabase
                .from("ai_agent_verdicts").select("*")
                .eq("triage_decision_id", triageDecisionId)
                // Stable order so the UI columns don't reshuffle as agents complete.
                .order("agent_name", { ascending: true });
            if (error) throw error;
            return (data ?? []) as AgentVerdict[];
        },
        enabled: !!triageDecisionId,
        // Poll while orchestration is in flight so verdicts appear as they land.
        refetchInterval: (q) => {
            const list = (q.state.data ?? []) as AgentVerdict[];
            return list.length < 3 ? 2_000 : false;
        },
    });
}

export function useAiInvestigation(alertId: string | undefined) {
    const { currentOrganization } = useTenant();
    return useQuery({
        queryKey: ["ai-investigation", alertId, currentOrganization?.id],
        queryFn: async () => {
            if (!alertId) return null;
            const { data, error } = await supabase
                .from("ai_investigations").select("*")
                .eq("alert_id", alertId).maybeSingle();
            if (error) throw error;
            return (data as AiInvestigation | null) ?? null;
        },
        enabled: !!alertId,
        refetchInterval: (q) => {
            const d = q.state.data as AiInvestigation | null;
            return d?.status === "pending" ? 3_000 : false;
        },
    });
}

export function useAiTriageDecisions() {
    const { currentOrganization } = useTenant();
    return useQuery({
        queryKey: ["ai-triage-list", currentOrganization?.id],
        queryFn: async () => {
            if (!currentOrganization?.id) return [];
            const { data, error } = await supabase
                .from("ai_triage_decisions").select("*")
                .eq("organization_id", currentOrganization.id)
                .order("created_at", { ascending: false }).limit(200);
            if (error) throw error;
            return (data ?? []) as AiTriageDecision[];
        },
        enabled: !!currentOrganization?.id,
    });
}

// Shared list of query-key prefixes invalidated after a triage or
// investigation. Keeps every surface (alerts page, SOC console KPI strip,
// activity feed) in sync when an agent decision lands.
const AI_AFFECTED_KEYS = [
    "ai-triage",
    "ai-investigation",
    "ai-triage-list",
    "alerts",
    "soc-counters",
    "soc-ai-activity",
    "soc-alerts-feed",
    // Distinct from soc-ai-activity — this is the standalone /admin/ai-activity
    // feed (useAiActivity hook) which renders reviewer decisions. Without
    // this invalidation an operator's approve/override stays stale until
    // navigation away and back.
    "ai-activity",
];

function invalidateAiSurfaces(qc: ReturnType<typeof useQueryClient>) {
    for (const key of AI_AFFECTED_KEYS) {
        qc.invalidateQueries({ queryKey: [key] });
    }
}

export function useRunTriage() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ alertId, force }: { alertId: string; force?: boolean }) => {
            return await callFn("ai-triage-alert", { alert_id: alertId, force: !!force });
        },
        onSettled: () => invalidateAiSurfaces(qc),
    });
}

export function useRunInvestigation() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ alertId, force }: { alertId: string; force?: boolean }) => {
            return await callFn("ai-investigate-alert", { alert_id: alertId, force: !!force });
        },
        onSettled: () => invalidateAiSurfaces(qc),
    });
}

export function useReviewTriageDecision() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (args: {
            decisionId: string;
            action: "approved" | "overridden" | "dismissed";
            notes?: string;
        }) => {
            const { data: { user } } = await supabase.auth.getUser();
            const { error } = await supabase.from("ai_triage_decisions").update({
                reviewed_by_user_id: user?.id ?? null,
                reviewed_at: new Date().toISOString(),
                review_action: args.action,
                review_notes: args.notes ?? null,
            }).eq("id", args.decisionId);
            if (error) throw error;
        },
        // Use the shared helper so reviewer overrides also invalidate
        // ai-investigation, soc-ai-activity, and the SOC counter keys -
        // otherwise the side-by-side investigation panel and SOC dashboard
        // stay stale until the operator navigates away and back.
        onSettled: () => invalidateAiSurfaces(qc),
    });
}
