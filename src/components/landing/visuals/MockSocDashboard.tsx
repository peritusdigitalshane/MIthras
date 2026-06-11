import {
  Activity, Bell, Brain, Bot, AlertTriangle, Monitor, Cloud, TrendingUp,
} from "lucide-react";

/**
 * Mirror of the real /soc page (SocConsole.tsx) populated with synthetic data.
 * Structure stays faithful so MSP buyers see the same layout they'd get on day
 * one of evaluation:
 *   - title bar with Activity icon + LivePulse on the right
 *   - 6-tile KPI strip (Open alerts / AI triages / Investigations / Active
 *     threats / Endpoints online / M365 tenants)
 *   - 2-column main area: AI agent activity (left) + Live alerts (right)
 *   - super-admin per-organisation posture table at the bottom
 */

// Verdict colours mirror SocConsole.tsx / Alerts.tsx vocabulary.
const SEVERITY_DOT: Record<string, string> = {
  critical: "bg-red-500",
  high:     "bg-orange-500",
  medium:   "bg-amber-500",
  low:      "bg-blue-500",
};

const AI_ACTIVITY: Array<{
  verdict: "true_positive" | "false_positive" | "needs_human";
  status: "auto_closed" | "resolved" | "open";
  confidence: number;
  alertTitle: string;
  summary: string;
  age: string;
}> = [
  { verdict: "true_positive",  status: "auto_closed", confidence: 0.94, alertTitle: "wp_brute_force on dev6.peritusdigital.com.au", summary: "5 failed logins for mithras-test, distinct IP 198.51.100.42. Verified TP — 5 agents agree. IP blocked at perimeter; MFA reset forced.", age: "2m ago" },
  { verdict: "true_positive",  status: "open",        confidence: 0.88, alertTitle: "defender_signature: Trojan:Win32/Wacatac on WH-04", summary: "Real-time protection caught Wacatac variant; file quarantined. Adversarial agent confirmed no benign explanation.", age: "5m ago" },
  { verdict: "false_positive", status: "auto_closed", confidence: 0.79, alertTitle: "microseg_block from NL-FS1:445", summary: "Outbound SMB to corporate file server — expected behaviour for the backup job that runs at 03:00.", age: "9m ago" },
  { verdict: "true_positive",  status: "open",        confidence: 0.82, alertTitle: "ldap_failed_logon × 12 on DC01", summary: "Failed binds from a single workstation. Investigation in progress — likely a stale service account; opened ticket on ACME-LAP-04.", age: "14m ago" },
  { verdict: "needs_human",    status: "open",        confidence: 0.61, alertTitle: "m365_oauth_grant on tenant_b", summary: "New tenant-wide consent to non-Microsoft app with Mail.ReadWrite scope. Risk profile borderline — flagged for analyst review.", age: "22m ago" },
];

const LIVE_ALERTS: Array<{ severity: "critical" | "high" | "medium" | "low"; title: string; message: string; endpoint: string; alertType: string; age: string }> = [
  { severity: "high",     title: "WordPress brute force on dev6",     message: "5 failed logins for mithras-test from 198.51.100.42",            endpoint: "dev6.peritusdigital.com.au", alertType: "wp_brute_force",       age: "2m ago" },
  { severity: "critical", title: "Defender signature: Wacatac",       message: "Real-time protection blocked Trojan:Win32/Wacatac.B!ml",         endpoint: "WH-04",                     alertType: "defender_signature",   age: "5m ago" },
  { severity: "medium",   title: "Microseg block — outbound SMB",     message: "TCP/445 from NL-FS1 to file-server denied by rule pol_smb_lock",  endpoint: "NL-FS1",                    alertType: "microseg_block",       age: "9m ago" },
  { severity: "medium",   title: "12 failed LDAP logons",             message: "Account ACME-LAP-04\\svc-backup failed bind 12× in 4m",          endpoint: "DC01",                      alertType: "ldap_failed_logon",    age: "14m ago" },
  { severity: "low",      title: "M365 OAuth grant — Mail.ReadWrite", message: "Tenant-wide consent granted to ContactSync (publisher unknown)",  endpoint: "tenant_b",                  alertType: "m365_oauth_grant",     age: "22m ago" },
  { severity: "high",     title: "WordPress credential stuffing",     message: "Same IP across 3 sites — coordinated campaign",                   endpoint: "3 sites",                   alertType: "wp_credential_stuffing", age: "31m ago" },
];

const POSTURE = [
  { org: "ACME Corp",          endpoints: 142, openAlerts: 7,  critical: 1, threats: 1, ai: 41, last: "2m ago"  },
  { org: "Westfield Health",   endpoints:  88, openAlerts: 12, critical: 0, threats: 3, ai: 28, last: "5m ago"  },
  { org: "Sundance Studios",   endpoints:  41, openAlerts:  5, critical: 0, threats: 0, ai: 14, last: "11m ago" },
  { org: "Lakeside Realty",    endpoints:  31, openAlerts:  3, critical: 0, threats: 0, ai:  9, last: "18m ago" },
  { org: "Bayside Bookkeeping",endpoints:  18, openAlerts:  0, critical: 0, threats: 0, ai:  2, last: "1h ago"  },
];

