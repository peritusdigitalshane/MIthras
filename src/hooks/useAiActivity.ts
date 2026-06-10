import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface AiActivityFilter {
    verdict?: "true_positive" | "false_positive" | "needs_human" | "inconclusive" | "all";
    status?: "completed" | "pending" | "failed" | "budget_exceeded" | "all";
    minConfidence?: number;           // 0..1
    sinceIso?: string | null;          // null = no lower bound
    autoClosedOnly?: boolean;
    reviewedOnly?: boolean;
    pageSize?: number;
    page?: number;
}

export interface AiActivityRow {
    id: string;
    alert_id: string;
    organization_id: string;
    status: string;
    verdict: string | null;
    confidence: number | null;
    summary: string | null;
    auto_closed: boolean;
    escalated_to_investigation: boolean;
    recommended_action: string | null;
    recommended_command: string | null;
    model: string | null;
    cost_cents: number;
    latency_ms: number | null;
    reviewed_by_user_id: string | null;
    reviewed_at: string | null;
    review_action: string | null;
    created_at: string;
    completed_at: string | null;
    alerts?: { title: string; severity: string; alert_type: string } | null;
    organizations?: { name: string } | null;
}

const PAGE_SIZE_DEFAULT = 50;

/**
 * Sortable, filterable AI Triage decision log. Super-admins see all orgs;
 * org members see their org only (RLS handles the boundary; we still scope
 * the query in the key so the cache stays tenant-correct).
 */
export function useAiActivity(filter: AiActivityFilter = {}) {
    const { currentOrganization, isSuperAdmin } = useTenant();
    const orgId = currentOrganization?.id;
    const pageSize = filter.pageSize ?? PAGE_SIZE_DEFAULT;
    const page = filter.page ?? 0;

    return useQuery({
        queryKey: [
            "ai-activity",
            orgId, isSuperAdmin,
            filter.verdict, filter.status, filter.minConfidence,
            filter.sinceIso, filter.autoClosedOnly, filter.reviewedOnly,
            page, pageSize,
        ],
        queryFn: async () => {
            let q = supabase
                .from("ai_triage_decisions")
                .select(
                    `id, alert_id, organization_id, status, verdict, confidence, summary,
                     auto_closed, escalated_to_investigation, recommended_action, recommended_command,
                     model, cost_cents, latency_ms,
                     reviewed_by_user_id, reviewed_at, review_action,
                     created_at, completed_at,
                     alerts:alert_id ( title, severity, alert_type ),
                     organizations:organization_id ( name )`,
                    { count: "exact" },
                )
                .order("created_at", { ascending: false })
                .range(page * pageSize, (page + 1) * pageSize - 1);

            if (orgId && !isSuperAdmin) q = q.eq("organization_id", orgId);
            if (filter.verdict && filter.verdict !== "all") q = q.eq("verdict", filter.verdict);
            if (filter.status && filter.status !== "all")   q = q.eq("status", filter.status);
            if (typeof filter.minConfidence === "number")    q = q.gte("confidence", filter.minConfidence);
            if (filter.sinceIso)                              q = q.gte("created_at", filter.sinceIso);
            if (filter.autoClosedOnly)                        q = q.eq("auto_closed", true);
            if (filter.reviewedOnly)                          q = q.not("reviewed_at", "is", null);

            const { data, error, count } = await q;
            if (error) throw error;

            return {
                rows: (data ?? []) as unknown as AiActivityRow[],
                total: count ?? 0,
                page,
                pageSize,
            };
        },
        enabled: isSuperAdmin || !!orgId,
        // Background refresh so live decisions filter in without manual reload.
        refetchInterval: 20_000,
    });
}

export interface AiActivityRollup {
    totalDecisions: number;
    truePositives: number;
    falsePositives: number;
    needsHuman: number;
    inconclusive: number;
    autoClosed: number;
    spendCents: number;
    avgLatencyMs: number | null;
}

export function useAiActivityRollup(sinceIso: string) {
    const { currentOrganization, isSuperAdmin } = useTenant();
    const orgId = currentOrganization?.id;
    return useQuery({
        queryKey: ["ai-activity-rollup", orgId, isSuperAdmin, sinceIso],
        queryFn: async (): Promise<AiActivityRollup> => {
            let q = supabase
                .from("ai_triage_decisions")
                .select("verdict, auto_closed, cost_cents, latency_ms")
                .eq("status", "completed")
                .gte("created_at", sinceIso);
            if (orgId && !isSuperAdmin) q = q.eq("organization_id", orgId);
            const { data, error } = await q;
            if (error) throw error;

            const rows = (data ?? []) as Array<{
                verdict: string | null;
                auto_closed: boolean;
                cost_cents: number;
                latency_ms: number | null;
            }>;
            let truePos = 0, falsePos = 0, needsH = 0, inconc = 0, autoC = 0, spend = 0, latencySum = 0, latencyCount = 0;
            for (const r of rows) {
                if (r.verdict === "true_positive") truePos++;
                else if (r.verdict === "false_positive") falsePos++;
                else if (r.verdict === "needs_human") needsH++;
                else if (r.verdict === "inconclusive") inconc++;
                if (r.auto_closed) autoC++;
                spend += r.cost_cents ?? 0;
                if (r.latency_ms != null) { latencySum += r.latency_ms; latencyCount++; }
            }
            return {
                totalDecisions: rows.length,
                truePositives: truePos,
                falsePositives: falsePos,
                needsHuman: needsH,
                inconclusive: inconc,
                autoClosed: autoC,
                spendCents: spend,
                avgLatencyMs: latencyCount > 0 ? Math.round(latencySum / latencyCount) : null,
            };
        },
        enabled: isSuperAdmin || !!orgId,
        refetchInterval: 30_000,
    });
}
