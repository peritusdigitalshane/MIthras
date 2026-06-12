import { useEffect, useRef, useState } from "react";
import {
  Activity, Bell, Brain, Bot, AlertTriangle, Monitor, Cloud, Lock,
  ShieldCheck, Sword, Sparkles, FileSearch, Cpu, Zap, ExternalLink,
  CheckCircle2, Database, Network, Ban, MailCheck, Eye, RotateCcw,
} from "lucide-react";

/**
 * Marketing hero centrepiece — the showpiece animation. Wraps the real
 * /soc page chrome (header + KPI strip) around a cinematic "Live
 * investigation" panel that walks a single alert through the multi-agent
 * pipeline in real time:
 *
 *   1. Alert capture banner slides in (red, with the source data)
 *   2. Agent ribbon — 5 circular agent avatars connected by a flow line.
 *      A "particle" travels between avatars as the alert hands off.
 *   3. Active agent's reasoning streams in via typewriter effect.
 *      Citation chips materialise as the reasoning text references them.
 *   4. Refutation rows show counter-arguments being knocked down one by one.
 *   5. Finale — playbook checklist builds up tick-by-tick as the Commander
 *      dispatches actions, then a big "RESOLVED" stamp.
 *
 * All synthetic data, no real customer references — runs on a ~25s loop.
 */

const SEVERITY_DOT: Record<string, string> = {
  critical: "bg-red-500",
  high:     "bg-orange-500",
  medium:   "bg-amber-500",
  low:      "bg-blue-500",
};

// ---------------------------------------------------------------------------
// Pipeline definition — each stage has a typewriter body, refutations or
// findings, citations that appear at character offsets, and a verdict
// stamp at the end.
// ---------------------------------------------------------------------------

interface StageDef {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  role: string;
  model: string;
  body: string;             // the typewriter text
  citations: string[];      // chip labels that fade in alongside the body
  verdict: string;
  confidence: number;
  cost: string;
  latency: string;
  durationMs: number;       // typewriter duration (ms)
  holdMs: number;           // pause after typewriter finishes
  /** Optional inline list to render below body — refutations / findings. */
  bulletKind?: "refute" | "find" | "playbook";
  bullets?: Array<{ label: string; meta?: string; ok?: boolean }>;
}

