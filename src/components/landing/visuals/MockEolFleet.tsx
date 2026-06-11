import { Monitor, AlertTriangle, ShieldCheck } from "lucide-react";

/**
 * Mirror of the real /endpoints page (Endpoints.tsx) filtered to legacy
 * Windows hosts, populated with synthetic data. Same header + summary tiles +
 * table-of-endpoints pattern the real product uses.
 */

const ROWS: Array<{
  hostname: string;
  os: string;
  generation: "Win 7" | "Win 8.1" | "Server 2008 R2" | "Server 2012 R2" | "Win 10" | "Win 11";
  agent: string;
  status: "online" | "idle" | "offline";
  posture: { defender: boolean; appLock: boolean; microseg: boolean };
  badges: Array<"EOL" | "no_policy" | "agent_outdated">;
  lastSeen: string;
}> = [
  { hostname: "ACC-WIN7-04",  os: "Windows 7 SP1 (x64)",          generation: "Win 7",           agent: "v0.7.10", status: "online",  posture: { defender: true,  appLock: true,  microseg: true  }, badges: ["EOL"], lastSeen: "32s ago" },
  { hostname: "OFF-WIN81-12", os: "Windows 8.1 Pro (x64)",         generation: "Win 8.1",         agent: "v0.7.10", status: "online",  posture: { defender: true,  appLock: true,  microseg: true  }, badges: ["EOL"], lastSeen: "58s ago" },
  { hostname: "SRV-DC01",     os: "Windows Server 2008 R2 SP1",    generation: "Server 2008 R2",  agent: "v0.7.10", status: "online",  posture: { defender: true,  appLock: true,  microseg: true  }, badges: ["EOL"], lastSeen: "1m ago"  },
  { hostname: "SRV-FS01",     os: "Windows Server 2012 R2",        generation: "Server 2012 R2",  agent: "v0.7.10", status: "online",  posture: { defender: true,  appLock: true,  microseg: true  }, badges: ["EOL"], lastSeen: "44s ago" },
  { hostname: "DEV-WIN10-18", os: "Windows 10 22H2 (x64)",         generation: "Win 10",          agent: "v0.7.10", status: "online",  posture: { defender: true,  appLock: true,  microseg: true  }, badges: [],      lastSeen: "12s ago" },
  { hostname: "ENG-WIN11-04", os: "Windows 11 23H2 (x64)",         generation: "Win 11",          agent: "v0.7.10", status: "online",  posture: { defender: true,  appLock: true,  microseg: true  }, badges: [],      lastSeen: "8s ago"  },
  { hostname: "RECEPT-WIN7",  os: "Windows 7 SP1 (x86)",           generation: "Win 7",           agent: "v0.7.9",  status: "idle",    posture: { defender: true,  appLock: true,  microseg: false }, badges: ["EOL", "agent_outdated"], lastSeen: "27m ago" },
  { hostname: "SRV-FS02",     os: "Windows Server 2012 R2",        generation: "Server 2012 R2",  agent: "v0.7.10", status: "online",  posture: { defender: true,  appLock: false, microseg: true  }, badges: ["EOL", "no_policy"], lastSeen: "1m ago" },
];

