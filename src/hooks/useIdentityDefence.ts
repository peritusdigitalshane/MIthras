import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";

export type RuleMode = "off" | "report_only" | "enforce";

export interface IdentityRule {
    id: string;
    organization_id: string;
    name: string;
    description: string | null;
    trigger_kind: string;
    trigger_config: Record<string, unknown>;
    applies_to: unknown;
    actions: Array<{ kind: string; severity?: string; [k: string]: unknown }>;
    mode: RuleMode;
    rate_limit_per_user_per_day: number;
    break_glass_users: string[];
    created_at: string;
    updated_at: string;
    enforce_started_at: string | null;
    last_evaluated_at: string | null;
    notes: string | null;
}

export interface IdentityAction {
    id: string;
    organization_id: string;
    rule_id: string | null;
    target_user: string;
    outcome: string;
    actions_taken: Array<Record<string, unknown>>;
    evidence: Record<string, unknown>;
    graph_response: unknown;
    error_message: string | null;
    reviewed_at: string | null;
    reviewed_by: string | null;
    review_verdict: string | null;
    review_note: string | null;
    created_at: string;
}

export interface IdentityOverview {
    rules_total: number;
    rules_enforced: number;
    rules_report_only: number;
    actions_last_24h: number;
    actions_enforced_24h: number;
    actions_report_only_24h: number;
    last_action_at: string | null;
}

export const TRIGGER_KIND_LABEL: Record<string, string> = {
    endpoint_defender_critical: "Endpoint — Defender critical detection",
    mailbox_rule_added:         "M365 — suspicious mailbox rule created",
    missing_mfa:                "M365 — user signed in without MFA registered",
    oauth_grant_by_non_admin:   "M365 — OAuth grant by non-admin (Phase B)",
};

export const ACTION_KIND_LABEL: Record<string, string> = {
    revoke_sessions:   "Revoke all M365 sessions",
    notify_soc:        "Alert SOC",
    isolate_endpoint:  "Isolate endpoint from network",
    disable_account:   "Disable M365 account (Phase B)",
};

// Pre-built rule templates the operator picks from. Each ships in
// report_only mode by default; operator promotes after watching dry runs.
export const RULE_TEMPLATES: Array<{
    key:           string;
    name:          string;
    description:   string;
    trigger_kind:  string;
    trigger_config: Record<string, unknown>;
    actions:       Array<{ kind: string; severity?: string }>;
}> = [
    {
        key:           "tpl_endpoint_defender_critical",
        name:          "Revoke sessions on critical Defender detection",
        description:   "When Microsoft Defender flags a Severe or High threat on a managed endpoint, kill the user's M365 sessions and isolate the endpoint from the network. Classic post-compromise containment.",
        trigger_kind:  "endpoint_defender_critical",
        trigger_config:{},
        actions: [
            { kind: "isolate_endpoint" },
            { kind: "revoke_sessions" },
            { kind: "notify_soc", severity: "critical" },
        ],
    },
    {
        key:           "tpl_mailbox_rule_added",
        name:          "Revoke sessions on suspicious mailbox rule",
        description:   "When a user creates an inbox rule that forwards externally or silently deletes inbound mail — the classic post-compromise tell — revoke their M365 sessions and alert the SOC. Works on any M365 plan; no Entra ID P1 required.",
        trigger_kind:  "mailbox_rule_added",
        trigger_config:{},
        actions: [
            { kind: "revoke_sessions" },
            { kind: "notify_soc", severity: "high" },
        ],
    },
    {
        key:           "tpl_missing_mfa_revoke",
        name:          "Enforce MFA enrollment — revoke sessions until registered",
        description:   "When a user signs in successfully but has no MFA method registered, kill their M365 sessions. They re-authenticate from scratch and complete MFA enrollment to get back in. Substitutes the MFA-enforcement half of Entra ID P1 ($6/user/mo) on any M365 plan including the free tier.",
        trigger_kind:  "missing_mfa",
        trigger_config:{},
        actions: [
            { kind: "revoke_sessions" },
            { kind: "notify_soc", severity: "medium" },
        ],
    },
];

export function useIdentityOverview() {
    const { currentOrganization } = useTenant();
    const orgId = currentOrganization?.id ?? null;
    return useQuery({
        queryKey: ["identity-overview", orgId],
        enabled: !!orgId,
        queryFn: async (): Promise<IdentityOverview | null> => {
            if (!orgId) return null;
            const { data, error } = await supabase.rpc("get_identity_defence_overview", { p_org_id: orgId });
            if (error) throw error;
            const row = Array.isArray(data) ? data[0] : data;
            return (row ?? null) as IdentityOverview | null;
        },
        refetchInterval: 30_000,
    });
}