const STAGES: StageDef[] = [
  {
    id: "triage",
    label: "Triage",
    icon: Brain,
    role: "Initial classification",
    model: "gpt-5-mini",
    body:
      "Pattern: 5 failed logons in 3m32s window from a single source IP. " +
      "Cross-referencing tenant allow-list… 198.51.100.42 is not registered. " +
      "Behavioural match against rule wp_brute_force_v3 → 0.94 confidence. " +
      "No legitimate user behaviour matches this pattern. Verdict: true_positive.",
    citations: ["site_event_logs ×5", "agent_secrets ×1"],
    verdict: "true_positive",
    confidence: 0.94,
    cost: "$0.004",
    latency: "1.8s",
    durationMs: 4200,
    holdMs: 600,
  },
  {
    id: "verify",
    label: "Verify",
    icon: ShieldCheck,
    role: "Independent re-classification",
    model: "claude-sonnet-4-6",
    body:
      "Independent re-run with a different model. Pulling 7 supporting rows from " +
      "site_event_logs… all share actor_ip 198.51.100.42 and actor_user_login " +
      "webadmin. Pattern consistent with the wp_brute_force playbook. " +
      "Agrees with Triage. No new doubts surfaced.",
    citations: ["site_event_logs ×7", "wp_brute_force_v3"],
    verdict: "agrees",
    confidence: 0.88,
    cost: "$0.002",
    latency: "1.1s",
    durationMs: 3600,
    holdMs: 500,
  },
  {
    id: "adversarial",
    label: "Adversarial",
    icon: Sword,
    role: "Refutation attempt",
    model: "gpt-5-mini",
    body:
      "Steel-manning the opposite verdict. Generating benign explanations and " +
      "testing each against the available evidence:",
    citations: [],
    verdict: "not_refuted",
    confidence: 0.91,
    cost: "$0.002",
    latency: "1.4s",
    durationMs: 1800,
    holdMs: 2400,
    bulletKind: "refute",
    bullets: [
      { label: "Forgot password — would match m365_sign_in_events for a reset",                 meta: "0 events", ok: false },
      { label: "Browser autofill flood — would show agent_commands push within window",        meta: "0 events", ok: false },
      { label: "Scheduled security audit — would map to change_tickets in the window",         meta: "0 tickets", ok: false },
    ],
  },
  {
    id: "investigate",
    label: "Investigate",
    icon: FileSearch,
    role: "Cross-tenant forensics",
    model: "claude-sonnet-4-6",
    body:
      "Hunting laterally. Searching for the source IP across all tenant sites " +
      "in the last 24h:",
    citations: ["site_event_logs ×12", "endpoint_event_logs ×4"],
    verdict: "campaign",
    confidence: 0.92,
    cost: "$0.011",
    latency: "3.2s",
    durationMs: 2100,
    holdMs: 2400,
    bulletKind: "find",
    bullets: [
      { label: "blog.acme-corp.example",        meta: "5 fails · webadmin",  ok: true },
      { label: "store.fabrikam-studios.example", meta: "9 fails · admin",     ok: true },
      { label: "intranet.contoso.example",      meta: "4 fails · admin",     ok: true },
      { label: "portal.adatum.example",         meta: "3 fails · webmaster", ok: true },
    ],
  },
  {
    id: "commander",
    label: "Commander",
    icon: Sparkles,
    role: "Playbook + response",
    model: "gpt-5-mini",
    body:
      "Drafting response playbook. Selecting bounded actions allowed under the " +
      "ACME response policy. Issuing commands and arming the customer-confirm " +
      "rollback timer:",
    citations: [],
    verdict: "auto-fired",
    confidence: 0.95,
    cost: "$0.008",
    latency: "2.7s",
    durationMs: 1800,
    holdMs: 3800,
    bulletKind: "playbook",
    bullets: [
      { label: "Block 198.51.100.42 at perimeter",       meta: "03:14:14", ok: true },
      { label: "Force MFA reset for webadmin",           meta: "03:14:18", ok: true },
      { label: "Open INC-2418 for ACME",                  meta: "03:14:21", ok: true },
      { label: "Watch blog.acme-corp.example for 24h",    meta: "armed",    ok: true },
      { label: "Auto-rollback if no customer confirm 4h", meta: "armed",    ok: true },
    ],
  },
];

const LIVE_ALERTS: Array<{ severity: "critical" | "high" | "medium" | "low"; title: string; message: string; endpoint: string; alertType: string; age: string }> = [
  { severity: "high",     title: "WordPress brute force on acme blog", message: "5 failed logins for webadmin from 198.51.100.42",      endpoint: "blog.acme-corp.example", alertType: "wp_brute_force",       age: "2m ago" },
  { severity: "critical", title: "Defender: Wacatac",                message: "Real-time protection blocked Trojan:Win32/Wacatac.B!ml",    endpoint: "CH-04",                  alertType: "defender_signature",   age: "5m ago" },
  { severity: "medium",   title: "Microseg block — outbound SMB",    message: "TCP/445 from NL-FS1 denied by rule pol_smb_lock",          endpoint: "NL-FS1",                 alertType: "microseg_block",       age: "9m ago" },
  { severity: "medium",   title: "12 failed LDAP logons",            message: "Account svc-backup failed bind 12× in 4m",                 endpoint: "DC01",                   alertType: "ldap_failed_logon",    age: "14m ago" },
  { severity: "low",      title: "M365 OAuth grant",                 message: "Tenant consent to ContactSync (Mail.ReadWrite)",           endpoint: "tenant_b",               alertType: "m365_oauth_grant",     age: "22m ago" },
];

// ---------------------------------------------------------------------------
// Cycle hook — drives stage progression. Also exposes per-stage progress so
// the typewriter inside each stage can advance smoothly.
// ---------------------------------------------------------------------------

type CyclePhase = "running" | "finale" | "resetting";

