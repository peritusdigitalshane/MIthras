import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import {
  useIncidents, useResolveIncident, useUpdateIncidentStatus, useAssignIncident,
  useOrgMembers, Incident, IncidentStatus,
} from "@/hooks/useIncidents";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHelp } from "@/components/help/PageHelp";
import { HelpHint } from "@/components/help/HelpHint";
import { EmptyState } from "@/components/help/EmptyState";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, CheckCircle, Clock, Shield, ShieldAlert, Bot } from "lucide-react";
import { IncidentAiSummary } from "@/components/incidents/IncidentAiSummary";

const STATUS_LABEL: Record<IncidentStatus, string> = {
  open: "Open",
  triaging: "Triaging",
  in_progress: "In progress",
  resolved: "Resolved",
  false_positive: "False positive",
};

function severityClasses(sev: string) {
  switch (sev) {
    case "Severe":   return "bg-status-critical/20 text-status-critical border-status-critical/40";
    case "High":     return "bg-orange-500/20 text-orange-500 border-orange-500/40";
    case "Moderate": return "bg-amber-500/20 text-amber-500 border-amber-500/40";
    case "Low":      return "bg-muted text-muted-foreground border-muted-foreground/40";
    // Distinguish "we don't know yet" from "no severity assigned" -- amber-ringed
    // so the analyst sees it as triage-required, not as a low-priority muted row.
    case "Unknown":  return "bg-amber-500/10 text-amber-600 border-amber-500/30";
    default:         return "bg-muted text-muted-foreground";
  }
}

function statusBadge(status: IncidentStatus) {
  if (status === "resolved" || status === "false_positive") {
    return <Badge variant="outline" className="gap-1"><CheckCircle className="h-3 w-3 text-status-healthy" />{STATUS_LABEL[status]}</Badge>;
  }
  return <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" />{STATUS_LABEL[status]}</Badge>;
}

function slaCell(incident: Incident) {
  if (incident.status === "resolved" || incident.status === "false_positive") {
    return <span className="text-xs text-status-healthy">met</span>;
  }
  const due = new Date(incident.sla_due_at).getTime();
  const now = Date.now();
  if (due < now) {
    return <span className="text-xs text-status-critical font-medium">breached {formatDistanceToNow(new Date(incident.sla_due_at), { addSuffix: true })}</span>;
  }
  return <span className="text-xs text-muted-foreground">due in {formatDistanceToNow(new Date(incident.sla_due_at))}</span>;
}

