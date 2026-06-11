import { Server, Monitor, Shield, History, AlertTriangle, CheckCircle2, Lock } from "lucide-react";

/**
 * EOL Windows page mock — a fleet of mixed-age endpoints, each card showing
 * the OS, its EOL status, and the Mithras controls that protect it. Visually
 * sells the "we protect what CrowdStrike won't" narrative.
 */

const ENDPOINTS = [
  { id: "WIN7-ACC04",  os: "Windows 7 SP1",            kind: "workstation", eol: "Jan 2020", protect: ["Defender", "WDAC", "Microseg"], status: "protected" as const },
  { id: "WIN81-OFF12", os: "Windows 8.1",              kind: "workstation", eol: "Jan 2023", protect: ["Defender", "Path allow-list", "Microseg"], status: "protected" as const },
  { id: "SRV2012-FS01",os: "Server 2012 R2",           kind: "server",      eol: "Oct 2023", protect: ["Defender", "WDAC", "Microseg", "ASR"], status: "protected" as const },
  { id: "SRV2008-DC01",os: "Server 2008 R2",           kind: "server",      eol: "Jan 2020", protect: ["Defender", "Path allow-list", "Microseg"], status: "protected" as const },
  { id: "WIN10-LAP18", os: "Windows 10 22H2",          kind: "workstation", eol: "Oct 2025", protect: ["Defender", "WDAC", "Microseg", "ASR"], status: "ok" as const },
  { id: "WIN11-LAP04", os: "Windows 11 23H2",          kind: "workstation", eol: "Current",  protect: ["Defender", "WDAC", "Microseg", "ASR"], status: "ok" as const },
];

export function MockEolFleet() {
  return (
    <div className="p-4 sm:p-5 text-foreground/95 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <History className="h-4 w-4 text-amber-400" />
            Your end-of-life Windows fleet
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Win 7 SP1 · Win 8.1 · Server 2008 R2 · Server 2012 R2 — all under management
          </p>
        </div>
        <div className="text-[10px] font-mono text-emerald-300 px-2 py-1 rounded border border-emerald-500/30 bg-emerald-500/10">
          12 OF 12 PROTECTED
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {ENDPOINTS.map((e) => (
          <EndpointCard key={e.id} {...e} />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <ContrastTile competitor="CrowdStrike" minOs="Windows 10 1809" />
        <ContrastTile competitor="SentinelOne" minOs="Windows 10 1809" />
        <ContrastTile competitor="Huntress"    minOs="Windows 10 1903" />
      </div>
    </div>
  );
}

function EndpointCard({
  id, os, kind, eol, protect, status,
}: {
  id: string; os: string; kind: "workstation" | "server";
  eol: string; protect: string[];
  status: "protected" | "ok";
}) {
  const isLegacy = status === "protected";
  const Icon = kind === "server" ? Server : Monitor;
  const accent = isLegacy
    ? "border-amber-500/30 bg-amber-500/5"
    : "border-emerald-500/30 bg-emerald-500/5";
  return (
    <div className={`rounded-lg border ${accent} p-3`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={`h-4 w-4 flex-shrink-0 ${isLegacy ? "text-amber-400" : "text-emerald-400"}`} />
          <div className="min-w-0">
            <div className="text-[11px] font-mono font-semibold truncate">{id}</div>
            <div className="text-[10px] text-muted-foreground truncate">{os}</div>
          </div>
        </div>
        {isLegacy ? (
          <Shield className="h-3.5 w-3.5 text-amber-400" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
        )}
      </div>
      <div className="text-[10px] font-mono text-muted-foreground mb-2 flex items-center gap-1">
        <Lock className="h-2.5 w-2.5" />
        EOL: {eol}
      </div>
      <div className="flex flex-wrap gap-1">
        {protect.map((p) => (
          <span key={p} className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-border/50 bg-card/40 text-foreground/80">
            {p}
          </span>
        ))}
      </div>
    </div>
  );
}

function ContrastTile({ competitor, minOs }: { competitor: string; minOs: string }) {
  return (
    <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
      <div className="text-[10px] uppercase tracking-wider text-red-300 mb-1 flex items-center gap-1">
        <AlertTriangle className="h-3 w-3" />
        {competitor}
      </div>
      <div className="text-[11px] text-muted-foreground">
        Requires <span className="font-mono text-foreground/80">{minOs}</span> or newer. Older boxes go un-monitored.
      </div>
    </div>
  );
}
