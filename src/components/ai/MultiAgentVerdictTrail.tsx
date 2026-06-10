import { Brain, ShieldCheck, AlertTriangle, HelpCircle, Sword, Loader2, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
    useAgentVerdicts,
    type AgentVerdict,
    type AiTriageDecision,
} from "@/hooks/useAISoc";

interface Props {
    decision: AiTriageDecision;
}

/**
 * Multi-agent verdict trail. Customer-facing proof that the decision was
 * reviewed by three independent AI agents, not a single black-box LLM call.
 *
 * Hides itself entirely on legacy single-agent decisions (no verification
 * row present) — the existing TriageSummary handles that case as before.
 */
export function MultiAgentVerdictTrail({ decision }: Props) {
    const verdicts = useAgentVerdicts(decision.id);

    if (verdicts.isLoading) {
        return (
            <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
                <CardContent className="py-6 flex items-center gap-3">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    <div className="text-sm text-muted-foreground">Loading multi-agent verdict trail…</div>
                </CardContent>
            </Card>
        );
    }

    const list = verdicts.data ?? [];
    const triage = list.find(v => v.agent_name === "triage");
    const verification = list.find(v => v.agent_name === "verification");
    const adversarial = list.find(v => v.agent_name === "adversarial");

    // Legacy / pre-multi-agent decision — don't render anything.
    // The original TriageSummary continues to show the single verdict
    // exactly as it always has.
    if (!verification && !adversarial) {
        return null;
    }

    const finalVerdict = decision.final_verdict ?? decision.verdict;
    const finalConfidence = decision.final_confidence ?? decision.confidence;
    const stateLabel = orchestrationStateLabel(decision.orchestration_state);

    return (
        <Card className={
            decision.disagreement_detected
                ? "border-amber-500/40 bg-gradient-to-br from-amber-500/5 to-transparent"
                : "border-primary/30 bg-gradient-to-br from-primary/5 to-transparent"
        }>
            <CardContent className="space-y-4 pt-5">
                {/* Header: final consensus */}
                <div className="flex items-start gap-3">
                    <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
                        decision.disagreement_detected ? "bg-amber-500/15" : "bg-primary/15"
                    }`}>
                        <Sparkles className={`h-5 w-5 ${
                            decision.disagreement_detected ? "text-amber-500" : "text-primary"
                        }`} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs uppercase tracking-wider text-muted-foreground">
                                Multi-agent consensus
                            </span>
                            <Badge
                                variant="outline"
                                className="text-[10px] uppercase tracking-wider border-primary/40 text-primary"
                            >
                                Phase {stateLabel}
                            </Badge>
                        </div>
                        <div className="mt-1 flex items-center gap-2 flex-wrap">
                            <VerdictPill verdict={finalVerdict} />
                            {finalConfidence != null && (
                                <Badge variant="outline" className="text-xs">
                                    {Math.round(finalConfidence * 100)}% confidence
                                </Badge>
                            )}
                            {decision.disagreement_detected && (
                                <Badge variant="outline" className="text-xs border-amber-500/40 text-amber-500">
                                    ⚠ Disagreement
                                </Badge>
                            )}
                            {decision.adversarial_refuted === true && (
                                <Badge variant="outline" className="text-xs border-rose-500/40 text-rose-500">
                                    Adversarial refuted
                                </Badge>
                            )}
                            {decision.adversarial_refuted === false && (
                                <Badge variant="outline" className="text-xs border-emerald-500/40 text-emerald-500">
                                    Adversarial cleared
                                </Badge>
                            )}
                        </div>
                        {decision.consensus_reasoning && (
                            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                                {decision.consensus_reasoning}
                            </p>
                        )}
                    </div>
                </div>

                {/* Three-agent grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <AgentCard
                        title="Triage"
                        role="Initial classification"
                        icon={<Brain className="h-4 w-4" />}
                        verdict={triage}
                        kind="classifier"
                    />
                    <AgentCard
                        title="Verification"
                        role="Independent re-classification"
                        icon={<ShieldCheck className="h-4 w-4" />}
                        verdict={verification ?? null}
                        kind="classifier"
                    />
                    <AgentCard
                        title="Adversarial"
                        role="Refutation attempt"
                        icon={<Sword className="h-4 w-4" />}
                        verdict={adversarial ?? null}
                        kind="refuter"
                        skippedReason={
                            !adversarial && triage?.verdict !== "true_positive"
                                && (!verification?.verdict || verification?.verdict === triage?.verdict)
                                ? "Not run — Triage + Verification agreed on a non-malicious verdict"
                                : undefined
                        }
                    />
                </div>

                {/* Footer: value statement */}
                <div className="text-[11px] text-muted-foreground border-t border-border/40 pt-3 leading-relaxed">
                    Decision reviewed by {list.length} independent AI agents.
                    {" "}<strong>Triage</strong> classifies, <strong>Verification</strong> re-runs with a
                    different model, and <strong>Adversarial</strong> tries to disprove the verdict. The
                    final call is the consensus — no single LLM can drive an automated response.
                </div>
            </CardContent>
        </Card>
    );
}

// --------------------------------------------------------------------
// Helpers

function orchestrationStateLabel(s: AiTriageDecision["orchestration_state"]): string {
    switch (s) {
        case "pending":         return "1/3 (triaging)";
        case "triaged":         return "2/3 (verifying)";
        case "verified":        return "3/3 (refuting)";
        case "completed":       return "complete";
        case "failed":          return "failed";
        case "budget_exceeded": return "budget exceeded";
        default:                return s ?? "—";
    }
}

function VerdictPill({ verdict }: { verdict: string | null | undefined }) {
    if (!verdict) {
        return <Badge variant="outline" className="text-xs">— pending</Badge>;
    }
    const cls =
        verdict === "true_positive"  ? "border-rose-500/50 text-rose-600 bg-rose-500/5" :
        verdict === "false_positive" ? "border-emerald-500/50 text-emerald-600 bg-emerald-500/5" :
        verdict === "needs_human"    ? "border-amber-500/50 text-amber-600 bg-amber-500/5" :
        verdict === "inconclusive"   ? "border-slate-500/50 text-slate-600 bg-slate-500/5" :
        verdict === "refuted"        ? "border-rose-500/50 text-rose-600 bg-rose-500/5" :
        verdict === "not_refuted"    ? "border-emerald-500/50 text-emerald-600 bg-emerald-500/5" :
                                       "border-border";
    return (
        <Badge variant="outline" className={`text-xs uppercase tracking-wider ${cls}`}>
            {verdict.replace(/_/g, " ")}
        </Badge>
    );
}

interface AgentCardProps {
    title: string;
    role: string;
    icon: React.ReactNode;
    verdict: AgentVerdict | null | undefined;
    kind: "classifier" | "refuter";
    skippedReason?: string;
}

function AgentCard({ title, role, icon, verdict, kind, skippedReason }: AgentCardProps) {
    // Not run state. For the Adversarial agent this is the common case
    // (only fires for TP or disagreement), so distinguish "skipped on purpose"
    // from "still running".
    if (!verdict) {
        return (
            <div className="rounded-lg border border-dashed border-border/40 bg-muted/20 p-3 space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    {icon}
                    <span>{title}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                    {skippedReason ?? "Pending…"}
                </p>
            </div>
        );
    }

    if (verdict.error_message) {
        return (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
                    {icon}
                    <span>{title}</span>
                </div>
                <p className="text-[11px] font-mono text-amber-700 break-all">
                    {verdict.error_message.slice(0, 120)}
                </p>
            </div>
        );
    }

    const conf = verdict.confidence != null ? Math.round(verdict.confidence * 100) : null;
    const cost = verdict.cost_microcents != null ? verdict.cost_microcents / 100_000 : null;

    return (
        <div className="rounded-lg border border-border/40 bg-card p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-medium">
                    {icon}
                    <span>{title}</span>
                </div>
                {verdict.model && (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <span className="text-[10px] text-muted-foreground font-mono cursor-help">
                                    {verdict.model}
                                </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                                <div>Model: {verdict.model}</div>
                                {verdict.latency_ms != null && <div>Latency: {verdict.latency_ms}ms</div>}
                                {cost != null && <div>Cost: ${cost.toFixed(4)}</div>}
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                )}
            </div>

            <div className="text-[11px] text-muted-foreground">{role}</div>

            <div className="flex items-center gap-2 flex-wrap">
                <VerdictPill verdict={verdict.verdict} />
                {conf != null && (
                    <Badge variant="secondary" className="text-[10px]">{conf}%</Badge>
                )}
            </div>

            {verdict.summary && (
                <p className="text-[11px] leading-relaxed line-clamp-3">
                    {verdict.summary}
                </p>
            )}

            {/* Refutation-specific surface */}
            {kind === "refuter" && verdict.refutations.length > 0 && (
                <div className="text-[10px] space-y-0.5 border-t border-border/40 pt-2 mt-2">
                    <div className="font-medium uppercase tracking-wider text-muted-foreground">
                        Refutations ({verdict.refutations.length})
                    </div>
                    {verdict.refutations.slice(0, 2).map((r, i) => (
                        <div key={i} className="text-muted-foreground line-clamp-2">
                            <Badge variant="outline" className="text-[9px] mr-1">{r.strength}</Badge>
                            {r.argument}
                        </div>
                    ))}
                </div>
            )}

            {/* Classifier-specific surface */}
            {kind === "classifier" && verdict.key_indicators.length > 0 && (
                <div className="text-[10px] text-muted-foreground border-t border-border/40 pt-2 mt-2">
                    <span className="font-medium uppercase tracking-wider">Cited</span>{" "}
                    {verdict.key_indicators.length} indicator{verdict.key_indicators.length === 1 ? "" : "s"}
                </div>
            )}
        </div>
    );
}