const Incidents = () => {
  const { toast } = useToast();
  const [resolveTarget, setResolveTarget] = useState<Incident | null>(null);
  const [resolveOutcome, setResolveOutcome] = useState<"resolved" | "false_positive">("resolved");
  const [resolveNotes, setResolveNotes] = useState("");
  const { data: incidents, isLoading } = useIncidents();
  const resolveMut = useResolveIncident();

  const open = useMemo(() => (incidents ?? []).filter(i => !["resolved","false_positive"].includes(i.status)), [incidents]);
  const closed = useMemo(() => (incidents ?? []).filter(i => ["resolved","false_positive"].includes(i.status)), [incidents]);

  const handleResolveSubmit = async () => {
    if (!resolveTarget) return;
    try {
      await resolveMut.mutateAsync({ incidentId: resolveTarget.id, outcome: resolveOutcome, notes: resolveNotes.trim() || undefined });
      toast({ title: "Incident resolved" });
      setResolveTarget(null); setResolveNotes("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Resolve failed";
      toast({ title: "Failed to resolve", description: msg, variant: "destructive" });
    }
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <ShieldAlert className="h-6 w-6 text-primary" /> Incidents
              <PageHelp
                title="Incidents"
                glossaryAnchor="/glossary#incident-kind"
                whatIsThis={
                  <>
                    <p>
                      An incident is a high-priority event that needs analyst attention. Severe/High
                      Defender threats and Critical/High alerts <b>auto-open</b> an incident with an
                      SLA timer.
                    </p>
                    <p>
                      One incident per (endpoint × root event) — the threat and alert pipelines are
                      deduped, so a Defender detection doesn't spawn two incidents.
                    </p>
                  </>
                }
                tasks={[
                  { label: "Click an incident to triage it" },
                  { label: "Assign to a SOC analyst" },
                  { label: "Mark Resolved or False positive when done" },
                  { label: "Add resolution notes for the audit trail" },
                ]}
                faq={[
                  {
                    q: "What's an incident 'kind'?",
                    a: (
                      <ul>
                        <li><b>threat</b> — Defender detection (Severe/High)</li>
                        <li><b>alert</b> — Critical/High platform alert (M365, ransomware indicator)</li>
                        <li><b>posture_drift</b> — endpoint fell out of policy</li>
                        <li><b>agent_offline</b> — heartbeat missing too long</li>
                        <li><b>vuln_critical</b> — CVSS 9+ finding</li>
                        <li><b>custom</b> — operator-opened</li>
                      </ul>
                    ),
                  },
                  {
                    q: "What are the SLA timers?",
                    a: (
                      <ul>
                        <li><b>Severe / Critical</b>: 1 hour</li>
                        <li><b>High</b>: 4 hours</li>
                        <li><b>Moderate</b>: 1 day</li>
                        <li><b>Low</b>: 7 days</li>
                      </ul>
                    ),
                  },
                  {
                    q: "Why don't all my threats become incidents?",
                    a: <p>Only Severe and High severity threats auto-open incidents. Moderate and Low show on the Threats page but don't escalate. If a threat lands as 'Unknown', triage it manually.</p>,
                  },
                ]}
              />
            </h1>
            <p className="text-sm text-muted-foreground">Severe/High Defender threats and Critical/High alerts auto-open an incident. SLA: Severe/Critical 1h, High 4h.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Open</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{open.length}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">SLA breached</CardTitle></CardHeader><CardContent className="text-2xl font-semibold text-status-critical">{open.filter(i => new Date(i.sla_due_at).getTime() < Date.now()).length}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Closed (this view)</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{closed.length}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Severe open</CardTitle></CardHeader><CardContent className="text-2xl font-semibold text-status-critical">{open.filter(i => i.severity === "Severe").length}</CardContent></Card>
        </div>

        <Tabs defaultValue="open">
          <TabsList>
            <TabsTrigger value="open">Open ({open.length})</TabsTrigger>
            <TabsTrigger value="closed">Closed ({closed.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="open">
            <Card>
              <CardContent className="p-0">
                {isLoading ? <div className="p-6"><Skeleton className="h-32" /></div> : <IncidentTable rows={open} onResolve={(r) => { setResolveTarget(r); setResolveOutcome("resolved"); }} />}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="closed">
            <Card>
              <CardContent className="p-0">
                {isLoading ? <div className="p-6"><Skeleton className="h-32" /></div> : <IncidentTable rows={closed} onResolve={() => {}} closed />}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Dialog open={!!resolveTarget} onOpenChange={(o) => !o && setResolveTarget(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-primary" /> Resolve incident</DialogTitle>
              <DialogDescription>{resolveTarget?.title}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {resolveTarget && (
                <IncidentAiSummary incidentId={resolveTarget.id} endpointId={resolveTarget.endpoint_id} />
              )}
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Outcome</div>
                <div className="flex gap-2">
                  <Button variant={resolveOutcome === "resolved" ? "default" : "outline"} size="sm" onClick={() => setResolveOutcome("resolved")}>Resolved</Button>
                  <Button variant={resolveOutcome === "false_positive" ? "default" : "outline"} size="sm" onClick={() => setResolveOutcome("false_positive")}>False positive</Button>
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Notes (added to audit trail + customer report)</div>
                <Textarea placeholder="What was done?" value={resolveNotes} onChange={(e) => setResolveNotes(e.target.value)} rows={4} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setResolveTarget(null)}>Cancel</Button>
              <Button onClick={handleResolveSubmit} disabled={resolveMut.isPending}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
};

function IncidentTable({ rows, onResolve, closed }: { rows: Incident[]; onResolve: (i: Incident) => void; closed?: boolean }) {
  // All hooks MUST come before any conditional return — otherwise React
  // throws "Rendered fewer hooks than expected" the moment rows transitions
  // from non-empty to empty (e.g. operator resolves the last open incident).
  const { data: members } = useOrgMembers();
  const updateStatus = useUpdateIncidentStatus();
  const assign = useAssignIncident();
  const { toast } = useToast();
  const navigate = useNavigate();

  if (rows.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<ShieldAlert className="h-7 w-7" />}
          title={closed ? "No closed incidents yet" : "No open incidents — that's a good thing"}
          tone="positive"
          description={
            closed ? (
              <p>Resolved and false-positive incidents move here so they don't crowd the open queue.</p>
            ) : (
              <>
                <p>Incidents auto-open from two pipelines:</p>
                <p><b>Defender threats</b> (Severe/High) and <b>platform alerts</b> (Critical/High). Each gets an SLA timer (1h Severe/Critical, 4h High).</p>
              </>
            )
          }
          secondaryAction={{ label: "How incidents work →", href: "/glossary#incident-kind" }}
        />
      </div>
    );
  }

  const memberLabel = (id: string | null | undefined) => {
    if (!id) return "Unassigned";
    const m = members?.find((x) => x.user_id === id);
    return m?.display_name || m?.email || id.slice(0, 8);
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <span className="inline-flex items-center gap-1">
              Severity
              <HelpHint title="Severity scale" learnMore="/glossary#severity" side="bottom">
                <ul>
                  <li><b>Severe</b> — confirmed malware (Defender) / Critical (alert)</li>
                  <li><b>High</b> — hacktools, exploit kits</li>
                  <li><b>Moderate</b> — PUA, adware</li>
                  <li><b>Low</b> — misleading apps, low-confidence</li>
                  <li><b>Unknown</b> — needs manual triage</li>
                </ul>
                <p>SLA: Severe/Critical 1h, High 4h, Moderate 1d, Low 7d.</p>
              </HelpHint>
            </span>
          </TableHead>
          <TableHead>Title</TableHead>
          <TableHead>Endpoint</TableHead>
          <TableHead>Opened</TableHead>
          <TableHead>SLA</TableHead>
          <TableHead>Status</TableHead>
          {!closed && <TableHead>Assigned</TableHead>}
          {!closed && <TableHead className="text-right">Actions</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((i) => (
          <TableRow key={i.id} className="cursor-pointer hover:bg-muted/40" onClick={(ev) => {
            // Don't navigate when the click started on an interactive control
            // (Select, Button, etc.) inside the row.
            if ((ev.target as HTMLElement).closest("button, select, [role='combobox']")) return;
            navigate(`/incidents/${i.id}`);
          }}>
            <TableCell><Badge variant="outline" className={severityClasses(i.severity)}>{i.severity}</Badge></TableCell>
            <TableCell className="max-w-md"><div className="truncate font-medium">{i.title}</div><div className="text-xs text-muted-foreground truncate">{i.description}</div></TableCell>
            <TableCell className="text-sm">{i.endpoint?.hostname ?? <span className="text-muted-foreground">—</span>}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(i.opened_at), { addSuffix: true })}</TableCell>
            <TableCell>{slaCell(i)}</TableCell>
            <TableCell>
              {closed ? (
                statusBadge(i.status)
              ) : (
                <Select
                  value={i.status}
                  onValueChange={(v) =>
                    updateStatus.mutate(
                      { incidentId: i.id, status: v as "open" | "triaging" | "in_progress" },
                      { onError: (e) => toast({ title: "Status update failed", description: e.message, variant: "destructive" }) },
                    )
                  }
                >
                  <SelectTrigger className="h-7 w-[130px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="triaging">Triaging</SelectItem>
                    <SelectItem value="in_progress">In progress</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </TableCell>
            {!closed && (
              <TableCell className="text-xs">
                <Select
                  value={i.assignee_id ?? "__unassigned__"}
                  onValueChange={(v) =>
                    assign.mutate(
                      { incidentId: i.id, assignee: v === "__unassigned__" ? null : v },
                      { onError: (e) => toast({ title: "Assignment failed", description: e.message, variant: "destructive" }) },
                    )
                  }
                >
                  <SelectTrigger className="h-7 w-[170px] text-xs">
                    <SelectValue>{memberLabel(i.assignee_id)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unassigned__">Unassigned</SelectItem>
                    {(members ?? []).map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        {m.display_name || m.email || m.user_id.slice(0, 8)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
            )}
            {!closed && (
              <TableCell className="text-right">
                <Button size="sm" variant="outline" onClick={() => onResolve(i)} className="gap-1.5">
                  <CheckCircle className="h-3.5 w-3.5" /> Resolve
                </Button>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default Incidents;
