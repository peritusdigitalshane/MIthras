import { useEffect, useState } from "react";
import {
  Activity, Bell, Brain, Bot, AlertTriangle, Monitor, Cloud, Lock,
  ShieldCheck, Sword, Sparkles, FileSearch, Cpu, Zap, ExternalLink,
  CheckCircle2,
} from "lucide-react";

/**
 * Marketing hero centrepiece — looks like a real screenshot of the platform's
 * /soc page (SocConsole.tsx) with the multi-agent verdict trail
 * (MultiAgentVerdictTrail.tsx) wired up to a live demo animation.
 *
 * Layout mirrors the real product exactly so visitors see the same surface on
 * day one of evaluation:
 *   - Browser-chrome shell (mac dots + URL) so it reads as a screenshot
 *   - SOC Console header (Activity icon + h1 + LivePulse) — matches SocConsole.tsx
 *   - 6-tile KPI strip — same tiles as the real page (Open alerts / AI triages
 *     today / Investigations today / Active threats / Endpoints online / M365)
 *   - "Live investigation" card — the multi-agent verdict trail with synthetic
 *     verdicts that cycle through Triage → Verify → Adversarial → Investigate
 *     → Commander on a 22s loop
 *   - Live alerts column on the right with real product styling
 *   - Fleet mini-grid below alerts — the demo endpoint going red/isolated
 *
 * All synthetic data, no real customer leaks.
 */

const SEVERITY_DOT: Record<string, string> = {
  critical: "bg-red-500",
  high:     "bg-orange-500",
  medium:   "bg-amber-500",
  low:      "bg-blue-500",
};

const PIPELINE_STAGES = [
  { id: "triage",       label: "Triage",       icon: Brain,       role: "Initial classification",        verdict: "true_positive", confidence: 0.94, model: "gpt-5-mini", latency: "1.8s", cost: "$0.004", summary: "5 failed logins for mithras-test in 3m32s window. Source 198.51.100.42 not in allow-list. Verdict: true_positive.", durationMs: 1800 },
  { id: "verification", label: "Verification", icon: ShieldCheck, role: "Independent re-classification", verdict: "true_positive", confidence: 0.88, model: "claude-sonnet", latency: "1.1s", cost: "$0.002", summary: "Cross-checked against 7 site_event_logs. Pattern matches wp_brute_force playbook. Agrees with Triage.", durationMs: 1400 },
  { id: "adversarial",  label: "Adversarial",  icon: Sword,       role: "Refutation attempt",            verdict: "not_refuted",   confidence: 0.91, model: "gpt-5-mini", latency: "1.4s", cost: "$0.002", summary: "Tested 3 benign explanations (autofill, password manager, security audit). None survived endpoint context check.", durationMs: 1600 },
  { id: "investigate",  label: "Investigate",  icon: FileSearch,  role: "Cross-tenant forensics",        verdict: "campaign",      confidence: 0.92, model: "claude-sonnet", latency: "3.2s", cost: "$0.011", summary: "Same source IP 198.51.100.42 hit 4 other tenant sites in last 24h. Coordinated credential-stuffing campaign confirmed.", durationMs: 2400 },
  { id: "commander",    label: "Commander",    icon: Sparkles,    role: "Playbook + response",           verdict: "auto-fired",    confidence: 0.95, model: "gpt-5-mini", latency: "2.7s", cost: "$0.008", summary: "Block 198.51.100.42 at perimeter, force MFA reset for mithras-test, watch dev6 for 24h, notify ACME admin.", durationMs: 2200 },
] as const;

const LIVE_ALERTS: Array<{ severity: "critical" | "high" | "medium" | "low"; title: string; message: string; endpoint: string; alertType: string; age: string }> = [
  { severity: "high",     title: "WordPress brute force on dev6",   message: "5 failed logins for mithras-test from 198.51.100.42",         endpoint: "dev6.peritusdigital.com.au", alertType: "wp_brute_force",       age: "2m ago" },
  { severity: "critical", title: "Defender: Wacatac",                message: "Real-time protection blocked Trojan:Win32/Wacatac.B!ml",      endpoint: "WH-04",                      alertType: "defender_signature",   age: "5m ago" },
  { severity: "medium",   title: "Microseg block — outbound SMB",    message: "TCP/445 from NL-FS1 denied by rule pol_smb_lock",            endpoint: "NL-FS1",                     alertType: "microseg_block",       age: "9m ago" },
  { severity: "medium",   title: "12 failed LDAP logons",            message: "Account svc-backup failed bind 12× in 4m",                    endpoint: "DC01",                       alertType: "ldap_failed_logon",    age: "14m ago" },
  { severity: "low",      title: "M365 OAuth grant",                 message: "Tenant consent to ContactSync (Mail.ReadWrite)",              endpoint: "tenant_b",                   alertType: "m365_oauth_grant",     age: "22m ago" },
];

