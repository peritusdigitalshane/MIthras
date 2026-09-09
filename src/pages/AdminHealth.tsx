import { useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  ShieldAlert, Activity, Loader2, RefreshCw, CheckCircle2, AlertCircle,
  XCircle, Clock, ChevronRight, Database, Cog, Server, Bot, Coins, Plug, ShieldCheck, HelpCircle,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Link } from "react-router-dom";
import { useTenant } from "@/contexts/TenantContext";
import {
  usePlatformHealthFindings, usePlatformHealthRuns, useRunPlatformHealthScan, useUpdateFindingStatus,
  type PlatformHealthFinding, type HealthCategory, type HealthSeverity, type HealthStatus,
} from "@/hooks/usePlatformHealth";

const CATEGORY_LABEL: Record<HealthCategory, string> = {
  cron:           "Scheduled jobs",
  edge_function:  "Background services",
  database:       "Database",
  agent_fleet:    "Agent fleet",
  ai_pipeline:    "AI pipeline",
  budget:         "Budget",
  integration:    "Integration",
  security:       "Security",
  other:          "Other",
};

const CATEGORY_ICON: Record<HealthCategory, React.ComponentType<{ className?: string }>> = {
  cron:           Clock,
  edge_function:  Cog,
  database:       Database,
  agent_fleet:    Server,
  ai_pipeline:    Bot,
  budget:         Coins,
  integration:    Plug,
  security:       ShieldCheck,
  other:          HelpCircle,
};

const SEVERITY_RANK: Record<HealthSeverity, number> = {
  critical: 0, high: 1, medium: 2, low: 3, info: 4, unknown: 5,
};

function severityVariant(sev: HealthSeverity): "default" | "destructive" | "secondary" | "outline" {
  if (sev === "critical" || sev === "high") return "destructive";
  if (sev === "medium")                     return "default";
  return "secondary";
}

function statusVariant(s: HealthStatus): "default" | "destructive" | "secondary" | "outline" {
  if (s === "open")                         return "destructive";
  if (s === "acknowledged")                 return "default";
  return "secondary";
}

