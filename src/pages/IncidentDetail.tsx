import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { formatDistanceToNow, format } from "date-fns";
import {
  ArrowLeft, ShieldAlert, Sparkles, Bot, Activity, CheckCircle2,
  Clock, AlertTriangle, Cpu, Loader2, FileText, Mail, Zap, Monitor,
  ChevronRight, RotateCcw,
} from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useIncident, useResolveIncident, type Incident } from "@/hooks/useIncidents";
import { useAiTriageDecision } from "@/hooks/useAISoc";
import { MultiAgentVerdictTrail } from "@/components/ai/MultiAgentVerdictTrail";
import { AiDecisionDrawer } from "@/components/ai/AiDecisionDrawer";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTenant } from "@/contexts/TenantContext";

/**
 * Incident detail page (/incidents/:id).
 *
 * The L2 analyst's case view. Shows the AI Commander's summary on top,
 * then the multi-agent verdict trail (Triage → Verify → Adversarial),
 * the response action that was dispatched (if any), the customer comms
 * history, and resolution controls.
 *
 * Most of the heavy lifting is delegated to the existing AI surface:
 *   * MultiAgentVerdictTrail — the three-agent consensus card
 *   * AiDecisionDrawer — opens for the full investigation report
 *
 * The "View full AI analysis" button slides out the drawer for the
 * complete cited-evidence + attack-chain treatment.
 */

const SEVERITY_CLASSES: Record<string, string> = {
  Severe:   "bg-status-critical/20 text-status-critical border-status-critical/40",
  High:     "bg-orange-500/20 text-orange-500 border-orange-500/40",
  Moderate: "bg-amber-500/20 text-amber-500 border-amber-500/40",
  Low:      "bg-muted text-muted-foreground border-muted-foreground/40",
};

const PLAYBOOK_STEPS = [
  { key: "forensics_complete", label: "Forensics complete", icon: FileText },
  { key: "contained",          label: "Contained",           icon: ShieldAlert },
  { key: "customer_notified",  label: "Customer notified",   icon: Mail },
  { key: "review_scheduled",   label: "Review scheduled",    icon: Clock },
  { key: "resolved",           label: "Resolved",            icon: CheckCircle2 },
] as const;

