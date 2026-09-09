import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";

export interface CaPolicy {
    id: string;
    m365_tenant_id: string;
    organization_id: string;
    policy_id: string;
    display_name: string;
    state: "enabled" | "disabled" | "enabledForReportingNotEnforced" | string;
    conditions: Record<string, unknown>;
    grant_controls: Record<string, unknown> | null;
    session_controls: Record<string, unknown> | null;
    created_datetime: string | null;
    modified_datetime: string | null;
    fetched_at: string;
    deleted_at: string | null;
}

export interface CaFinding {
    id: string;
    m365_tenant_id: string;
    organization_id: string;
    finding_key: string;
    severity: "critical" | "high" | "medium" | "low" | "info";
    title: string;
    body: string;
    recommended_action: string;
    entra_deep_link: string;
    related_policy_ids: string[];
    acknowledged_at: string | null;
    acknowledged_by: string | null;
    acknowledged_note: string | null;
    created_at: string;
}

export interface CaOverview {
    tenant_count: number;
    policies_total: number;
    policies_enabled: number;
    policies_report_only: number;
    findings_open: number;
    findings_critical: number;
    last_fetched_at: string | null;
}

export function useCaOverview() {
    const { currentOrganization } = useTenant();
    const orgId = currentOrganization?.id ?? null;
    return useQuery({
        queryKey: ["ca-overview", orgId],
        enabled: !!orgId,
        queryFn: async (): Promise<CaOverview | null> => {
            if (!orgId) return null;
            const { data, error } = await supabase.rpc("get_m365_ca_overview", { p_org_id: orgId });
            if (error) throw error;
            const row = Array.isArray(data) ? data[0] : data;
            return (row ?? null) as CaOverview | null;
        },
        refetchInterval: 60_000,
    });
}

export function useCaPolicies() {
    const { currentOrganization } = useTenant();
    const orgId = currentOrganization?.id ?? null;
    return useQuery({
        queryKey: ["ca-policies", orgId],
        enabled: !!orgId,
        queryFn: async (): Promise<CaPolicy[]> => {
            if (!orgId) return [];
            const { data, error } = await supabase
                .from("m365_ca_policies")
                .select("*")
                .eq("organization_id", orgId)
                .is("deleted_at", null)
                .order("display_name", { ascending: true });
            if (error) throw error;
            return (data ?? []) as CaPolicy[];
        },
    });
}

export function useCaFindings(opts?: { includeAcknowledged?: boolean }) {
    const { currentOrganization } = useTenant();
    const orgId = currentOrganization?.id ?? null;
    const includeAck = opts?.includeAcknowledged ?? false;
    return useQuery({
        queryKey: ["ca-findings", orgId, includeAck],
        enabled: !!orgId,
        queryFn: async (): Promise<CaFinding[]> => {
            if (!orgId) return [];
            let q = supabase
                .from("m365_ca_findings")
                .select("*")
                .eq("organization_id", orgId)
                .order("created_at", { ascending: false });
            if (!includeAck) q = q.is("acknowledged_at", null);
            const { data, error } = await q;
            if (error) throw error;
            return (data ?? []) as CaFinding[];
        },
    });
}

// Fire an on-demand CA poll. Refresh the policies + findings lists once
// the function returns. tenant_pk omitted → poll every connected tenant.
export function useRefreshCa() {
    const qc = useQueryClient();
    const { toast } = useToast();
    return useMutation({
        mutationFn: async (vars: { tenantPk?: string } = {}) => {
            const { data, error } = await supabase.functions.invoke("m365-ca-poll", {
                method: "POST",
                body:   vars.tenantPk ? { tenant_pk: vars.tenantPk } : {},
            });
            if (error) throw error;
            return data;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["ca-policies"] });
            qc.invalidateQueries({ queryKey: ["ca-findings"] });
            qc.invalidateQueries({ queryKey: ["ca-overview"] });
            toast({ title: "Conditional Access refreshed", description: "Latest policies + AI gap analysis are in." });
        },
        onError: (e: Error) =>
            toast({ title: "Refresh failed", description: e.message, variant: "destructive" }),
    });
}

export function useAcknowledgeCaFinding() {
    const qc = useQueryClient();
    const { toast } = useToast();
    return useMutation({
        mutationFn: async (vars: { findingId: string; note?: string }) => {
            const { data: { user } } = await supabase.auth.getUser();
            const { error } = await supabase
                .from("m365_ca_findings")
                .update({
                    acknowledged_at:   new Date().toISOString(),
                    acknowledged_by:   user?.id ?? null,
                    acknowledged_note: vars.note ?? null,
                } as any)
                .eq("id", vars.findingId);
            if (error) throw error;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["ca-findings"] });
            qc.invalidateQueries({ queryKey: ["ca-overview"] });
            toast({ title: "Finding acknowledged" });
        },
        onError: (e: Error) =>
            toast({ title: "Couldn't acknowledge", description: e.message, variant: "destructive" }),
    });
}
