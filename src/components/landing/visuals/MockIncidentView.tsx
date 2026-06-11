import { Bot, ExternalLink, Sparkles, Shield, Clock, Cpu, Brain, FileSearch } from "lucide-react";

/**
 * Mock /soc/incidents/:id detail page. Two columns: timeline of agent activity
 * on the left, evidence + playbook on the right. Same vocabulary as the real
 * ai_incident_commander + ai_investigations output.
 */
export function MockIncidentView() {
  return (
    <div className="p-4 sm:p-5 text-foreground/95 space-y-4">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground mb-1">
          <span>INC-2418</span>
          <span className="opacity-50">·</span>
          <span>ACME Corp</span>
          <span className="opacity-50">·</span>
          <span>opened 24s ago</span>
        </div>
        <h3 className="text-base font-semibold flex items-center gap-2">
          <Shield className="h-4 w-4 text-red-400" />
          Active brute-force attempt on dev6.peritusdigital.com.au
        </h3>
        <div className="flex items-center gap-2 mt-2">
          <span className="px-2 py-0.5 rounded border border-red-500/30 bg-red-500/10 text-[10px] uppercase tracking-wider text-red-300 font-mono">HIGH</span>
          <span className="px-2 py-0.5 rounded border border-primary/30 bg-primary/10 text-[10px] uppercase tracking-wider text-primary font-mono">AUTO-CONTAINED</span>
          <span className="px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-[10px] uppercase tracking-wider text-emerald-300 font-mono">CUSTOMER NOTIFIED</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Timeline */}
        <div className="lg:col-span-7 space-y-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Agent timeline</div>
          <TimelineRow
            agent="Triage"
            icon={Brain}
            elapsed="+0.0s"
            verdict="TP · 0.94"
            body="5 failed logins for &quot;mithras-test&quot; within 3m32s; source IP not in allow-list. Verdict: true_positive."
            cost="$0.004"
            citations={4}
          />
          <TimelineRow
            agent="Verify"
            icon={Shield}
            elapsed="+2.1s"
            verdict="agrees"
            body="Cross-checked against site_event_logs (7 cites). Pattern matches wordpress_brute_force playbook."
            cost="$0.002"
            citations={7}
          />
          <TimelineRow
            agent="Adversarial"
            icon={Bot}
            elapsed="+3.6s"
            verdict="cannot refute"
            body="Tried 3 benign explanations (forgot password, password manager autofill, security audit). None match the IP behaviour profile."
            cost="$0.002"
            citations={2}
          />
          <TimelineRow
            agent="Investigate"
            icon={FileSearch}
            elapsed="+5.4s"
            verdict="campaign"
            body="Same source IP (198.51.100.42) hit 4 other tenant sites in the last 24h. Coordinated credential stuffing campaign."
            cost="$0.011"
            citations={12}
          />
          <TimelineRow
            agent="Commander"
            icon={Sparkles}
            elapsed="+8.7s"
            verdict="auto-fired"
            body="Block 198.51.100.42 at perimeter, force MFA reset for mithras-test, watch dev6 for 24h, notify ACME admin."
            cost="$0.008"
            citations={5}
            tone="ok"
          />
        </div>

        {/* Right column: evidence + playbook */}
        <div className="lg:col-span-5 space-y-3">
          <PlaybookCard />
          <EvidenceCard />
        </div>
      </div>
    </div>
  );
}

function TimelineRow({
  agent, icon: Icon, elapsed, verdict, body, cost, citations, tone = "info",
}: {
  agent: string;
  icon: React.ComponentType<{ className?: string }>;
  elapsed: string; verdict: string; body: string; cost: string; citations: number;
  tone?: "info" | "ok";
}) {
  const accent =
    tone === "ok" ? "border-emerald-500/40 bg-emerald-500/5"
                  : "border-border/40 bg-card/40";
  const iconCls =
    tone === "ok" ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-primary/15 text-primary";
  return (
    <div className={`relative rounded-lg border ${accent} p-3`}>
      <div className="flex items-start gap-3">
        <div className={`h-7 w-7 rounded-md ${iconCls} flex items-center justify-center flex-shrink-0`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-2 text-[12px] font-semibold">
              <span>{agent}</span>
              <span className="text-[10px] font-mono text-muted-foreground">{elapsed}</span>
            </div>
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
              tone === "ok"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-primary/30 bg-primary/10 text-primary"
            }`}>
              {verdict}
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-foreground/85">{body}</p>
          <div className="mt-1.5 flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Cpu className="h-2.5 w-2.5" />gpt-5-mini</span>
            <span>{cost}</span>
            <span className="inline-flex items-center gap-1">
              <ExternalLink className="h-2.5 w-2.5" />{citations} citations
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlaybookCard() {
  const steps = [
    { label: "block IP at perimeter", done: true,  meta: "agent-issued" },
    { label: "force MFA reset",       done: true,  meta: "Microsoft Graph" },
    { label: "open ACME ticket",      done: true,  meta: "INC-2418" },
    { label: "monitor for 24h",       done: false, meta: "next check 01:14" },
    { label: "auto-rollback @ 04:14", done: false, meta: "if no confirm" },
  ];
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] uppercase tracking-wider text-primary font-semibold">Playbook · 5 steps</div>
        <span className="inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
          <Clock className="h-2.5 w-2.5" />2 of 5 pending
        </span>
      </div>
      <ul className="space-y-1.5 text-[11px]">
        {steps.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className={`h-3 w-3 rounded-full flex items-center justify-center flex-shrink-0 ${
              s.done ? "bg-emerald-500/30 text-emerald-300" : "border border-border/60 text-muted-foreground"
            }`}>
              {s.done ? "✓" : ""}
            </span>
            <span className={s.done ? "text-foreground/90" : "text-foreground/70"}>{s.label}</span>
            <span className="text-[10px] font-mono text-muted-foreground ml-auto">{s.meta}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EvidenceCard() {
  const evidence = [
    { kind: "site_event_logs",       count: 7  },
    { kind: "endpoint_event_logs",   count: 4  },
    { kind: "firewall_audit_logs",   count: 12 },
    { kind: "m365_sign_in_events",   count: 0  },
    { kind: "sysmon_events",         count: 6  },
  ];
  return (
    <div className="rounded-lg border border-border/40 bg-card/30 p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Evidence cited</div>
      <ul className="space-y-1 text-[11px] font-mono">
        {evidence.map((e) => (
          <li key={e.kind} className="flex items-center justify-between">
            <span className="text-foreground/85">{e.kind}</span>
            <span className={e.count > 0 ? "text-emerald-300/80" : "text-muted-foreground/60"}>
              {e.count > 0 ? `${e.count} rows` : "—"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
