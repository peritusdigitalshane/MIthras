import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useEndpoints } from "@/hooks/useDashboardData";
import {
  useEndpointAppWhitelist,
  useStartAppAudit,
  useStopAppAudit,
  useEnforceAppWhitelist,
  useAddObservedToWhitelist,
  useDeleteAppWhitelistRule,
} from "@/hooks/useAppWhitelisting";
import { formatDistanceToNow } from "date-fns";
import {
  Search, Loader2, Play, Pause, Lock, Eye, ShieldCheck, AlertTriangle,
  Monitor, Plus, Trash2, FileBadge, Building2, FolderOpen, CheckCircle2, XCircle,
} from "lucide-react";
import { HelpHint } from "@/components/help/HelpHint";

function modeBadge(mode: string) {
  switch (mode) {
    case "auditing":
      return (
        <Badge variant="outline" className="gap-1 border-amber-400 text-amber-600 dark:text-amber-300">
          <Eye className="h-3.5 w-3.5" /> Auditing
        </Badge>
      );
    case "enforcing":
      return (
        <Badge variant="outline" className="gap-1 border-red-500 text-red-600 dark:text-red-400">
          <Lock className="h-3.5 w-3.5" /> Enforcing
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="gap-1 text-muted-foreground">
          Idle
        </Badge>
      );
  }
}

function matchTypeIcon(type: string) {
  switch (type) {
    case "hash":         return <FileBadge className="h-3.5 w-3.5" />;
    case "publisher":    return <Building2 className="h-3.5 w-3.5" />;
    case "path":         return <FolderOpen className="h-3.5 w-3.5" />;
    case "trusted_path": return <ShieldCheck className="h-3.5 w-3.5" />;
    default:             return null;
  }
}

function matchTypeLabel(type: string) {
  // "trusted_path" reads better as "Trusted path" in the UI; everything else
  // is short enough to display verbatim.
  if (type === "trusted_path") return "Trusted path";
  return type;
}

