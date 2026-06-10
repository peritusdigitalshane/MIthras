import { useState } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import {
    Shield, AlertTriangle, Activity, Bot, Brain, ShieldCheck, Bell,
    Monitor, Cloud, ExternalLink, TrendingUp, ChevronRight,
} from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSocCounters, useRecentAiActivity, useRecentAlertsFeed, useOrgPosture } from "@/hooks/useSocDashboard";
import { useTenant } from "@/contexts/TenantContext";
import { AiDecisionDrawer } from "@/components/ai/AiDecisionDrawer";

const SEVERITY_DOT: Record<string, string> = {
    critical: "bg-red-500",
    high:     "bg-orange-500",
    medium:   "bg-amber-500",
    low:      "bg-blue-500",
    info:     "bg-muted-foreground",
};

export default function SocConsole() {
    const counters = useSocCounters();
    const activity = useRecentAiActivity();
    const alerts = useRecentAlertsFeed();
    const posture = useOrgPosture();
    const { isSuperAdmin } = useTenant();
    const [aiAlertId, setAiAlertId] = useState<string | null>(null);

    const c = counters.data;

    return (
        <MainLayout>
            <div className="space-y-6">
                <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-2">
                            <Activity className="h-6 w-6 text-primary" />
                            SOC Console
                        </h1>
                        <p className="text-muted-foreground text-sm">
                            Live security operations across {isSuperAdmin ? "all organisations" : "your organisation"}.
                            Updates in real time.
                        </p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <LivePulse updatedAt={counters.dataUpdatedAt} isError={counters.isError} />
                    </div>
                </div>

                {/* KPI strip */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                    <Kpi
                        icon={<Bell className="h-4 w-4" />}
                        label="Open alerts"
                        value={c?.openAlerts ?? "-"}
                        accent={(c?.openAlerts ?? 0) > 0 ? "warning" : undefined}
                        sub={`${c?.criticalAlerts ?? 0} critical`}
                    />
                    <Kpi
                        icon={<Brain className="h-4 w-4" />}
                        label="AI triages today"
                        value={c?.aiTriagedToday ?? "-"}
                        sub={`${c?.autoClosedToday ?? 0} auto-closed`}
                    />
                    <Kpi
                        icon={<Bot className="h-4 w-4" />}
                        label="Investigations today"
                        value={c?.investigationsToday ?? "-"}
                        sub={`US$${((c?.aiSpendCentsToday ?? 0) / 100).toFixed(2)} spend`}
                    />
                    <Kpi
                        icon={<AlertTriangle className="h-4 w-4" />}
                        label="Active threats"
                        value={c?.activeThreats ?? "-"}
                        accent={(c?.activeThreats ?? 0) > 0 ? "danger" : undefined}
                    />
                    <Kpi
                        icon={<Monitor className="h-4 w-4" />}
                        label="Endpoints online"
                        value={c ? `${c.onlineEndpoints} / ${c.totalEndpoints}` : "-"}
                        sub="last 24h"
                    />
                    <Kpi
                        icon={<Cloud className="h-4 w-4" />}
                        label="M365 tenants"
                        value={c?.m365ConnectedTenants ?? "-"}
                        sub={`${c?.m365RiskySignIns24h ?? 0} risky / ${c?.m365ExternalForwardRules ?? 0} ext fwd`}
                        accent={((c?.m365RiskySignIns24h ?? 0) + (c?.m365ExternalForwardRules ?? 0)) > 0 ? "warning" : undefined}
                    />
                </div>

                {/* Main 2-column area */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* AI activity */}
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                            <CardTitle className="text-base flex items-center gap-2">
                                <Brain className="h-4 w-4 text-primary" />
                                AI agent activity
                            </CardTitle>
                            <Badge variant="outline" className="text-[10px]">last {activity.data?.length ?? 0}</Badge>
                        </CardHeader>
                        <CardContent className="space-y-1.5 max-h-[420px] overflow-y-auto">
                            {(activity.data ?? []).length === 0 ? (
                                <p className="text-sm text-muted-foreground py-4 text-center">
                                    No AI decisions yet. Enable the AI SOC per-org from the org settings, or run a triage manually from an alert.
                                </p>
                            ) : (
                                (activity.data ?? []).map((d) => (
                                    <button
                                        key={d.id}
                                        onClick={() => setAiAlertId(d.alert_id)}
                                        className="w-full text-left rounded-lg border border-border/40 p-3 hover:border-primary/40 hover:bg-muted/20 transition-colors"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                                    <VerdictPill verdict={d.verdict} status={d.status} />
                                                    {d.confidence != null && (
                                                        <span className="text-[10px] text-muted-foreground tabular-nums">
                                                            {Math.round(d.confidence * 100)}%
                                                        </span>
                                                    )}
                                                    {d.auto_closed && (
                                                        <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-500">
                                                            auto-closed
                                                        </Badge>
                                                    )}
                                                </div>
                                                <div className="text-xs font-medium truncate">{d.alerts?.title ?? "(alert unavailable)"}</div>
                                                {d.summary && (
                                                    <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{d.summary}</div>
                                                )}
                                            </div>
                                            <div className="text-[10px] text-muted-foreground whitespace-nowrap">
                                                {formatDistanceToNow(new Date(d.created_at), { addSuffix: true })}
                                            </div>
                                        </div>
                                    </button>
                                ))
                            )}
                        </CardContent>
                    </Card>

                    {/* Live alerts feed */}
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                            <CardTitle className="text-base flex items-center gap-2">
                                <Bell className="h-4 w-4 text-primary" />
                                Live alerts
                            </CardTitle>
                            <Button asChild variant="ghost" size="sm" className="text-xs h-7">
                                <Link to="/alerts">
                                    Open alerts page
                                    <ChevronRight className="h-3 w-3 ml-0.5" />
                                </Link>
                            </Button>
                        </CardHeader>
                        <CardContent className="space-y-1 max-h-[420px] overflow-y-auto">
                            {(alerts.data ?? []).length === 0 ? (
                                <p className="text-sm text-muted-foreground py-4 text-center">No alerts in the feed.</p>
                            ) : (
                                (alerts.data ?? []).map((a) => (
                                    <button
                                        key={a.id}
                                        onClick={() => setAiAlertId(a.id)}
                                        className={`w-full text-left rounded-lg border border-border/40 p-2.5 hover:border-primary/40 transition-colors flex items-start gap-3 ${
                                            a.acknowledged ? "opacity-60" : ""
                                        }`}
                                    >
                                        <span
                                            className={`mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${SEVERITY_DOT[a.severity] ?? "bg-muted"}`}
                                            role="img"
                                            aria-label={`Severity: ${a.severity}`}
                                        />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-xs font-medium truncate">{a.title}</div>
                                            <div className="text-[11px] text-muted-foreground line-clamp-1">{a.message}</div>
                                            <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-2">
                                                <span>{formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}</span>
                                                {a.endpoints?.hostname && <span>· {a.endpoints.hostname}</span>}
                                                <span className="font-mono">· {a.alert_type}</span>
                                            </div>
                                        </div>
                                    </button>
                                ))
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* Org posture table — super-admin only */}
                {isSuperAdmin && (posture.data ?? []).length > 0 && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                                <TrendingUp className="h-4 w-4 text-primary" />
                                Per-organisation posture
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0 overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                                    <tr>
                                        <th className="text-left p-3">Organisation</th>
                                        <th className="text-right p-3">Endpoints</th>
                                        <th className="text-right p-3">Open alerts</th>
                                        <th className="text-right p-3">Critical</th>
                                        <th className="text-right p-3">Active threats</th>
                                        <th className="text-right p-3">AI triages today</th>
                                        <th className="text-left p-3">Last activity</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(posture.data ?? [])
                                        .sort((a, b) => (b.critical_alerts - a.critical_alerts) || (b.open_alerts - a.open_alerts))
                                        .map((o) => (
                                            <tr key={o.organization_id} className="border-t border-border/40 hover:bg-muted/20">
                                                <td className="p-3 font-medium">{o.organization_name}</td>
                                                <td className="p-3 text-right tabular-nums">{o.endpoints}</td>
                                                <td className="p-3 text-right tabular-nums">{o.open_alerts}</td>
                                                <td className={`p-3 text-right tabular-nums ${o.critical_alerts > 0 ? "text-red-500 font-bold" : ""}`}>{o.critical_alerts}</td>
                                                <td className={`p-3 text-right tabular-nums ${o.active_threats > 0 ? "text-amber-500" : ""}`}>{o.active_threats}</td>
                                                <td className="p-3 text-right tabular-nums text-muted-foreground">{o.ai_triages_today}</td>
                                                <td className="p-3 text-xs text-muted-foreground">
                                                    {o.last_alert_at ? formatDistanceToNow(new Date(o.last_alert_at), { addSuffix: true }) : "never"}
                                                </td>
                                            </tr>
                                        ))}
                                </tbody>
                            </table>
                        </CardContent>
                    </Card>
                )}

                <div className="text-[10px] text-muted-foreground flex items-center justify-between">
                    <span>Custom dashboard — replaces the Grafana view. Updates every 15s + on every event via Supabase Realtime.</span>
                    {isSuperAdmin && (
                        <Button variant="ghost" size="sm" className="text-xs h-7" asChild>
                            <a href="https://soc.mithras.com.au" target="_blank" rel="noopener noreferrer">
                                Open Grafana
                                <ExternalLink className="h-3 w-3 ml-1" />
                            </a>
                        </Button>
                    )}
                </div>
            </div>

            <AiDecisionDrawer alertId={aiAlertId} onOpenChange={(open) => !open && setAiAlertId(null)} />
        </MainLayout>
    );
}