export function useIdentityRules() {
    const { currentOrganization } = useTenant();
    const orgId = currentOrganization?.id ?? null;
    return useQuery({
        queryKey: ["identity-rules", orgId],
        enabled: !!orgId,
        queryFn: async (): Promise<IdentityRule[]> => {
            if (!orgId) return [];
            const { data, error } = await supabase
                .from("identity_access_rules")
                .select("*")
                .eq("organization_id", orgId)
                .order("created_at", { ascending: false });
            if (error) throw error;
            return (data ?? []) as IdentityRule[];
        },
    });
}

export function useIdentityActions(opts?: { limit?: number }) {
    const { currentOrganization } = useTenant();
    const orgId = currentOrganization?.id ?? null;
    const limit = opts?.limit ?? 100;
    return useQuery({
        queryKey: ["identity-actions", orgId, limit],
        enabled: !!orgId,
        queryFn: async (): Promise<IdentityAction[]> => {
            if (!orgId) return [];
            const { data, error } = await supabase
                .from("identity_actions")
                .select("*")
                .eq("organization_id", orgId)
                .order("created_at", { ascending: false })
                .limit(limit);
            if (error) throw error;
            return (data ?? []) as IdentityAction[];
        },
        refetchInterval: 60_000,
    });
}

export function useCreateRuleFromTemplate() {
    const { currentOrganization } = useTenant();
    const qc = useQueryClient();
    const { toast } = useToast();
    return useMutation({
        mutationFn: async (templateKey: string) => {
            const tpl = RULE_TEMPLATES.find((t) => t.key === templateKey);
            if (!tpl) throw new Error("template_not_found");
            if (!currentOrganization?.id) throw new Error("no_org");
            const { data: { user } } = await supabase.auth.getUser();
            const { error } = await supabase.from("identity_access_rules").insert({
                organization_id: currentOrganization.id,
                name:            tpl.name,
                description:     tpl.description,
                trigger_kind:    tpl.trigger_kind,
                trigger_config:  tpl.trigger_config,
                applies_to:      "all",
                actions:         tpl.actions,
                mode:            "report_only",
                created_by:      user?.id ?? null,
            });
            if (error) throw error;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["identity-rules"] });
            qc.invalidateQueries({ queryKey: ["identity-overview"] });
            toast({ title: "Rule added — report-only mode", description: "Watch the dry-run output for 24 hours before flipping to enforce." });
        },
        onError: (e: Error) => toast({ title: "Couldn't add rule", description: e.message, variant: "destructive" }),
    });
}

export function useUpdateRuleMode() {
    const qc = useQueryClient();
    const { toast } = useToast();
    return useMutation({
        mutationFn: async ({ ruleId, mode }: { ruleId: string; mode: RuleMode }) => {
            const { error } = await supabase.from("identity_access_rules")
                .update({ mode } as any)
                .eq("id", ruleId);
            if (error) throw error;
        },
        onSuccess: (_d, vars) => {
            qc.invalidateQueries({ queryKey: ["identity-rules"] });
            qc.invalidateQueries({ queryKey: ["identity-overview"] });
            toast({
                title: vars.mode === "enforce"
                    ? "Rule promoted to enforce"
                    : vars.mode === "report_only" ? "Rule set to report-only" : "Rule disabled",
            });
        },
        onError: (e: Error) => toast({ title: "Couldn't update rule", description: e.message, variant: "destructive" }),
    });
}

export function useDeleteRule() {
    const qc = useQueryClient();
    const { toast } = useToast();
    return useMutation({
        mutationFn: async (ruleId: string) => {
            const { error } = await supabase.from("identity_access_rules").delete().eq("id", ruleId);
            if (error) throw error;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["identity-rules"] });
            qc.invalidateQueries({ queryKey: ["identity-overview"] });
            toast({ title: "Rule deleted" });
        },
        onError: (e: Error) => toast({ title: "Couldn't delete rule", description: e.message, variant: "destructive" }),
    });
}

// Kill switch — flip every enforce-mode rule to report-only in one click.
// Logged + visible on the actions ledger.
export function usePauseAllEnforcement() {
    const { currentOrganization } = useTenant();
    const qc = useQueryClient();
    const { toast } = useToast();
    return useMutation({
        mutationFn: async () => {
            if (!currentOrganization?.id) throw new Error("no_org");
            const { error } = await supabase.from("identity_access_rules")
                .update({ mode: "report_only" } as any)
                .eq("organization_id", currentOrganization.id)
                .eq("mode", "enforce");
            if (error) throw error;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["identity-rules"] });
            qc.invalidateQueries({ queryKey: ["identity-overview"] });
            toast({ title: "All enforcement paused", description: "Every rule moved to report-only. Promote them back individually when you're ready." });
        },
        onError: (e: Error) => toast({ title: "Couldn't pause enforcement", description: e.message, variant: "destructive" }),
    });
}
