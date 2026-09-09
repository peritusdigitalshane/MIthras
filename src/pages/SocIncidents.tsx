import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import {
  ShieldAlert, AlertTriangle, Clock, Brain, Bot, ExternalLink,
  ChevronRight, Filter,
} from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useOpenIncidentsFeed, normaliseSeverity, type OpenIncidentRow,
} from "@/hooks/useIncidents";
import { AiDecisionDrawer } from "@/components/ai/AiDecisionDrawer";
import { useTenant } from "@/contexts/TenantContext";

// SOC operator queue. Lives under /soc/incidents and is the primary view
// the on-call analyst lives in: pre-joined incident rows with the AI
// Commander's summary + playbook step, severity-sorted, with SLA timers
// and an inline AI-investigation drawer for alert-linked incidents.
//
// /incidents is the everyone-view (tabs for open + closed, edit
// assignment, resolve dialog). /soc/incidents is the operator-focused
// "what's on fire right now" cut.

type SeverityFilter = "all" | "critical" | "high" | "medium" | "low";

const SEV_BG: Record<ReturnType<typeof normaliseSeverity>, string> = {
  critical: "bg-status-critical/15 text-status-critical border-status-critical/40",
  high:     "bg-orange-500/15  text-orange-500  border-orange-500/40",
  medium:   "bg-amber-500/15   text-amber-500   border-amber-500/40",
  low:      "bg-muted text-muted-foreground border-muted-foreground/40",
};

const STATUS_LABEL: Record<string, string> = {
  open:           "Open",
  triaging:       "Triaging",
  triaged:        "Triaged",
  in_progress:    "In progress",
  investigating:  "Investigating",
  contained:      "Contained",
};

const PLAYBOOK_LABEL: Record<string, string> = {
  forensics_complete: "Forensics done",
  contained:          "Contained",
  customer_notified:  "Customer notified",
  review_scheduled:   "Review scheduled",
  resolved:           "Ready to close",
};

export default function SocIncidents() {
  const { data, isLoading, isError, error } = useOpenIncidentsFeed();
  const { isSuperAdmin } = useTenant();
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [alertDrawerId, setAlertDrawerId] = useState<string | null>(null);

  const incidents = data ?? [];

  const counts = useMemo(() => {
    const c = { all: 0, critical: 0, high: 0, medium: 0, low: 0, slaBreached: 0 };
    for (const i of incidents) {
      c.all++;
      const sev = normaliseSeverity(i.severity);
      c[sev]++;
      if (i.sla_due_at && new Date(i.sla_due_at).getTime() < Date.now()) c.slaBreached++;
    }
    return c;
  }, [incidents]);

  const visible = useMemo(() => {
    if (severityFilter === "all") return incidents;
    return incidents.filter((i) => normaliseSeverity(i.severity) === severityFilter);
  }, [incidents, severityFilter]);

  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-primary" />
            Active incidents
          </h1>
          <p className="text-sm text-muted-foreground">
            The on-call operator queue. Severity-sorted, AI Commander summary on every row,
            click an alert-linked incident for the full investigation report.
          </p>
        </div>

        {/* Counter strip */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <CounterTile label="Active" value={counts.all} />
          <CounterTile label="Critical" value={counts.critical} accent={counts.critical > 0 ? "danger" : undefined} />
          <CounterTile label="High" value={counts.high} accent={counts.high > 0 ? "warning" : undefined} />
          <CounterTile label="Medium" value={counts.medium} />
          <CounterTile
            label="SLA breached"
            value={counts.slaBreached}
            accent={counts.slaBreached > 0 ? "danger" : undefined}
          />
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground mr-1">Severity:</span>
          {(["all", "critical", "high", "medium", "low"] as SeverityFilter[]).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={severityFilter === s ? "default" : "outline"}
              className="h-7 text-xs capitalize"
              onClick={() => setSeverityFilter(s)}
            >
              {s} {s !== "all" && counts[s] > 0 && (
                <Badge variant="outline" className="ml-1.5 text-[10px] px-1 py-0">{counts[s]}</Badge>
              )}
            </Button>
          ))}
          <span className="flex-1" />
          <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
            <Link to="/incidents">
              Full incidents page <ChevronRight className="h-3 w-3 ml-0.5" />
            </Link>
          </Button>
        </div>

        {/* Body */}
        {isLoading ? (
          <Card><CardContent className="p-6 space-y-2">
            <Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" />
          </CardContent></Card>
        ) : isError ? (
          <Card><CardContent className="p-6">
            <div className="text-sm text-status-critical">Couldn't load the queue.</div>
            <div className="text-xs text-muted-foreground mt-1 font-mono break-all">
              {(error as Error)?.message ?? "Unknown error"}
            </div>
          </CardContent></Card>
        ) : visible.length === 0 ? (
          <Card><CardContent className="p-8 text-center">
            <ShieldAlert className="h-10 w-10 mx-auto text-status-healthy/70 mb-2" />
            <div className="font-medium text-sm">No active incidents</div>
            <div className="text-xs text-muted-foreground mt-1">
              {severityFilter === "all"
                ? "Every open incident is resolved. Good shift."
                : `No ${severityFilter}-severity incidents right now.`}
            </div>
          </CardContent></Card>
        ) : (
          <div className="space-y-2">
            {visible.map((i) => (
              <IncidentRow
                key={i.id}
                incident={i}
                isSuperAdmin={isSuperAdmin}
                onOpenAlertDrawer={(alertId) => setAlertDrawerId(alertId)}
              />
            ))}
          </div>
        )}

        <div className="text-[10px] text-muted-foreground">
          Queue refreshes every 15 seconds.
        </div>
      </div>

      {/* Alert-investigation panel — the cited-evidence drawer used
          everywhere AI decisions surface. Mounted here so the operator
          can read the full triage + investigation without leaving the
          queue. */}
      <AiDecisionDrawer
        alertId={alertDrawerId}
        onOpenChange={(open) => !open && setAlertDrawerId(null)}
      />
    </MainLayout>
  );
}

