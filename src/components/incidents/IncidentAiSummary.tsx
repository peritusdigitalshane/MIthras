import { useIncidentAssessment, useTriageIncident } from "@/hooks/useIncidentAi";
import { useEnqueueAgentCommand, CommandType } from "@/hooks/useAgentCommands";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useEffect } from "react";
import { Bot, Loader2, RefreshCw, Sparkles, Zap } from "lucide-react";

interface Props {
  incidentId: string;
  endpointId: string | null;
}

export function IncidentAiSummary({ incidentId, endpointId }: Props) {
  const { toast } = useToast();
  const { data: assessment, isLoading } = useIncidentAssessment(incidentId);
  const triage = useTriageIncident();
  const enqueue = useEnqueueAgentCommand();

  // Auto-fetch on first render if not yet generated.
  useEffect(() => {
    if (!isLoading && !assessment && !triage.isPending) {
      triage.mutate({ incidentId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId, isLoading, assessment?.summary]);

  const runSuggested = async () => {
    if (!endpointId || !assessment?.suggested_command || assessment.suggested_command === "none") return;
    try {
      await enqueue.mutateAsync({
        endpointId,
        commandType: assessment.suggested_command as CommandType,
        incidentId,
      });
      toast({ title: "AI-suggested action queued", description: `${assessment.suggested_command.replace(/_/g, " ")} dispatched to the endpoint.` });
    } catch (e) {
      toast({ title: "Failed to queue", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
    }
  };

  if (isLoading || (triage.isPending && !assessment)) {
    return (
      <Alert className="border-primary/30 bg-primary/5">
        <Bot className="h-4 w-4 animate-pulse text-primary" />
        <AlertTitle className="flex items-center gap-2"><Sparkles className="h-3 w-3" /> AI triage in progress…</AlertTitle>
        <AlertDescription className="text-xs flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Reading threat + endpoint context.</AlertDescription>
      </Alert>
    );
  }

  if (assessment?.error_message) {
    return (
      <Alert variant="destructive">
        <Bot className="h-4 w-4" />
        <AlertTitle>AI triage failed</AlertTitle>
        <AlertDescription className="text-xs">
          {assessment.error_message}
          <Button size="sm" variant="outline" className="mt-2" onClick={() => triage.mutate({ incidentId, force: true })}>
            <RefreshCw className="h-3 w-3 mr-1" /> Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!assessment?.summary) return null;

  return (
    <Alert className="border-primary/40 bg-primary/5">
      <Bot className="h-4 w-4 text-primary" />
      <AlertTitle className="flex items-center gap-2 flex-wrap">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        AI assessment
        {assessment.confidence && (
          <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
            {assessment.confidence} confidence
          </Badge>
        )}
        {assessment.severity_override && (
          <Badge variant="destructive" className="text-[10px]">
            Suggests severity: {assessment.severity_override}
          </Badge>
        )}
        <Button size="sm" variant="ghost" className="ml-auto h-6 px-2 text-xs" onClick={() => triage.mutate({ incidentId, force: true })} disabled={triage.isPending}>
          <RefreshCw className={`h-3 w-3 mr-1 ${triage.isPending ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </AlertTitle>
      <AlertDescription className="space-y-2 mt-1">
        <p className="text-sm leading-relaxed text-foreground">{assessment.summary}</p>
        {assessment.suggested_action && (
          <p className="text-sm">
            <span className="font-medium">→ Next:</span> {assessment.suggested_action}
          </p>
        )}
        {(assessment.mitre_tags?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {assessment.mitre_tags!.map(tag => (
              <Badge key={tag} variant="secondary" className="text-[10px] font-mono">{tag}</Badge>
            ))}
          </div>
        )}
        {assessment.suggested_command && assessment.suggested_command !== "none" && endpointId && (
          <Button size="sm" onClick={runSuggested} disabled={enqueue.isPending} className="mt-2 gap-1.5">
            <Zap className="h-3.5 w-3.5" /> Run AI-suggested: {assessment.suggested_command.replace(/_/g, " ")}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
