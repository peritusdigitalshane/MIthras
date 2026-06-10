import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useEndpointMicroseg,
  useStartLearning,
  useStopMicroseg,
  useEnforceMicroseg,
  EndpointMicrosegTrafficRow,
  Direction,
} from "@/hooks/useMicrosegmentation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { useEndpoints } from "@/hooks/useDashboardData";
import { formatDistanceToNow } from "date-fns";
import {
  Shield,
  Eye,
  Lock,
  Search,
  Activity,
  Monitor,
  Loader2,
  AlertCircle,
  Play,
  Pause,
  Globe,
} from "lucide-react";
import { HelpHint } from "@/components/help/HelpHint";

export function MicrosegmentationDashboard() {
  const { data: endpoints, isLoading: endpointsLoading } = useEndpoints();
  const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(null);
  const [direction, setDirection] = useState<Direction>("inbound");
  const [search, setSearch] = useState("");
  const [confirmEnforce, setConfirmEnforce] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);

  // Default-select the first endpoint (most-recently-seen) when none chosen yet.
  useEffect(() => {
    if (!selectedEndpointId && endpoints && endpoints.length > 0) {
      setSelectedEndpointId(endpoints[0].id);
    }
  }, [endpoints, selectedEndpointId]);

  const { data: snap, isLoading: snapLoading } = useEndpointMicroseg(selectedEndpointId, direction);
  const startLearning = useStartLearning();
  const stopMicroseg = useStopMicroseg();
  const enforceMicroseg = useEnforceMicroseg();

  const selectedEndpoint = endpoints?.find((e) => e.id === selectedEndpointId) ?? null;
  const state = snap?.state ?? "idle";
  const traffic = snap?.traffic ?? [];

  const filteredTraffic = useMemo(() => {
    if (!search) return traffic;
    const q = search.toLowerCase();
    return traffic.filter(
      (t) =>
        String(t.local_port).includes(q) ||
        t.protocol.toLowerCase().includes(q) ||
        (t.service_name ?? "").toLowerCase().includes(q),
    );
  }, [traffic, search]);

  const totalHits24h = traffic.reduce((sum, t) => sum + t.hits_24h, 0);
  const totalHits7d = traffic.reduce((sum, t) => sum + t.hits_7d, 0);
  const uniqueSources = new Set<string>();
  for (const t of traffic) for (const s of t.top_sources ?? []) uniqueSources.add(s.ip);

  const busy = startLearning.isPending || stopMicroseg.isPending || enforceMicroseg.isPending;

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
            Register at least one Windows endpoint via Deploy Agent. Once the agent is shipping
            firewall logs, you can start a learning window here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header: endpoint selector + state + action buttons ─────── */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex-1 min-w-0 space-y-2">
              <CardTitle className="text-base">Microsegmentation</CardTitle>
              <CardDescription className="text-xs">
                Pick an endpoint, start a learning window to observe its inbound traffic,
                then Enforce to lock it down. The agent ships every inbound packet (matched
                or not) and rules are auto-built from what was observed.
              </CardDescription>

              <div className="flex flex-wrap items-center gap-2 pt-2">
                <Select
                  value={selectedEndpointId ?? undefined}
                  onValueChange={(v) => setSelectedEndpointId(v)}
                >
                  <SelectTrigger className="w-[320px]">
                    <SelectValue placeholder="Pick an endpoint…" />
                  </SelectTrigger>
                  <SelectContent>
                    {endpoints.map((e: any) => (
                      <SelectItem key={e.id} value={e.id}>
                        <span className="flex items-center gap-2">
                          <Monitor className="h-3.5 w-3.5" />
                          <span className="font-medium">{e.hostname}</span>
                          {e.last_seen_at && (
                            <span className="text-muted-foreground text-xs">
                              · seen {formatDistanceToNow(new Date(e.last_seen_at), { addSuffix: true })}
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <StateBadge state={state} since={snap?.observation_started_at ?? snap?.enforce_started_at ?? null} />
                <HelpHint title="What does this state mean?" learnMore={state === "enforcing" ? "/glossary#microseg-enforcing" : "/glossary#microseg-learning"}>
                  <p><b>idle</b> — no rules being managed for this endpoint.</p>
                  <p><b>learning</b> — agent records every connection but blocks nothing. Safe to leave running.</p>
                  <p><b>enforcing</b> — anything not seen during learning is now blocked.</p>
                </HelpHint>

                <Tabs value={direction} onValueChange={(v) => setDirection(v as Direction)} className="ml-auto">
                  <TabsList>
                    <TabsTrigger value="inbound" className="gap-1.5">
                      <ArrowDownToLine className="h-3.5 w-3.5" /> Inbound
                    </TabsTrigger>
                    <TabsTrigger value="outbound" className="gap-1.5">
                      <ArrowUpFromLine className="h-3.5 w-3.5" /> Outbound
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                <HelpHint title="Inbound vs outbound">
                  <p><b>Inbound</b>: traffic <i>arriving</i> at this endpoint (clients connecting to its open ports).</p>
                  <p><b>Outbound</b>: traffic <i>leaving</i> this endpoint (the machine reaching other services).</p>
                  <p>You can enforce one direction without the other.</p>
                </HelpHint>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              {state === "idle" && (
                <Button
                  onClick={() => selectedEndpointId && startLearning.mutate({ endpointId: selectedEndpointId, direction })}
                  disabled={busy || !selectedEndpointId}
                  className="gap-2"
                >
                  <Play className="h-4 w-4" />
                  Start Learning
                </Button>
              )}
              {state === "learning" && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => setConfirmRestart(true)}
                    disabled={busy}
                    className="gap-2"
                  >
                    <Play className="h-4 w-4" />
                    Restart Learning
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => selectedEndpointId && stopMicroseg.mutate({ endpointId: selectedEndpointId, direction })}
                    disabled={busy}
                    className="gap-2"
                  >
                    <Pause className="h-4 w-4" />
                    Stop
                  </Button>
                  <Button
                    onClick={() => setConfirmEnforce(true)}
                    disabled={busy || traffic.length === 0}
                    className="gap-2"
                  >
                    <Lock className="h-4 w-4" />
                    Enforce ({traffic.length} ports)
                  </Button>
                </>
              )}
              {state === "enforcing" && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => selectedEndpointId && stopMicroseg.mutate({ endpointId: selectedEndpointId, direction })}
                    disabled={busy}
                    className="gap-2"
                  >
                    <Pause className="h-4 w-4" />
                    Stop Enforcing
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => selectedEndpointId && startLearning.mutate({ endpointId: selectedEndpointId, direction })}
                    disabled={busy}
                    className="gap-2"
                  >
                    <Play className="h-4 w-4" />
                    Re-learn
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* ── Summary stats ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <SummaryCard icon={Globe} label="Ports observed" value={traffic.length} subtitle={state === "idle" ? "from last 7 days" : "since learning started"} accent="blue" />
        <SummaryCard icon={Activity} label="Hits (24h)" value={totalHits24h} subtitle="inbound connections" accent="amber" />
        <SummaryCard icon={Eye} label="Hits (7d)" value={totalHits7d} subtitle="inbound connections" accent="violet" />
        <SummaryCard icon={Shield} label="Unique sources" value={uniqueSources.size} subtitle="distinct remote IPs" accent="green" />
      </div>

      {/* ── Search ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter by port, protocol, or service…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* ── Observed traffic table ───────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Inbound traffic observed{" "}
            {state === "idle" && <span className="text-muted-foreground text-sm">· last 7 days</span>}
            {state === "learning" && snap?.observation_started_at && (
              <span className="text-amber-600 dark:text-amber-400 text-sm">
                · since {formatDistanceToNow(new Date(snap.observation_started_at), { addSuffix: true })}
              </span>
            )}
            {state === "enforcing" && snap?.enforce_started_at && (
              <span className="text-green-600 dark:text-green-400 text-sm">
                · enforcing since {formatDistanceToNow(new Date(snap.enforce_started_at), { addSuffix: true })}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {snapLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : filteredTraffic.length === 0 ? (
            <div className="flex items-start gap-2 p-4 rounded-lg bg-muted/50 border text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                {state === "learning"
                  ? "No inbound traffic observed yet during this learning window. The agent ships firewall logs every ~5 min."
                  : "No inbound traffic in the last 7 days for this endpoint. Either nothing is hitting it or the agent isn't shipping firewall logs."}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-6 px-6">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="py-2 font-medium">Service</th>
                    <th className="py-2 font-medium">Port</th>
                    <th className="py-2 font-medium">Proto</th>
                    <th className="py-2 font-medium text-right">Hits (24h)</th>
                    <th className="py-2 font-medium text-right">Hits (7d)</th>
                    <th className="py-2 font-medium text-right">Sources</th>
                    <th className="py-2 font-medium">Top sources</th>
                    <th className="py-2 font-medium">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTraffic.map((t) => (
                    <tr key={`${t.local_port}-${t.protocol}`} className="border-b last:border-b-0 hover:bg-muted/30">
                      <td className="py-2 font-medium">{t.service_name ?? `Port-${t.local_port}`}</td>
                      <td className="py-2 font-mono text-xs">{t.local_port}</td>
                      <td className="py-2 font-mono text-xs uppercase">{t.protocol}</td>
                      <td className="py-2 text-right tabular-nums">{t.hits_24h.toLocaleString()}</td>
                      <td className="py-2 text-right tabular-nums">{t.hits_7d.toLocaleString()}</td>
                      <td className="py-2 text-right tabular-nums">{t.unique_sources}</td>
                      <td className="py-2 text-xs">
                        <div className="flex flex-wrap gap-1">
                          {(t.top_sources ?? []).slice(0, 3).map((s) => (
                            <Badge key={s.ip} variant="outline" className="font-mono text-[10px]">
                              {s.ip} <span className="ml-1 text-muted-foreground">{s.count}</span>
                            </Badge>
                          ))}
                          {t.top_sources && t.top_sources.length > 3 && (
                            <Badge variant="outline" className="text-[10px]">
                              +{t.top_sources.length - 3}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">
                        {t.last_seen ? formatDistanceToNow(new Date(t.last_seen), { addSuffix: true }) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Confirm Enforce ──────────────────────────────────────── */}
      <AlertDialog open={confirmEnforce} onOpenChange={setConfirmEnforce}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Enforce {traffic.length} observed port{traffic.length === 1 ? "" : "s"} on {selectedEndpoint?.hostname}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Rules will be created for every (port, protocol) that was observed during this
              learning window. The agent will install them as Windows Firewall block rules on
              its next policy pass (~15 min). Anything OBSERVED stays open; ports that NEVER
              saw traffic during learning are not yet auto-blocked — that requires the
              default-deny addon (see roadmap).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (selectedEndpointId) enforceMicroseg.mutate({ endpointId: selectedEndpointId, direction });
                setConfirmEnforce(false);
              }}
            >
              Enforce
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Confirm Restart Learning ─────────────────────────────── */}
      <AlertDialog open={confirmRestart} onOpenChange={setConfirmRestart}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restart the learning window?</AlertDialogTitle>
            <AlertDialogDescription>
              Clears the observed-traffic table and starts a fresh observation period from now.
              Historical firewall logs are preserved (still visible if you stop and view 7-day
              default), only the active learning baseline resets.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (selectedEndpointId) startLearning.mutate({ endpointId: selectedEndpointId, direction });
                setConfirmRestart(false);
              }}
            >
              Restart
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StateBadge({
  state,
  since,
}: {
  state: "idle" | "learning" | "enforcing";
  since: string | null;
}) {
  const sinceText = since ? `since ${formatDistanceToNow(new Date(since), { addSuffix: true })}` : "";
  switch (state) {
    case "learning":
      return (
        <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 gap-1">
          <Eye className="h-3 w-3" /> Learning {sinceText}
        </Badge>
      );
    case "enforcing":
      return (
        <Badge variant="outline" className="bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30 gap-1">
          <Lock className="h-3 w-3" /> Enforcing {sinceText}
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="gap-1">
          <Pause className="h-3 w-3" /> Idle
        </Badge>
      );
  }
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  subtitle,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  subtitle: string;
  accent: "amber" | "green" | "blue" | "violet";
}) {
  const accentMap = {
    amber: "text-amber-500 bg-amber-500/10",
    green: "text-green-600 bg-green-500/10",
    blue: "text-blue-500 bg-blue-500/10",
    violet: "text-violet-500 bg-violet-500/10",
  };
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="text-3xl font-bold mt-1">
              {typeof value === "number" ? value.toLocaleString() : value}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
          </div>
          <div className={`p-2 rounded-lg ${accentMap[accent]}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