export default function IncidentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: incident, isLoading, error } = useIncident(id);
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveOutcome, setResolveOutcome] = useState<"resolved" | "false_positive">("resolved");
  const [resolveNotes, setResolveNotes] = useState("");
  const resolveMut = useResolveIncident();

  if (isLoading) {
    return (
      <MainLayout>
        <div className="space-y-4">
          <Skeleton className="h-10 w-1/2" />
          <Skeleton className="h-32" />
          <Skeleton className="h-64" />
        </div>
      </MainLayout>
    );
  }
  if (error || !incident) {
    return (
      <MainLayout>
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {error?.message ?? "Incident not found or you don't have access."}
            <div className="mt-4">
              <Button variant="outline" size="sm" asChild>
                <Link to="/incidents"><ArrowLeft className="h-4 w-4 mr-2" />Back to incidents</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </MainLayout>
    );
  }

  const handleResolveSubmit = async () => {
    try {
      await resolveMut.mutateAsync({
        incidentId: incident.id,
        outcome: resolveOutcome,
        notes: resolveNotes.trim() || undefined,
      });
      toast({ title: `Incident ${resolveOutcome === "resolved" ? "resolved" : "marked false positive"}` });
      setResolveOpen(false);
      setResolveNotes("");
      navigate("/incidents");
    } catch (e) {
      toast({
        title: "Failed to resolve",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const isClosed = incident.status === "resolved" || incident.status === "false_positive";

  return (
    <MainLayout>
      <div className="animate-fade-in space-y-6">
        {/* Top nav */}
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link to="/incidents"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
              <span>INC-{incident.id.slice(0, 8)}</span>
              <span className="opacity-50">·</span>
              <span>opened {formatDistanceToNow(new Date(incident.opened_at), { addSuffix: true })}</span>
              {incident.endpoint?.hostname && (
                <>
                  <span className="opacity-50">·</span>
                  <Monitor className="h-3 w-3" />
                  <Link to={`/endpoints/${incident.endpoint.id}`} className="hover:text-foreground">
                    {incident.endpoint.hostname}
                  </Link>
                </>
              )}
            </div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 mt-0.5">
              <ShieldAlert className="h-6 w-6 text-primary flex-shrink-0" />
              <span className="truncate">{incident.title}</span>
            </h1>
          </div>
          <HeaderActions
            incident={incident}
            isClosed={isClosed}
            onResolve={() => { setResolveOutcome("resolved"); setResolveOpen(true); }}
            onMarkFp={() => { setResolveOutcome("false_positive"); setResolveOpen(true); }}
          />
        </div>

        {/* Status chip row */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={`uppercase tracking-wider text-[10px] ${SEVERITY_CLASSES[incident.severity] ?? ""}`}>
            {incident.severity}
          </Badge>
          <StatusBadge status={incident.status} />
          <SlaPill incident={incident} />
          {incident.commander_kind && (
            <Badge variant="outline" className="gap-1 font-mono text-[10px]">
              <Sparkles className="h-3 w-3 text-primary" />
              {incident.commander_kind.replace(/_/g, " ")}
            </Badge>
          )}
          {incident.alert_id && (
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setAiDrawerOpen(true)}>
              <Bot className="h-3.5 w-3.5 mr-1" />
              View full AI analysis
              <ChevronRight className="h-3 w-3 ml-0.5" />
            </Button>
          )}
        </div>

        {/* Commander summary card — only when commander has run */}
        {incident.commander_summary && (
          <CommanderSummaryCard incident={incident} />
        )}

        {/* Playbook progress */}
        {incident.playbook_step && (
          <PlaybookCard incident={incident} />
        )}

        {/* Multi-agent verdict trail */}
        {incident.alert_id && <AgentTrailSection alertId={incident.alert_id} />}

        {/* Response action — what got dispatched and what's in flight */}
        {incident.triage_decision_id && (
          <ResponseActionCard triageDecisionId={incident.triage_decision_id} />
        )}

        {/* Customer comms history */}
        {incident.triage_decision_id && (
          <CommsHistoryCard triageDecisionId={incident.triage_decision_id} />
        )}

        {/* Resolution notes (closed only) */}
        {isClosed && incident.resolution_notes && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                Resolution notes
              </CardTitle>
              <CardDescription>
                {incident.resolved_at && `Closed ${formatDistanceToNow(new Date(incident.resolved_at), { addSuffix: true })}`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap">{incident.resolution_notes}</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Drawer — full AI investigation report */}
      <AiDecisionDrawer
        alertId={aiDrawerOpen ? incident.alert_id : null}
        onOpenChange={(o) => !o && setAiDrawerOpen(false)}
      />

      {/* Resolution dialog */}
      <Dialog open={resolveOpen} onOpenChange={setResolveOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {resolveOutcome === "resolved"
                ? <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                : <AlertTriangle className="h-5 w-5 text-amber-500" />}
              {resolveOutcome === "resolved" ? "Resolve incident" : "Mark as false positive"}
            </DialogTitle>
            <DialogDescription>{incident.title}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Notes (added to audit trail + customer report)
            </div>
            <Textarea
              placeholder={resolveOutcome === "resolved"
                ? "What was done? What changed on the endpoint?"
                : "Why was this safe? What benign behaviour did this turn out to be?"}
              value={resolveNotes}
              onChange={(e) => setResolveNotes(e.target.value)}
              rows={5}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveOpen(false)} disabled={resolveMut.isPending}>
              Cancel
            </Button>
            <Button onClick={handleResolveSubmit} disabled={resolveMut.isPending}>
              {resolveMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {resolveOutcome === "resolved" ? "Resolve" : "Mark false positive"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}

// ---------------------------------------------------------------------------
// Header actions
// ---------------------------------------------------------------------------

function HeaderActions({
  incident, isClosed, onResolve, onMarkFp,
}: {
  incident: Incident;
  isClosed: boolean;
  onResolve: () => void;
  onMarkFp: () => void;
}) {
  if (isClosed) {
    return (
      <Badge variant="outline" className="gap-1 text-emerald-500 border-emerald-500/40 bg-emerald-500/10">
        <CheckCircle2 className="h-3 w-3" />
        {incident.status === "resolved" ? "Resolved" : "Closed (FP)"}
      </Badge>
    );
  }
  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      <Button size="sm" variant="outline" onClick={onMarkFp}>False positive</Button>
      <Button size="sm" onClick={onResolve}>Resolve</Button>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "resolved" || status === "false_positive") {
    return (
      <Badge variant="outline" className="gap-1">
        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
        {status === "resolved" ? "Resolved" : "False positive"}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1">
      <Clock className="h-3 w-3" />
      {status === "in_progress" ? "In progress" : status === "triaging" ? "Triaging" : "Open"}
    </Badge>
  );
}

function SlaPill({ incident }: { incident: Incident }) {
  if (incident.status === "resolved" || incident.status === "false_positive") return null;
  const due = new Date(incident.sla_due_at).getTime();
  const now = Date.now();
  if (due < now) {
    return (
      <Badge variant="outline" className="gap-1 text-red-500 border-red-500/40 bg-red-500/10 font-mono text-[10px]">
        <AlertTriangle className="h-3 w-3" />
        SLA breached {formatDistanceToNow(new Date(incident.sla_due_at), { addSuffix: true })}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground font-mono text-[10px]">
      <Clock className="h-3 w-3" />
      SLA due in {formatDistanceToNow(new Date(incident.sla_due_at))}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Commander summary card
// ---------------------------------------------------------------------------

function CommanderSummaryCard({ incident }: { incident: Incident }) {
  const costUsd = incident.commander_cost_microcents
    ? (incident.commander_cost_microcents / 1_000_000).toFixed(4)
    : null;
  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          AI Commander summary
        </CardTitle>
        <CardDescription className="flex items-center gap-2 text-[11px] font-mono">
          {incident.commander_model && (
            <>
              <Cpu className="h-3 w-3" />
              <span>{incident.commander_model}</span>
            </>
          )}
          {costUsd && (
            <>
              <span className="opacity-50">·</span>
              <span>${costUsd}</span>
            </>
          )}
          {incident.commander_last_action_at && (
            <>
              <span className="opacity-50">·</span>
              <span>updated {formatDistanceToNow(new Date(incident.commander_last_action_at), { addSuffix: true })}</span>
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{incident.commander_summary}</p>
        {incident.description && incident.description !== incident.commander_summary && (
          <details className="mt-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground">Customer-facing summary</summary>
            <p className="mt-2 whitespace-pre-wrap leading-relaxed">{incident.description}</p>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Playbook progress
// ---------------------------------------------------------------------------

function PlaybookCard({ incident }: { incident: Incident }) {
  const currentIdx = PLAYBOOK_STEPS.findIndex((s) => s.key === incident.playbook_step);
  const state = (incident.playbook_state ?? {}) as Record<string, unknown>;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          Playbook
        </CardTitle>
        <CardDescription>The Commander's progress through the response workflow.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-2">
          {PLAYBOOK_STEPS.map((step, i) => {
            const Icon = step.icon;
            const done = i < currentIdx || (i === currentIdx && state[step.key] === true);
            const active = i === currentIdx && !done;
            return (
              <li key={step.key} className="flex items-center gap-3 text-sm">
                <span className={`h-7 w-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                  done   ? "bg-emerald-500/15 text-emerald-500" :
                  active ? "bg-primary/15 text-primary"         :
                           "bg-muted text-muted-foreground/60"
                }`}>
                  {done ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-3.5 w-3.5" />}
                </span>
                <span className={done ? "text-foreground" : active ? "text-foreground/90 font-medium" : "text-muted-foreground"}>
                  {step.label}
                </span>
                {active && <span className="ml-2 text-[10px] uppercase tracking-wider text-primary">current</span>}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Multi-agent trail
// ---------------------------------------------------------------------------

function AgentTrailSection({ alertId }: { alertId: string }) {
  const triage = useAiTriageDecision(alertId);
  if (!triage.data) return null;
  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        Agent consensus
      </h2>
      <MultiAgentVerdictTrail decision={triage.data} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Response action card
// ---------------------------------------------------------------------------

interface ResponseActionRow {
  id: string;
  action_kind: string;
  status: string;
  executed_at: string | null;
  rollback_at: string | null;
  rolled_back_at: string | null;
  customer_overrode_at: string | null;
  force_fired: boolean | null;
  comms_failed: boolean | null;
  comms_failure_reason: string | null;
  reasoning: string | null;
}

function ResponseActionCard({ triageDecisionId }: { triageDecisionId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { isSuperAdmin } = useTenant();
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [rollbackReason, setRollbackReason] = useState("");

  const { data: action } = useQuery({
    queryKey: ["incident-response-action", triageDecisionId],
    queryFn: async (): Promise<ResponseActionRow | null> => {
      const { data } = await supabase
        .from("ai_agent_actions")
        .select("id, action_kind, status, executed_at, rollback_at, rolled_back_at, customer_overrode_at, force_fired, comms_failed, comms_failure_reason, reasoning")
        .eq("triage_decision_id", triageDecisionId)
        .order("executed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    refetchInterval: 30_000,
  });

  const confirmMut = useMutation({
    mutationFn: async (actionId: string) => {
      const { error } = await supabase.rpc("confirm_ai_action" as any, { p_action_id: actionId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Action confirmed", description: "Auto-rollback cancelled." });
      qc.invalidateQueries({ queryKey: ["incident-response-action", triageDecisionId] });
    },
    onError: (e: any) => toast({ title: "Confirm failed", description: e?.message ?? "Unknown", variant: "destructive" }),
  });

  const rollbackMut = useMutation({
    mutationFn: async (input: { actionId: string; reason: string }) => {
      const { data, error } = await supabase.functions.invoke("ai-response-rollback", {
        body: { action_id: input.actionId, operator_reason: input.reason },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({ title: "Rollback dispatched" });
      setRollbackOpen(false);
      setRollbackReason("");
      qc.invalidateQueries({ queryKey: ["incident-response-action", triageDecisionId] });
    },
    onError: (e: any) => toast({ title: "Rollback failed", description: e?.message ?? "Unknown", variant: "destructive" }),
  });

  if (!action) return null;
  const isRolledBack = !!action.rolled_back_at;
  const isConfirmed = action.status === "customer_confirmed";
  const isPendingRollback = !isRolledBack && !isConfirmed && action.rollback_at && new Date(action.rollback_at).getTime() > Date.now();
  const canConfirm = action.status === "executed" && !isRolledBack && !isConfirmed && !action.customer_overrode_at;
  const canRollback = (action.status === "executed" || action.status === "customer_confirmed") && !isRolledBack && !action.customer_overrode_at;

  return (
    <Card className={action.comms_failed ? "border-amber-500/40 bg-amber-500/5" : undefined}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          Autonomous response
        </CardTitle>
        <CardDescription className="flex items-center gap-2 text-[11px] font-mono">
          <span className="font-semibold">{action.action_kind.replace(/_/g, " ")}</span>
          <span className="opacity-50">·</span>
          <span>{action.status}</span>
          {action.executed_at && (
            <>
              <span className="opacity-50">·</span>
              <span>{format(new Date(action.executed_at), "HH:mm:ss")}</span>
            </>
          )}
          {action.force_fired && (
            <Badge variant="outline" className="ml-2 border-amber-500/40 text-amber-500 bg-amber-500/10 text-[10px]">
              forceFire override
            </Badge>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {action.reasoning && (
          <p className="text-xs text-muted-foreground leading-relaxed">{action.reasoning}</p>
        )}
        {isPendingRollback && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs">
            <RotateCcw className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-amber-600 dark:text-amber-400">
                Auto-rollback armed
              </div>
              <div className="text-muted-foreground">
                Rolls back {formatDistanceToNow(new Date(action.rollback_at!), { addSuffix: true })} unless the customer confirms.
              </div>
            </div>
          </div>
        )}
        {isConfirmed && (
          <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-500">
            <CheckCircle2 className="h-4 w-4" />
            Action confirmed — auto-rollback cancelled.
          </div>
        )}
        {isRolledBack && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RotateCcw className="h-4 w-4" />
            Rolled back {formatDistanceToNow(new Date(action.rolled_back_at!), { addSuffix: true })}
            {action.customer_overrode_at && " by customer override"}
          </div>
        )}
        {action.comms_failed && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs">
            <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-amber-600 dark:text-amber-400">
                Customer notification failed — operator review required
              </div>
              <div className="text-muted-foreground font-mono">
                {action.comms_failure_reason ?? "(no reason recorded)"}
              </div>
              <div className="text-muted-foreground mt-1">
                Auto-rollback has been disarmed. Contact the customer manually and resolve or roll back from here.
              </div>
            </div>
          </div>
        )}

        {/* Action buttons */}
        {(canConfirm || canRollback) && (
          <div className="flex items-center gap-2 pt-2 border-t border-border/40">
            {canConfirm && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => confirmMut.mutate(action.id)}
                disabled={confirmMut.isPending}
              >
                {confirmMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                Confirm action
              </Button>
            )}
            {canRollback && (
              <Button
                size="sm"
                variant={isSuperAdmin ? "destructive" : "outline"}
                onClick={() => setRollbackOpen(true)}
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                {isSuperAdmin ? "Force rollback" : "Rollback now"}
              </Button>
            )}
          </div>
        )}
      </CardContent>

      <Dialog open={rollbackOpen} onOpenChange={setRollbackOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-amber-500" />
              {isSuperAdmin ? "Force rollback this action" : "Rollback this action"}
            </DialogTitle>
            <DialogDescription>
              Reverses <span className="font-mono">{action.action_kind}</span>. The endpoint will return to its prior state within a heartbeat.
              {isSuperAdmin && " As a super-admin, this counts as a force rollback and is recorded in the audit trail."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Reason (required, ≥ 20 chars)
            </div>
            <Textarea
              value={rollbackReason}
              onChange={(e) => setRollbackReason(e.target.value)}
              placeholder="What makes this action wrong? Lands in the audit log + monthly customer report."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRollbackOpen(false)} disabled={rollbackMut.isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={rollbackMut.isPending || rollbackReason.trim().length < 20}
              onClick={() => rollbackMut.mutate({ actionId: action.id, reason: rollbackReason.trim() })}
            >
              {rollbackMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Rollback now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Comms history card
// ---------------------------------------------------------------------------

interface CommsRow {
  id: string;
  subject: string;
  recipients: string[];
  status: string;
  sent_at: string | null;
  created_at: string;
  error_message: string | null;
}

function CommsHistoryCard({ triageDecisionId }: { triageDecisionId: string }) {
  const { data: comms } = useQuery({
    queryKey: ["incident-comms", triageDecisionId],
    queryFn: async (): Promise<CommsRow[]> => {
      const { data } = await supabase
        .from("ai_agent_comms")
        .select("id, subject, recipients, status, sent_at, created_at, error_message")
        .eq("triage_decision_id", triageDecisionId)
        .order("created_at", { ascending: false });
      return (data ?? []) as unknown as CommsRow[];
    },
    refetchInterval: 30_000,
  });

  if (!comms || comms.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Mail className="h-4 w-4 text-primary" />
          Customer notifications ({comms.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {comms.map((c) => (
          <div key={c.id} className="rounded-md border border-border/40 p-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium truncate">{c.subject}</div>
              <CommsStatusChip status={c.status} />
            </div>
            <div className="text-muted-foreground text-[11px] mt-1 truncate">
              to {c.recipients.join(", ")}
            </div>
            <div className="text-muted-foreground text-[10px] font-mono mt-0.5">
              {c.sent_at
                ? `sent ${formatDistanceToNow(new Date(c.sent_at), { addSuffix: true })}`
                : `drafted ${formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}`}
            </div>
            {c.error_message && (
              <div className="text-amber-600 dark:text-amber-400 text-[11px] mt-1 font-mono">
                {c.error_message.slice(0, 200)}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function CommsStatusChip({ status }: { status: string }) {
  const cls =
    status === "sent"    ? "border-emerald-500/40 text-emerald-500 bg-emerald-500/10" :
    status === "failed"  ? "border-amber-500/40 text-amber-500 bg-amber-500/10" :
                           "border-border";
  return (
    <Badge variant="outline" className={`text-[10px] uppercase tracking-wider ${cls}`}>
      {status}
    </Badge>
  );
}
