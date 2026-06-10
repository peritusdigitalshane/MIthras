import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSysmonEvents, useSysmonSummary, SysmonEvent } from "@/hooks/useSysmonEvents";
import { useEnqueueAgentCommand } from "@/hooks/useAgentCommands";
import { useToast } from "@/hooks/use-toast";
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
import { formatDistanceToNow, format } from "date-fns";
import {
  Activity,
  Cpu,
  Network,
  FileText,
  Search,
  Monitor,
  ChevronRight,
  Zap,
  ShieldOff,
  Loader2,
} from "lucide-react";

const EVENT_LABELS: Record<number, { label: string; color: string; icon: React.ReactNode }> = {
  1:  { label: "Process Create",  color: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",   icon: <Cpu     className="h-3 w-3" /> },
  3:  { label: "Network Connect", color: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",icon: <Network className="h-3 w-3" /> },
  11: { label: "File Create",     color: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30", icon: <FileText className="h-3 w-3" /> },
};

type ActionConfirm =
  | { kind: "kill"; event: SysmonEvent }
  | { kind: "quarantine"; event: SysmonEvent }
  | null;

const Telemetry = () => {
  const [search, setSearch]   = useState("");
  const [eventId, setEventId] = useState<string>("all");
  const [drillEvent, setDrillEvent] = useState<SysmonEvent | null>(null);
  const [actionConfirm, setActionConfirm] = useState<ActionConfirm>(null);
  const enqueue = useEnqueueAgentCommand();
  const { toast } = useToast();

  const filters = {
    search: search.trim() || undefined,
    eventId: eventId === "all" ? undefined : Number(eventId),
    limit: 200,
  };
  const { data: events, isLoading } = useSysmonEvents(filters);
  const { data: summary } = useSysmonSummary();

  const handleAction = async () => {
    if (!actionConfirm) return;
    const { kind, event } = actionConfirm;
    try {
      if (kind === "kill") {
        if (!event.process_id) throw new Error("This event has no process_id");
        await enqueue.mutateAsync({
          endpointId: event.endpoint_id,
          commandType: "kill_process",
          params: { pid: event.process_id, image: event.image ?? undefined },
        });
        toast({
          title: "Kill queued",
          description: `PID ${event.process_id} on ${event.endpoint?.hostname ?? "endpoint"}. Will execute on next heartbeat.`,
        });
      } else {
        if (!event.target_filename) throw new Error("This event has no file path");
        await enqueue.mutateAsync({
          endpointId: event.endpoint_id,
          commandType: "quarantine_file",
          params: { path: event.target_filename },
        });
        toast({
          title: "Quarantine queued",
          description: `Defender will scan ${event.target_filename} on next heartbeat.`,
        });
      }
      setActionConfirm(null);
    } catch (e) {
      toast({
        title: "Couldn't queue command",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Activity className="h-7 w-7 text-primary" />
            Process telemetry
          </h1>
          <p className="text-muted-foreground mt-1">
            Real-time process create, network connect, and file create events from Sysmon
            on every Windows endpoint. Last 24 hours by default.
          </p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat
            icon={<Activity className="h-5 w-5" />}
            label="Total (24h)"
            value={(summary?.total ?? 0).toLocaleString()}
            accent="blue"
          />
          <Stat
            icon={<Cpu className="h-5 w-5" />}
            label="Process creates"
            value={(summary?.process_create ?? 0).toLocaleString()}
            accent="blue"
          />
          <Stat
            icon={<Network className="h-5 w-5" />}
            label="Network connects"
            value={(summary?.network_connect ?? 0).toLocaleString()}
            accent="amber"
          />
          <Stat
            icon={<Monitor className="h-5 w-5" />}
            label="Endpoints reporting"
            value={(summary?.endpoints_reporting ?? 0).toLocaleString()}
            accent="violet"
          />
        </div>

        {/* Filters */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Event stream</CardTitle>
            <CardDescription>
              Filter by event type or search across image / command line / target file /
              destination IP &amp; hostname.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col md:flex-row gap-3 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search image, cmdline, file, destination..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={eventId} onValueChange={setEventId}>
                <SelectTrigger className="w-full md:w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All events</SelectItem>
                  <SelectItem value="1">Process create</SelectItem>
                  <SelectItem value="3">Network connect</SelectItem>
                  <SelectItem value="11">File create</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : !events?.length ? (
              <div className="py-12 text-center text-muted-foreground">
                <Activity className="h-10 w-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">No events recorded in this window.</p>
                <p className="text-xs mt-1">
                  If you just installed the agent, allow 5-10 minutes for the first batch to ship.
                </p>
              </div>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Endpoint</TableHead>
                      <TableHead>Event</TableHead>
                      <TableHead>What</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {events.map((e) => (
                      <TableRow key={e.id} className="hover:bg-muted/40">
                        <TableCell
                          className="text-xs text-muted-foreground"
                          title={format(new Date(e.event_time), "PPpp")}
                        >
                          {formatDistanceToNow(new Date(e.event_time), { addSuffix: true })}
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          {e.endpoint?.hostname ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={EVENT_LABELS[e.event_id]?.color}
                          >
                            <span className="mr-1">{EVENT_LABELS[e.event_id]?.icon}</span>
                            {EVENT_LABELS[e.event_id]?.label ?? `id ${e.event_id}`}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-md">
                          <EventOneLiner event={e} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground truncate max-w-[140px]">
                          {e.user_name ?? "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {e.event_id === 1 && e.process_id && (
                              <Button
                                size="sm"
                                variant="ghost"
                                title={`Kill PID ${e.process_id} on ${e.endpoint?.hostname ?? "endpoint"}`}
                                onClick={() => setActionConfirm({ kind: "kill", event: e })}
                                className="gap-1 text-destructive hover:text-destructive"
                              >
                                <Zap className="h-3.5 w-3.5" />
                                Kill
                              </Button>
                            )}
                            {e.event_id === 11 && e.target_filename && (
                              <Button
                                size="sm"
                                variant="ghost"
                                title={`Quarantine ${e.target_filename}`}
                                onClick={() => setActionConfirm({ kind: "quarantine", event: e })}
                                className="gap-1 text-destructive hover:text-destructive"
                              >
                                <ShieldOff className="h-3.5 w-3.5" />
                                Quarantine
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setDrillEvent(e)}
                              className="gap-1"
                            >
                              Detail
                              <ChevronRight className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Drill-in dialog */}
      <Dialog open={!!drillEvent} onOpenChange={(o) => !o && setDrillEvent(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {drillEvent && (
                <Badge variant="outline" className={EVENT_LABELS[drillEvent.event_id]?.color}>
                  <span className="mr-1">{EVENT_LABELS[drillEvent.event_id]?.icon}</span>
                  {EVENT_LABELS[drillEvent.event_id]?.label}
                </Badge>
              )}
              Event detail
            </DialogTitle>
            <DialogDescription>
              {drillEvent && format(new Date(drillEvent.event_time), "PPpp")}
              {drillEvent?.endpoint?.hostname && ` · ${drillEvent.endpoint.hostname}`}
            </DialogDescription>
          </DialogHeader>
          {drillEvent && <EventDetail event={drillEvent} />}
        </DialogContent>
      </Dialog>

      {/* Confirmation for destructive response actions */}
      <AlertDialog open={!!actionConfirm} onOpenChange={(o) => !o && !enqueue.isPending && setActionConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {actionConfirm?.kind === "kill"
                ? `Kill PID ${actionConfirm.event.process_id}?`
                : `Quarantine file?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {actionConfirm?.kind === "kill" ? (
                <>
                  This sends a force-kill command to{" "}
                  <strong>{actionConfirm.event.endpoint?.hostname ?? "the endpoint"}</strong> for
                  process <code className="font-mono">{actionConfirm.event.image ?? "(unknown image)"}</code>
                  {" "}with PID <strong>{actionConfirm.event.process_id}</strong>. The agent picks
                  it up on its next heartbeat — usually under a minute.
                </>
              ) : actionConfirm?.kind === "quarantine" ? (
                <>
                  Defender will scan{" "}
                  <code className="font-mono break-all">{actionConfirm.event.target_filename}</code>
                  {" "}on <strong>{actionConfirm.event.endpoint?.hostname ?? "the endpoint"}</strong>{" "}
                  and quarantine if it matches a known threat signature.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={enqueue.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void handleAction(); }}
              disabled={enqueue.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {enqueue.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {actionConfirm?.kind === "kill" ? "Kill process" : "Quarantine"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
};

function Stat({
  icon, label, value, accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: "blue" | "amber" | "violet";
}) {
  const tones = {
    blue:   "text-blue-500 bg-blue-500/10",
    amber:  "text-amber-500 bg-amber-500/10",
    violet: "text-violet-500 bg-violet-500/10",
  };
  return (
    <Card>
      <CardContent className="pt-6 flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="text-3xl font-bold mt-1">{value}</p>
        </div>
        <div className={`p-2 rounded-lg ${tones[accent]}`}>{icon}</div>
      </CardContent>
    </Card>
  );
}

function EventOneLiner({ event }: { event: SysmonEvent }) {
  if (event.event_id === 1) {
    return (
      <div className="text-sm">
        <div className="font-mono text-xs truncate" title={event.image ?? ""}>
          {event.image ?? "(no image)"}
        </div>
        {event.parent_image && (
          <div className="text-xs text-muted-foreground truncate" title={event.parent_image}>
            ← parent: {event.parent_image}
          </div>
        )}
      </div>
    );
  }
  if (event.event_id === 3) {
    return (
      <div className="text-sm">
        <div className="font-mono text-xs">
          {event.destination_ip ?? "?"}
          {event.destination_port ? `:${event.destination_port}` : ""}
          {event.protocol && (
            <span className="ml-1 text-muted-foreground">[{event.protocol.toUpperCase()}]</span>
          )}
        </div>
        {event.destination_hostname && (
          <div className="text-xs text-muted-foreground truncate" title={event.destination_hostname}>
            {event.destination_hostname}
          </div>
        )}
        {event.image && (
          <div className="text-[10px] font-mono text-muted-foreground truncate" title={event.image}>
            from {event.image}
          </div>
        )}
      </div>
    );
  }
  if (event.event_id === 11) {
    return (
      <div className="text-sm">
        <div className="font-mono text-xs truncate" title={event.target_filename ?? ""}>
          {event.target_filename ?? "(no path)"}
        </div>
        {event.image && (
          <div className="text-[10px] font-mono text-muted-foreground truncate" title={event.image}>
            by {event.image}
          </div>
        )}
      </div>
    );
  }
  return <span className="text-xs text-muted-foreground">—</span>;
}

function EventDetail({ event }: { event: SysmonEvent }) {
  const fields: { label: string; value: React.ReactNode }[] = [];
  const add = (l: string, v: React.ReactNode | null | undefined) => {
    if (v === null || v === undefined || v === "") return;
    fields.push({ label: l, value: v });
  };

  if (event.event_id === 1) {
    add("Image", <code className="font-mono text-xs">{event.image}</code>);
    add("Command line", <code className="font-mono text-xs break-all">{event.command_line}</code>);
    add("Parent image", <code className="font-mono text-xs">{event.parent_image}</code>);
    add("Parent cmd",   <code className="font-mono text-xs break-all">{event.parent_command_line}</code>);
    add("PID",          event.process_id);
    add("PPID",         event.parent_process_id);
    add("Current dir",  event.current_directory);
    add("Integrity",    event.integrity_level);
    if (event.hashes) {
      for (const [algo, hash] of Object.entries(event.hashes)) {
        add(algo, <code className="font-mono text-xs break-all">{hash}</code>);
      }
    }
  }
  if (event.event_id === 3) {
    add("Image", <code className="font-mono text-xs">{event.image}</code>);
    add("Direction", event.initiated === true ? "outbound" : event.initiated === false ? "inbound" : "—");
    add("Protocol", event.protocol);
    add("Source", `${event.source_ip ?? "?"}${event.source_port ? `:${event.source_port}` : ""}`);
    add("Destination", `${event.destination_ip ?? "?"}${event.destination_port ? `:${event.destination_port}` : ""}`);
    add("Hostname", event.destination_hostname);
  }
  if (event.event_id === 11) {
    add("Target file", <code className="font-mono text-xs break-all">{event.target_filename}</code>);
    add("Created by",  <code className="font-mono text-xs">{event.image}</code>);
    add("PID",         event.process_id);
  }
  add("User", event.user_name);

  return (
    <div className="space-y-2">
      {fields.map((f) => (
        <div key={f.label} className="grid grid-cols-[140px_1fr] gap-3 py-1.5 border-b border-border/40">
          <div className="text-xs uppercase tracking-wide text-muted-foreground pt-0.5">
            {f.label}
          </div>
          <div className="text-sm">{f.value}</div>
        </div>
      ))}
    </div>
  );
}

export default Telemetry;
