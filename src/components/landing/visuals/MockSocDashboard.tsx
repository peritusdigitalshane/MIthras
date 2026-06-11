import { useEffect, useState } from "react";
import { Activity, AlertTriangle, Bot, CheckCircle2, Shield, Sparkles, Zap, Search } from "lucide-react";

/**
 * Fake SOC dashboard for the marketing pages — looks like a real screenshot
 * of `/soc` but built in code so it stays sharp at any DPI and updates with
 * the brand instead of going stale. Three KPI tiles, a live alert table, an
 * agent activity panel, and a tiny sparkline.
 *
 * All data is synthetic but uses the platform's actual vocabulary
 * (alert_type, severity, agent names) so MSP buyers recognise it.
 */
export function MockSocDashboard() {
  return (
    <div className="text-foreground/95 p-4 sm:p-5 space-y-4">
      <DashHeader />
      <Kpis />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <AlertTable />
        </div>
        <div className="space-y-4">
          <AgentPanel />
          <FleetTile />
        </div>
      </div>
    </div>
  );
}

function DashHeader() {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h3 className="text-base font-semibold flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          AI SOC overview
        </h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">Across 14 organisations · 487 endpoints</p>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-[10px] font-mono text-emerald-300">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-75" />
            <span className="relative rounded-full bg-emerald-500 h-1.5 w-1.5" />
          </span>
          AGENTS ONLINE
        </div>
      </div>
    </div>
  );
}

function Kpis() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Kpi label="Open incidents"  value="3"   delta="-2"   tone="ok" icon={<AlertTriangle className="h-3 w-3" />} />
      <Kpi label="Alerts (24h)"    value="142" delta="+18"  tone="warn" icon={<Activity className="h-3 w-3" />} />
      <Kpi label="Auto-resolved"   value="119" delta="83%"  tone="ok" icon={<CheckCircle2 className="h-3 w-3" />} />
      <Kpi label="Mean triage"     value="2.1s" delta="-0.4s" tone="ok" icon={<Zap className="h-3 w-3" />} />
    </div>
  );
}

function Kpi({
  label, value, delta, tone, icon,
}: {
  label: string; value: string; delta: string; tone: "ok" | "warn"; icon: React.ReactNode;
}) {
  const deltaCls =
    tone === "ok"   ? "text-emerald-400" :
    tone === "warn" ? "text-amber-400"   :
                      "text-muted-foreground";
  return (
    <div className="rounded-lg border border-border/40 bg-card/40 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
        <span className="text-primary/80">{icon}</span>
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-semibold">{value}</span>
        <span className={`text-[10px] font-mono ${deltaCls}`}>{delta}</span>
      </div>
      <Sparkline tone={tone} />
    </div>
  );
}

