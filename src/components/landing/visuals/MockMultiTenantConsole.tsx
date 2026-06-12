import {
  ShieldCheck, Plus, Building2, Monitor, AlertTriangle, DollarSign,
  ArrowUp, ArrowDown,
} from "lucide-react";

/**
 * Mirror of the real /partner page (PartnerDashboard.tsx) with synthetic data.
 * Structure matches the real layout:
 *   - PortalHero with eyebrow / title / subtitle / status / "Add customer" action
 *   - 4-tile PortalStatCard strip
 *   - "Top customers by endpoint count" table card
 *
 * No real customer names — these are obvious fakes.
 */

const TOP_CUSTOMERS = [
  { name: "ACME Corp",          endpoints: 142, plan: "Pro",      mrr: "$1,562" },
  { name: "Contoso Healthcare",   endpoints:  88, plan: "Pro",      mrr: "$968"   },
  { name: "Northern Logistics", endpoints:  64, plan: "Standard", mrr: "$704"   },
  { name: "Fabrikam Studios",   endpoints:  41, plan: "Pro",      mrr: "$451"   },
  { name: "Lakeside Realty",    endpoints:  31, plan: "Standard", mrr: "$341"   },
  { name: "Coastal Chartered",  endpoints:  27, plan: "Standard", mrr: "$297"   },
  { name: "Bayside Bookkeeping",endpoints:  18, plan: "Standard", mrr: "$198"   },
  { name: "Pinnacle Plumbing",  endpoints:  12, plan: "Lite",     mrr: "$132"   },
];

export function MockMultiTenantConsole() {
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* PortalHero */}
      <div className="relative overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-sm">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 via-transparent to-primary/10 pointer-events-none" />
        <div className="relative p-5 sm:p-6 flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-2 min-w-0">
            <div className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-indigo-400">
              <ShieldCheck className="h-3.5 w-3.5" />
              Partner portal
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Sentinel IT Partners &mdash; Reseller</h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Manage your customers, deploy the Mithras agent, and track wholesale billing in one place.
            </p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-[11px] font-medium text-emerald-500">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Active
            </span>
            <button className="inline-flex items-center gap-1 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium shadow-sm">
              <Plus className="h-4 w-4 mr-1" /> Add customer
            </button>
          </div>
        </div>
      </div>

      {/* 4-tile PortalStatCard strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <PortalStat label="Customers"        value="14" hint="Organisations under your account" icon={<Building2 className="h-4 w-4" />} delta={+8}  />
        <PortalStat label="Active endpoints" value="487" hint="Across all customer orgs"          icon={<Monitor   className="h-4 w-4" />} delta={+12} />
        <PortalStat label="Open alerts (24h)" value="23" hint="119 already auto-resolved"          icon={<AlertTriangle className="h-4 w-4" />} delta={-18} good />
        <PortalStat label="Wholesale MRR"    value="$4,653" hint="At your reseller rate"          icon={<DollarSign className="h-4 w-4" />} delta={+9}  />
      </div>

      {/* Main row — top customers table + credits summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="px-4 py-3 border-b border-border/40">
            <div className="text-base font-semibold leading-none tracking-tight">Top customers by endpoint count</div>
            <p className="text-xs text-muted-foreground mt-1">Your biggest deployments, sorted by active agent count.</p>
          </div>
          <div className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="text-left p-3 font-medium">Customer</th>
                  <th className="text-right p-3 font-medium">Endpoints</th>
                  <th className="text-left p-3 font-medium">Plan</th>
                  <th className="text-right p-3 font-medium">MRR</th>
                </tr>
              </thead>
              <tbody>
                {TOP_CUSTOMERS.map((c) => (
                  <tr key={c.name} className="border-b border-border/40 last:border-b-0 hover:bg-muted/30">
                    <td className="p-3 font-medium">{c.name}</td>
                    <td className="p-3 text-right tabular-nums">{c.endpoints}</td>
                    <td className="p-3 text-xs text-muted-foreground">{c.plan}</td>
                    <td className="p-3 text-right tabular-nums text-foreground/90">{c.mrr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="px-4 py-3 border-b border-border/40">
            <div className="text-base font-semibold leading-none tracking-tight flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-primary" />
              Credit pool
            </div>
          </div>
          <div className="p-4 space-y-4">
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Balance</div>
              <div className="text-3xl font-bold tabular-nums">126</div>
              <div className="text-xs text-muted-foreground">credits · 1 credit = 1 endpoint × 1 month</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1.5">Runway</div>
              <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500" style={{ width: "73%" }} />
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">~3.4 months at current pace</div>
            </div>
            <div className="pt-2 border-t border-border/40">
              <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1.5">This month</div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Consumed</span>
                <span className="font-mono">487 cr</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">From distributor</span>
                <span className="font-mono text-emerald-500">+ 500 cr</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PortalStat — visual match of the real PortalStatCard component
// ---------------------------------------------------------------------------

function PortalStat({
  label, value, hint, icon, delta, good,
}: {
  label: string; value: string; hint: string; icon: React.ReactNode;
  delta: number; good?: boolean;
}) {
  // Default: positive delta = good (more endpoints / MRR / customers).
  // Pass `good` to flip semantics (fewer alerts = good).
  const isGood = good ? delta < 0 : delta > 0;
  const cls = isGood
    ? "text-emerald-500 border-emerald-500/40 bg-emerald-500/10"
    : "text-rose-500 border-rose-500/40 bg-rose-500/10";
  const Icon = delta > 0 ? ArrowUp : ArrowDown;
  return (
    <div className="relative overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/0 via-primary/0 to-primary/5 pointer-events-none" />
      <div className="relative p-5 space-y-3">
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="text-xs uppercase tracking-wider font-medium">{label}</span>
          <span className="opacity-60">{icon}</span>
        </div>
        <div className="flex items-baseline gap-3">
          <div className="text-3xl font-bold tabular-nums tracking-tight">{value}</div>
          <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md border text-xs font-medium tabular-nums ${cls}`}>
            <Icon className="h-3 w-3" />
            {Math.abs(delta)}%
          </span>
        </div>
        <p className="text-xs text-muted-foreground leading-snug">{hint}</p>
      </div>
    </div>
  );
}
