import { useEffect, useState } from "react";
import {
  Brain, ShieldAlert, Bot, FileSearch, Sparkles,
  Activity, Cpu, AlertTriangle, CheckCircle2, Zap,
} from "lucide-react";

/**
 * The hero centrepiece — a live-looking SOC console that runs through a fake
 * alert end-to-end. Three stacked panels:
 *   1. Multi-agent pipeline: alert flows TRIAGE → VERIFY → ADVERSARIAL →
 *      INVESTIGATE → COMMANDER. Each card lights up in turn with reasoning
 *      text + cost + latency.
 *   2. Endpoint grid: 60 dots, one goes red when the demo alert fires,
 *      animates to "isolated" once the pipeline finishes.
 *   3. Alert feed: synthetic alerts scroll in with severity tags.
 *
 * The whole thing loops on a ~22s cycle. Built in pure React + Tailwind so it
 * scales to any DPI and stays in sync with brand colours.
 *
 * Data is intentionally fake — fixed scenario names that map to the actual
 * platform's vocabulary so MSP buyers see something recognisable, but never
 * leaks real customer data.
 */

const PIPELINE_STAGES = [
  {
    id: "triage",
    label: "Triage",
    icon: Brain,
    role: "L1 analyst",
    output: "wp_brute_force on dev6 — high confidence true positive",
    cost: "$0.004",
    latency: "1.8s",
    durationMs: 1800,
  },
  {
    id: "verify",
    label: "Verify",
    icon: ShieldAlert,
    role: "L1 reviewer",
    output: "cross-check: 7 site_event_logs cited — verdict holds",
    cost: "$0.002",
    latency: "1.1s",
    durationMs: 1400,
  },
  {
    id: "adversarial",
    label: "Adversarial",
    icon: Bot,
    role: "Devil's advocate",
    output: "refute attempt: no benign explanation found",
    cost: "$0.002",
    latency: "1.4s",
    durationMs: 1600,
  },
  {
    id: "investigate",
    label: "Investigate",
    icon: FileSearch,
    role: "Forensics",
    output: "12 evidence rows pulled — attacker IP 198.51.100.42 / 4 sites",
    cost: "$0.011",
    latency: "3.2s",
    durationMs: 2400,
  },
  {
    id: "commander",
    label: "Commander",
    icon: Sparkles,
    role: "L2 commander",
    output: "playbook: block IP at firewall, force MFA reset, monitor 24h",
    cost: "$0.008",
    latency: "2.7s",
    durationMs: 2200,
  },
] as const;

const SAMPLE_ALERTS: Array<{ time: string; type: string; sev: "high" | "medium" | "low"; endpoint: string }> = [
  { time: "00:14", type: "wp_brute_force",        sev: "high",   endpoint: "dev6.peritusdigital.com.au" },
  { time: "00:11", type: "microseg_block",        sev: "medium", endpoint: "CMW-FS1"                     },
  { time: "00:08", type: "defender_signature",    sev: "high",   endpoint: "ACME-LAP-04"                 },
  { time: "00:05", type: "ldap_failed_logon×5",     sev: "medium", endpoint: "DC01"                        },
  { time: "00:02", type: "site_audit_critical",   sev: "high",   endpoint: "site_42"                     },
  { time: "23:58", type: "m365_oauth_grant",      sev: "low",    endpoint: "tenant_b"                    },
  { time: "23:51", type: "wp_plugin_activated",   sev: "low",    endpoint: "dev6.peritusdigital.com.au" },
  { time: "23:43", type: "wp_credential_stuffing",sev: "high",   endpoint: "3 sites × 1 IP"                 },
  { time: "23:32", type: "vuln_finding_critical", sev: "high",   endpoint: "CMW-CB1"                     },
];

const TOTAL_CYCLE_MS =
  PIPELINE_STAGES.reduce((sum, s) => sum + s.durationMs, 0) + 4000; // + finale + reset

// ---------------------------------------------------------------------------
// Core animation hook — drives the active stage index off a monotonic timer.
// ---------------------------------------------------------------------------

