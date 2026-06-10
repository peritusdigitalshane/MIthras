import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
    Crosshair, Globe, FileWarning, Mail, Key, Sparkles, AlertTriangle,
    AlertCircle, Loader2, Network, Hash, RefreshCw, Users,
} from "lucide-react";
import { useHuntFindings, type HuntFinding } from "@/hooks/useHunt";
import { useTenant } from "@/contexts/TenantContext";
import { formatDistanceToNow } from "date-fns";

const STATUS_TABS: Array<{ value: "open" | "acknowledged" | "all"; label: string }> = [
    { value: "open",         label: "Open" },
    { value: "acknowledged", label: "Acknowledged" },
    { value: "all",          label: "All" },
];

export default function Hunt() {
    const { isSuperAdmin } = useTenant();
    const [status, setStatus] = useState<"open" | "acknowledged" | "all">("open");
    const findings = useHuntFindings(status);

    const open = (findings.data ?? []).filter(f => f.status === "open");

    return (
        <MainLayout>
            <div className="p-6 space-y-6 max-w-7xl mx-auto">
                {/* Hero */}
                <div className="flex items-start justify-between flex-wrap gap-3">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                            <Crosshair className="h-8 w-8 text-primary" />
                            Cross-tenant Hunt
                        </h1>
                        <p className="text-muted-foreground mt-1 max-w-2xl">
                            Patterns the Hunt Agent has flagged by correlating indicators across
                            multiple Mithras customers. Same IP / hash / pattern showing up in 2+
                            tenants is rarely a coincidence — it's usually an active campaign.
                            {isSuperAdmin && " · Fleet-wide view (super admin)."}
                        </p>
                    </div>
                    <Tabs value={status} onValueChange={(v) => setStatus(v as any)}>
                        <TabsList>
                            {STATUS_TABS.map((t) => (
                                <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
                            ))}
                        </TabsList>
                    </Tabs>
                </div>

                {/* Privacy notice */}
                {!isSuperAdmin && (
                    <Alert className="border-primary/30 bg-primary/5">
                        <Users className="h-4 w-4 text-primary" />
                        <AlertTitle className="text-sm">Privacy-preserved cross-tenant view</AlertTitle>
                        <AlertDescription className="text-xs">
                            You see the indicators and how many other tenants are affected — but
                            never <em>who</em> they are. Other customers see the same about you.
                            The intelligence compounds across the fleet without ever revealing
                            individual tenant identity.
                        </AlertDescription>
                    </Alert>
                )}

                {findings.error && (
                    <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Couldn't load hunt findings</AlertTitle>
                        <AlertDescription className="text-xs">{(findings.error as Error).message}</AlertDescription>
                    </Alert>
                )}

                {/* KPI strip */}
                {findings.data && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <KpiCard label="Open findings" value={open.length} icon={<Sparkles className="h-4 w-4 text-primary" />} />
                        <KpiCard label="Critical" value={open.filter(f => f.severity === "critical").length} icon={<AlertTriangle className="h-4 w-4 text-rose-500" />} tone="bad" />
                        <KpiCard label="High" value={open.filter(f => f.severity === "high").length} icon={<AlertTriangle className="h-4 w-4 text-amber-500" />} />
                        <KpiCard label="Indicators tracked" value={(findings.data ?? []).length} icon={<Crosshair className="h-4 w-4 text-slate-500" />} />
                    </div>
                )}

                {/* Findings list */}
                <Card>
                    <CardHeader className="pb-3">
                        <div className="flex items-start justify-between">
                            <div>
                                <CardTitle className="text-base">Active findings</CardTitle>
                                <CardDescription className="text-xs">
                                    Auto-refreshes every minute. Detection runs every 15 minutes.
                                </CardDescription>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => findings.refetch()} className="gap-1.5">
                                <RefreshCw className={`h-3.5 w-3.5 ${findings.isFetching ? "animate-spin" : ""}`} />
                                Refresh
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {findings.isLoading ? (
                            <div className="space-y-2">
                                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
                            </div>
                        ) : (findings.data ?? []).length === 0 ? (
                            <EmptyState />
                        ) : (
                            <div className="space-y-3">
                                {(findings.data ?? []).map((f) => <FindingRow key={f.id} finding={f} />)}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </MainLayout>
    );
}

// ----------------------------------------------------------------------

