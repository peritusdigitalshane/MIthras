import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

/**
 * SOC dashboard data: org-wide rollups across alerts, AI agents, endpoints,
 * threats, M365 ITDR. Super-admins see all orgs; org members see only theirs
 * — RLS enforces it.
 *
 * Live updates: each query has a Realtime channel that invalidates on
 * relevant inserts/updates so the dashboard refreshes without polling.
 */

export interface SocCounters {
    openAlerts: number;
    criticalAlerts: number;
    aiTriagedToday: number;
    autoClosedToday: number;
    investigationsToday: number;
    aiSpendCentsToday: number;
    activeThreats: number;
    onlineEndpoints: number;
    totalEndpoints: number;
    m365ConnectedTenants: number;
    m365RiskySignIns24h: number;
    m365ExternalForwardRules: number;
}

interface CountResult { count: number | null }

export function useSocCounters() {
    const { currentOrganization, isSuperAdmin } = useTenant();
    const orgId = currentOrganization?.id;

    const q = useQuery({
        queryKey: ["soc-counters", orgId, isSuperAdmin],
        queryFn: async (): Promise<SocCounters> => {
            const todayStart = new Date();
            todayStart.setUTCHours(0, 0, 0, 0);
            const todayIso = todayStart.toISOString();
            const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

            const scope = <T,>(q: T): T => {
                if (orgId && !isSuperAdmin) {
                    return (q as unknown as { eq: (col: string, v: string) => T }).eq("organization_id", orgId);
                }
                return q;
            };

            const [
                openAlerts, critical, triagedToday, closedToday, investigationsToday,
                aiSpend, activeThreats, endpoints, m365Tenants, m365Risky, m365Fwd,
            ] = await Promise.all([
                scope(supabase.from("alerts").select("*", { count: "exact", head: true }).eq("acknowledged", false)).then((r: CountResult) => r.count ?? 0),
                scope(supabase.from("alerts").select("*", { count: "exact", head: true }).eq("acknowledged", false).eq("severity", "critical")).then((r: CountResult) => r.count ?? 0),
                scope(supabase.from("ai_triage_decisions").select("*", { count: "exact", head: true }).gte("created_at", todayIso)).then((r: CountResult) => r.count ?? 0),
                scope(supabase.from("ai_triage_decisions").select("*", { count: "exact", head: true }).gte("created_at", todayIso).eq("auto_closed", true)).then((r: CountResult) => r.count ?? 0),
                scope(supabase.from("ai_investigations").select("*", { count: "exact", head: true }).gte("created_at", todayIso)).then((r: CountResult) => r.count ?? 0),
                (async () => {
                    const triage = scope(supabase.from("ai_triage_decisions").select("cost_cents").gte("created_at", todayIso));
                    const invest = scope(supabase.from("ai_investigations").select("cost_cents").gte("created_at", todayIso));
                    const [{ data: t }, { data: i }] = await Promise.all([triage, invest]);
                    return ((t ?? []).reduce((s: number, r: { cost_cents: number }) => s + (r.cost_cents ?? 0), 0)
                        + (i ?? []).reduce((s: number, r: { cost_cents: number }) => s + (r.cost_cents ?? 0), 0));
                })(),
                // Defender stores statuses Title-case (Active/Cleaning/Blocked/...). The
                // open-incident trigger keys off ('Active','Cleaning'); 'Allowed' and
                // 'Executing' are also outstanding from a SOC perspective. Matches the
                // open_incident_from_threat predicate, plus the executable-states that
                // an analyst would consider unresolved.
                scope(supabase.from("endpoint_threats").select("*", { count: "exact", head: true }).in("status", ["Active", "Cleaning", "Allowed", "Executing"])).then((r: CountResult) => r.count ?? 0),
                (async () => {
                    const total  = scope(supabase.from("endpoints").select("*", { count: "exact", head: true }).is("deleted_at", null));
                    const online = scope(supabase.from("endpoints").select("*", { count: "exact", head: true }).is("deleted_at", null).gte("last_seen_at", dayAgo));
                    const [{ count: t }, { count: o }] = await Promise.all([total, online]);
                    return { total: t ?? 0, online: o ?? 0 };
                })(),
                scope(supabase.from("m365_tenants_view").select("id", { count: "exact", head: true }).eq("consent_state", "active")).then((r: CountResult) => r.count ?? 0),
                scope(supabase.from("m365_sign_in_events").select("*", { count: "exact", head: true }).gte("occurred_at", dayAgo).in("risk_level", ["medium", "high"])).then((r: CountResult) => r.count ?? 0),
                scope(supabase.from("m365_mailbox_rules").select("*", { count: "exact", head: true }).eq("forwards_externally", true).eq("is_active", true)).then((r: CountResult) => r.count ?? 0),
            ]);

            return {
                openAlerts, criticalAlerts: critical,
                aiTriagedToday: triagedToday,
                autoClosedToday: closedToday,
                investigationsToday,
                aiSpendCentsToday: aiSpend,
                activeThreats,
                onlineEndpoints: endpoints.online,
                totalEndpoints: endpoints.total,
                m365ConnectedTenants: m365Tenants,
                m365RiskySignIns24h: m365Risky,
                m365ExternalForwardRules: m365Fwd,
            };
        },
        refetchInterval: 15_000,
    });

    useRealtimeRefetch(["alerts", "ai_triage_decisions", "ai_investigations"], () => q.refetch());

    return q;
}

