import { useMemo, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import {
    Brain, AlertTriangle, ShieldCheck, HelpCircle, Loader2, Filter, ChevronLeft,
    ChevronRight, CheckCircle2, ArrowDownToLine,
} from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useAiActivity, useAiActivityRollup, type AiActivityFilter } from "@/hooks/useAiActivity";
import { useTenant } from "@/contexts/TenantContext";
import { AiDecisionDrawer } from "@/components/ai/AiDecisionDrawer";

const TIME_RANGES = [
    { label: "Last 24h",   sinceMs: 24 * 60 * 60 * 1000 },
    { label: "Last 7d",    sinceMs: 7 * 24 * 60 * 60 * 1000 },
    { label: "Last 30d",   sinceMs: 30 * 24 * 60 * 60 * 1000 },
    { label: "Last 90d",   sinceMs: 90 * 24 * 60 * 60 * 1000 },
    { label: "All time",   sinceMs: null as number | null },
];

export default function AiActivity() {
    const { isSuperAdmin } = useTenant();
    const [openAlertId, setOpenAlertId] = useState<string | null>(null);
    const [rangeIdx, setRangeIdx] = useState(1);                  // default 7d
    const [verdict, setVerdict] = useState<AiActivityFilter["verdict"]>("all");
    const [status, setStatus] = useState<AiActivityFilter["status"]>("completed");
    const [minConfidence, setMinConfidence] = useState<number>(0);
    const [autoClosedOnly, setAutoClosedOnly] = useState(false);
    const [reviewedOnly, setReviewedOnly] = useState(false);
    const [page, setPage] = useState(0);

    const sinceIso = useMemo(() => {
        const r = TIME_RANGES[rangeIdx];
        return r.sinceMs ? new Date(Date.now() - r.sinceMs).toISOString() : null;
    }, [rangeIdx]);

    const filter: AiActivityFilter = {
        verdict,
        status,
        minConfidence: minConfidence > 0 ? minConfidence : undefined,
        autoClosedOnly,
        reviewedOnly,
        sinceIso: sinceIso ?? undefined,
        page,
        pageSize: 50,
    };
    const activity = useAiActivity(filter);
    const rollup = useAiActivityRollup(sinceIso ?? new Date(0).toISOString());
    const rows = activity.data?.rows ?? [];
    const total = activity.data?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / 50));

    const exportCsv = () => {
        // Model + cost columns are super-admin-only. Non-super-admin
        // partner/operator users still get verdict, severity, and review
        // status — enough for audit, no vendor leakage.
        const headers = [
            "occurred_at", "verdict", "confidence", "auto_closed", "escalated",
            "alert_title", "alert_severity", "alert_type",
            "organization",
            ...(isSuperAdmin ? ["model", "cost_cents"] : []),
            "latency_ms",
            "reviewed_at", "review_action",
        ];
        const escape = (v: unknown) => {
            const s = String(v ?? "");
            return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
        };
        const lines = [headers.join(",")];
        for (const r of rows) {
            lines.push([
                r.created_at, r.verdict ?? "", r.confidence ?? "", r.auto_closed, r.escalated_to_investigation,
                r.alerts?.title ?? "", r.alerts?.severity ?? "", r.alerts?.alert_type ?? "",
                r.organizations?.name ?? "",
                ...(isSuperAdmin ? [r.model ?? "", r.cost_cents] : []),
                r.latency_ms ?? "",
                r.reviewed_at ?? "", r.review_action ?? "",
            ].map(escape).join(","));
        }
        const blob = new Blob([lines.join("\n")], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `ai-activity-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <MainLayout>
            <div className="space-y-6">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Brain className="h-6 w-6 text-primary" />
                        AI Activity
                    </h1>
                    <p className="text-muted-foreground text-sm">
                        Every decision the AI Triage Agent has made. Audit trail, filter by
                        verdict / confidence / time, drill into any single decision.
                    </p>
                </div>

                {/* Rollup tiles */}
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                    <Tile label="Total" value={rollup.data?.totalDecisions ?? "-"} />
                    <Tile label="True positive" value={rollup.data?.truePositives ?? "-"} accent="danger" />
                    <Tile label="False positive" value={rollup.data?.falsePositives ?? "-"} accent="ok" />
                    <Tile label="Needs human" value={rollup.data?.needsHuman ?? "-"} accent="warning" />
                    <Tile label="Auto-closed" value={rollup.data?.autoClosed ?? "-"} accent="ok" />
                    <Tile
                        label="Spend"
                        value={rollup.data ? `$${(rollup.data.spendCents / 100).toFixed(2)}` : "-"}
                    />
                    <Tile
                        label="Avg latency"
                        value={rollup.data?.avgLatencyMs != null ? `${(rollup.data.avgLatencyMs / 1000).toFixed(1)}s` : "-"}
                    />
                </div>

                {/* Filters */}
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-2 mb-4">
                            <Filter className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-medium">Filters</span>
                            <div className="ml-auto flex items-center gap-2">
                                <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
                                    <ArrowDownToLine className="h-3.5 w-3.5 mr-1.5" />
                                    Export CSV
                                </Button>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                            <div className="space-y-1">
                                <Label className="text-xs">Time range</Label>
                                <Select value={String(rangeIdx)} onValueChange={(v) => { setRangeIdx(Number(v)); setPage(0); }}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {TIME_RANGES.map((r, i) => (
                                            <SelectItem key={r.label} value={String(i)}>{r.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Verdict</Label>
                                <Select value={verdict} onValueChange={(v) => { setVerdict(v as AiActivityFilter["verdict"]); setPage(0); }}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All verdicts</SelectItem>
                                        <SelectItem value="true_positive">True positive</SelectItem>
                                        <SelectItem value="false_positive">False positive</SelectItem>
                                        <SelectItem value="needs_human">Needs human</SelectItem>
                                        <SelectItem value="inconclusive">Inconclusive</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Status</Label>
                                <Select value={status} onValueChange={(v) => { setStatus(v as AiActivityFilter["status"]); setPage(0); }}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All statuses</SelectItem>
                                        <SelectItem value="completed">Completed</SelectItem>
                                        <SelectItem value="pending">Pending</SelectItem>
                                        <SelectItem value="failed">Failed</SelectItem>
                                        <SelectItem value="budget_exceeded">Budget exceeded</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Min confidence</Label>
                                <Input
                                    type="number"
                                    min="0"
                                    max="1"
                                    step="0.05"
                                    value={minConfidence}
                                    onChange={(e) => { setMinConfidence(Number(e.target.value) || 0); setPage(0); }}
                                />
                            </div>
                            <div className="space-y-3 flex flex-col justify-center">
                                <label className="flex items-center justify-between gap-2 text-xs cursor-pointer">
                                    <span>Auto-closed only</span>
                                    <Switch checked={autoClosedOnly} onCheckedChange={(v) => { setAutoClosedOnly(v); setPage(0); }} />
                                </label>
                                <label className="flex items-center justify-between gap-2 text-xs cursor-pointer">
                                    <span>Human-reviewed only</span>
                                    <Switch checked={reviewedOnly} onCheckedChange={(v) => { setReviewedOnly(v); setPage(0); }} />
                                </label>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Activity table */}
                <Card>
                    <CardContent className="p-0">
                        {activity.isLoading ? (
                            <div className="py-12 flex justify-center">
                                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                            </div>
                        ) : rows.length === 0 ? (
                            <div className="py-12 text-center text-sm text-muted-foreground">
                                No AI decisions match those filters.
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                                        <tr>
                                            <th className="text-left px-3 py-2">When</th>
                                            <th className="text-left px-3 py-2">Alert</th>
                                            {isSuperAdmin && <th className="text-left px-3 py-2">Org</th>}
                                            <th className="text-left px-3 py-2">Verdict</th>
                                            <th className="text-right px-3 py-2">Conf</th>
                                            <th className="text-center px-3 py-2">Flags</th>
                                            <th className="text-right px-3 py-2">Cost</th>
                                            <th className="text-right px-3 py-2">Latency</th>
                                            <th className="text-left px-3 py-2">Review</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((r) => (
                                            <tr
                                                key={r.id}
                                                className="border-t border-border/40 hover:bg-muted/20 cursor-pointer"
                                                onClick={() => setOpenAlertId(r.alert_id)}
                                            >
                                                <td className="px-3 py-2 text-xs whitespace-nowrap">
                                                    <div>{format(new Date(r.created_at), "dd MMM HH:mm")}</div>
                                                    <div className="text-[10px] text-muted-foreground">
                                                        {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                                                    </div>
                                                </td>
                                                <td className="px-3 py-2 max-w-xs">
                                                    <div className="truncate text-xs font-medium">{r.alerts?.title ?? "(alert unavailable)"}</div>
                                                    <div className="text-[10px] text-muted-foreground font-mono">{r.alerts?.alert_type}</div>
                                                </td>
                                                {isSuperAdmin && (
                                                    <td className="px-3 py-2 text-xs">{r.organizations?.name ?? "—"}</td>
                                                )}
                                                <td className="px-3 py-2">
                                                    <VerdictPill verdict={r.verdict} status={r.status} />
                                                </td>
                                                <td className="px-3 py-2 text-right text-xs tabular-nums">
                                                    {r.confidence != null ? `${Math.round(r.confidence * 100)}%` : "—"}
                                                </td>
                                                <td className="px-3 py-2 text-center">
                                                    <div className="flex items-center justify-center gap-1">
                                                        {r.auto_closed && (
                                                            <Badge variant="outline" className="text-[9px] border-emerald-500/40 text-emerald-500 px-1">
                                                                ack
                                                            </Badge>
                                                        )}
                                                        {r.escalated_to_investigation && (
                                                            <Badge variant="outline" className="text-[9px] border-amber-500/40 text-amber-500 px-1">
                                                                inv
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                                                    US${(r.cost_cents / 100).toFixed(4)}
                                                </td>
                                                <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                                                    {r.latency_ms != null ? `${(r.latency_ms / 1000).toFixed(1)}s` : "—"}
                                                </td>
                                                <td className="px-3 py-2 text-xs">
                                                    {r.reviewed_at ? (
                                                        <span className="inline-flex items-center gap-1 text-emerald-500">
                                                            <CheckCircle2 className="h-3 w-3" />
                                                            {r.review_action}
                                                        </span>
                                                    ) : (
                                                        <span className="text-muted-foreground">—</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">
                            Showing {page * 50 + 1}–{Math.min((page + 1) * 50, total)} of {total}
                        </span>
                        <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>
                                <ChevronLeft className="h-3.5 w-3.5" />
                                Previous
                            </Button>
                            <span className="text-muted-foreground tabular-nums">
                                Page {page + 1} of {totalPages}
                            </span>
                            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page + 1 >= totalPages}>
                                Next
                                <ChevronRight className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            <AiDecisionDrawer
                alertId={openAlertId}
                onOpenChange={(open) => !open && setOpenAlertId(null)}
            />
        </MainLayout>
    );
}

function Tile({ label, value, accent }: { label: string; value: number | string; accent?: "ok" | "warning" | "danger" }) {
    const c = accent === "danger" ? "text-red-500" : accent === "warning" ? "text-amber-500" : accent === "ok" ? "text-emerald-500" : "";
    return (
        <Card>
            <CardContent className="p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
                <div className={`text-xl font-bold tabular-nums mt-0.5 ${c}`}>{value}</div>
            </CardContent>
        </Card>
    );
}

function VerdictPill({ verdict, status }: { verdict: string | null; status: string }) {
    if (status === "pending")         return <Badge variant="outline" className="text-[10px]"><Loader2 className="h-2.5 w-2.5 mr-0.5 animate-spin" />triaging</Badge>;
    if (status === "failed")          return <Badge variant="outline" className="text-[10px] text-muted-foreground">failed</Badge>;
    if (status === "budget_exceeded") return <Badge variant="outline" className="text-[10px] text-muted-foreground">budget</Badge>;
    if (verdict === "true_positive")  return <Badge className="text-[10px] bg-red-500/20 text-red-500 border-red-500/40" variant="outline"><AlertTriangle className="h-2.5 w-2.5 mr-0.5" />true positive</Badge>;
    if (verdict === "false_positive") return <Badge className="text-[10px] bg-emerald-500/20 text-emerald-500 border-emerald-500/40" variant="outline"><ShieldCheck className="h-2.5 w-2.5 mr-0.5" />false positive</Badge>;
    if (verdict === "needs_human")    return <Badge className="text-[10px] bg-amber-500/20 text-amber-500 border-amber-500/40" variant="outline"><HelpCircle className="h-2.5 w-2.5 mr-0.5" />needs human</Badge>;
    return <Badge variant="outline" className="text-[10px]">{verdict ?? "—"}</Badge>;
}
