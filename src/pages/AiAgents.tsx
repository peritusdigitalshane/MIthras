import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
    Brain, ShieldCheck, Sword, Cog, Sparkles, AlertCircle,
    AlertTriangle, CheckCircle2, RefreshCw, Activity, DollarSign,
    Clock, Users, ArrowRightLeft, Zap, RotateCcw, ThumbsDown,
} from "lucide-react";
import { useAgentDashboard, useAgentActivity, type AgentActivityRow } from "@/hooks/useAgentDashboard";
import { useTenant } from "@/contexts/TenantContext";
import { formatDistanceToNow } from "date-fns";

const WINDOWS = [
    { hours: 1,  label: "1h"  },
    { hours: 24, label: "24h" },
    { hours: 168, label: "7d" },
];

export default function AiAgents() {
    const { currentOrganization, isSuperAdmin } = useTenant();
    const [hours, setHours] = useState(24);
    const dashboard = useAgentDashboard(hours);
    const activity = useAgentActivity(100);

    if (!currentOrganization) {
        return (
            <MainLayout>
                <div className="p-6">
                    <Skeleton className="h-32 w-full" />
                </div>
            </MainLayout>
        );
    }

    return (
        <MainLayout>
            <div className="p-6 space-y-6 max-w-7xl mx-auto">
                {/* Hero */}
                <div className="flex items-start justify-between flex-wrap gap-3">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                            <Sparkles className="h-8 w-8 text-primary" />
                            AI Agents
                        </h1>
                        <p className="text-muted-foreground mt-1 max-w-2xl">
                            Live view of the four-agent SOC. Triage classifies, Verification re-runs
                            with a different model, Adversarial tries to disprove the verdict, Response
                            executes contained autonomous actions with auto-rollback safety.
                            {isSuperAdmin && " · Showing fleet-wide totals (super admin)."}
                        </p>
                    </div>
                    <Tabs value={String(hours)} onValueChange={(v) => setHours(Number(v))}>
                        <TabsList>
                            {WINDOWS.map((w) => (
                                <TabsTrigger key={w.hours} value={String(w.hours)}>{w.label}</TabsTrigger>
                            ))}
                        </TabsList>
                    </Tabs>
                </div>

                {dashboard.error && (
                    <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Couldn't load dashboard</AlertTitle>
                        <AlertDescription className="text-xs">{(dashboard.error as Error).message}</AlertDescription>
                    </Alert>
                )}

                {/* KPI grid */}
                {dashboard.data && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <KpiCard
                            icon={<Activity className="h-4 w-4 text-primary" />}
                            label="Alerts orchestrated"
                            value={dashboard.data.alerts_orchestrated}
                        />
                        <KpiCard
                            icon={<Zap className="h-4 w-4 text-amber-500" />}
                            label="Autonomous responses"
                            value={dashboard.data.autonomous_responses}
                        />
                        <KpiCard
                            icon={<RotateCcw className="h-4 w-4 text-slate-500" />}
                            label="Auto-rollbacks"
                            value={dashboard.data.auto_rollbacks}
                        />
                        <KpiCard
                            icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                            label="Customer confirmations"
                            value={dashboard.data.customer_confirmations}
                            tone={dashboard.data.customer_confirmations > 0 ? "good" : "neutral"}
                        />
                        <KpiCard
                            icon={<ThumbsDown className="h-4 w-4 text-rose-500" />}
                            label="Customer overrides"
                            value={dashboard.data.customer_overrides}
                            hint={dashboard.data.customer_overrides > 0 ? "FP rate" : undefined}
                        />
                        <KpiCard
                            icon={<ArrowRightLeft className="h-4 w-4 text-amber-500" />}
                            label="Disagreement rate"
                            value={pct(dashboard.data.disagreement_rate)}
                            hint="Triage vs Verification"
                        />
                        <KpiCard
                            icon={<ShieldCheck className="h-4 w-4 text-emerald-500" />}
                            label="Agreement rate"
                            value={pct(dashboard.data.verification_agreement_rate)}
                            tone="good"
                        />
                        <KpiCard
                            icon={<DollarSign className="h-4 w-4 text-slate-500" />}
                            label="Avg cost / alert"
                            value={fmtCents(dashboard.data.avg_cost_per_alert_microcents)}
                            hint={`Total: ${fmtCents(dashboard.data.total_cost_microcents)}`}
                        />
                    </div>
                )}

                {/* Per-agent cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <AgentCard
                        icon={<Brain className="h-4 w-4 text-primary" />}
                        title="Triage"
                        kind="classifier"
                        description="First-pass classification. Reads alert + evidence, emits verdict with citations."
                        stats={dashboard.data ? [
                            { label: "Runs", value: dashboard.data.alerts_orchestrated.toString() },
                            { label: "Verdicts", value: Object.entries(dashboard.data.verdict_distribution ?? {}).map(([k, v]) => `${shortVerdict(k)}: ${v}`).join("  ·  ") || "—" },
                        ] : []}
                    />
                    <AgentCard
                        icon={<ShieldCheck className="h-4 w-4 text-emerald-500" />}
                        title="Verification"
                        kind="classifier"
                        description="Independent re-classification with a different model. Catches Triage hallucinations."
                        stats={dashboard.data ? [
                            { label: "Agreement", value: pct(dashboard.data.verification_agreement_rate) },
                            { label: "Disagreement", value: pct(dashboard.data.disagreement_rate) },
                        ] : []}
                    />
                    <AgentCard
                        icon={<Sword className="h-4 w-4 text-rose-500" />}
                        title="Adversarial"
                        kind="refuter"
                        description="Tries to refute the verdict. Fires on TP or disagreement. The hallucination shield."
                        stats={dashboard.data ? [
                            { label: "Fire rate", value: pct(dashboard.data.adversarial_fire_rate) },
                            { label: "Refutation rate", value: pct(dashboard.data.adversarial_refutation_rate) },
                        ] : []}
                    />
                    <AgentCard
                        icon={<Cog className="h-4 w-4 text-amber-500" />}
                        title="Response"
                        kind="actor"
                        description="Executes contained actions on consensus TP. Auto-reverses after 4h unless customer confirms."
                        stats={dashboard.data ? [
                            { label: "Actions", value: dashboard.data.autonomous_responses.toString() },
                            { label: "Reverted", value: dashboard.data.auto_rollbacks.toString() },
                        ] : []}
                    />
                </div>

                {/* Activity feed */}
                <Card>
                    <CardHeader className="pb-3">
                        <div className="flex items-start justify-between">
                            <div>
                                <CardTitle className="text-base flex items-center gap-2">
                                    <Activity className="h-4 w-4 text-primary" /> Live activity
                                </CardTitle>
                                <CardDescription className="text-xs">
                                    Every agent decision and Response Agent action, newest first. Polls every 5 seconds.
                                </CardDescription>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => activity.refetch()} className="gap-1.5">
                                <RefreshCw className={`h-3.5 w-3.5 ${activity.isFetching ? "animate-spin" : ""}`} />
                                Refresh
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {activity.isLoading ? (
                            <div className="space-y-2">
                                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                            </div>
                        ) : (activity.data ?? []).length === 0 ? (
                            <div className="text-sm text-muted-foreground text-center py-12">
                                No agent activity yet. The agents will start posting events here as alerts come in.
                            </div>
                        ) : (
                            <div className="divide-y divide-border/40">
                                {(activity.data ?? []).map((row, i) => (
                                    <ActivityRow key={i} row={row} />
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </MainLayout>
    );
}

// ----------------------------------------------------------------------

function KpiCard({ icon, label, value, hint, tone = "neutral" }: {
    icon: React.ReactNode;
    label: string;
    value: number | string;
    hint?: string;
    tone?: "neutral" | "good" | "bad";
}) {
    const toneCls =
        tone === "good" ? "border-emerald-500/30 bg-emerald-500/5" :
        tone === "bad"  ? "border-rose-500/30 bg-rose-500/5"       :
                          "";
    return (
        <Card className={toneCls}>
            <CardContent className="pt-5 pb-4">
                <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
                    {icon}
                </div>
                <p className="text-2xl font-bold tabular-nums">{value}</p>
                {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
            </CardContent>
        </Card>
    );
}

function AgentCard({ icon, title, kind, description, stats }: {
    icon: React.ReactNode;
    title: string;
    kind: "classifier" | "refuter" | "actor";
    description: string;
    stats: Array<{ label: string; value: string }>;
}) {
    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5">
                    {icon} {title}
                    <Badge variant="outline" className="text-[9px] uppercase tracking-wider ml-1">{kind}</Badge>
                </CardTitle>
                <CardDescription className="text-[11px] leading-snug">{description}</CardDescription>
            </CardHeader>
            <CardContent className="pt-1 space-y-1">
                {stats.length === 0 ? (
                    <Skeleton className="h-3 w-full" />
                ) : (
                    stats.map((s, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">{s.label}</span>
                            <span className="font-mono font-medium">{s.value}</span>
                        </div>
                    ))
                )}
            </CardContent>
        </Card>
    );
}

function ActivityRow({ row }: { row: AgentActivityRow }) {
    const icon = agentIcon(row.agent_name);
    const eventLabel = describeEvent(row);
    const verdictTone = verdictBadgeTone(row.verdict);
    return (
        <div className="py-2 flex items-start gap-3">
            <div className="mt-0.5">{icon}</div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap text-xs">
                    <span className="font-semibold uppercase tracking-wider text-muted-foreground">{row.agent_name}</span>
                    <span className="text-muted-foreground">{eventLabel}</span>
                    {row.verdict && (
                        <Badge variant="outline" className={`text-[10px] uppercase tracking-wider ${verdictTone}`}>
                            {row.verdict.replace(/_/g, " ")}
                        </Badge>
                    )}
                    {row.confidence != null && (
                        <Badge variant="secondary" className="text-[10px]">{Math.round(Number(row.confidence) * 100)}%</Badge>
                    )}
                </div>
                {row.summary && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5 leading-relaxed">{row.summary}</p>
                )}
            </div>
            <div className="text-[10px] text-muted-foreground whitespace-nowrap">
                {formatDistanceToNow(new Date(row.occurred_at), { addSuffix: true })}
            </div>
        </div>
    );
}

// ----------------------------------------------------------------------
// helpers

function pct(v: number | null | undefined): string {
    return v == null ? "—" : `${v}%`;
}
function fmtCents(microCents: number): string {
    const usd = microCents / 100_000;
    if (usd < 0.01) return `$${usd.toFixed(4)}`;
    return `$${usd.toFixed(2)}`;
}
function shortVerdict(v: string): string {
    return v === "true_positive"  ? "TP"
         : v === "false_positive" ? "FP"
         : v === "needs_human"    ? "NH"
         : v === "inconclusive"   ? "IC"
         :                          v;
}
function agentIcon(name: AgentActivityRow["agent_name"]) {
    switch (name) {
        case "triage":        return <Brain className="h-4 w-4 text-primary" />;
        case "verification":  return <ShieldCheck className="h-4 w-4 text-emerald-500" />;
        case "adversarial":   return <Sword className="h-4 w-4 text-rose-500" />;
        case "response":      return <Cog className="h-4 w-4 text-amber-500" />;
    }
}
function describeEvent(row: AgentActivityRow): string {
    if (row.event_kind === "action")   return `→ executed ${row.summary ?? "action"}`;
    if (row.event_kind === "rollback") return `← rolled back (${(row.extra as any)?.reason ?? "expired"})`;
    if (row.event_kind === "confirm")  return "✓ customer confirmed threat";
    if (row.event_kind === "override") return "✗ customer marked false positive";
    return "classified alert";
}
function verdictBadgeTone(v: string | null): string {
    if (!v) return "";
    if (v === "true_positive" || v === "refuted")       return "border-rose-500/40 text-rose-600";
    if (v === "false_positive" || v === "not_refuted")  return "border-emerald-500/40 text-emerald-600";
    if (v === "needs_human")                            return "border-amber-500/40 text-amber-600";
    if (v === "executed" || v === "executing")          return "border-amber-500/40 text-amber-600";
    if (v === "rolled_back")                            return "border-slate-500/40 text-slate-600";
    return "";
}