export interface AiActivityRow {
    id: string;
    alert_id: string;
    status: string;
    verdict: string | null;
    confidence: number | null;
    summary: string | null;
    auto_closed: boolean;
    cost_cents: number;
    created_at: string;
    alerts?: { title: string; severity: string } | null;
}

export function useRecentAiActivity(limit = 30) {
    const { currentOrganization, isSuperAdmin } = useTenant();
    const orgId = currentOrganization?.id;
    const q = useQuery({
        queryKey: ["soc-ai-activity", orgId, isSuperAdmin, limit],
        queryFn: async () => {
            let q = supabase.from("ai_triage_decisions")
                .select("id, alert_id, status, verdict, confidence, summary, auto_closed, cost_cents, created_at, alerts:alert_id(title, severity)")
                .order("created_at", { ascending: false })
                .limit(limit);
            if (orgId && !isSuperAdmin) q = q.eq("organization_id", orgId);
            const { data, error } = await q;
            if (error) throw error;
            return (data ?? []) as unknown as AiActivityRow[];
        },
        // Without an org context, a non-super-admin would hit RLS for nothing
        // — and worse, the "no orgId" path skips the .eq filter entirely.
        // Disable until the tenant is known.
        enabled: isSuperAdmin || !!orgId,
        refetchInterval: 15_000,
    });
    useRealtimeRefetch(["ai_triage_decisions"], () => q.refetch());
    return q;
}

export interface AlertFeedRow {
    id: string;
    alert_type: string;
    severity: string;
    title: string;
    message: string;
    acknowledged: boolean;
    created_at: string;
    endpoints?: { hostname: string } | null;
}

export function useRecentAlertsFeed(limit = 40) {
    const { currentOrganization, isSuperAdmin } = useTenant();
    const orgId = currentOrganization?.id;
    const q = useQuery({
        queryKey: ["soc-alerts-feed", orgId, isSuperAdmin, limit],
        queryFn: async () => {
            let q = supabase.from("alerts")
                .select("id, alert_type, severity, title, message, acknowledged, created_at, endpoints:endpoint_id(hostname)")
                .order("created_at", { ascending: false })
                .limit(limit);
            if (orgId && !isSuperAdmin) q = q.eq("organization_id", orgId);
            const { data, error } = await q;
            if (error) throw error;
            return (data ?? []) as unknown as AlertFeedRow[];
        },
        enabled: isSuperAdmin || !!orgId,
        refetchInterval: 15_000,
    });
    useRealtimeRefetch(["alerts"], () => q.refetch());
    return q;
}

