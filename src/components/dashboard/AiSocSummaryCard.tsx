import { useState } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import {
    Brain, ArrowRight, Loader2, AlertTriangle, ShieldCheck, HelpCircle, BrainCircuit,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSocCounters, useRecentAiActivity } from "@/hooks/useSocDashboard";
import { AiDecisionDrawer } from "@/components/ai/AiDecisionDrawer";

/**
 * Customer-dashboard AI surface. Two parts:
 *   1. Counts strip (today's triages / auto-closures / investigations / spend)
 *   2. Recent decisions list — actual verdicts with click-through to the
 *      full decision drawer.
 *
 * Renders an empty / off state when no AI activity exists yet so the
 * card doesn't look broken before the agents have anything to show.
 */
export function AiSocSummaryCard() {
    const counters = useSocCounters();
    const recent = useRecentAiActivity(6);
    const [openAlertId, setOpenAlertId] = useState<string | null>(null);

    const data = counters.data;
    const decisions = recent.data ?? [];
    const isLoading = counters.isLoading || recent.isLoading;
    const hasActivity = (data?.aiTriagedToday ?? 0) > 0 || decisions.length > 0;

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                    <Brain className="h-4 w-4 text-primary" />
                    AI SOC activity
                </CardTitle>
                <Button asChild variant="ghost" size="sm" className="text-xs h-7">
                    <Link to="/soc">
                        Open SOC Console
                        <ArrowRight className="h-3 w-3 ml-1" />
                    </Link>
                </Button>
            </CardHeader>
            <CardContent className="space-y-4">
                {isLoading ? (
                    <div className="py-4 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                ) : !hasActivity ? (
                    <EmptyState />
                ) : (
                    <>
                        {/* Today's counts */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <Tile label="Triaged today" value={data?.aiTriagedToday ?? 0} />
                            <Tile
                                label="Auto-closed"
                                value={data?.autoClosedToday ?? 0}
                                accent={(data?.autoClosedToday ?? 0) > 0}
                            />
                            <Tile label="Investigations" value={data?.investigationsToday ?? 0} />
                            <Tile
                                label="Spend today"
                                value={data ? `$${(data.aiSpendCentsToday / 100).toFixed(2)}` : "$0.00"}
                            />
                        </div>

                        {/* Recent decisions */}
                        {decisions.length > 0 && (
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                                        Recent decisions
                                    </div>
                                    <Badge variant="outline" className="text-[10px]">last {decisions.length}</Badge>
                                </div>
                                <ul className="space-y-1.5">
                                    {decisions.slice(0, 6).map((d) => (
                                        <li key={d.id}>
                                            <button
                                                onClick={() => setOpenAlertId(d.alert_id)}
                                                className="w-full text-left rounded-lg border border-border/40 px-3 py-2 hover:border-primary/40 hover:bg-muted/20 transition-colors"
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                                                            <VerdictPill verdict={d.verdict} status={d.status} />
                                                            {d.confidence != null && (
                                                                <span className="text-[10px] text-muted-foreground tabular-nums">
                                                                    {Math.round(d.confidence * 100)}%
                                                                </span>
                                                            )}
                                                            {d.auto_closed && (
                                                                <Badge variant="outline" className="text-[9px] border-emerald-500/40 text-emerald-500 px-1">
                                                                    auto-closed
                                                                </Badge>
                                                            )}
                                                        </div>
                                                        <div className="text-xs font-medium truncate">
                                                            {d.alerts?.title ?? "(alert unavailable)"}
                                                        </div>
                                                        {d.summary && (
                                                            <div className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                                                                {d.summary}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="text-[10px] text-muted-foreground whitespace-nowrap mt-0.5">
                                                        {formatDistanceToNow(new Date(d.created_at), { addSuffix: true })}
                                                    </div>
                                                </div>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </>
                )}

                <p className="text-[11px] text-muted-foreground border-t border-border/40 pt-3">
                    The AI Triage Agent classifies every new alert and auto-closes high-confidence
                    false positives. True positives escalate to the Investigation Agent for a full
                    timeline + recommended actions.
                </p>
            </CardContent>

            <AiDecisionDrawer
                alertId={openAlertId}
                onOpenChange={(open) => !open && setOpenAlertId(null)}
            />
        </Card>
    );
}

function EmptyState() {
    return (
        <div className="rounded-lg border border-dashed border-border/40 p-4 text-center">
            <BrainCircuit className="h-6 w-6 mx-auto text-muted-foreground/60 mb-2" />
            <p className="text-xs text-muted-foreground">
                No AI activity yet. Decisions appear here as the agents process new alerts.
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
                Not seeing anything? Check that AI SOC is enabled for your org under Admin → AI SOC.
            </p>
        </div>
    );
}

function Tile({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
    return (
        <div className="rounded-lg border border-border/40 bg-muted/20 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className={`text-xl font-bold tabular-nums mt-0.5 ${accent ? "text-emerald-500" : ""}`}>{value}</div>
        </div>
    );
}

function VerdictPill({ verdict, status }: { verdict: string | null; status: string }) {
    if (status === "pending")          return <Badge variant="outline" className="text-[9px] px-1.5">triaging…</Badge>;
    if (status === "failed")           return <Badge variant="outline" className="text-[9px] px-1.5 text-muted-foreground">failed</Badge>;
    if (status === "budget_exceeded")  return <Badge variant="outline" className="text-[9px] px-1.5 text-muted-foreground">budget</Badge>;
    if (verdict === "true_positive")   return <Badge className="text-[9px] bg-red-500/20 text-red-500 border-red-500/40 px-1.5" variant="outline"><AlertTriangle className="h-2.5 w-2.5 mr-0.5" />true positive</Badge>;
    if (verdict === "false_positive")  return <Badge className="text-[9px] bg-emerald-500/20 text-emerald-500 border-emerald-500/40 px-1.5" variant="outline"><ShieldCheck className="h-2.5 w-2.5 mr-0.5" />false positive</Badge>;
    if (verdict === "needs_human")     return <Badge className="text-[9px] bg-amber-500/20 text-amber-500 border-amber-500/40 px-1.5" variant="outline"><HelpCircle className="h-2.5 w-2.5 mr-0.5" />needs human</Badge>;
    return <Badge variant="outline" className="text-[9px] px-1.5">{verdict ?? "—"}</Badge>;
}