function CounterTile({ label, value, accent }: {
  label: string;
  value: number;
  accent?: "warning" | "danger";
}) {
  const accentClass =
    accent === "danger"  ? "text-status-critical" :
    accent === "warning" ? "text-amber-500" : "";
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={`text-2xl font-bold tabular-nums mt-1 ${accentClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function SlaPill({ dueAt, status }: { dueAt: string | null; status: string }) {
  if (!dueAt) return null;
  if (status === "resolved" || status === "false_positive") return null;
  const due = new Date(dueAt).getTime();
  const now = Date.now();
  if (due < now) {
    return (
      <Badge variant="outline" className="text-[10px] text-status-critical border-status-critical/40">
        <Clock className="h-2.5 w-2.5 mr-1" />
        SLA breached {formatDistanceToNow(new Date(dueAt), { addSuffix: true })}
      </Badge>
    );
  }
  const remaining = formatDistanceToNow(new Date(dueAt));
  // Highlight the "running out" zone — under an hour.
  const tight = (due - now) < 60 * 60 * 1000;
  return (
    <Badge
      variant="outline"
      className={`text-[10px] ${tight ? "text-amber-500 border-amber-500/40" : "text-muted-foreground"}`}
    >
      <Clock className="h-2.5 w-2.5 mr-1" />
      due in {remaining}
    </Badge>
  );
}

function IncidentRow({ incident, isSuperAdmin, onOpenAlertDrawer }: {
  incident: OpenIncidentRow;
  isSuperAdmin: boolean;
  onOpenAlertDrawer: (alertId: string) => void;
}) {
  const sev = normaliseSeverity(incident.severity);
  const sevClass = SEV_BG[sev];
  const statusLabel = STATUS_LABEL[incident.status] ?? incident.status;
  const stepLabel = incident.playbook_step ? (PLAYBOOK_LABEL[incident.playbook_step] ?? incident.playbook_step) : null;

  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          {/* Severity gutter */}
          <div className={`w-1 self-stretch rounded-full ${
            sev === "critical" ? "bg-status-critical" :
            sev === "high"     ? "bg-orange-500" :
            sev === "medium"   ? "bg-amber-500" : "bg-muted-foreground/30"
          }`} />

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <Badge variant="outline" className={`text-[10px] capitalize ${sevClass}`}>{sev}</Badge>
                  <Badge variant="outline" className="text-[10px]">{statusLabel}</Badge>
                  {stepLabel && (
                    <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">
                      <Bot className="h-2.5 w-2.5 mr-1" />
                      {stepLabel}
                    </Badge>
                  )}
                  <SlaPill dueAt={incident.sla_due_at} status={incident.status} />
                </div>

                <Link
                  to={`/incidents/${incident.id}`}
                  className="font-medium text-sm hover:underline truncate block"
                >
                  {incident.title}
                </Link>

                <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                  {isSuperAdmin && <span>{incident.organization_name}</span>}
                  {isSuperAdmin && incident.endpoint_hostname && <span>·</span>}
                  {incident.endpoint_hostname && <span>{incident.endpoint_hostname}</span>}
                  <span>·</span>
                  <span>opened {formatDistanceToNow(new Date(incident.opened_at), { addSuffix: true })}</span>
                  {incident.commander_last_action_at && (
                    <>
                      <span>·</span>
                      <span>commander acted {formatDistanceToNow(new Date(incident.commander_last_action_at), { addSuffix: true })}</span>
                    </>
                  )}
                </div>

                {incident.commander_summary && (
                  <div className="mt-2 rounded-md bg-muted/30 border border-border/40 p-2 text-xs leading-relaxed">
                    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                      <Brain className="h-2.5 w-2.5" />
                      AI Commander
                    </div>
                    <div className="text-foreground/90 line-clamp-3">{incident.commander_summary}</div>
                  </div>
                )}
              </div>

              <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                {incident.alert_id && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1.5"
                    onClick={() => onOpenAlertDrawer(incident.alert_id!)}
                  >
                    <Brain className="h-3 w-3" />
                    AI analysis
                  </Button>
                )}
                <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
                  <Link to={`/incidents/${incident.id}`}>
                    Open case
                    <ExternalLink className="h-3 w-3 ml-1" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
