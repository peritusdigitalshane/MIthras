import { useQuery } from "@tanstack/react-query";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import {
  Activity, Database, Server, Cpu, ShieldAlert, ShieldCheck,
  CircleCheck, CircleAlert, CircleX, Cloud, Monitor, RefreshCcw,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Link } from "react-router-dom";

type Overall = "healthy" | "degraded" | "down";
type FnProbe = { name: string; healthy: boolean; status: number | null; latency_ms: number | null; error?: string };

interface HealthSnapshot {
  generated_at: string;
  generation_ms: number;
  overall: Overall;
  signals: {
    db_ok: boolean;
    heartbeat_fn_ok: boolean;
    fleet_alive_1h: boolean;
    fleet_alive_5min: boolean;
    other_functions_down: number;
    meshcentral_ok: boolean;
    stuck_commands: boolean;
    bundle_age_over_30d: boolean;
    m365_stale_polls: boolean;
  };
  database: { status: string; latency_ms?: number; version?: string | null; error?: string | null };
  edge_functions: {
    base_url: string;
    total: number;
    healthy: number;
    unhealthy: number;
    unhealthy_names: string[];
    per_function: FnProbe[];
  };
  fleet: {
    status: string;
    total_active?: number;
    active_5min?: number;
    active_1h?: number;
    stale_1h_to_1d?: number;
    offline_over_1d?: number;
    soft_deleted?: number;
    agent_versions?: Array<{ version: string; count: number }>;
  };
  commands: {
    queued?: number;
    dispatched?: number;
    stuck_over_15min?: number;
    succeeded_24h?: number;
    failed_24h?: number;
  };
  agent_bundle: {
    status?: string;
    version?: string;
    sha256?: string;
    published_at?: string;
    age_days?: number;
  };
  meshcentral: { base_url: string; ok: boolean; status: number | null; latency_ms: number | null; error?: string };
  m365: { status: string; tenants_connected?: number; tenants_stale_poll_1h?: number; tenants_with_poll_error?: number };
  pg_cron: { status: string; enabled?: boolean; jobs_total?: number; jobs_active?: number; last_run_age_minutes?: number };
  ai_soc: { status: string; triages_24h?: number; investigations_24h?: number; open_alerts?: number; critical_alerts?: number };
}

