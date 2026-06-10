// Hook for the Hunt Agent surfaces. Wraps get_hunt_findings_for_tenant —
// the SECURITY DEFINER RPC that redacts the affected_tenant_ids list down
// to "you + N others" before returning.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface HuntFinding {
    id: string;
    finding_kind:
        | "cross_tenant_ip" | "cross_tenant_hash" | "cross_tenant_domain"
        | "cross_tenant_command_line" | "cross_tenant_mailbox_rule"
        | "cross_tenant_oauth_grant" | "novel_pattern" | "systematic_miss";
    shared_indicator: { value: string; kind?: string } & Record<string, unknown>;
    other_tenant_count: number;
    tenant_count: number;
    sample_event_count: number;
    event_window_start: string;
    event_window_end: string;
    severity: "low" | "medium" | "high" | "critical";
    confidence: number | null;
    summary: string | null;
    recommended_action: string | null;
    status: "open" | "acknowledged" | "dismissed" | "resolved";
    created_at: string;
    updated_at: string;
}

export function useHuntFindings(status: "open" | "all" | "acknowledged" | "resolved" = "open") {
    const { currentOrganization, isSuperAdmin } = useTenant();
    return useQuery({
        queryKey: ["hunt-findings", currentOrganization?.id, isSuperAdmin, status],
        queryFn: async () => {
            const p_org = isSuperAdmin ? null : (currentOrganization?.id ?? null);
            const { data, error } = await supabase.rpc("get_hunt_findings_for_tenant", {
                p_org_id: p_org,
                p_status: status,
                p_limit:  100,
            });
            if (error) throw error;
            return (data ?? []) as HuntFinding[];
        },
        enabled: !!currentOrganization?.id,
        refetchInterval: 60_000,
    });
}