function useSocCycle() {
  const [activeIdx, setActiveIdx] = useState(0);
  const [finished, setFinished] = useState(false);

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

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SocConsoleHero() {
  const { activeIdx, finished } = useSocCycle();

  return (
    <div className="relative w-full max-w-6xl mx-auto">
      {/* Outer console shell */}
      <div className="relative rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl shadow-2xl shadow-primary/10 overflow-hidden">
        {/* Top chrome bar */}
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border/40 bg-card/60">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
            <span className="ml-3 text-[11px] font-mono text-muted-foreground">mithras-soc — 24/7 live</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-mono text-emerald-400/80">
            <span className="relative flex h-2 w-2">
              <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-75" />
              <span className="relative rounded-full bg-emerald-500 h-2 w-2" />
            </span>
            <span>LIVE</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-0">
          {/* Left column: pipeline + verdict */}
          <div className="lg:col-span-8 p-4 sm:p-6 border-b lg:border-b-0 lg:border-r border-border/40">
            <PipelineHeader activeIdx={activeIdx} finished={finished} />
            <PipelineFlow activeIdx={activeIdx} finished={finished} />
            <ActiveReasoningPanel activeIdx={activeIdx} finished={finished} />
          </div>

          {/* Right column: endpoint grid + alert feed */}
          <div className="lg:col-span-4 p-4 sm:p-6 space-y-4">
            <EndpointGrid finished={finished} />
            <LiveAlertFeed />
          </div>
        </div>
      </div>

      {/* Ambient glow under the console */}
      <div className="absolute -inset-x-6 -bottom-6 h-32 bg-gradient-to-t from-primary/10 to-transparent blur-2xl -z-10" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PipelineHeader({ activeIdx, finished }: { activeIdx: number; finished: boolean }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold">
            Alert <span className="font-mono text-amber-400">#a47c91</span> — wp_brute_force on dev6.peritusdigital.com.au
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground font-mono">
          5 failed logins for &quot;mithras-test&quot; / 3m32s window / src 198.51.100.42
        </div>
      </div>
      <div className={`text-[10px] font-mono px-2 py-1 rounded-md transition-colors ${
        finished
          ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
          : "bg-primary/15 text-primary border border-primary/30"
      }`}>
        {finished ? "RESOLVED · 24s" : `STAGE ${activeIdx + 1}/${PIPELINE_STAGES.length}`}
      </div>
    </div>
  );
}

function PipelineFlow({ activeIdx, finished }: { activeIdx: number; finished: boolean }) {
  return (
    <div className="relative">
      <div className="grid grid-cols-5 gap-2 sm:gap-3 mb-5">
        {PIPELINE_STAGES.map((stage, i) => {
          const state: StageState =
            finished ? "done" :
            i <  activeIdx ? "done" :
            i === activeIdx ? "active" : "pending";
          return <AgentCard key={stage.id} stage={stage} state={state} />;
        })}
      </div>
    </div>
  );
}

type StageState = "pending" | "active" | "done";

function AgentCard({
  stage,
  state,
}: {
  stage: typeof PIPELINE_STAGES[number];
  state: StageState;
}) {
  const Icon = stage.icon;
  const ringClass =
    state === "active" ? "border-primary/70 bg-primary/10 shadow-[0_0_24px_-6px] shadow-primary/40" :
    state === "done"   ? "border-emerald-500/40 bg-emerald-500/5" :
                         "border-border/40 bg-card/40";
  const iconClass =
    state === "active" ? "text-primary" :
    state === "done"   ? "text-emerald-400" :
                         "text-muted-foreground/50";

  return (
    <div className={`relative rounded-lg border ${ringClass} px-2 py-3 text-center transition-all duration-500`}>
      <div className="flex justify-center mb-1.5">
        <div className={`relative flex items-center justify-center h-8 w-8 rounded-md bg-background/40 ${iconClass}`}>
          <Icon className="h-4 w-4" />
          {state === "active" && (
            <span className="absolute inset-0 rounded-md ring-2 ring-primary/60 animate-pulse" />
          )}
          {state === "done" && (
            <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-emerald-500 flex items-center justify-center">
              <CheckCircle2 className="h-2.5 w-2.5 text-background" strokeWidth={3} />
            </span>
          )}
        </div>
      </div>
      <div className="text-[11px] font-semibold leading-tight">{stage.label}</div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">{stage.role}</div>
    </div>
  );
}

function ActiveReasoningPanel({ activeIdx, finished }: { activeIdx: number; finished: boolean }) {
  if (finished) {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
        <div className="flex items-start gap-3">
          <div className="h-8 w-8 rounded-md bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
            <Zap className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-emerald-400 font-semibold mb-1">
              Incident resolved · autonomous response fired
            </div>
            <div className="text-sm leading-relaxed">
              Blocked <span className="font-mono text-emerald-300">198.51.100.42</span> at the perimeter,
              forced MFA reset on <span className="font-mono text-emerald-300">mithras-test</span>,
              opened incident <span className="font-mono text-emerald-300">INC-2418</span> for the customer.
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-mono">
              <Badge tone="ok">5 agents · 24s</Badge>
              <Badge tone="ok">$0.027 total</Badge>
              <Badge tone="ok">12 citations</Badge>
              <Badge tone="ok">customer notified</Badge>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const stage = PIPELINE_STAGES[activeIdx];
  const Icon = stage.icon;
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <div className="h-8 w-8 rounded-md bg-primary/15 flex items-center justify-center flex-shrink-0">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-primary font-semibold mb-1">
            <span>{stage.label} agent thinking</span>
            <ThinkingDots />
          </div>
          <div className="text-sm leading-relaxed text-foreground/90">{stage.output}</div>
          <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-mono">
            <Badge tone="info"><Cpu className="h-2.5 w-2.5" /> gpt-5-mini</Badge>
            <Badge tone="info"><Activity className="h-2.5 w-2.5" /> {stage.latency}</Badge>
            <Badge tone="info">{stage.cost}</Badge>
          </div>
        </div>
      </div>
    </div>
  );
}

function ThinkingDots() {
  return (
    <span className="inline-flex gap-0.5">
      <span className="h-1 w-1 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
      <span className="h-1 w-1 rounded-full bg-primary animate-bounce [animation-delay:120ms]" />
      <span className="h-1 w-1 rounded-full bg-primary animate-bounce [animation-delay:240ms]" />
    </span>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "info" | "ok" }) {
  const cls = tone === "ok"
    ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
    : "bg-primary/10 text-primary border-primary/30";
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${cls}`}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Endpoint grid — 60 dots, one lights up when the demo alert fires.
// ---------------------------------------------------------------------------

const TOTAL_ENDPOINTS = 60;
const ALERT_ENDPOINT_IDX = 23;

function EndpointGrid({ finished }: { finished: boolean }) {
  return (
    <div className="rounded-lg border border-border/40 bg-card/40 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Fleet</div>
        <div className="text-[10px] font-mono text-muted-foreground">
          <span className="text-emerald-400">{TOTAL_ENDPOINTS - 1}</span> healthy
          <span className="mx-1.5 opacity-50">/</span>
          <span className={finished ? "text-emerald-400" : "text-red-400"}>1 {finished ? "isolated" : "alerting"}</span>
        </div>
      </div>
      <div className="grid grid-cols-12 gap-1.5">
        {Array.from({ length: TOTAL_ENDPOINTS }).map((_, i) => {
          const isAlert = i === ALERT_ENDPOINT_IDX;
          const cls = isAlert
            ? (finished
                ? "bg-amber-500/60 ring-2 ring-amber-400/40"
                : "bg-red-500/80 ring-2 ring-red-400/40 animate-pulse")
            : "bg-emerald-500/40";
          return <div key={i} className={`h-2.5 w-2.5 rounded-full ${cls} transition-all`} />;
        })}
      </div>
      <div className="mt-3 flex items-center gap-3 text-[10px] text-muted-foreground">
        <Legend dot="bg-emerald-500/60" label="healthy" />
        <Legend dot={finished ? "bg-amber-500/60" : "bg-red-500/80"} label={finished ? "isolated" : "active"} />
      </div>
    </div>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Live alert feed — scrolls a fixed list with a new entry every ~3s.
// ---------------------------------------------------------------------------

function LiveAlertFeed() {
  const [head, setHead] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setHead((h) => (h + 1) % SAMPLE_ALERTS.length), 2800);
    return () => clearInterval(id);
  }, []);

  const visible = [...Array(5)].map((_, i) => SAMPLE_ALERTS[(head + i) % SAMPLE_ALERTS.length]);

  return (
    <div className="rounded-lg border border-border/40 bg-card/40 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Alert feed</div>
        <div className="text-[10px] font-mono text-muted-foreground">last 24h</div>
      </div>
      <ul className="space-y-1.5">
        {visible.map((a, i) => (
          <li
            key={`${head}-${i}`}
            className="flex items-center gap-2 text-[11px] font-mono py-0.5"
            style={{ opacity: 1 - i * 0.18 }}
          >
            <span className="text-muted-foreground/80 w-10 flex-shrink-0">{a.time}</span>
            <SeverityDot sev={a.sev} />
            <span className="truncate flex-1 text-foreground/90">{a.type}</span>
            <span className="text-muted-foreground/60 text-[10px] truncate max-w-[7rem]">{a.endpoint}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SeverityDot({ sev }: { sev: "high" | "medium" | "low" }) {
  const cls =
    sev === "high"   ? "bg-red-500" :
    sev === "medium" ? "bg-amber-500" :
                       "bg-sky-500";
  return <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${cls}`} />;
}
