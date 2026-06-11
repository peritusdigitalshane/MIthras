import { Building2, AlertTriangle, CheckCircle2, Activity } from "lucide-react";

/**
 * MSP-focused mock — a list of customer orgs, each with their own posture
 * summary, alert count, AI-handled %, and runaway-revenue tile. Communicates
 * "you manage many customers from one pane" without a real screenshot.
 */

const ORGS: Array<{
  name: string;
  endpoints: number;
  posture: number; // %
  alerts24h: number;
  autoHandled: number; // %
  mrr: string;
  tone: "ok" | "watch" | "act";
}> = [
  { name: "ACME Corp",             endpoints: 142, posture: 96, alerts24h: 47, autoHandled: 84, mrr: "$1,562", tone: "ok"    },
  { name: "Westfield Health",      endpoints:  88, posture: 92, alerts24h: 23, autoHandled: 78, mrr: "$968",   tone: "watch" },
  { name: "Northern Logistics",    endpoints:  64, posture: 99, alerts24h:  8, autoHandled: 92, mrr: "$704",   tone: "ok"    },
  { name: "Sundance Studios",      endpoints:  41, posture: 88, alerts24h: 14, autoHandled: 80, mrr: "$451",   tone: "act"   },
  { name: "Lakeside Realty",       endpoints:  31, posture: 94, alerts24h:  6, autoHandled: 89, mrr: "$341",   tone: "ok"    },
  { name: "Bayside Bookkeeping",   endpoints:  18, posture: 100,alerts24h:  2, autoHandled: 100,mrr: "$198",   tone: "ok"    },
  { name: "Coastal Chartered",     endpoints:  27, posture: 87, alerts24h: 12, autoHandled: 75, mrr: "$297",   tone: "act"   },
  { name: "Pinnacle Plumbing",     endpoints:  12, posture: 95, alerts24h:  3, autoHandled: 100,mrr: "$132",   tone: "ok"    },
];

export function MockMultiTenantConsole() {
  const total = ORGS.reduce((s, o) => s + o.endpoints, 0);
  const alerts = ORGS.reduce((s, o) => s + o.alerts24h, 0);
  const totalMrr = ORGS.reduce((s, o) => s + Number(o.mrr.replace(/[^0-9]/g, "")), 0);

  return (
    <div className="p-4 sm:p-5 space-y-4 text-foreground/95">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            Your customers
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">All customer orgs · single console · scoped per-customer</p>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-[10px] font-mono text-emerald-300">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-75" />
            <span className="relative rounded-full bg-emerald-500 h-1.5 w-1.5" />
          </span>
          AGENTS WATCHING
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Tile label="Customers"     value={ORGS.length.toString()}  />
        <Tile label="Endpoints"     value={total.toString()}          />
        <Tile label="Alerts (24h)"  value={alerts.toString()}         tone="warn" />
        <Tile label="MRR"           value={`$${totalMrr.toLocaleString()}`} tone="ok" />
      </div>

      <div className="rounded-lg border border-border/40 bg-card/30 overflow-hidden">
        <div className="grid grid-cols-12 gap-2 px-3 py-2 border-b border-border/40 bg-card/40 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          <span className="col-span-3">Organisation</span>
          <span className="col-span-1 text-right">Endpoints</span>
          <span className="col-span-2 text-right">Posture</span>
          <span className="col-span-2 text-right">Alerts 24h</span>
          <span className="col-span-2 text-right">AI handled</span>
          <span className="col-span-2 text-right">MRR</span>
        </div>
        <div className="divide-y divide-border/30 text-[11px] font-mono">
          {ORGS.map((o) => (
            <div key={o.name} className="grid grid-cols-12 gap-2 px-3 py-1.5 hover:bg-primary/5 items-center">
              <div className="col-span-3 flex items-center gap-2 truncate">
                <ToneIcon tone={o.tone} />
                <span className="text-foreground/90 truncate">{o.name}</span>
              </div>
              <span className="col-span-1 text-right text-muted-foreground tabular-nums">{o.endpoints}</span>
              <span className="col-span-2 text-right">
                <PostureBar pct={o.posture} />
              </span>
              <span className="col-span-2 text-right tabular-nums">
                <span className={o.alerts24h > 30 ? "text-amber-300" : "text-foreground/80"}>{o.alerts24h}</span>
              </span>
              <span className="col-span-2 text-right tabular-nums text-emerald-300/80">{o.autoHandled}%</span>
              <span className="col-span-2 text-right tabular-nums text-foreground/80">{o.mrr}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, tone = "info" }: { label: string; value: string; tone?: "info" | "ok" | "warn" }) {
  const valCls =
    tone === "ok"   ? "text-emerald-300" :
    tone === "warn" ? "text-amber-300"   :
                      "text-foreground/90";
  return (
    <div className="rounded-lg border border-border/40 bg-card/30 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${valCls}`}>{value}</div>
    </div>
  );
}

function ToneIcon({ tone }: { tone: "ok" | "watch" | "act" }) {
  if (tone === "ok")    return <CheckCircle2 className="h-3 w-3 text-emerald-400 flex-shrink-0" />;
  if (tone === "watch") return <Activity      className="h-3 w-3 text-amber-400 flex-shrink-0" />;
  return                       <AlertTriangle className="h-3 w-3 text-red-400 flex-shrink-0" />;
}

function PostureBar({ pct }: { pct: number }) {
  const cls =
    pct >= 95 ? "bg-emerald-500/70" :
    pct >= 90 ? "bg-amber-500/70"   :
                "bg-red-500/70";
  return (
    <span className="inline-flex items-center gap-1.5 justify-end">
      <span className="w-12 h-1 rounded-full bg-background/60 overflow-hidden">
        <span className={`block h-full rounded-full ${cls}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="text-foreground/80 tabular-nums w-6 text-right">{pct}%</span>
    </span>
  );
}
