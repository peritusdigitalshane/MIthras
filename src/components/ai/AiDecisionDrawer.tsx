import { format } from "date-fns";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { Brain, AlertTriangle, ShieldCheck, HelpCircle, Loader2, ExternalLink, ThumbsUp, ThumbsDown, FileText, Cog, Target, Clock } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
    useAiTriageDecision,
    useAiInvestigation,
    useRunTriage,
    useRunInvestigation,
    useReviewTriageDecision,
    type Citation,
    type AiTriageDecision,
    type AiInvestigation,
} from "@/hooks/useAISoc";
import { useToast } from "@/hooks/use-toast";

interface Props {
    alertId: string | null;
    onOpenChange: (open: boolean) => void;
}

export function AiDecisionDrawer({ alertId, onOpenChange }: Props) {
    const triage = useAiTriageDecision(alertId ?? undefined);
    const investigation = useAiInvestigation(alertId ?? undefined);
    const runTriage = useRunTriage();
    const runInvestigation = useRunInvestigation();
    const review = useReviewTriageDecision();
    const { toast } = useToast();
    const open = !!alertId;

    const handleReview = (action: "approved" | "overridden" | "dismissed") => {
        if (!triage.data?.id) return;
        review.mutate({ decisionId: triage.data.id, action }, {
            onSuccess: () => toast({ title: `Decision ${action}` }),
        });
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
                <SheetHeader>
                    <SheetTitle className="flex items-center gap-2">
                        <Brain className="h-5 w-5 text-primary" />
                        AI SOC analysis
                    </SheetTitle>
                    <SheetDescription>
                        Triage decision + investigation. Every claim cites the evidence it came from — click to see the source row.
                    </SheetDescription>
                </SheetHeader>

                {!triage.data ? (
                    <EmptyState
                        loading={triage.isLoading}
                        onTriage={() => alertId && runTriage.mutate({ alertId })}
                        running={runTriage.isPending}
                    />
                ) : (
                    <div className="mt-6 space-y-6">
                        <TriageSummary decision={triage.data} onReview={handleReview} reviewing={review.isPending} />

                        {triage.data.verdict === "true_positive" && (
                            <>
                                <Separator />
                                <Investigation
                                    investigation={investigation.data}
                                    loading={investigation.isLoading}
                                    onRun={() => alertId && runInvestigation.mutate({ alertId })}
                                    running={runInvestigation.isPending}
                                />
                            </>
                        )}

                        <Separator />
                        <ManualReRun
                            onReTriage={() => alertId && runTriage.mutate({ alertId, force: true })}
                            onReInvestigate={() => alertId && runInvestigation.mutate({ alertId, force: true })}
                            triageRunning={runTriage.isPending}
                            investigationRunning={runInvestigation.isPending}
                        />
                    </div>
                )}
            </SheetContent>
        </Sheet>
    );
}

function EmptyState({ loading, onTriage, running }: { loading: boolean; onTriage: () => void; running: boolean }) {
    if (loading) {
        return (
            <div className="mt-12 flex justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
        );
    }
    return (
        <div className="mt-10 text-center max-w-md mx-auto">
            <Brain className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground mb-4">
                No AI decision yet for this alert. Run the triage agent now to get a verdict + cited reasoning.
            </p>
            <Button onClick={onTriage} disabled={running}>
                {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Brain className="h-4 w-4 mr-2" />}
                Run AI triage
            </Button>
        </div>
    );
}

function VerdictIcon({ verdict }: { verdict: AiTriageDecision["verdict"] }) {
    if (verdict === "true_positive") return <AlertTriangle className="h-5 w-5 text-red-500" />;
    if (verdict === "false_positive") return <ShieldCheck className="h-5 w-5 text-emerald-500" />;
    if (verdict === "needs_human") return <HelpCircle className="h-5 w-5 text-amber-500" />;
    return <Brain className="h-5 w-5" />;
}