export function MockSocDashboard() {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" />
            SOC Console
          </h1>
          <p className="text-muted-foreground text-sm">
            Live security operations across all organisations. Updates in real time.
          </p>
        </div>
        <LivePulse />
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi icon={<Bell      className="h-4 w-4" />} label="Open alerts"          value="23"  sub="2 critical"        accent="warning" />
        <Kpi icon={<Brain     className="h-4 w-4" />} label="AI triages today"     value="142" sub="119 auto-closed" />
        <Kpi icon={<Bot       className="h-4 w-4" />} label="Investigations today" value="47"  sub="US$1.67 spend" />
        <Kpi icon={<AlertTriangle className="h-4 w-4" />} label="Active threats"   value="4"   accent="danger" />
        <Kpi icon={<Monitor   className="h-4 w-4" />} label="Endpoints online"     value="481 / 487" sub="last 24h" />
        <Kpi icon={<Cloud     className="h-4 w-4" />} label="M365 tenants"         value="9"   sub="3 risky / 1 ext fwd" accent="warning" />
      </div>

      {/* Main 2-column area */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* AI activity */}
        <MockCard
          title={<><Brain className="h-4 w-4 text-primary" /> AI agent activity</>}
          right={<span className="text-[10px] px-1.5 py-0.5 rounded border border-border/60 text-muted-foreground">last 5</span>}
        >
          <div className="space-y-1.5">
            {AI_ACTIVITY.map((d, i) => (
              <div key={i} className="w-full text-left rounded-lg border border-border/40 p-3 hover:border-primary/40 hover:bg-muted/20 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <VerdictPill verdict={d.verdict} />
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {Math.round(d.confidence * 100)}%
                      </span>
                      {d.status === "auto_closed" && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-500/40 text-emerald-500">
                          auto-closed
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-medium truncate">{d.alertTitle}</div>
                    <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{d.summary}</div>
                  </div>
                  <div className="text-[10px] text-muted-foreground whitespace-nowrap">{d.age}</div>
                </div>
              </div>
            ))}
          </div>
        </MockCard>

        {/* Live alerts feed */}
        <MockCard
          title={<><Bell className="h-4 w-4 text-primary" /> Live alerts</>}
          right={<span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">Open alerts page <span className="text-muted-foreground/60">›</span></span>}
        >
          <div className="space-y-1">
            {LIVE_ALERTS.map((a, i) => (
              <div key={i} className="w-full text-left rounded-lg border border-border/40 p-2.5 hover:border-primary/40 transition-colors flex items-start gap-3">
                <span className={`mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${SEVERITY_DOT[a.severity]}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{a.title}</div>
                  <div className="text-[11px] text-muted-foreground line-clamp-1">{a.message}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-2">
                    <span>{a.age}</span>
                    <span>· {a.endpoint}</span>
                    <span className="font-mono">· {a.alertType}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </MockCard>
      </div>

      {/* Per-organisation posture (super-admin) */}
      <MockCard title={<><TrendingUp className="h-4 w-4 text-primary" /> Per-organisation posture</>}>
        <div className="overflow-x-auto -mx-3 px-3">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left p-3">Organisation</th>
                <th className="text-right p-3">Endpoints</th>
                <th className="text-right p-3">Open alerts</th>
                <th className="text-right p-3">Critical</th>
                <th className="text-right p-3">Active threats</th>
                <th className="text-right p-3">AI triages today</th>
                <th className="text-left p-3">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {POSTURE.map((o) => (
                <tr key={o.org} className="border-t border-border/40 hover:bg-muted/20">
                  <td className="p-3 font-medium">{o.org}</td>
                  <td className="p-3 text-right tabular-nums">{o.endpoints}</td>
                  <td className="p-3 text-right tabular-nums">{o.openAlerts}</td>
                  <td className={`p-3 text-right tabular-nums ${o.critical > 0 ? "text-red-500 font-bold" : ""}`}>{o.critical}</td>
                  <td className={`p-3 text-right tabular-nums ${o.threats > 0 ? "text-amber-500" : ""}`}>{o.threats}</td>
                  <td className="p-3 text-right tabular-nums text-muted-foreground">{o.ai}</td>
                  <td className="p-3 text-xs text-muted-foreground">{o.last}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </MockCard>

      <div className="text-[10px] text-muted-foreground">
        Custom dashboard — replaces the Grafana view. Updates every 15s + on every event via Supabase Realtime.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Building blocks — match shadcn Card styling without pulling in the real
// component (the marketing page intentionally builds these in code).
// ---------------------------------------------------------------------------

function MockCard({
  title, right, children,
}: {
  title: React.ReactNode; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
      <div className="flex flex-row items-center justify-between space-y-0 px-4 py-3 border-b border-border/40">
        <div className="text-base font-semibold leading-none tracking-tight flex items-center gap-2">{title}</div>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Kpi({
  icon, label, value, sub, accent,
}: {
  icon: React.ReactNode; label: string; value: string; sub?: string; accent?: "warning" | "danger";
}) {
  const accentClass = accent === "danger" ? "text-red-500" : accent === "warning" ? "text-amber-500" : "";
  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <div className={`text-xl font-bold tabular-nums ${accentClass}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function VerdictPill({ verdict }: { verdict: "true_positive" | "false_positive" | "needs_human" }) {
  const cls =
    verdict === "true_positive"  ? "border-red-500/40 text-red-500 bg-red-500/10" :
    verdict === "false_positive" ? "border-emerald-500/40 text-emerald-500 bg-emerald-500/10" :
                                   "border-amber-500/40 text-amber-500 bg-amber-500/10";
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono uppercase tracking-wider ${cls}`}>
      {verdict.replace("_", " ")}
    </span>
  );
}

function LivePulse() {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="relative flex h-2 w-2">
        <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-75" />
        <span className="relative rounded-full bg-emerald-500 h-2 w-2" />
      </span>
      <span className="text-emerald-500 font-medium">live</span>
      <span className="text-muted-foreground/60">· updated 4s ago</span>
    </div>
  );
}