export interface OrgPosture {
    organization_id: string;
    organization_name: string;
    endpoints: number;
    open_alerts: number;
    critical_alerts: number;
    active_threats: number;
    ai_triages_today: number;
    last_alert_at: string | null;
}

export function useOrgPosture() {
    const { isSuperAdmin } = useTenant();
    return useQuery({
        queryKey: ["soc-org-posture", isSuperAdmin],
        queryFn: async (): Promise<OrgPosture[]> => {
            const todayStart = new Date();
            todayStart.setUTCHours(0, 0, 0, 0);
            const todayIso = todayStart.toISOString();

            const { data: orgs } = await supabase
                .from("organizations").select("id, name").order("name");
            const ids = (orgs ?? []).map((o: { id: string }) => o.id);
            if (ids.length === 0) return [];

            // Pull counts in parallel; RLS will already trim non-super to one row.
            const counts = await Promise.all(ids.map(async (orgId: string) => {
                // endpoint_threats has NO organization_id column - tenancy is
                // enforced through the FK to endpoints. The old query filtered
                // on the non-existent column AND used lowercase 'active' vs
                // the schema's title-case CHECK ('Active'). Net effect: the
                // active_threats column on the SOC org grid was permanently
                // 0 for every org. Scope via the join + use the title-case
                // status values from endpoint_threats_status_check.
                const [{ count: ep }, { count: alerts }, { count: critical }, { count: threats }, { count: ai }, { data: latest }] = await Promise.all([
                    supabase.from("endpoints").select("*", { count: "exact", head: true }).eq("organization_id", orgId).is("deleted_at", null),
                    supabase.from("alerts").select("*", { count: "exact", head: true }).eq("organization_id", orgId).eq("acknowledged", false),
                    supabase.from("alerts").select("*", { count: "exact", head: true }).eq("organization_id", orgId).eq("acknowledged", false).eq("severity", "critical"),
                    supabase.from("endpoint_threats")
                        .select("id, endpoints!inner(organization_id)", { count: "exact", head: true })
                        .eq("endpoints.organization_id", orgId)
                        .in("status", ["Active", "Cleaning", "Allowed", "Executing"]),
                    supabase.from("ai_triage_decisions").select("*", { count: "exact", head: true }).eq("organization_id", orgId).gte("created_at", todayIso),
                    supabase.from("alerts").select("created_at").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
                ]);
                return {
                    organization_id: orgId,
                    endpoints: ep ?? 0,
                    open_alerts: alerts ?? 0,
                    critical_alerts: critical ?? 0,
                    active_threats: threats ?? 0,
                    ai_triages_today: ai ?? 0,
                    last_alert_at: (latest as { created_at?: string } | null)?.created_at ?? null,
                };
            }));

            return counts.map((c, i) => ({
                ...c,
                organization_name: orgs![i].name,
            }));
        },
        refetchInterval: 30_000,
        enabled: isSuperAdmin,
    });
}

// ----------------------------------------------------------------------------
// Realtime helper
// ----------------------------------------------------------------------------

function useRealtimeRefetch(tables: string[], refetch: () => void) {
    // Capture refetch in a ref so subscription callbacks always invoke
    // the latest closure. Without this, a query-key change (org switch)
    // hands TanStack Query a new refetch; the channel's bound callback
    // still points at the old one and effectively no-ops.
    const refetchRef = useRef(refetch);
    useEffect(() => { refetchRef.current = refetch; }, [refetch]);

    useEffect(() => {
        const channelName = `soc-${tables.join("-")}-${Math.random().toString(36).slice(2, 8)}`;
        const channel = supabase.channel(channelName);
        for (const t of tables) {
            channel.on(
                "postgres_changes" as never,
                { event: "*", schema: "public", table: t } as never,
                () => refetchRef.current(),
            );
        }
        channel.subscribe();
        return () => { void supabase.removeChannel(channel); };
        // tables identity stable per call site → eslint exception is safe
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tables.join(",")]);
}