function TriageSummary({ decision, onReview, reviewing }: {
    decision: AiTriageDecision;
    onReview: (a: "approved" | "overridden" | "dismissed") => void;
    reviewing: boolean;
}) {
    if (decision.status === "pending") {
        return (
            <div className="flex items-center gap-3 p-4 rounded-lg border border-border/40 bg-muted/20">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <div>
                    <div className="font-semibold text-sm">Triaging…</div>
                    <div className="text-xs text-muted-foreground">The AI is reading the evidence. Usually under 10s.</div>
                </div>
            </div>
        );
    }
    if (decision.status === "failed") {
        return (
            <div className="p-4 rounded-lg border border-red-500/40 bg-red-500/5">
                <div className="font-semibold text-sm text-red-500 mb-1">Triage failed</div>
                <div className="text-xs text-muted-foreground font-mono break-all">{decision.error_message}</div>
            </div>
        );
    }
    if (decision.status === "budget_exceeded") {
        return (
            <div className="p-4 rounded-lg border border-amber-500/40 bg-amber-500/5">
                <div className="font-semibold text-sm text-amber-500 mb-1">Daily AI budget reached</div>
                <div className="text-xs text-muted-foreground">{decision.error_message}</div>
            </div>
        );
    }

    const conf = decision.confidence != null ? Math.round(decision.confidence * 100) : null;
    return (
        <div className="space-y-4">
            <div className="flex items-start gap-3">
                <VerdictIcon verdict={decision.verdict} />
                <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold uppercase text-sm">{decision.verdict?.replace(/_/g, " ")}</span>
                        {conf != null && (
                            <Badge variant="outline">{conf}% confidence</Badge>
                        )}
                        {decision.auto_closed && (
                            <Badge variant="outline" className="text-emerald-500 border-emerald-500/40">auto-closed</Badge>
                        )}
                        {decision.reviewed_at && (
                            <Badge variant="outline">human: {decision.review_action}</Badge>
                        )}
                    </div>
                    <p className="text-sm mt-2 leading-relaxed">{decision.summary}</p>
                </div>
            </div>

            {decision.key_indicators.length > 0 && (
                <Section icon={<Target className="h-3.5 w-3.5" />} title="Key indicators">
                    <ul className="space-y-1.5">
                        {decision.key_indicators.map((k, i) => (
                            <li key={i} className="text-sm flex items-start gap-2">
                                <span className="text-muted-foreground mt-0.5">•</span>
                                <span className="flex-1">
                                    {k.indicator} <CitationChip citation={k.citation} />
                                </span>
                            </li>
                        ))}
                    </ul>
                </Section>
            )}

            {decision.reasoning_steps.length > 0 && (
                <Section icon={<Brain className="h-3.5 w-3.5" />} title="Reasoning">
                    <ol className="space-y-1.5 list-decimal list-inside marker:text-muted-foreground">
                        {decision.reasoning_steps.map((r, i) => (
                            <li key={i} className="text-sm">
                                {r.step} <CitationChip citation={r.citation} />
                            </li>
                        ))}
                    </ol>
                </Section>
            )}

            {decision.recommended_action && (
                <Section icon={<Cog className="h-3.5 w-3.5" />} title="Recommended action">
                    <p className="text-sm">{decision.recommended_action}</p>
                    {decision.recommended_command && decision.recommended_command !== "none" && (
                        <Badge variant="outline" className="mt-2 font-mono">command: {decision.recommended_command}</Badge>
                    )}
                </Section>
            )}

            {decision.mitre_tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {decision.mitre_tags.map((t) => (
                        <Badge key={t} variant="secondary" className="font-mono text-[10px]">{t}</Badge>
                    ))}
                </div>
            )}

            <Separator />

            <div className="flex items-center justify-between gap-3">
                <div className="text-[10px] text-muted-foreground">
                    {decision.model} · {decision.latency_ms}ms · ${(decision.cost_cents / 100).toFixed(4)}
                </div>
                <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => onReview("approved")} disabled={reviewing}>
                        <ThumbsUp className="h-3.5 w-3.5 mr-1" />
                        Approve
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => onReview("overridden")} disabled={reviewing}>
                        <ThumbsDown className="h-3.5 w-3.5 mr-1" />
                        Override
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onReview("dismissed")} disabled={reviewing}>
                        Dismiss
                    </Button>
                </div>
            </div>
        </div>
    );
}