function KpiCard({ label, value, icon, tone = "neutral" }: {
    label: string; value: number; icon: React.ReactNode; tone?: "neutral" | "good" | "bad";
}) {
    const cls = tone === "bad" ? "border-rose-500/30 bg-rose-500/5" : tone === "good" ? "border-emerald-500/30 bg-emerald-500/5" : "";
    return (
        <Card className={cls}>
            <CardContent className="pt-5 pb-4">
                <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
                    {icon}
                </div>
                <p className="text-2xl font-bold tabular-nums">{value}</p>
            </CardContent>
        </Card>
    );
}

function FindingRow({ finding }: { finding: HuntFinding }) {
    const isEnriched = !!finding.summary;
    return (
        <div className="rounded-lg border border-border/40 bg-card p-4 hover:border-primary/40 transition-colors">
            <div className="flex items-start gap-3">
                <div className={`mt-0.5 h-10 w-10 rounded-lg flex items-center justify-center ${severityBg(finding.severity)}`}>
                    {kindIcon(finding.finding_kind)}
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                    {/* Header line */}
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-semibold break-all">
                            {finding.shared_indicator.value}
                        </span>
                        <Badge variant="outline" className={`text-[10px] uppercase tracking-wider ${severityBadge(finding.severity)}`}>
                            {finding.severity}
                        </Badge>
                        {finding.confidence != null && (
                            <Badge variant="secondary" className="text-[10px]">
                                {Math.round(finding.confidence * 100)}% confidence
                            </Badge>
                        )}
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                            {kindLabel(finding.finding_kind)}
                        </Badge>
                        {!isEnriched && (
                            <Badge variant="outline" className="text-[10px] border-slate-500/40 text-slate-500">
                                <Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" />
                                enriching
                            </Badge>
                        )}
                    </div>

                    {/* Counts line */}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span><strong className="text-foreground">{finding.tenant_count}</strong> tenants affected{finding.other_tenant_count > 0 ? ` (you + ${finding.other_tenant_count} others)` : ""}</span>
                        <span><strong className="text-foreground">{finding.sample_event_count.toLocaleString()}</strong> events</span>
                        <span>First seen {formatDistanceToNow(new Date(finding.event_window_start), { addSuffix: true })}</span>
                    </div>

                    {/* Enrichment */}
                    {finding.summary && (
                        <p className="text-sm leading-relaxed">{finding.summary}</p>
                    )}
                    {finding.recommended_action && (
                        <div className="rounded-md bg-muted/40 px-3 py-2 text-xs">
                            <strong className="text-foreground">Recommended action:</strong>{" "}
                            <span className="text-muted-foreground">{finding.recommended_action}</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function EmptyState() {
    return (
        <div className="text-center py-12">
            <Crosshair className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                No cross-tenant findings yet. The Hunt Agent runs every 15 minutes — patterns
                only emerge when the same indicator hits multiple tenants in a short window.
                That's the network effect at work.
            </p>
        </div>
    );
}

function kindIcon(kind: HuntFinding["finding_kind"]) {
    switch (kind) {
        case "cross_tenant_ip":           return <Globe className="h-4 w-4 text-primary" />;
        case "cross_tenant_hash":         return <Hash className="h-4 w-4 text-primary" />;
        case "cross_tenant_domain":       return <Network className="h-4 w-4 text-primary" />;
        case "cross_tenant_mailbox_rule": return <Mail className="h-4 w-4 text-primary" />;
        case "cross_tenant_oauth_grant":  return <Key className="h-4 w-4 text-primary" />;
        case "cross_tenant_command_line": return <FileWarning className="h-4 w-4 text-primary" />;
        default:                          return <Sparkles className="h-4 w-4 text-primary" />;
    }
}
function kindLabel(kind: HuntFinding["finding_kind"]): string {
    return kind.replace(/^cross_tenant_/, "").replace(/_/g, " ");
}
function severityBg(s: HuntFinding["severity"]): string {
    return s === "critical" ? "bg-rose-500/15"
         : s === "high"     ? "bg-amber-500/15"
         : s === "medium"   ? "bg-amber-500/10"
         :                    "bg-slate-500/10";
}
function severityBadge(s: HuntFinding["severity"]): string {
    return s === "critical" ? "border-rose-500/40 text-rose-600 bg-rose-500/5"
         : s === "high"     ? "border-amber-500/40 text-amber-600 bg-amber-500/5"
         : s === "medium"   ? "border-amber-500/40 text-amber-700"
         :                    "border-slate-500/40 text-slate-600";
}