function RunStatusBadge({ status }: { status: string }) {
  if (status === "succeeded")  return <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" />Succeeded</Badge>;
  if (status === "running")    return <Badge variant="default"   className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />Running</Badge>;
  if (status === "partial")    return <Badge variant="default"   className="gap-1"><AlertCircle className="h-3 w-3" />Partial</Badge>;
  if (status === "failed")     return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />Failed</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

export default function AdminHealth() {
  const { isSuperAdmin, isLoading: tenantLoading } = useTenant();
  const { data: findings, isLoading: findingsLoading, error: findingsErr } = usePlatformHealthFindings();
  const { data: runs, isLoading: runsLoading } = usePlatformHealthRuns(20);
  const runScan = useRunPlatformHealthScan();
  const updateStatus = useUpdateFindingStatus();

  const [selected, setSelected] = useState<PlatformHealthFinding | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");
  const [confirmAction, setConfirmAction] = useState<HealthStatus | null>(null);

  const openFindings = useMemo(
    () => (findings ?? []).filter((f) => f.status === "open"),
    [findings],
  );
  const ackFindings = useMemo(
    () => (findings ?? []).filter((f) => f.status === "acknowledged"),
    [findings],
  );
  const closedFindings = useMemo(
    () => (findings ?? []).filter((f) => f.status === "fixed" || f.status === "dismissed" || f.status === "auto_resolved"),
    [findings],
  );

  const severityCounts = useMemo(() => {
    const m: Record<HealthSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0, unknown: 0 };
    for (const f of openFindings) m[f.severity] = (m[f.severity] ?? 0) + 1;
    return m;
  }, [openFindings]);

  const latestRun = runs?.[0];

  function runNow() {
    runScan.mutate(undefined, {
      onSuccess: (data: any) => {
        toast.success(`Scan complete — ${data?.findings_opened ?? 0} new, ${data?.findings_resolved ?? 0} resolved`);
      },
      onError: (e: any) => toast.error(`Scan failed: ${e?.message ?? "unknown error"}`),
    });
  }

  function applyStatus(s: HealthStatus) {
    if (!selected) return;
    updateStatus.mutate(
      { id: selected.id, status: s, note: resolutionNote.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(`Finding marked ${s}`);
          setSelected(null);
          setConfirmAction(null);
          setResolutionNote("");
        },
        onError: (e: any) => toast.error(e?.message ?? "Update failed"),
      },
    );
  }

  if (tenantLoading) {
    return (
      <MainLayout>
        <div className="p-6"><Skeleton className="h-32 w-full" /></div>
      </MainLayout>
    );
  }
  if (!isSuperAdmin) {
    return (
      <MainLayout>
        <div className="p-6 max-w-2xl mx-auto">
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Super-admin only</AlertTitle>
            <AlertDescription>Platform health is a Mithras platform operator concern.</AlertDescription>
          </Alert>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Activity className="h-6 w-6 text-primary" />
              Platform health
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Findings from the autonomous platform health scanner. Runs every 15 minutes; covers crons, agents, RLS, AI pipeline, budgets, and storage.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link to="/admin/health/status">Live status</Link>
            </Button>
            <Button onClick={runNow} disabled={runScan.isPending}>
              {runScan.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              Run scan now
            </Button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Open</div>
              <div className="text-2xl font-bold mt-1">{openFindings.length}</div>
              <div className="text-[11px] text-muted-foreground mt-1">
                {severityCounts.critical} critical · {severityCounts.high} high
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Acknowledged</div>
              <div className="text-2xl font-bold mt-1">{ackFindings.length}</div>
              <div className="text-[11px] text-muted-foreground mt-1">work in progress</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Closed (30d)</div>
              <div className="text-2xl font-bold mt-1">{closedFindings.length}</div>
              <div className="text-[11px] text-muted-foreground mt-1">fixed / dismissed / auto</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Last scan</div>
              <div className="text-2xl font-bold mt-1">
                {latestRun
                  ? formatDistanceToNow(new Date(latestRun.started_at), { addSuffix: true })
                  : "—"}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                {latestRun ? <RunStatusBadge status={latestRun.status} /> : "no runs yet"}
              </div>
            </CardContent>
          </Card>
        </div>

        {findingsErr && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Couldn&apos;t load findings</AlertTitle>
            <AlertDescription>{(findingsErr as Error).message}</AlertDescription>
          </Alert>
        )}

        {/* Open findings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Open findings</CardTitle>
            <CardDescription>
              Live problems detected by the most recent scans. Click a row for the LLM&apos;s recommended fix.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {findingsLoading ? (
              <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
            ) : openFindings.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <CheckCircle2 className="h-10 w-10 mx-auto mb-2 text-emerald-500" />
                <p className="text-sm">No open findings. Platform is healthy.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Severity</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>First seen</TableHead>
                    <TableHead>Last seen</TableHead>
                    <TableHead className="w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openFindings
                    .slice()
                    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
                    .map((f) => {
                      const Icon = CATEGORY_ICON[f.category];
                      return (
                        <TableRow
                          key={f.id}
                          className="cursor-pointer"
                          onClick={() => { setSelected(f); setResolutionNote(""); }}
                        >
                          <TableCell>
                            <Badge variant={severityVariant(f.severity)} className="uppercase text-[10px]">
                              {f.severity}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex items-center gap-1.5 text-xs">
                              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                              {CATEGORY_LABEL[f.category]}
                            </span>
                          </TableCell>
                          <TableCell className="font-medium">{f.title}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(f.first_seen), { addSuffix: true })}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(f.last_seen), { addSuffix: true })}
                          </TableCell>
                          <TableCell>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Acknowledged + closed */}
        {(ackFindings.length > 0 || closedFindings.length > 0) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Acknowledged & recently closed</CardTitle>
              <CardDescription>Findings currently being worked or already resolved.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead className="w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...ackFindings, ...closedFindings].slice(0, 30).map((f) => (
                    <TableRow
                      key={f.id}
                      className="cursor-pointer"
                      onClick={() => { setSelected(f); setResolutionNote(f.resolution_note ?? ""); }}
                    >
                      <TableCell>
                        <Badge variant={statusVariant(f.status)} className="uppercase text-[10px]">
                          {f.status.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="uppercase text-[10px]">{f.severity}</Badge>
                      </TableCell>
                      <TableCell className="font-medium">{f.title}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(f.resolved_at ?? f.last_seen), { addSuffix: true })}
                      </TableCell>
                      <TableCell>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Run history */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent scans</CardTitle>
            <CardDescription>Last 20 scans. Cron fires every 15 minutes.</CardDescription>
          </CardHeader>
          <CardContent>
            {runsLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : !runs || runs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No scans yet. Click <strong>Run scan now</strong>.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Started</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead className="text-right">Opened</TableHead>
                    <TableHead className="text-right">Updated</TableHead>
                    <TableHead className="text-right">Resolved</TableHead>
                    <TableHead className="text-right">Triage cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((r) => {
                    const start = new Date(r.started_at);
                    const end = r.finished_at ? new Date(r.finished_at) : null;
                    const durMs = end ? end.getTime() - start.getTime() : null;
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDistanceToNow(start, { addSuffix: true })}
                        </TableCell>
                        <TableCell><RunStatusBadge status={r.status} /></TableCell>
                        <TableCell className="text-xs">{durMs != null ? `${(durMs / 1000).toFixed(1)}s` : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.findings_opened}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.findings_updated}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.findings_resolved}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                          {r.triage_cost_microcents > 0
                            ? `$${(r.triage_cost_microcents / 1_000_000).toFixed(4)}`
                            : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Finding detail dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) { setSelected(null); setConfirmAction(null); } }}>
        <DialogContent className="max-w-2xl">
          {selected && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant={severityVariant(selected.severity)} className="uppercase text-[10px]">{selected.severity}</Badge>
                  <Badge variant="outline" className="uppercase text-[10px]">{CATEGORY_LABEL[selected.category]}</Badge>
                  <Badge variant={statusVariant(selected.status)} className="uppercase text-[10px]">{selected.status.replace("_", " ")}</Badge>
                </div>
                <DialogTitle className="text-lg">{selected.title}</DialogTitle>
                {selected.description && (
                  <DialogDescription>{selected.description}</DialogDescription>
                )}
              </DialogHeader>

              <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
                {selected.recommended_fix && (
                  <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
                    <div className="text-xs uppercase tracking-wider text-primary font-medium mb-1">Recommended fix</div>
                    <p className="text-sm">{selected.recommended_fix}</p>
                    {selected.triage_model && (
                      <p className="text-[10px] text-muted-foreground mt-1">— triaged by {selected.triage_model}</p>
                    )}
                  </div>
                )}
                {selected.triage_reasoning && (
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-1">Reasoning</div>
                    <p className="text-sm text-muted-foreground">{selected.triage_reasoning}</p>
                  </div>
                )}
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-1">Evidence</div>
                  <pre className="text-[11px] bg-muted/40 p-2 rounded border border-border/40 overflow-x-auto">
                    {JSON.stringify(selected.evidence, null, 2)}
                  </pre>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="text-muted-foreground">First seen</div>
                    <div>{formatDistanceToNow(new Date(selected.first_seen), { addSuffix: true })}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Last seen</div>
                    <div>{formatDistanceToNow(new Date(selected.last_seen), { addSuffix: true })}</div>
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-1">Resolution note</div>
                  <Textarea
                    value={resolutionNote}
                    onChange={(e) => setResolutionNote(e.target.value)}
                    placeholder="What did you do (or why dismiss)?"
                    rows={2}
                  />
                </div>
              </div>

              <DialogFooter className="flex-wrap gap-2">
                {selected.status === "open" && (
                  <>
                    <Button variant="outline" disabled={updateStatus.isPending} onClick={() => applyStatus("acknowledged")}>
                      Acknowledge
                    </Button>
                    <Button variant="secondary" disabled={updateStatus.isPending} onClick={() => applyStatus("dismissed")}>
                      Dismiss
                    </Button>
                    <Button disabled={updateStatus.isPending} onClick={() => applyStatus("fixed")}>
                      Mark fixed
                    </Button>
                  </>
                )}
                {selected.status === "acknowledged" && (
                  <>
                    <Button variant="outline" disabled={updateStatus.isPending} onClick={() => applyStatus("open")}>
                      Re-open
                    </Button>
                    <Button disabled={updateStatus.isPending} onClick={() => applyStatus("fixed")}>
                      Mark fixed
                    </Button>
                  </>
                )}
                {(selected.status === "fixed" || selected.status === "dismissed" || selected.status === "auto_resolved") && (
                  <Button variant="outline" disabled={updateStatus.isPending} onClick={() => applyStatus("open")}>
                    Re-open
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