export default function SystemHealth() {
  const { isSuperAdmin } = useTenant();

  const { data, isLoading, isError, error, dataUpdatedAt, refetch, isFetching } = useQuery<HealthSnapshot>({
    queryKey: ["system-health"],
    enabled: isSuperAdmin,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<HealthSnapshot>("health-check", {
        method: "GET",
      });
      if (error) throw error;
      if (!data) throw new Error("Empty health response");
      return data;
    },
  });

  if (!isSuperAdmin) {
    return (
      <MainLayout>
        <Alert variant="destructive">
          <CircleX className="h-4 w-4" />
          <AlertTitle>Super-admin only</AlertTitle>
          <AlertDescription>This dashboard is restricted to Mithras platform operators.</AlertDescription>
        </Alert>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6 animate-fade-in">
        {/* Top banner: traffic-light overall + the why */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <OverallDot status={data?.overall} loading={isLoading} />
            <div>
              <h1 className="text-2xl font-bold">System Health</h1>
              <p className="text-sm text-muted-foreground">
                Live operational status of the Mithras platform. Auto-refreshes every 30s.
                {data?.generated_at && <> Last refresh {formatDistanceToNow(new Date(data.generated_at), { addSuffix: true })} ({data.generation_ms}ms server-side).</>}
              </p>
            </div>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="text-xs inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 hover:bg-muted/50 disabled:opacity-50"
          >
            <RefreshCcw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
            Refresh now
          </button>
        </div>

        {isError && (
          <Alert variant="destructive">
            <CircleX className="h-4 w-4" />
            <AlertTitle>Cannot reach health-check edge function</AlertTitle>
            <AlertDescription>
              {error instanceof Error ? error.message : "Unknown error"} — the function may be down OR your auth token expired. If this persists, the platform is likely in a hard-down state.
            </AlertDescription>
          </Alert>
        )}

        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[0,1,2,3,4,5].map(i => <Skeleton key={i} className="h-32" />)}
          </div>
        )}

        {data && (
          <>
            {/* Signals row — the "why" behind the colour */}
            <SignalsCard data={data} />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              <DatabaseCard data={data} />
              <FleetCard data={data} />
              <CommandsCard data={data} />
              <AgentBundleCard data={data} />
              <MeshCentralCard data={data} />
              <M365Card data={data} />
              <PgCronCard data={data} />
              <AiSocCard data={data} />
            </div>

            <EdgeFunctionsCard data={data} />

            {/* Agent versions distribution */}
            {data.fleet.agent_versions && data.fleet.agent_versions.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2"><Cpu className="h-4 w-4" /> Agent versions across fleet</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {data.fleet.agent_versions.map(v => (
                    <Badge key={v.version} variant="outline" className="gap-1">
                      <code className="font-mono">v{v.version}</code>
                      <span className="text-muted-foreground">×{v.count}</span>
                    </Badge>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </MainLayout>
  );
}

function OverallDot({ status, loading }: { status?: Overall; loading: boolean }) {
  if (loading) return <Skeleton className="h-12 w-12 rounded-full mt-1" />;
  const cls =
    status === "healthy" ? "bg-emerald-500" :
    status === "degraded" ? "bg-amber-500" :
    status === "down" ? "bg-red-500" : "bg-muted";
  return (
    <div className={`h-12 w-12 rounded-full ${cls} flex items-center justify-center text-white shrink-0 mt-1 ${status === "healthy" ? "animate-pulse" : ""}`}>
      {status === "healthy" ? <CircleCheck className="h-6 w-6" /> :
       status === "degraded" ? <CircleAlert className="h-6 w-6" /> :
       status === "down" ? <CircleX className="h-6 w-6" /> :
       <Activity className="h-6 w-6" />}
    </div>
  );
}

function StatusBadge({ kind, children }: { kind: "ok" | "warn" | "bad"; children: React.ReactNode }) {
  const cls =
    kind === "ok"   ? "bg-status-healthy/10 text-status-healthy border-status-healthy/40" :
    kind === "warn" ? "bg-amber-500/10 text-amber-600 border-amber-500/40 dark:text-amber-400" :
                      "bg-destructive/10 text-destructive border-destructive/40";
  const Icon = kind === "ok" ? CircleCheck : kind === "warn" ? CircleAlert : CircleX;
  return (
    <Badge variant="outline" className={`gap-1 ${cls}`}>
      <Icon className="h-3 w-3" />
      {children}
    </Badge>
  );
}

function SignalsCard({ data }: { data: HealthSnapshot }) {
  const items: Array<{ key: keyof HealthSnapshot["signals"]; label: string; positive: boolean; severity: "ok"|"warn"|"bad" }> = [
    { key: "db_ok",                label: "Database reachable",            positive: data.signals.db_ok, severity: data.signals.db_ok ? "ok" : "bad" },
    { key: "heartbeat_fn_ok",      label: "agent-heartbeat function up",   positive: data.signals.heartbeat_fn_ok, severity: data.signals.heartbeat_fn_ok ? "ok" : "bad" },
    { key: "fleet_alive_1h",       label: "Fleet alive within 1h",         positive: data.signals.fleet_alive_1h, severity: data.signals.fleet_alive_1h ? "ok" : "bad" },
    { key: "fleet_alive_5min",     label: "Fleet alive within 5min",       positive: data.signals.fleet_alive_5min, severity: data.signals.fleet_alive_5min ? "ok" : "warn" },
    { key: "other_functions_down", label: `${data.signals.other_functions_down} other functions down`, positive: data.signals.other_functions_down === 0, severity: data.signals.other_functions_down > 0 ? "warn" : "ok" },
    { key: "meshcentral_ok",       label: "MeshCentral reachable",          positive: data.signals.meshcentral_ok, severity: data.signals.meshcentral_ok ? "ok" : "warn" },
    { key: "stuck_commands",       label: "No stuck commands",              positive: !data.signals.stuck_commands, severity: data.signals.stuck_commands ? "warn" : "ok" },
    { key: "bundle_age_over_30d",  label: "Agent bundle fresh",             positive: !data.signals.bundle_age_over_30d, severity: data.signals.bundle_age_over_30d ? "warn" : "ok" },
    { key: "m365_stale_polls",     label: "M365 polls fresh",               positive: !data.signals.m365_stale_polls, severity: data.signals.m365_stale_polls ? "warn" : "ok" },
  ];
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Health signals</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {items.map(it => <StatusBadge key={it.key} kind={it.severity}>{it.label}</StatusBadge>)}
      </CardContent>
    </Card>
  );
}