interface CycleState {
  stageIdx: number;
  phase: CyclePhase;
  /** ms since stage entered "running" state — used for typewriter. */
  tStage: number;
}

function useInvestigationCycle(): CycleState {
  const [state, setState] = useState<CycleState>({ stageIdx: 0, phase: "running", tStage: 0 });
  const startedAt = useRef(Date.now());

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      while (!cancelled) {
        for (let i = 0; i < STAGES.length; i++) {
          startedAt.current = Date.now();
          setState({ stageIdx: i, phase: "running", tStage: 0 });
          const total = STAGES[i].durationMs + STAGES[i].holdMs;
          await delay(total);
          if (cancelled) return;
        }
        setState((s) => ({ ...s, phase: "finale" }));
        await delay(4200);
        if (cancelled) return;
        setState({ stageIdx: 0, phase: "resetting", tStage: 0 });
        await delay(600);
      }
    };
    run();
    return () => { cancelled = true; };
  }, []);

  // Per-stage time tick for typewriter — 60Hz-ish.
  const [tStage, setT] = useState(0);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setT(Date.now() - startedAt.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state.stageIdx, state.phase]);

  return { ...state, tStage };
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SocConsoleHero() {
  const cycle = useInvestigationCycle();

  return (
    <div className="relative w-full max-w-6xl mx-auto">
      <div className="relative rounded-2xl border bg-card text-card-foreground shadow-2xl shadow-primary/10 overflow-hidden">
        <BrowserChrome url="console.mithras.com.au/soc" />
        <div className="p-4 sm:p-6 space-y-5">
          <SocHeader />
          <KpiStrip cycle={cycle} />
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-8">
              <InvestigationTheatre cycle={cycle} />
            </div>
            <div className="lg:col-span-4 space-y-4">
              <LiveAlertsCard />
              <FleetMiniGrid finished={cycle.phase === "finale"} />
            </div>
          </div>
        </div>
      </div>
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
// SOC header — matches SocConsole.tsx
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
// KPI strip — ticks up as the demo runs
// ---------------------------------------------------------------------------

function KpiStrip({ cycle }: { cycle: CycleState }) {
  const triagesTick = 142 + cycle.stageIdx + (cycle.phase === "finale" ? 1 : 0);
  const investTick  = 47  + (cycle.stageIdx >= 3 ? 1 : 0) + (cycle.phase === "finale" ? 1 : 0);
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
      <div className={`text-xl font-bold tabular-nums ${accentClass} transition-all`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

// ===========================================================================
// INVESTIGATION THEATRE — the showpiece
// ===========================================================================

function InvestigationTheatre({ cycle }: { cycle: CycleState }) {
  const finale = cycle.phase === "finale";
  return (
    <div className="rounded-lg border border-primary/30 bg-card text-card-foreground shadow-sm overflow-hidden">
      {/* Alert header banner — pulses red, sets the stage */}
      <AlertBanner finale={finale} />

      {/* Agent ribbon — circles connected by a flow line, with a particle */}
      <div className="p-4 sm:p-5 border-b border-border/40">
        <AgentRibbon cycle={cycle} />
      </div>

      {/* Main panel — switches between live reasoning and the finale */}
      <div className="p-4 sm:p-5 min-h-[280px]">
        {finale ? <FinaleResolution /> : <LiveReasoning cycle={cycle} />}
      </div>
    </div>
  );
}

function AlertBanner({ finale }: { finale: boolean }) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 border-b border-border/40 transition-colors ${
      finale
        ? "bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-transparent"
        : "bg-gradient-to-r from-red-500/10 via-red-500/5 to-transparent"
    }`}>
      <div className={`h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0 ${
        finale ? "bg-emerald-500/15" : "bg-red-500/15"
      }`}>
        {finale
          ? <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          : <AlertTriangle className="h-5 w-5 text-red-500 animate-pulse" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap text-[10px] uppercase tracking-wider">
          <span className={finale ? "text-emerald-500 font-semibold" : "text-red-500 font-semibold"}>
            {finale ? "Alert resolved" : "Alert captured"}
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground font-mono">#a47c91</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground font-mono">wp_brute_force</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground font-mono">03:14:02 UTC</span>
        </div>
        <div className="text-sm font-medium mt-0.5">
          <span className="font-mono text-foreground/90">blog.acme-corp.example</span>
          <span className="text-muted-foreground"> · 5 failed logins for </span>
          <span className="font-mono text-foreground/90">webadmin</span>
          <span className="text-muted-foreground"> from </span>
          <span className="font-mono text-foreground/90">198.51.100.42</span>
        </div>
      </div>
      <div className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded border font-mono font-medium flex-shrink-0 ${
        finale
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
          : "border-amber-500/40 bg-amber-500/10 text-amber-500"
      }`}>
        {finale ? "RESOLVED · 24s" : "INVESTIGATING"}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent ribbon — 5 avatars on a flow line with a travelling particle
// ---------------------------------------------------------------------------

function AgentRibbon({ cycle }: { cycle: CycleState }) {
  const isFinale = cycle.phase === "finale";
  return (
    <div className="relative">
      {/* connecting line */}
      <div className="absolute top-5 left-[10%] right-[10%] h-px bg-border/60" />
      {/* travelling pulse */}
      {!isFinale && <TravellingPulse stageIdx={cycle.stageIdx} />}

      <div className="relative grid grid-cols-5 gap-2">
        {STAGES.map((stage, i) => {
          const state: AgentState =
            isFinale ? "done" : i < cycle.stageIdx ? "done" : i === cycle.stageIdx ? "active" : "pending";
          return <AgentAvatar key={stage.id} stage={stage} state={state} />;
        })}
      </div>
    </div>
  );
}

type AgentState = "pending" | "active" | "done";

function AgentAvatar({ stage, state }: { stage: StageDef; state: AgentState }) {
  const Icon = stage.icon;
  const ringCls =
    state === "active" ? "border-primary bg-primary/15 shadow-[0_0_40px_-8px] shadow-primary/60" :
    state === "done"   ? "border-emerald-500/60 bg-emerald-500/10" :
                         "border-border/40 bg-muted/20";
  const iconCls =
    state === "active" ? "text-primary"     :
    state === "done"   ? "text-emerald-500" :
                         "text-muted-foreground/50";
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className={`relative h-10 w-10 rounded-full border-2 ${ringCls} flex items-center justify-center transition-all duration-500`}>
        <Icon className={`h-4 w-4 ${iconCls}`} />
        {state === "active" && (
          <span className="absolute -inset-1 rounded-full border-2 border-primary/40 animate-ping" />
        )}
        {state === "done" && (
          <span className="absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full bg-emerald-500 flex items-center justify-center">
            <CheckCircle2 className="h-2.5 w-2.5 text-background" strokeWidth={3} />
          </span>
        )}
      </div>
      <div className={`text-[10px] font-semibold leading-none text-center ${
        state === "pending" ? "text-muted-foreground/60" : ""
      }`}>
        {stage.label}
      </div>
    </div>
  );
}

/**
 * Light particle that travels from the previous agent avatar to the current
 * one as the alert "hands off". Renders as an absolutely-positioned dot that
 * uses a CSS `key` change to retrigger the animation on stage change.
 */
function TravellingPulse({ stageIdx }: { stageIdx: number }) {
  if (stageIdx === 0) return null;
  // Each avatar is centered at (i + 0.5) / 5 of the row width.
  const fromPct = ((stageIdx - 1) + 0.5) * 20;
  const toPct   = (stageIdx     + 0.5) * 20;
  return (
    <div
      key={stageIdx}
      className="absolute top-[18px] h-2 w-2 rounded-full bg-primary shadow-[0_0_12px] shadow-primary"
      style={{
        left: `${fromPct}%`,
        animation: "soc-pulse-travel 700ms ease-out forwards",
        ["--to" as string]: `${toPct - fromPct}%`,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Live reasoning — typewriter body + citations chips + verdict stamp
// ---------------------------------------------------------------------------

function LiveReasoning({ cycle }: { cycle: CycleState }) {
  const stage = STAGES[cycle.stageIdx];
  const Icon = stage.icon;

  // Typewriter — reveal `visibleChars` of stage.body.
  const ratio = Math.min(1, cycle.tStage / stage.durationMs);
  const visibleChars = Math.floor(ratio * stage.body.length);
  const visibleBody  = stage.body.slice(0, visibleChars);
  const typing = visibleChars < stage.body.length;

  // Citations fade in once the body is ~30% through.
  const citationStart = stage.durationMs * 0.3;
  const citationsVisible = Math.max(0, Math.min(
    stage.citations.length,
    Math.floor((cycle.tStage - citationStart) / Math.max(1, (stage.durationMs - citationStart) / Math.max(1, stage.citations.length))),
  ));

  // Bullets reveal AFTER body is fully typed.
  const bulletsStart = stage.durationMs;
  const bulletsEnd   = stage.durationMs + stage.holdMs * 0.7;
  const bullets = stage.bullets ?? [];
  const bulletsVisible = bullets.length
    ? Math.max(0, Math.min(
        bullets.length,
        Math.floor(((cycle.tStage - bulletsStart) / Math.max(1, (bulletsEnd - bulletsStart) / bullets.length))),
      ))
    : 0;

  // Verdict stamp appears once everything else has rendered.
  const verdictShown =
    cycle.tStage > stage.durationMs + (bullets.length ? stage.holdMs * 0.4 : 0);

  return (
    <div className="space-y-3">
      {/* Header: which agent + model */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-[12px]">
          <Icon className="h-4 w-4 text-primary" />
          <span className="font-semibold">{stage.label} agent</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{stage.role}</span>
          {typing && (
            <span className="inline-flex gap-0.5 ml-1">
              <span className="h-1 w-1 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
              <span className="h-1 w-1 rounded-full bg-primary animate-bounce [animation-delay:120ms]" />
              <span className="h-1 w-1 rounded-full bg-primary animate-bounce [animation-delay:240ms]" />
            </span>
          )}
        </div>
        <span className="text-[10px] font-mono text-muted-foreground">{stage.model}</span>
      </div>

      {/* Typewriter body */}
      <div className="rounded-lg border border-border/40 bg-muted/20 p-3.5">
        <p className="text-[12px] leading-relaxed font-mono text-foreground/85 min-h-[3.5em] whitespace-pre-wrap">
          {visibleBody}
          {typing && <span className="inline-block w-1.5 h-3.5 bg-primary/80 align-text-bottom animate-pulse ml-0.5" />}
        </p>

        {/* Citations chips */}
        {stage.citations.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {stage.citations.slice(0, citationsVisible).map((c, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-primary/40 bg-primary/10 text-primary text-[10px] font-mono animate-[soc-chip-in_300ms_ease-out]"
              >
                <Database className="h-2.5 w-2.5" />
                {c}
              </span>
            ))}
          </div>
        )}

        {/* Bullets (refutations / findings / playbook) */}
        {bullets.length > 0 && bulletsVisible > 0 && stage.bulletKind && (
          <div className="mt-3 space-y-1">
            {bullets.slice(0, bulletsVisible).map((b, i) => (
              <BulletRow key={i} bullet={b} kind={stage.bulletKind!} />
            ))}
          </div>
        )}
      </div>

      {/* Footer — verdict stamp + cost/latency meta */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Cpu className="h-2.5 w-2.5" />latency {stage.latency}</span>
          <span>{stage.cost}</span>
          <span className="inline-flex items-center gap-1">
            <ExternalLink className="h-2.5 w-2.5" />{stage.citations.length} citations
          </span>
        </div>
        {verdictShown && (
          <div className="inline-flex items-center gap-1.5 animate-[soc-stamp-in_400ms_cubic-bezier(0.34,1.56,0.64,1)]">
            <VerdictPill verdict={stage.verdict} />
            <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
              {Math.round(stage.confidence * 100)}% conf
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function BulletRow({ bullet, kind }: { bullet: { label: string; meta?: string; ok?: boolean }; kind: "refute" | "find" | "playbook" }) {
  const icon =
    kind === "refute"   ? <Ban         className="h-3 w-3 text-red-500" /> :
    kind === "find"     ? <Network     className="h-3 w-3 text-amber-500" /> :
                          <CheckCircle2 className="h-3 w-3 text-emerald-500" />;
  return (
    <div className="flex items-center gap-2 text-[11px] font-mono py-1 px-2 rounded bg-background/50 animate-[soc-row-in_300ms_ease-out]">
      <span className="flex-shrink-0">{icon}</span>
      <span className="flex-1 min-w-0 truncate text-foreground/90">{bullet.label}</span>
      {bullet.meta && (
        <span className={`text-[10px] ${
          kind === "refute"  ? "text-red-500" :
          kind === "find"    ? "text-amber-500" :
                               "text-emerald-500"
        }`}>
          {bullet.meta}
        </span>
      )}
    </div>
  );
}

function VerdictPill({ verdict }: { verdict: string }) {
  const cls =
    verdict === "true_positive"  ? "border-rose-500/50 text-rose-600 dark:text-rose-400 bg-rose-500/10" :
    verdict === "false_positive" ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" :
    verdict === "needs_human"    ? "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10" :
    verdict === "not_refuted"    ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" :
    verdict === "agrees"         ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" :
    verdict === "campaign"       ? "border-rose-500/50 text-rose-600 dark:text-rose-400 bg-rose-500/10" :
    verdict === "auto-fired"     ? "border-primary/50 text-primary bg-primary/10" :
                                   "border-border";
  return (
    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border font-bold ${cls}`}>
      {verdict.replace(/_/g, " ")}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Finale — big resolution stamp + playbook recap + cost line
// ---------------------------------------------------------------------------

function FinaleResolution() {
  const playbook = STAGES[STAGES.length - 1].bullets ?? [];
  return (
    <div className="space-y-4 animate-[soc-fade-in_500ms_ease-out]">
      <div className="rounded-lg border border-emerald-500/40 bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent p-4">
        <div className="flex items-start gap-3 mb-3">
          <div className="h-10 w-10 rounded-full bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
            <Zap className="h-5 w-5 text-emerald-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-emerald-500 font-bold">
              Incident contained · INC-2418 opened · ACME notified
            </div>
            <p className="text-sm leading-relaxed mt-0.5">
              Blocked attacker IP at the perimeter, forced MFA reset on the affected
              account, and notified the customer admin with the full evidence trail.
              All 5 agents agreed; no human intervention required.
            </p>
          </div>
        </div>

        {/* Playbook checklist */}
        <div className="rounded-md bg-background/50 border border-emerald-500/20 p-3 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-emerald-500 font-semibold mb-1">
            Playbook · 5 of 5 dispatched
          </div>
          {playbook.map((p, i) => (
            <div key={i} className="flex items-center gap-2 text-[12px]">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
              <span className="flex-1 truncate">{p.label}</span>
              <span className="text-[10px] font-mono text-muted-foreground">{p.meta}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Final cost / time / coverage strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <FinalStat icon={<Sparkles className="h-3.5 w-3.5" />} label="Agents" value="5" />
        <FinalStat icon={<Cpu      className="h-3.5 w-3.5" />} label="Time"   value="24s" />
        <FinalStat icon={<Eye      className="h-3.5 w-3.5" />} label="Cited"  value="12 rows" />
        <FinalStat icon={<MailCheck className="h-3.5 w-3.5" />} label="Cost"  value="$0.027" />
      </div>

      <div className="text-[11px] text-muted-foreground flex items-center gap-2">
        <RotateCcw className="h-3 w-3" />
        Auto-rollback armed: undoes the perimeter block in 4h if the customer doesn&apos;t confirm.
      </div>
    </div>
  );
}

function FinalStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-emerald-500 mb-0.5">
        {icon}
        {label}
      </div>
      <div className="text-base font-bold tabular-nums">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live alerts card — small product-styled list
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
// Fleet mini-grid
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
      </div>
    </div>
  );
}