function Kpi({ icon, label, value, sub, accent }: {
    icon: React.ReactNode;
    label: string;
    value: number | string;
    sub?: string;
    accent?: "warning" | "danger";
}) {
    const accentClass = accent === "danger" ? "text-red-500" : accent === "warning" ? "text-amber-500" : "";
    return (
        <Card>
            <CardContent className="p-3">
                <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
                    <span className="text-muted-foreground">{icon}</span>
                </div>
                <div className={`text-xl font-bold tabular-nums ${accentClass}`}>{value}</div>
                {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
            </CardContent>
        </Card>
    );
}

function VerdictPill({ verdict, status }: { verdict: string | null; status: string }) {
    if (status === "pending") return <Badge variant="outline" className="text-[10px]">triaging…</Badge>;
    if (status === "failed") return <Badge variant="outline" className="text-[10px] text-muted-foreground">failed</Badge>;
    if (status === "budget_exceeded") return <Badge variant="outline" className="text-[10px] text-muted-foreground">budget</Badge>;
    if (verdict === "true_positive")  return <Badge className="text-[10px] bg-red-500/20 text-red-500 border-red-500/40" variant="outline"><AlertTriangle className="h-2.5 w-2.5 mr-0.5" />true positive</Badge>;
    if (verdict === "false_positive") return <Badge className="text-[10px] bg-emerald-500/20 text-emerald-500 border-emerald-500/40" variant="outline"><ShieldCheck className="h-2.5 w-2.5 mr-0.5" />false positive</Badge>;
    if (verdict === "needs_human")    return <Badge className="text-[10px] bg-amber-500/20 text-amber-500 border-amber-500/40" variant="outline"><Shield className="h-2.5 w-2.5 mr-0.5" />needs human</Badge>;
    return <Badge variant="outline" className="text-[10px]">{verdict}</Badge>;
}

// "Live" pulse derived from the actual TanStack Query staleness instead of
// hardcoded green. Goes amber when the last successful refresh is older
// than expected (counters refetch on a 15s interval), red on outright
// query error. Operators no longer trust a green dot when the data has
// silently stopped updating.
function LivePulse({ updatedAt, isError }: { updatedAt: number; isError: boolean }) {
    const ageMs = updatedAt > 0 ? Date.now() - updatedAt : Infinity;
    const status: "live" | "stale" | "error" = isError ? "error" : ageMs > 30_000 ? "stale" : "live";
    const dot =
        status === "error" ? "bg-red-500" :
        status === "stale" ? "bg-amber-500" :
                             "bg-emerald-500 animate-pulse";
    const label =
        status === "error" ? "Disconnected" :
        status === "stale" ? "Reconnecting" :
                             "Live";
    return (
        <span className="inline-flex items-center gap-1">
            <span className={`h-2 w-2 rounded-full ${dot}`} />
            {label}
        </span>
    );
}
