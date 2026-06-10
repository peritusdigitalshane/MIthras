import { Brain, Loader2, AlertTriangle, ShieldCheck, HelpCircle, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useAiTriageDecision, type AiTriageDecision } from "@/hooks/useAISoc";

interface Props {
    alertId: string;
    onClick?: () => void;
}

/**
 * Compact AI status pill rendered next to each alert in the list. Click
 * opens the AI decision drawer with full details.
 */
export function AiTriageBadge({ alertId, onClick }: Props) {
    const { data: decision } = useAiTriageDecision(alertId);
    if (!decision) return null;
    return <BadgeInner decision={decision} onClick={onClick} />;
}

function BadgeInner({ decision, onClick }: { decision: AiTriageDecision; onClick?: () => void }) {
    const common = "inline-flex items-center gap-1 cursor-pointer text-[10px] uppercase tracking-wider font-semibold";

    if (decision.status === "pending") {
        return (
            <Badge variant="outline" className={`${common} bg-muted/40 border-border/40`} onClick={onClick}>
                <Loader2 className="h-3 w-3 animate-spin" />
                AI triaging
            </Badge>
        );
    }
    if (decision.status === "failed") {
        return (
            <Badge variant="outline" className={`${common} bg-muted/40 border-border/40 text-muted-foreground`} onClick={onClick}>
                <XCircle className="h-3 w-3" />
                AI failed
            </Badge>
        );
    }
    if (decision.status === "budget_exceeded") {
        return (
            <Badge variant="outline" className={`${common} bg-muted/40 border-border/40 text-muted-foreground`} onClick={onClick}>
                <AlertTriangle className="h-3 w-3" />
                AI budget
            </Badge>
        );
    }

    const verdict = decision.verdict;
    const conf = decision.confidence != null ? Math.round(decision.confidence * 100) : null;

    if (verdict === "true_positive") {
        return (
            <Badge variant="outline" className={`${common} bg-red-500/15 text-red-500 border-red-500/40`} onClick={onClick}>
                <AlertTriangle className="h-3 w-3" />
                AI: real ({conf}%)
                {decision.escalated_to_investigation && <span className="ml-1 opacity-70">· investigating</span>}
            </Badge>
        );
    }
    if (verdict === "false_positive") {
        return (
            <Badge variant="outline" className={`${common} bg-emerald-500/15 text-emerald-500 border-emerald-500/40`} onClick={onClick}>
                <ShieldCheck className="h-3 w-3" />
                AI: false positive ({conf}%)
                {decision.auto_closed && <span className="ml-1 opacity-70">· auto-closed</span>}
            </Badge>
        );
    }
    if (verdict === "needs_human") {
        return (
            <Badge variant="outline" className={`${common} bg-amber-500/15 text-amber-500 border-amber-500/40`} onClick={onClick}>
                <HelpCircle className="h-3 w-3" />
                AI: needs human ({conf}%)
            </Badge>
        );
    }
    return (
        <Badge variant="outline" className={`${common}`} onClick={onClick}>
            <Brain className="h-3 w-3" />
            AI: {verdict}
        </Badge>
    );
}