function DatabaseCard({ data }: { data: HealthSnapshot }) {
  const ok = data.database.status === "ok";
  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm flex items-center gap-2"><Database className="h-4 w-4" /> Database</CardTitle>
        <StatusBadge kind={ok ? "ok" : "bad"}>{ok ? "Up" : "Down"}</StatusBadge>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground space-y-1">
        {data.database.latency_ms != null && <div>Query latency: <span className="font-mono">{data.database.latency_ms}ms</span></div>}
        {data.database.version && <div className="truncate" title={data.database.version}>{data.database.version.split(" ").slice(0, 4).join(" ")}</div>}
        {data.database.error && <div className="text-destructive">{data.database.error}</div>}
      </CardContent>
    </Card>
  );
}

function FleetCard({ data }: { data: HealthSnapshot }) {
  const f = data.fleet;
  const ok = (f.active_5min ?? 0) > 0;
  const warn = !ok && (f.active_1h ?? 0) > 0;
  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm flex items-center gap-2"><Server className="h-4 w-4" /> Fleet</CardTitle>
        <StatusBadge kind={ok ? "ok" : warn ? "warn" : "bad"}>
          {ok ? "Active" : warn ? "Slow" : "Silent"}
        </StatusBadge>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground space-y-1">
        <div>Active in last 5min: <span className="font-mono text-foreground">{f.active_5min ?? "?"}</span> / {f.total_active ?? "?"}</div>
        <div>Active in last 1h: <span className="font-mono text-foreground">{f.active_1h ?? "?"}</span></div>
        <div>Stale 1h-1d: <span className="font-mono text-foreground">{f.stale_1h_to_1d ?? "?"}</span></div>
        <div>Offline &gt;1d: <span className="font-mono text-foreground">{f.offline_over_1d ?? "?"}</span></div>
        <div>Soft-deleted: <span className="font-mono text-foreground">{f.soft_deleted ?? "?"}</span></div>
      </CardContent>
    </Card>
  );
}

function CommandsCard({ data }: { data: HealthSnapshot }) {
  const c = data.commands;
  const stuck = (c.stuck_over_15min ?? 0) > 0;
  const inflight = (c.queued ?? 0) + (c.dispatched ?? 0);
  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm flex items-center gap-2"><Cpu className="h-4 w-4" /> Agent commands</CardTitle>
        <StatusBadge kind={stuck ? "warn" : "ok"}>{stuck ? `${c.stuck_over_15min} stuck` : "Healthy"}</StatusBadge>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground space-y-1">
        <div>In-flight: <span className="font-mono text-foreground">{inflight}</span> (queued {c.queued ?? 0} · dispatched {c.dispatched ?? 0})</div>
        <div>Stuck &gt;15min: <span className="font-mono text-foreground">{c.stuck_over_15min ?? 0}</span></div>
        <div>24h success: <span className="font-mono text-status-healthy">{c.succeeded_24h ?? 0}</span></div>
        <div>24h failed: <span className="font-mono text-destructive">{c.failed_24h ?? 0}</span></div>
      </CardContent>
    </Card>
  );
}

function AgentBundleCard({ data }: { data: HealthSnapshot }) {
  const b = data.agent_bundle;
  const ok = b.status === "ok" && (b.age_days ?? 0) <= 30;
  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm flex items-center gap-2"><Cloud className="h-4 w-4" /> Agent bundle</CardTitle>
        <StatusBadge kind={ok ? "ok" : "warn"}>{b.version ? `v${b.version}` : "missing"}</StatusBadge>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground space-y-1">
        {b.sha256 && <div className="font-mono truncate" title={b.sha256}>{b.sha256.slice(0, 16)}…</div>}
        {b.published_at && <div>Published {formatDistanceToNow(new Date(b.published_at), { addSuffix: true })}</div>}
        {b.age_days != null && <div>Age: <span className="font-mono">{b.age_days}d</span></div>}
      </CardContent>
    </Card>
  );
}