function Investigation({ investigation, loading, onRun, running }: {
    investigation: AiInvestigation | null | undefined;
    loading: boolean;
    onRun: () => void;
    running: boolean;
}) {
    if (loading) {
        return (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading investigation…
            </div>
        );
    }
    if (!investigation) {
        return (
            <div className="p-4 rounded-lg border border-border/40 text-center">
                <FileText className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground mb-3">No investigation yet.</p>
                <Button onClick={onRun} disabled={running}>
                    {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Brain className="h-4 w-4 mr-2" />}
                    Run AI investigation
                </Button>
            </div>
        );
    }
    if (investigation.status === "pending") {
        return (
            <div className="flex items-center gap-3 p-4 rounded-lg border border-border/40 bg-muted/20">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <div>
                    <div className="font-semibold text-sm">Investigating…</div>
                    <div className="text-xs text-muted-foreground">Building timeline + report. Usually 15-45s.</div>
                </div>
            </div>
        );
    }
    if (investigation.status === "failed") {
        return (
            <div className="p-4 rounded-lg border border-red-500/40 bg-red-500/5">
                <div className="font-semibold text-sm text-red-500 mb-1">Investigation failed</div>
                <div className="text-xs text-muted-foreground font-mono break-all">{investigation.error_message}</div>
            </div>
        );
    }
    if (investigation.status === "budget_exceeded") {
        return (
            <div className="p-4 rounded-lg border border-amber-500/40 bg-amber-500/5 text-sm text-amber-500">
                Daily AI budget reached — investigation skipped.
            </div>
        );
    }

    return (
        <Tabs defaultValue="summary">
            <TabsList className="grid grid-cols-4 w-full">
                <TabsTrigger value="summary">Summary</TabsTrigger>
                <TabsTrigger value="timeline">Timeline ({investigation.timeline.length})</TabsTrigger>
                <TabsTrigger value="actions">Actions</TabsTrigger>
                <TabsTrigger value="report">Customer report</TabsTrigger>
            </TabsList>

            <TabsContent value="summary" className="mt-4 space-y-4">
                <Section icon={<FileText className="h-3.5 w-3.5" />} title="Incident summary">
                    <p className="text-sm leading-relaxed">{investigation.incident_summary}</p>
                </Section>
                <Section icon={<Target className="h-3.5 w-3.5" />} title="Attack chain">
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{investigation.attack_chain_analysis}</p>
                </Section>
                {investigation.affected_assets.length > 0 && (
                    <Section icon={<Target className="h-3.5 w-3.5" />} title="Affected assets">
                        <ul className="space-y-1.5">
                            {investigation.affected_assets.map((a, i) => (
                                <li key={i} className="text-sm">
                                    <Badge variant="outline" className="mr-2 text-[10px]">{a.asset_type}</Badge>
                                    {a.asset_name}
                                    <CitationChip citation={a.citation} />
                                </li>
                            ))}
                        </ul>
                    </Section>
                )}
            </TabsContent>

            <TabsContent value="timeline" className="mt-4">
                <ol className="space-y-2">
                    {investigation.timeline.map((t, i) => (
                        <li key={i} className="flex items-start gap-3 text-sm">
                            <Clock className="h-3.5 w-3.5 mt-0.5 text-muted-foreground flex-shrink-0" />
                            <div className="flex-1">
                                <div className="text-xs text-muted-foreground font-mono">
                                    {format(new Date(t.occurred_at), "dd MMM HH:mm:ss")}
                                </div>
                                <div>{t.event_text} <CitationChip citation={t.citation} /></div>
                            </div>
                        </li>
                    ))}
                </ol>
            </TabsContent>

            <TabsContent value="actions" className="mt-4 space-y-4">
                {investigation.suggested_containment.length > 0 && (
                    <Section icon={<Cog className="h-3.5 w-3.5" />} title="Containment (stop the bleeding)">
                        <ul className="space-y-2">
                            {investigation.suggested_containment.map((c, i) => (
                                <li key={i} className="text-sm">
                                    <div className="font-medium">{c.action}</div>
                                    <div className="text-xs text-muted-foreground mt-0.5">
                                        {c.rationale} <CitationChip citation={c.citation} />
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </Section>
                )}
                {investigation.suggested_eradication.length > 0 && (
                    <Section icon={<Cog className="h-3.5 w-3.5" />} title="Eradication (prevent return)">
                        <ul className="space-y-2">
                            {investigation.suggested_eradication.map((c, i) => (
                                <li key={i} className="text-sm">
                                    <div className="font-medium">{c.action}</div>
                                    <div className="text-xs text-muted-foreground mt-0.5">
                                        {c.rationale} <CitationChip citation={c.citation} />
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </Section>
                )}
            </TabsContent>

            <TabsContent value="report" className="mt-4">
                <div className="rounded-lg border border-border/40 bg-card p-4">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                        Customer-ready report — review before sending
                    </div>
                    <article className="prose prose-invert prose-sm prose-headings:font-bold prose-h2:text-base prose-h3:text-sm max-w-none">
                        {/*
                          customer_report_markdown is LLM-generated AND
                          contains attacker-controlled telemetry verbatim.
                          rehype-sanitize strips any raw HTML / scripts /
                          inline styles. react-markdown v8+ refuses raw HTML
                          by default but this is belt-and-braces — if anyone
                          adds rehypeRaw later, the sanitiser still defends.
                        */}
                        <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
                            {investigation.customer_report_markdown ?? ""}
                        </ReactMarkdown>
                    </article>
                </div>
                <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => {
                        navigator.clipboard.writeText(investigation.customer_report_markdown ?? "");
                    }}>
                        Copy markdown
                    </Button>
                </div>
                <div className="text-[10px] text-muted-foreground mt-4 text-right">
                    {investigation.model} · {investigation.latency_ms}ms · ${(investigation.cost_cents / 100).toFixed(4)}
                </div>
            </TabsContent>
        </Tabs>
    );
}

function ManualReRun({ onReTriage, onReInvestigate, triageRunning, investigationRunning }: {
    onReTriage: () => void;
    onReInvestigate: () => void;
    triageRunning: boolean;
    investigationRunning: boolean;
}) {
    return (
        <div className="flex gap-2 text-xs text-muted-foreground items-center justify-between">
            <span>Force a re-run if the underlying evidence has changed.</span>
            <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={onReTriage} disabled={triageRunning}>
                    Re-triage
                </Button>
                <Button size="sm" variant="ghost" onClick={onReInvestigate} disabled={investigationRunning}>
                    Re-investigate
                </Button>
            </div>
        </div>
    );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
    return (
        <div>
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
                {icon}
                {title}
            </div>
            {children}
        </div>
    );
}

// Citation chips show the source table + a truncated row ID. Hover to see the
// full row ID; future enhancement: link to a per-table source-view page.
function CitationChip({ citation }: { citation: Citation }) {
    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors ml-1 align-middle">
                        <ExternalLink className="h-2.5 w-2.5" />
                        {citation.table}
                    </span>
                </TooltipTrigger>
                <TooltipContent className="font-mono text-[10px] max-w-xs break-all">
                    {citation.table}.{citation.row_id}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}