export function AppWhitelistDashboard() {
  const { data: endpoints, isLoading: endpointsLoading } = useEndpoints();
  const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [confirmEnforce, setConfirmEnforce] = useState(false);

  useEffect(() => {
    if (!selectedEndpointId && endpoints && endpoints.length > 0) {
      setSelectedEndpointId(endpoints[0].id);
    }
  }, [endpoints, selectedEndpointId]);

  const { data: snap, isLoading: snapLoading } = useEndpointAppWhitelist(selectedEndpointId);
  const startAudit  = useStartAppAudit();
  const stopAudit   = useStopAppAudit();
  const enforce     = useEnforceAppWhitelist();
  const addObserved = useAddObservedToWhitelist();
  const deleteRule  = useDeleteAppWhitelistRule();

  const selectedEndpoint = endpoints?.find((e) => e.id === selectedEndpointId) ?? null;
  const mode = snap?.mode ?? "idle";
  const observed = snap?.observed ?? [];
  const rules = snap?.rules ?? [];

  const filteredObserved = useMemo(() => {
    if (!search) return observed;
    const q = search.toLowerCase();
    return observed.filter((o) =>
      (o.file_name ?? "").toLowerCase().includes(q) ||
      (o.file_path ?? "").toLowerCase().includes(q) ||
      (o.publisher ?? "").toLowerCase().includes(q) ||
      (o.product_name ?? "").toLowerCase().includes(q) ||
      (o.sha256 ?? "").toLowerCase().includes(q),
    );
  }, [observed, search]);

  const totals = useMemo(() => {
    let totalLaunches = 0, totalBlocked = 0, distinct = 0;
    for (const o of observed) {
      totalLaunches += o.launches;
      totalBlocked  += o.blocked;
      distinct++;
    }
    return { totalLaunches, totalBlocked, distinct };
  }, [observed]);

  const busy = startAudit.isPending || stopAudit.isPending || enforce.isPending;

  if (endpointsLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (!endpoints || endpoints.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <Monitor className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">No endpoints registered yet</h3>
          <p className="text-muted-foreground max-w-md">
            Deploy the Mithras agent to at least one Windows endpoint. Application whitelisting needs the
            agent v0.5.8+ to observe process launches.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-4">
              <Select
                value={selectedEndpointId ?? ""}
                onValueChange={(v) => setSelectedEndpointId(v || null)}
              >
                <SelectTrigger className="w-[300px]">
                  <SelectValue placeholder="Select an endpoint" />
                </SelectTrigger>
                <SelectContent>
                  {endpoints.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.hostname || e.id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedEndpoint && (
                <div className="flex items-center gap-2">
                  {modeBadge(mode)}
                  {snap?.audit_started_at && mode !== "idle" && (
                    <span className="text-xs text-muted-foreground">
                      {mode === "enforcing" ? "Enforcing since " : "Auditing since "}
                      {formatDistanceToNow(
                        new Date(
                          mode === "enforcing"
                            ? snap.enforce_started_at ?? snap.audit_started_at
                            : snap.audit_started_at,
                        ),
                        { addSuffix: true },
                      )}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              {mode === "idle" && (
                <Button
                  onClick={() => selectedEndpointId && startAudit.mutate({ endpointId: selectedEndpointId })}
                  disabled={!selectedEndpointId || busy}
                  size="sm"
                >
                  {startAudit.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
                  Start audit
                </Button>
              )}
              {mode === "auditing" && (
                <>
                  <Button
                    onClick={() => selectedEndpointId && stopAudit.mutate({ endpointId: selectedEndpointId })}
                    disabled={!selectedEndpointId || busy}
                    size="sm" variant="outline"
                  >
                    {stopAudit.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Pause className="h-3.5 w-3.5 mr-1" />}
                    Stop
                  </Button>
                  <Button
                    onClick={() => setConfirmEnforce(true)}
                    disabled={!selectedEndpointId || busy || observed.length === 0}
                    size="sm" variant="destructive"
                  >
                    <Lock className="h-3.5 w-3.5 mr-1" />
                    Enforce
                  </Button>
                </>
              )}
              {mode === "enforcing" && (
                <Button
                  onClick={() => selectedEndpointId && stopAudit.mutate({ endpointId: selectedEndpointId })}
                  disabled={!selectedEndpointId || busy}
                  size="sm" variant="outline"
                >
                  {stopAudit.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Pause className="h-3.5 w-3.5 mr-1" />}
                  Disable enforcement
                </Button>
              )}
            </div>
          </div>
          <CardDescription className="mt-3 max-w-3xl">
            Audit mode ships every process launch for this endpoint. Curate the observed list, click <b>Enforce</b>,
            and the agent will start blocking anything not in the whitelist. OS paths (System32, Program Files, the
            Mithras agent) are added automatically so the box stays functional.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Distinct binaries</CardDescription>
            <CardTitle className="text-2xl">{totals.distinct}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Process launches (audit window)</CardDescription>
            <CardTitle className="text-2xl">{totals.totalLaunches.toLocaleString()}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Blocked launches</CardDescription>
            <CardTitle className="text-2xl text-red-500">{totals.totalBlocked.toLocaleString()}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Observed apps */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-lg">Observed applications</CardTitle>
              <CardDescription>
                One row per SHA-256 seen launching on this endpoint. Click <b>Add to whitelist</b> to allow it under enforce.
              </CardDescription>
            </div>
            <div className="relative w-full md:w-[300px]">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter by name, path, publisher…"
                className="pl-8"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {snapLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : filteredObserved.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <Eye className="h-10 w-10 mb-3 opacity-50" />
              <p className="text-sm">
                {mode === "idle"
                  ? "Nothing observed yet. Click Start audit and the agent will begin shipping process launches."
                  : "No process launches reported in the audit window yet — try again in a minute."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground border-b">
                  <tr>
                    <th className="py-2 pr-3">Application</th>
                    <th className="py-2 pr-3">Publisher</th>
                    <th className="py-2 pr-3 text-right">Launches</th>
                    <th className="py-2 pr-3 text-right">Blocked</th>
                    <th className="py-2 pr-3">Last seen</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredObserved.map((o) => (
                    <tr key={o.sha256} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="py-2 pr-3">
                        <div className="font-medium">{o.product_name || o.file_name || o.sha256.slice(0, 12)}</div>
                        <div className="text-xs text-muted-foreground truncate max-w-[420px]">{o.file_path}</div>
                      </td>
                      <td className="py-2 pr-3">
                        {o.publisher ? (
                          <span className="text-xs">{o.publisher}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">Unsigned</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{o.launches.toLocaleString()}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {o.blocked > 0 ? (
                          <span className="text-red-500 font-medium">{o.blocked.toLocaleString()}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {o.last_seen ? formatDistanceToNow(new Date(o.last_seen), { addSuffix: true }) : "—"}
                      </td>
                      <td className="py-2 pr-3">
                        {o.whitelisted ? (
                          <Badge variant="outline" className="gap-1 border-green-500 text-green-600 dark:text-green-400">
                            <CheckCircle2 className="h-3 w-3" /> Allowed
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1 text-muted-foreground">
                            <XCircle className="h-3 w-3" /> Not allowed
                          </Badge>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {!o.whitelisted && selectedEndpointId && (
                          <Button
                            size="sm" variant="outline"
                            disabled={addObserved.isPending}
                            onClick={() => addObserved.mutate({ endpointId: selectedEndpointId, sha256: o.sha256 })}
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            Add
                          </Button>
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

      {/* Whitelist rules */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            Whitelist rules ({rules.length})
            <HelpHint title="Rule match types" learnMore="/glossary#match-type-hash" side="bottom">
              <p><b>hash</b> — exact SHA-256 of the .exe. Strongest, but breaks on app update.</p>
              <p><b>publisher</b> — anything signed by this Authenticode publisher.</p>
              <p><b>path</b> — anything in this folder glob (e.g. <code>C:\Windows\System32\*</code>). Brittle.</p>
              <p><b>trusted_path</b> — compound: path glob AND publisher must both match. Airlock-style. Recommended for app dirs.</p>
            </HelpHint>
          </CardTitle>
          <CardDescription>
            Any one match (hash, publisher, path glob, or trusted_path) is enough to allow a process under enforce mode.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
              <AlertTriangle className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">No rules yet. Add observed apps above, or hit Enforce to seed the OS path defaults.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground border-b">
                  <tr>
                    <th className="py-2 pr-3">Match</th>
                    <th className="py-2 pr-3">Identity</th>
                    <th className="py-2 pr-3">App</th>
                    <th className="py-2 pr-3">Added</th>
                    <th className="py-2 pr-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="py-2 pr-3">
                        <Badge variant="outline" className="gap-1 text-xs">
                          {matchTypeIcon(r.match_type)} {matchTypeLabel(r.match_type)}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs truncate max-w-[420px]">{r.match_value}</td>
                      <td className="py-2 pr-3">{r.app_name || <span className="text-muted-foreground italic">—</span>}</td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {selectedEndpointId && (
                          <Button
                            size="sm" variant="ghost"
                            disabled={deleteRule.isPending}
                            onClick={() => deleteRule.mutate({ endpointId: selectedEndpointId, ruleId: r.id })}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
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

      <AlertDialog open={confirmEnforce} onOpenChange={setConfirmEnforce}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Lock this endpoint down?</AlertDialogTitle>
            <AlertDialogDescription>
              Every SHA-256 observed during audit will be added to the whitelist plus seed OS paths
              (System32, SysWOW64, WinSxS, Program Files\Mithras, ProgramData\Mithras). The agent
              will <b>terminate any process whose binary doesn't match a rule</b>. Make sure the
              observed list above looks complete before continuing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (selectedEndpointId) enforce.mutate({ endpointId: selectedEndpointId });
                setConfirmEnforce(false);
              }}
            >
              Enforce
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