// ---------------------------------------------------------------------------
// Cycle hook — drives the active stage index off a monotonic timer.
// ---------------------------------------------------------------------------

function useSocCycle() {
  const [activeIdx, setActiveIdx] = useState(0);
  const [finished, setFinished]   = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      while (!cancelled) {
        for (let i = 0; i < PIPELINE_STAGES.length; i++) {
          setActiveIdx(i);
          setFinished(false);
          await delay(PIPELINE_STAGES[i].durationMs);
          if (cancelled) return;
        }
        setFinished(true);
        await delay(3200);
      }
    };
    run();
    return () => { cancelled = true; };
  }, []);

  return { activeIdx, finished };
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SocConsoleHero() {
  const { activeIdx, finished } = useSocCycle();

  return (
    <div className="relative w-full max-w-6xl mx-auto">
      {/* Outer browser chrome — marketing flourish so it reads as a screenshot */}
      <div className="relative rounded-2xl border bg-card text-card-foreground shadow-2xl shadow-primary/10 overflow-hidden">
        <BrowserChrome url="console.mithras.com.au/soc" />

        {/* Inner content — laid out to match SocConsole.tsx */}
        <div className="p-4 sm:p-6 space-y-5">
          <SocHeader />
          <KpiStrip activeIdx={activeIdx} finished={finished} />
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-8">
              <ActiveInvestigationCard activeIdx={activeIdx} finished={finished} />
            </div>
            <div className="lg:col-span-4 space-y-4">
              <LiveAlertsCard />
              <FleetMiniGrid finished={finished} />
            </div>
          </div>
        </div>
      </div>

      {/* Ambient glow under the console */}
      <div className="absolute -inset-x-6 -bottom-6 h-32 bg-gradient-to-t from-primary/10 to-transparent blur-2xl -z-10" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Browser chrome
// ---------------------------------------------------------------------------

function BrowserChrome({ url }: { url: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b border-border/40 bg-card/80">
      <div className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/60" />
      </div>
      <div className="flex-1 flex justify-center">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-background/60 border border-border/40 text-[11px] font-mono text-muted-foreground max-w-full truncate">
          <Lock className="h-2.5 w-2.5 text-emerald-500 flex-shrink-0" />
          <span className="truncate">{url}</span>
        </div>
      </div>
      <div className="w-12" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header — matches SocConsole.tsx
// ---------------------------------------------------------------------------

function SocHeader() {
  return (
    <div className="flex items-center justify-between flex-wrap gap-3">
      <div>
        <h2 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
          <Activity className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
          SOC Console
        </h2>
        <p className="text-muted-foreground text-sm">
          Live security operations across all organisations. Updates in real time.
        </p>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="relative flex h-2 w-2">
          <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-75" />
          <span className="relative rounded-full bg-emerald-500 h-2 w-2" />
        </span>
        <span className="text-emerald-500 font-medium">live</span>
        <span className="text-muted-foreground/60">· updated 4s ago</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI strip — matches SocConsole.tsx
// ---------------------------------------------------------------------------

function KpiStrip({ activeIdx, finished }: { activeIdx: number; finished: boolean }) {
  // "Investigations today" + "AI triages today" tick up as the cycle progresses,
  // so visitors see the numbers change as the agents work.
  const triagesTick = 142 + activeIdx + (finished ? 1 : 0);
  const investTick  = 47  + (activeIdx >= 3 ? 1 : 0) + (finished ? 1 : 0);
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <Kpi icon={<Bell      className="h-4 w-4" />} label="Open alerts"          value="23"  sub="2 critical"        accent="warning" />
      <Kpi icon={<Brain     className="h-4 w-4" />} label="AI triages today"     value={String(triagesTick)} sub="119 auto-closed" />
      <Kpi icon={<Bot       className="h-4 w-4" />} label="Investigations today" value={String(investTick)} sub="US$1.67 spend" />
      <Kpi icon={<AlertTriangle className="h-4 w-4" />} label="Active threats"   value="4"   accent="danger" />
      <Kpi icon={<Monitor   className="h-4 w-4" />} label="Endpoints online"     value="481 / 487" sub="last 24h" />
      <Kpi icon={<Cloud     className="h-4 w-4" />} label="M365 tenants"         value="9"   sub="3 risky / 1 ext fwd" accent="warning" />
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

// ---------------------------------------------------------------------------
// Active investigation — mirror of MultiAgentVerdictTrail.tsx with the cycle
// driving "active" / "done" / "pending" state per agent.
// ---------------------------------------------------------------------------

function ActiveInvestigationCard({ activeIdx, finished }: { activeIdx: number; finished: boolean }) {
  return (
    <div className="rounded-lg border border-primary/30 bg-card text-card-foreground shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between gap-3 flex-wrap bg-gradient-to-br from-primary/5 to-transparent">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-9 w-9 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Multi-agent consensus</span>
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-primary/40 text-primary">
                {finished ? "complete" : `phase ${activeIdx + 1}/${PIPELINE_STAGES.length}`}
              </span>
            </div>
            <div className="text-sm font-semibold mt-0.5 truncate">
              Alert <span className="font-mono text-primary">#a47c91</span> &middot; wp_brute_force on dev6.peritusdigital.com.au
            </div>
          </div>
        </div>
        <FinalVerdictPill finished={finished} />
      </div>

      <div className="p-4 space-y-4">
        {/* 5-agent grid — staged via the cycle */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {PIPELINE_STAGES.map((stage, i) => {
            const state: AgentState =
              finished           ? "done" :
              i <  activeIdx     ? "done" :
              i === activeIdx    ? "active" : "pending";
            return <AgentTile key={stage.id} stage={stage} state={state} />;
          })}
        </div>

        {/* Active reasoning panel — replaces with summary on each tick */}
        <ActiveReasoning activeIdx={activeIdx} finished={finished} />
      </div>
    </div>
  );
}

type AgentState = "pending" | "active" | "done";

function AgentTile({ stage, state }: { stage: typeof PIPELINE_STAGES[number]; state: AgentState }) {
  const Icon = stage.icon;
  const baseCls =
    state === "active" ? "border-primary/60 bg-primary/5 shadow-[0_0_24px_-8px] shadow-primary/40" :
    state === "done"   ? "border-emerald-500/30 bg-emerald-500/5" :
                         "border-dashed border-border/40 bg-muted/10";
  const iconCls =
    state === "active" ? "text-primary"        :
    state === "done"   ? "text-emerald-500"    :
                         "text-muted-foreground/60";

  return (
    <div className={`relative rounded-lg border ${baseCls} p-3 transition-all duration-500`}>
      <div className="flex items-center gap-1.5 text-xs font-medium mb-1">
        <Icon className={`h-3.5 w-3.5 ${iconCls}`} />
        <span>{stage.label}</span>
        {state === "active" && (
          <span className="ml-auto inline-flex gap-0.5">
            <span className="h-1 w-1 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
            <span className="h-1 w-1 rounded-full bg-primary animate-bounce [animation-delay:120ms]" />
            <span className="h-1 w-1 rounded-full bg-primary animate-bounce [animation-delay:240ms]" />
          </span>
        )}
        {state === "done" && (
          <CheckCircle2 className="h-3 w-3 text-emerald-500 ml-auto" />
        )}
      </div>
      <div className="text-[11px] text-muted-foreground leading-tight mb-2">{stage.role}</div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {state === "pending" ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-border/40 text-muted-foreground">— pending</span>
        ) : (
          <>
            <VerdictPill verdict={stage.verdict} />
            <span className="text-[10px] text-muted-foreground tabular-nums">{Math.round(stage.confidence * 100)}%</span>
          </>
        )}
      </div>
    </div>
  );
}

function ActiveReasoning({ activeIdx, finished }: { activeIdx: number; finished: boolean }) {
  if (finished) {
    return (
      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4">
        <div className="flex items-start gap-3">
          <div className="h-8 w-8 rounded-md bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
            <Zap className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-emerald-500 font-semibold mb-1">
              Incident resolved · auto-response fired · incident INC-2418 opened
            </div>
            <div className="text-sm leading-relaxed">
              Blocked <span className="font-mono text-emerald-600 dark:text-emerald-400">198.51.100.42</span> at the perimeter,
              forced MFA reset on <span className="font-mono text-emerald-600 dark:text-emerald-400">mithras-test</span>,
              opened a ticket on ACME and notified the customer admin.
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
              <Badge tone="ok">5 agents · 24s</Badge>
              <Badge tone="ok">$0.027 total</Badge>
              <Badge tone="ok">12 citations</Badge>
              <Badge tone="ok">customer notified</Badge>
              <Badge tone="ok">auto-rollback armed (4h)</Badge>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const stage = PIPELINE_STAGES[activeIdx];
  const Icon = stage.icon;
  return (
    <div className="rounded-lg border border-border/40 bg-card p-3.5">
      <div className="flex items-start gap-3">
        <div className="h-8 w-8 rounded-md bg-primary/15 flex items-center justify-center flex-shrink-0">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="text-xs font-medium flex items-center gap-2">
              <span>{stage.label}</span>
              <span className="text-[10px] text-muted-foreground font-mono">running…</span>
            </div>
            <span className="text-[10px] text-muted-foreground font-mono">{stage.model}</span>
          </div>
          <p className="text-[12px] leading-relaxed text-foreground/85">{stage.summary}</p>
          <div className="mt-2 flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Cpu className="h-2.5 w-2.5" />latency {stage.latency}</span>
            <span>{stage.cost}</span>
            <span className="inline-flex items-center gap-1"><ExternalLink className="h-2.5 w-2.5" />{4 + activeIdx} citations</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function FinalVerdictPill({ finished }: { finished: boolean }) {
  return (
    <span className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded border font-medium ${
      finished
        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
        : "border-amber-500/40 bg-amber-500/10 text-amber-500"
    }`}>
      {finished ? "Resolved · 24s" : "Investigating…"}
    </span>
  );
}

function VerdictPill({ verdict }: { verdict: string }) {
  const cls =
    verdict === "true_positive"  ? "border-rose-500/50 text-rose-600 dark:text-rose-400 bg-rose-500/5" :
    verdict === "false_positive" ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5" :
    verdict === "needs_human"    ? "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/5" :
    verdict === "not_refuted"    ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5" :
    verdict === "campaign"       ? "border-rose-500/50 text-rose-600 dark:text-rose-400 bg-rose-500/5" :
    verdict === "auto-fired"     ? "border-primary/50 text-primary bg-primary/5" :
                                   "border-border";
  return (
    <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border font-medium ${cls}`}>
      {verdict.replace(/_/g, " ")}
    </span>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "ok" }) {
  const cls = tone === "ok" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/40" : "";
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border font-mono ${cls}`}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Live alerts card — matches the real /soc Live alerts panel
// ---------------------------------------------------------------------------

function LiveAlertsCard() {
  const [head, setHead] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setHead((h) => (h + 1) % LIVE_ALERTS.length), 3200);
    return () => clearInterval(id);
  }, []);
  const visible = [...Array(4)].map((_, i) => LIVE_ALERTS[(head + i) % LIVE_ALERTS.length]);

  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <div className="text-sm font-semibold leading-none tracking-tight flex items-center gap-2">
          <Bell className="h-4 w-4 text-primary" />
          Live alerts
        </div>
        <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
          Open alerts page <span className="text-muted-foreground/60">›</span>
        </span>
      </div>
      <div className="p-3 space-y-1">
        {visible.map((a, i) => (
          <div
            key={`${head}-${i}`}
            className="w-full text-left rounded-lg border border-border/40 p-2.5 hover:border-primary/40 transition-colors flex items-start gap-3"
            style={{ opacity: 1 - i * 0.12 }}
          >
            <span className={`mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${SEVERITY_DOT[a.severity]}`} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">{a.title}</div>
              <div className="text-[11px] text-muted-foreground line-clamp-1">{a.message}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-2">
                <span>{a.age}</span>
                <span>· {a.endpoint}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fleet mini-grid — small visualisation of the endpoint going red / isolated
// ---------------------------------------------------------------------------

const TOTAL_ENDPOINTS = 48;
const ALERT_ENDPOINT_IDX = 23;

function FleetMiniGrid({ finished }: { finished: boolean }) {
  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <div className="text-sm font-semibold leading-none tracking-tight flex items-center gap-2">
          <Monitor className="h-4 w-4 text-primary" />
          Fleet
        </div>
        <span className="text-[10px] font-mono text-muted-foreground">
          <span className="text-emerald-500">{TOTAL_ENDPOINTS - 1}</span> healthy
          <span className="mx-1.5 opacity-50">/</span>
          <span className={finished ? "text-amber-500" : "text-red-500"}>1 {finished ? "isolated" : "alerting"}</span>
        </span>
      </div>
      <div className="p-3">
        <div className="grid grid-cols-12 gap-1.5">
          {Array.from({ length: TOTAL_ENDPOINTS }).map((_, i) => {
            const isAlert = i === ALERT_ENDPOINT_IDX;
            const cls = isAlert
              ? (finished
                  ? "bg-amber-500/70 ring-2 ring-amber-400/40"
                  : "bg-red-500/80 ring-2 ring-red-400/40 animate-pulse")
              : "bg-emerald-500/40";
            return <div key={i} className={`h-2.5 w-2.5 rounded-full ${cls} transition-all`} />;
          })}
        </div>
        <div className="mt-3 flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-emerald-500/60" />
            healthy
          </span>
          <span className="inline-flex items-center gap-1">
            <span className={`h-2 w-2 rounded-full ${finished ? "bg-amber-500/70" : "bg-red-500/80"}`} />
            {finished ? "isolated" : "active"}
          </span>
        </div>
      </div>
    </div>
  );
}
