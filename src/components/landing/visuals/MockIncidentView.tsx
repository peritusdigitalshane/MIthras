import { ShieldAlert, Clock, CheckCircle } from "lucide-react";

/**
 * Mirror of the real /incidents page (Incidents.tsx) with synthetic data.
 * Same shape MSP buyers see on day one: header + 4-tile KPI strip + Open /
 * Closed tabs + Card-wrapped table.
 *
 * Severity colour-classes match the platform's helper severityClasses():
 *   Severe   → status-critical
 *   High     → orange-500
 *   Moderate → amber-500
 *   Low      → muted
 *   Unknown  → amber ring (triage required)
 */

const OPEN_ROWS: Array<{
  id: string;
  title: string;
  kind: "threat" | "alert" | "posture_drift" | "vuln_critical";
  severity: "Severe" | "High" | "Moderate" | "Low" | "Unknown";
  endpoint: string;
  sla: { state: "breached" | "due"; text: string };
  status: "Open" | "Triaging" | "In progress";
  assignee?: string;
}> = [
  { id: "INC-2418", title: "Trojan:Win32/Wacatac.B!ml on WH-04",         kind: "threat",         severity: "Severe",  endpoint: "WH-04",                   sla: { state: "due", text: "due in 41m" },   status: "In progress", assignee: "Emma C" },
  { id: "INC-2417", title: "WordPress brute force on dev6 — 5 sites",     kind: "alert",          severity: "High",    endpoint: "dev6.peritusdigital.com.au", sla: { state: "due", text: "due in 2h 18m" }, status: "Triaging",    assignee: "AI Commander" },
  { id: "INC-2416", title: "Critical CVE-2026-0142 — PHP 8.1 RCE",        kind: "vuln_critical",  severity: "Severe",  endpoint: "DEV-WEB-02",              sla: { state: "breached", text: "breached 12m ago" }, status: "Open" },
  { id: "INC-2415", title: "12 failed LDAP logons on DC01",               kind: "alert",          severity: "High",    endpoint: "DC01",                    sla: { state: "due", text: "due in 3h 51m" }, status: "Triaging" },
  { id: "INC-2414", title: "Posture drift — Defender RTP disabled",       kind: "posture_drift",  severity: "Moderate",endpoint: "ACME-LAP-04",             sla: { state: "due", text: "due in 18h" },   status: "Open" },
  { id: "INC-2413", title: "Unknown threat — Suspicious LSASS access",    kind: "threat",         severity: "Unknown", endpoint: "WIN10-LAP18",             sla: { state: "due", text: "due in 22h" },   status: "Open" },
];

export function MockIncidentView() {
  const openCount     = OPEN_ROWS.length;
  const breachedCount = OPEN_ROWS.filter((r) => r.sla.state === "breached").length;
  const closedCount   = 47;
  const severeCount   = OPEN_ROWS.filter((r) => r.severity === "Severe").length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-primary" /> Incidents
          </h1>
          <p className="text-sm text-muted-foreground">
            Severe/High Defender threats and Critical/High alerts auto-open an incident. SLA: Severe/Critical 1h, High 4h.
          </p>
        </div>
      </div>

      {/* KPI strip — 4 tiles to match the real layout */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MockStatCard title="Open"             value={openCount.toString()} />
        <MockStatCard title="SLA breached"     value={breachedCount.toString()} valueClass="text-red-500" />
        <MockStatCard title="Closed (this view)" value={closedCount.toString()} />
        <MockStatCard title="Severe open"      value={severeCount.toString()} valueClass="text-red-500" />
      </div>

      {/* Tabs */}
      <div className="space-y-3">
        <div className="inline-flex h-9 items-center justify-center rounded-lg bg-muted/60 p-1 text-muted-foreground">
          <span className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium bg-background text-foreground shadow-sm">
            Open ({openCount})
          </span>
          <span className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium">
            Closed ({closedCount})
          </span>
        </div>

        {/* Card-wrapped incident table */}
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="text-left p-3 font-medium">Severity</th>
                  <th className="text-left p-3 font-medium">Incident</th>
                  <th className="text-left p-3 font-medium">Kind</th>
                  <th className="text-left p-3 font-medium">Endpoint</th>
                  <th className="text-left p-3 font-medium">Status</th>
                  <th className="text-left p-3 font-medium">SLA</th>
                  <th className="text-left p-3 font-medium">Assignee</th>
                </tr>
              </thead>
              <tbody>
                {OPEN_ROWS.map((r) => (
                  <tr key={r.id} className="border-b border-border/40 last:border-b-0 hover:bg-muted/30">
                    <td className="p-3"><SeverityBadge sev={r.severity} /></td>
                    <td className="p-3">
                      <div className="font-medium text-foreground truncate max-w-[280px]">{r.title}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">{r.id}</div>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground font-mono">{r.kind}</td>
                    <td className="p-3 text-xs text-muted-foreground truncate max-w-[160px]">{r.endpoint}</td>
                    <td className="p-3"><StatusBadge status={r.status} /></td>
                    <td className="p-3"><SlaCell sla={r.sla} /></td>
                    <td className="p-3 text-xs text-muted-foreground">{r.assignee ?? <span className="text-muted-foreground/60">unassigned</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function MockStatCard({ title, value, valueClass }: { title: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
      <div className="px-4 pt-3 pb-1">
        <div className="text-sm text-foreground/80">{title}</div>
      </div>
      <div className="px-4 pb-3">
        <div className={`text-2xl font-semibold tabular-nums ${valueClass ?? ""}`}>{value}</div>
      </div>
    </div>
  );
}

function SeverityBadge({ sev }: { sev: "Severe" | "High" | "Moderate" | "Low" | "Unknown" }) {
  // Same map as severityClasses() in Incidents.tsx
  const cls =
    sev === "Severe"   ? "bg-red-500/20 text-red-500 border-red-500/40" :
    sev === "High"     ? "bg-orange-500/20 text-orange-500 border-orange-500/40" :
    sev === "Moderate" ? "bg-amber-500/20 text-amber-500 border-amber-500/40" :
    sev === "Unknown"  ? "bg-amber-500/10 text-amber-600 border-amber-500/30" :
                         "bg-muted text-muted-foreground border-muted-foreground/40";
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-[10px] uppercase tracking-wider font-medium ${cls}`}>
      {sev}
    </span>
  );
}

function StatusBadge({ status }: { status: "Open" | "Triaging" | "In progress" | "Resolved" }) {
  if (status === "Resolved") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border/60 text-[11px] text-emerald-500">
        <CheckCircle className="h-3 w-3" /> {status}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted text-[11px]">
      <Clock className="h-3 w-3" /> {status}
    </span>
  );
}

function SlaCell({ sla }: { sla: { state: "breached" | "due"; text: string } }) {
  if (sla.state === "breached") {
    return <span className="text-xs text-red-500 font-medium">{sla.text}</span>;
  }
  return <span className="text-xs text-muted-foreground">{sla.text}</span>;
}
