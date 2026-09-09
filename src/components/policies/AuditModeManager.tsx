import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Eye, Play, Square, CheckCircle, XCircle, Clock, BarChart3, Shield, Loader2, ThumbsUp, ThumbsDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow, differenceInDays, addDays, format } from "date-fns";
import {
  type PolicyType,
  type AuditSession,
  useActiveAuditSession,
  useAuditSessions,
  useAuditFindings,
  useStartAuditSession,
  useCompleteAuditSession,
  useApproveFinding,
  useBulkApproveFindings,
} from "@/hooks/useAuditSessions";

interface AuditModeManagerProps {
  policyType: PolicyType;
  policyId: string;
  policyName: string;
}


export function AuditModeManager({ policyType, policyId, policyName }: AuditModeManagerProps) {
  const { toast } = useToast();
  const [startDialogOpen, setStartDialogOpen] = useState(false);
  const [durationDays, setDurationDays] = useState(30);
  const [notes, setNotes] = useState("");
  const [selectedFindings, setSelectedFindings] = useState<Set<string>>(new Set());

  const { data: activeSession, isLoading: loadingActive } = useActiveAuditSession(policyType, policyId);
  const { data: allSessions = [] } = useAuditSessions(policyType);
  const { data: findings = [], isLoading: loadingFindings } = useAuditFindings(activeSession?.id);

  const startAudit = useStartAuditSession();
  const completeAudit = useCompleteAuditSession();
  const approveFinding = useApproveFinding();
  const bulkApprove = useBulkApproveFindings();

  const policySessions = allSessions.filter(s => s.policy_id === policyId);

  const handleStart = async () => {
    try {
      await startAudit.mutateAsync({
        policyType,
        policyId,
        durationDays,
        notes: notes || undefined,
      });
      toast({ title: "Audit mode started", description: `Learning mode active for ${durationDays} days` });
      setStartDialogOpen(false);
      setNotes("");
    } catch {
      toast({ title: "Failed to start audit", variant: "destructive" });
    }
  };

  const handleComplete = async (status: "completed" | "cancelled") => {
    if (!activeSession) return;
    try {
      await completeAudit.mutateAsync({ sessionId: activeSession.id, status });
      toast({
        title: status === "completed" ? "Audit completed" : "Audit cancelled",
        description: status === "completed"
          ? "Review the findings and approve normal behaviors"
          : "Audit session has been cancelled",
      });
    } catch {
      toast({ title: "Failed to update session", variant: "destructive" });
    }
  };

  const handleApproveFinding = async (findingId: string, approve: boolean) => {
    try {
      await approveFinding.mutateAsync({ findingId, approve });
    } catch {
      toast({ title: "Failed to update finding", variant: "destructive" });
    }
  };

  const handleBulkApprove = async (approve: boolean) => {
    if (selectedFindings.size === 0) return;
    try {
      await bulkApprove.mutateAsync({ findingIds: Array.from(selectedFindings), approve });
      setSelectedFindings(new Set());
      toast({ title: `${selectedFindings.size} findings ${approve ? "approved" : "rejected"}` });
    } catch {
      toast({ title: "Failed to update findings", variant: "destructive" });
    }
  };

  const toggleFinding = (id: string) => {
    setSelectedFindings(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedFindings.size === findings.length) {
      setSelectedFindings(new Set());
    } else {
      setSelectedFindings(new Set(findings.map(f => f.id)));
    }
  };

  if (loadingActive) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const daysElapsed = activeSession ? differenceInDays(new Date(), new Date(activeSession.started_at)) : 0;
  const plannedEnd = activeSession ? addDays(new Date(activeSession.started_at), activeSession.planned_duration_days) : null;
  const progress = activeSession ? Math.min(100, Math.round((daysElapsed / activeSession.planned_duration_days) * 100)) : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10">
              <Eye className="h-4 w-4 text-amber-500" />
            </div>
            <div>
              <CardTitle className="text-base">Learning Mode</CardTitle>
              <CardDescription>
                Audit &amp; baseline normal behavior for "{policyName}"
              </CardDescription>
            </div>
          </div>

          {!activeSession ? (
            <Dialog open={startDialogOpen} onOpenChange={setStartDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <Play className="h-4 w-4" />
                  Start Learning
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Start Learning Mode</DialogTitle>
                  <DialogDescription>
                    The policy will run in audit mode, collecting baseline behaviors without enforcing blocks.
                    You can extend or stop at any time.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div>
                    <label className="text-sm font-medium">Planned Duration (days)</label>
                    <Input
                      type="number"
                      min={1}
                      max={365}
                      value={durationDays}
                      onChange={e => setDurationDays(Number(e.target.value) || 30)}
                      className="mt-1.5"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      This is a target — you can complete or extend the audit at any time.
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Notes (optional)</label>
                    <Textarea
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      placeholder="Reason for baseline, scope notes…"
                      className="mt-1.5"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setStartDialogOpen(false)}>Cancel</Button>
                  <Button onClick={handleStart} disabled={startAudit.isPending}>
                    {startAudit.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                    Start
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/30">
                <Clock className="h-3 w-3" />
                Active — Day {daysElapsed}/{activeSession.planned_duration_days}
              </Badge>
              <Button size="sm" variant="default" onClick={() => handleComplete("completed")} disabled={completeAudit.isPending}>
                <CheckCircle className="mr-1 h-3.5 w-3.5" />
                Complete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => handleComplete("cancelled")} disabled={completeAudit.isPending}>
                <Square className="mr-1 h-3.5 w-3.5" />
                Cancel
              </Button>
            </div>
          )}
        </div>
      </CardHeader>

      {activeSession && (
        <CardContent className="space-y-4">
          {/* Progress Bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Started {formatDistanceToNow(new Date(activeSession.started_at), { addSuffix: true })}</span>
              <span>
                Target: {plannedEnd ? format(plannedEnd, "MMM d, yyyy") : "—"}
                {progress >= 100 && " (exceeded)"}
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${progress >= 100 ? "bg-green-500" : "bg-amber-500"}`}
                style={{ width: `${Math.min(progress, 100)}%` }}
              />
            </div>
          </div>

          {activeSession.notes && (
            <p className="text-sm text-muted-foreground italic">"{activeSession.notes}"</p>
          )}

          {/* Findings */}
          <Tabs defaultValue="findings" className="mt-4">
            <div className="flex items-center justify-between">
              <TabsList>
                <TabsTrigger value="findings" className="gap-1.5">
                  <BarChart3 className="h-3.5 w-3.5" />
                  Findings ({findings.length})
                </TabsTrigger>
                <TabsTrigger value="history" className="gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  History
                </TabsTrigger>
              </TabsList>

              {selectedFindings.size > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{selectedFindings.size} selected</span>
                  <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={() => handleBulkApprove(true)}>
                    <ThumbsUp className="h-3 w-3" /> Approve
                  </Button>
                  <Button size="sm" variant="ghost" className="gap-1 h-7 text-xs" onClick={() => handleBulkApprove(false)}>
                    <ThumbsDown className="h-3 w-3" /> Reject
                  </Button>
                </div>
              )}
            </div>

            <TabsContent value="findings">
              {loadingFindings ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : findings.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                  <Shield className="h-10 w-10 mb-2 opacity-30" />
                  <p className="text-sm">No findings yet — behaviors will appear here as the agent reports them.</p>
                </div>
              ) : (
                <div className="rounded-md border mt-2">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <Checkbox
                            checked={selectedFindings.size === findings.length && findings.length > 0}
                            onCheckedChange={toggleAll}
                          />
                        </TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Value</TableHead>
                        <TableHead className="text-right">Count</TableHead>
                        <TableHead>Endpoint</TableHead>
                        <TableHead>Last Seen</TableHead>
                        <TableHead className="text-center">Status</TableHead>
                        <TableHead className="w-20" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {findings.map(f => (
                        <TableRow key={f.id} className={f.is_approved ? "bg-green-50/50 dark:bg-green-950/10" : ""}>
                          <TableCell>
                            <Checkbox
                              checked={selectedFindings.has(f.id)}
                              onCheckedChange={() => toggleFinding(f.id)}
                            />
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="text-xs font-mono">
                              {f.finding_type}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs max-w-[300px] truncate" title={f.value}>
                            {f.value}
                          </TableCell>
                          <TableCell className="text-right font-medium">{f.occurrence_count}</TableCell>
                          <TableCell className="text-sm">
                            {f.endpoints?.hostname || "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(f.last_seen_at), { addSuffix: true })}
                          </TableCell>
                          <TableCell className="text-center">
                            {f.is_approved ? (
                              <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-xs">
                                Approved
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs">Pending</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                onClick={() => handleApproveFinding(f.id, !f.is_approved)}
                                title={f.is_approved ? "Revoke approval" : "Approve as normal"}
                              >
                                {f.is_approved ? (
                                  <XCircle className="h-3.5 w-3.5 text-destructive" />
                                ) : (
                                  <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                                )}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="history">
              {policySessions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No previous audit sessions.</p>
              ) : (
                <div className="space-y-2 mt-2">
                  {policySessions.map(s => (
                    <SessionHistoryCard key={s.id} session={s} />
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      )}

      {/* Show compact history when no active session */}
      {!activeSession && policySessions.length > 0 && (
        <CardContent>
          <p className="text-xs text-muted-foreground mb-2">Previous sessions</p>
          <div className="space-y-1.5">
            {policySessions.slice(0, 3).map(s => (
              <SessionHistoryCard key={s.id} session={s} />
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function SessionHistoryCard({ session }: { session: AuditSession }) {
  const daysRan = session.completed_at
    ? differenceInDays(new Date(session.completed_at), new Date(session.started_at))
    : differenceInDays(new Date(), new Date(session.started_at));

  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <Badge
          variant={session.status === "completed" ? "default" : session.status === "active" ? "secondary" : "outline"}
          className="text-xs"
        >
          {session.status}
        </Badge>
        <span className="text-muted-foreground">
          {daysRan} day{daysRan !== 1 ? "s" : ""} / {session.planned_duration_days}d target
        </span>
      </div>
      <span className="text-xs text-muted-foreground">
        {format(new Date(session.started_at), "MMM d, yyyy")}
        {session.completed_at && ` — ${format(new Date(session.completed_at), "MMM d, yyyy")}`}
      </span>
    </div>
  );
}