export function MockEolFleet() {
  return (
    <div className="p-6 space-y-6">
      {/* Header — same shape as Endpoints.tsx */}
      <div className="flex items-center gap-3 flex-wrap">
        <Monitor className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold text-foreground">Endpoints</h1>
        <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/40 text-amber-500 bg-amber-500/10 uppercase tracking-wider font-medium">
          filter: EOL Windows
        </span>
      </div>
      <p className="text-sm text-muted-foreground -mt-3">
        Win 7, Win 8.1, Server 2008 R2, Server 2012 R2 — all under management with the same agent as your modern fleet.
      </p>

      {/* 4-tile summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="EOL endpoints"      value={ROWS.filter(r => r.badges.includes("EOL")).length.toString()} sub="under management" />
        <StatCard title="Defender posture"   value="100%"  sub="all EOL hosts protected" valueClass="text-emerald-500" />
        <StatCard title="Microseg enforce"   value="93%"   sub="1 host in audit-only" />
        <StatCard title="Open posture badges" value="2"    sub="agent_outdated · no_policy" valueClass="text-amber-500" />
      </div>

      {/* Endpoints table */}
      <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
        <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between">
          <div className="text-base font-semibold leading-none tracking-tight">All endpoints &middot; 8 of 8</div>
          <div className="text-[10px] font-mono text-muted-foreground">sorted: EOL first</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40 bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="text-left p-3 font-medium">Hostname</th>
                <th className="text-left p-3 font-medium">OS</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium">Agent</th>
                <th className="text-left p-3 font-medium">Posture</th>
                <th className="text-left p-3 font-medium">Badges</th>
                <th className="text-left p-3 font-medium">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.hostname} className="border-b border-border/40 last:border-b-0 hover:bg-muted/30">
                  <td className="p-3">
                    <div className="font-medium text-foreground flex items-center gap-2">
                      <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
                      {r.hostname}
                    </div>
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">{r.os}</td>
                  <td className="p-3"><StatusBadge status={r.status} /></td>
                  <td className="p-3 text-xs font-mono text-muted-foreground">{r.agent}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-1.5">
                      <Dot ok={r.posture.defender} label="Def" />
                      <Dot ok={r.posture.appLock} label="App" />
                      <Dot ok={r.posture.microseg} label="Net" />
                    </div>
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      {r.badges.length === 0 && <span className="text-[10px] text-muted-foreground/60">—</span>}
                      {r.badges.map((b) => <Badge key={b} kind={b} />)}
                    </div>
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">{r.lastSeen}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Competitor contrast strip */}
      <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-4">
        <div className="text-base font-semibold mb-3">Where competitors stop</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <Competitor name="CrowdStrike Falcon" min="Windows 10 1809" />
          <Competitor name="SentinelOne"        min="Windows 10 1809" />
          <Competitor name="Huntress EDR"       min="Windows 10 1903" />
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Mithras runs on Win 7 SP1 / Win 8.1 / Server 2008 R2 / Server 2012 R2 with the same agent and the same AI SOC as your modern boxes — no Microsoft ESU bill.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function StatCard({ title, value, sub, valueClass }: { title: string; value: string; sub: string; valueClass?: string }) {
  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-1">{title}</div>
      <div className={`text-2xl font-bold tabular-nums tracking-tight ${valueClass ?? ""}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: "online" | "idle" | "offline" }) {
  const cls =
    status === "online"  ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/40" :
    status === "idle"    ? "bg-amber-500/15   text-amber-500   border-amber-500/40"   :
                           "bg-muted          text-muted-foreground border-muted-foreground/30";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] uppercase tracking-wider font-medium ${cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${
        status === "online" ? "bg-emerald-500" : status === "idle" ? "bg-amber-500" : "bg-muted-foreground"
      }`} />
      {status}
    </span>
  );
}

function Dot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span title={`${label}: ${ok ? "enabled" : "off"}`} className="inline-flex items-center gap-1 text-[10px] font-mono">
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
      <span className={ok ? "text-foreground/85" : "text-muted-foreground/60"}>{label}</span>
    </span>
  );
}

function Badge({ kind }: { kind: "EOL" | "no_policy" | "agent_outdated" }) {
  const meta: Record<typeof kind, { label: string; cls: string }> = {
    EOL:             { label: "EOL",             cls: "bg-amber-500/15 text-amber-500 border-amber-500/40" },
    no_policy:       { label: "no Defender policy", cls: "bg-red-500/15   text-red-500   border-red-500/40"   },
    agent_outdated:  { label: "agent outdated",  cls: "bg-orange-500/15 text-orange-500 border-orange-500/40" },
  };
  const m = meta[kind];
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${m.cls}`}>
      <AlertTriangle className="h-2.5 w-2.5" />
      {m.label}
    </span>
  );
}

function Competitor({ name, min }: { name: string; min: string }) {
  return (
    <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3">
      <div className="flex items-center gap-1 text-xs font-medium text-red-500 mb-0.5">
        <AlertTriangle className="h-3 w-3" />
        {name}
      </div>
      <div className="text-[11px] text-muted-foreground">
        Won&apos;t install below <span className="font-mono text-foreground/80">{min}</span>
      </div>
    </div>
  );
}