function Sparkline({ tone }: { tone: "ok" | "warn" }) {
  // Deterministic but jagged.
  const points = [3, 6, 4, 8, 5, 9, 6, 11, 7, 10, 8, 12];
  const max = Math.max(...points);
  const stroke = tone === "ok" ? "stroke-emerald-400/70" : "stroke-amber-400/70";
  const w = 100, h = 16;
  const path = points
    .map((p, i) => `${(i / (points.length - 1)) * w},${h - (p / max) * h}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-1 w-full h-3">
      <polyline points={path} fill="none" strokeWidth="1.2" className={stroke} />
    </svg>
  );
}

const ALERT_ROWS: Array<{
  id: string; time: string; type: string; sev: "high" | "medium" | "low"; org: string;
  endpoint: string; status: "verified" | "investigating" | "resolved" | "blocked";
  verdict: string;
}> = [
  { id: "a47c91", time: "00:14:02", type: "wp_brute_force",      sev: "high",   org: "ACME Corp",          endpoint: "dev6",  status: "verified",    verdict: "TP · 0.94 · 5 agents agree" },
  { id: "b21f08", time: "00:11:48", type: "defender_signature",  sev: "high",   org: "Westfield Health",   endpoint: "WH-04", status: "investigating", verdict: "investigating" },
  { id: "c93e1a", time: "00:08:27", type: "microseg_block",      sev: "medium", org: "Northern Logistics", endpoint: "NL-FS1",status: "resolved",    verdict: "FP · benign · agent confident" },
  { id: "d14b3c", time: "00:05:14", type: "ldap_failed_logon",   sev: "medium", org: "ACME Corp",          endpoint: "DC01",  status: "blocked",     verdict: "TP · IP blocked · MFA reset" },
  { id: "e72a09", time: "00:02:01", type: "wp_credential_stuffing", sev: "high", org: "Sundance Studios",   endpoint: "3 sites", status: "verified",   verdict: "TP · cross-tenant · campaign" },
  { id: "f48c20", time: "23:58:55", type: "m365_oauth_grant",    sev: "low",    org: "Lakeside Realty",    endpoint: "tenant_b", status: "resolved",  verdict: "needs_human · low conf" },
];

function AlertTable() {
  return (
    <div className="rounded-lg border border-border/40 bg-card/30 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/40 bg-card/40">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Recent alerts</div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Search className="h-3 w-3" />
          <span className="font-mono">filter</span>
        </div>
      </div>
      <div className="divide-y divide-border/30 text-[11px] font-mono">
        {ALERT_ROWS.map((r) => (
          <div key={r.id} className="grid grid-cols-12 gap-2 px-3 py-2 items-center hover:bg-primary/5 transition-colors">
            <span className="col-span-1 text-muted-foreground/70 truncate">{r.time}</span>
            <span className="col-span-1"><SeverityChip sev={r.sev} /></span>
            <span className="col-span-3 text-foreground/90 truncate">{r.type}</span>
            <span className="col-span-2 text-muted-foreground truncate">{r.org}</span>
            <span className="col-span-1 text-muted-foreground/80 truncate">{r.endpoint}</span>
            <span className="col-span-4">
              <StatusChip status={r.status} verdict={r.verdict} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SeverityChip({ sev }: { sev: "high" | "medium" | "low" }) {
  const cls =
    sev === "high"   ? "bg-red-500/15 text-red-300 border-red-500/30" :
    sev === "medium" ? "bg-amber-500/15 text-amber-300 border-amber-500/30" :
                       "bg-sky-500/15 text-sky-300 border-sky-500/30";
  return <span className={`inline-block px-1.5 py-0.5 rounded border text-[9px] uppercase tracking-wider ${cls}`}>{sev}</span>;
}

function StatusChip({ status, verdict }: { status: string; verdict: string }) {
  const tone =
    status === "blocked" || status === "verified" ? "bg-primary/15 text-primary border-primary/30" :
    status === "investigating" ? "bg-amber-500/15 text-amber-300 border-amber-500/30" :
                                 "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`px-1.5 py-0.5 rounded border text-[9px] uppercase tracking-wider ${tone}`}>{status}</span>
      <span className="text-muted-foreground/80 text-[10px] truncate">{verdict}</span>
    </span>
  );
}

const AGENT_ROWS = [
  { name: "Triage",      runs: "142", cost: "$0.41" },
  { name: "Verify",      runs: "142", cost: "$0.28" },
  { name: "Adversarial", runs: "142", cost: "$0.28" },
  { name: "Investigate", runs: "47",  cost: "$0.52" },
  { name: "Commander",   runs: "23",  cost: "$0.18" },
];

function AgentPanel() {
  return (
    <div className="rounded-lg border border-border/40 bg-card/30">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/40 bg-card/40">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1.5">
          <Bot className="h-3 w-3" /> Agent activity (24h)
        </div>
        <div className="text-[10px] font-mono text-emerald-300">$1.67 spend</div>
      </div>
      <div className="divide-y divide-border/30 text-[11px] font-mono">
        {AGENT_ROWS.map((a) => (
          <div key={a.name} className="flex items-center justify-between px-3 py-1.5">
            <span className="flex items-center gap-2 text-foreground/90">
              <Sparkles className="h-3 w-3 text-primary/70" />
              {a.name}
            </span>
            <span className="flex items-center gap-3">
              <span className="text-muted-foreground">{a.runs} runs</span>
              <span className="text-emerald-300/80 w-12 text-right">{a.cost}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FleetTile() {
  return (
    <div className="rounded-lg border border-border/40 bg-card/30 px-3 py-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Fleet posture</div>
      <FleetBar label="RTP enabled"      value={487} total={487} tone="ok" />
      <FleetBar label="Up-to-date sigs"   value={478} total={487} tone="ok" />
      <FleetBar label="Tamper protect"    value={482} total={487} tone="warn" />
      <FleetBar label="EOL Windows"       value={12}  total={487} tone="muted" />
    </div>
  );
}

function FleetBar({ label, value, total, tone }: { label: string; value: number; total: number; tone: "ok" | "warn" | "muted" }) {
  const pct = Math.min(100, Math.round((value / total) * 100));
  const cls =
    tone === "ok"   ? "bg-emerald-500/70" :
    tone === "warn" ? "bg-amber-500/70"   :
                      "bg-sky-500/60";
  return (
    <div className="mb-1.5 last:mb-0">
      <div className="flex justify-between text-[10px] font-mono mb-0.5">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-foreground/90">{value}/{total}</span>
      </div>
      <div className="h-1 w-full bg-background/60 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${cls}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