function MeshCentralCard({ data }: { data: HealthSnapshot }) {
  const ok = data.meshcentral.ok;
  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm flex items-center gap-2"><Monitor className="h-4 w-4" /> MeshCentral</CardTitle>
        <StatusBadge kind={ok ? "ok" : "warn"}>{ok ? "Reachable" : "Unreachable"}</StatusBadge>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground space-y-1">
        <div className="truncate" title={data.meshcentral.base_url}>{data.meshcentral.base_url}</div>
        {data.meshcentral.status != null && <div>HTTP <span className="font-mono">{data.meshcentral.status}</span></div>}
        {data.meshcentral.latency_ms != null && <div>Latency <span className="font-mono">{data.meshcentral.latency_ms}ms</span></div>}
        {data.meshcentral.error && <div className="text-destructive">{data.meshcentral.error}</div>}
      </CardContent>
    </Card>
  );
}

function M365Card({ data }: { data: HealthSnapshot }) {
  const m = data.m365;
  const stale = (m.tenants_stale_poll_1h ?? 0) > 0;
  const errored = (m.tenants_with_poll_error ?? 0) > 0;
  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm flex items-center gap-2"><Cloud className="h-4 w-4" /> M365 ITDR</CardTitle>
        <StatusBadge kind={errored ? "bad" : stale ? "warn" : "ok"}>
          {(m.tenants_connected ?? 0)} tenants
        </StatusBadge>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground space-y-1">
        <div>Connected: <span className="font-mono text-foreground">{m.tenants_connected ?? 0}</span></div>
        <div>Stale poll &gt;1h: <span className="font-mono">{m.tenants_stale_poll_1h ?? 0}</span></div>
        <div>With poll errors: <span className="font-mono text-destructive">{m.tenants_with_poll_error ?? 0}</span></div>
      </CardContent>
    </Card>
  );
}

function PgCronCard({ data }: { data: HealthSnapshot }) {
  const c = data.pg_cron;
  const enabled = c.enabled !== false;
  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" /> pg_cron</CardTitle>
        <StatusBadge kind={enabled ? "ok" : "warn"}>{enabled ? "Active" : "Disabled"}</StatusBadge>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground space-y-1">
        <div>Jobs: <span className="font-mono text-foreground">{c.jobs_active ?? 0}</span> active / {c.jobs_total ?? 0} total</div>
        {c.last_run_age_minutes != null && <div>Last run: <span className="font-mono">{c.last_run_age_minutes}min ago</span></div>}
      </CardContent>
    </Card>
  );
}

function AiSocCard({ data }: { data: HealthSnapshot }) {
  const s = data.ai_soc;
  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm flex items-center gap-2"><ShieldAlert className="h-4 w-4" /> AI SOC</CardTitle>
        <StatusBadge kind={(s.critical_alerts ?? 0) > 0 ? "bad" : (s.open_alerts ?? 0) > 0 ? "warn" : "ok"}>
          {(s.open_alerts ?? 0)} open
        </StatusBadge>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground space-y-1">
        <div>Critical alerts: <span className="font-mono text-destructive">{s.critical_alerts ?? 0}</span></div>
        <div>Triages 24h: <span className="font-mono text-foreground">{s.triages_24h ?? 0}</span></div>
        <div>Investigations 24h: <span className="font-mono text-foreground">{s.investigations_24h ?? 0}</span></div>
      </CardContent>
    </Card>
  );
}

function EdgeFunctionsCard({ data }: { data: HealthSnapshot }) {
  const ef = data.edge_functions;
  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Edge functions</CardTitle>
        <StatusBadge kind={ef.unhealthy === 0 ? "ok" : "warn"}>
          {ef.healthy}/{ef.total} healthy
        </StatusBadge>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1.5 text-xs">
          {ef.per_function.map(fn => (
            <div
              key={fn.name}
              className={`flex items-center justify-between gap-2 rounded border px-2 py-1.5 ${fn.healthy ? "border-status-healthy/30" : "border-destructive/40 bg-destructive/5"}`}
              title={fn.error ?? ""}
            >
              <span className="font-mono truncate">{fn.name}</span>
              <span className={`shrink-0 ${fn.healthy ? "text-muted-foreground" : "text-destructive"}`}>
                {fn.status ?? "ERR"}{fn.latency_ms != null && ` · ${fn.latency_ms}ms`}
              </span>
            </div>
          ))}
        </div>
        {ef.unhealthy_names.length > 0 && (
          <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
            <b>Down:</b> {ef.unhealthy_names.join(", ")}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
