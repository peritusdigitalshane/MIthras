import { useEffect, useState } from "react";
import { Globe2, Shield, Cpu, Activity } from "lucide-react";

/**
 * Marketing component for the AI SOC page — a live-looking threat intelligence
 * ticker. Shows what the AI agents are correlating against in real time:
 * MITRE techniques, known-bad IPs, CVEs, campaigns.
 *
 * Looks like a real threat-intel console (think: Recorded Future / VirusTotal
 * panel) but is built in code with synthetic data. Three sections:
 *   1. World feed: timestamped IOC stream
 *   2. Active campaigns: 3 active tracked campaigns with status
 *   3. Top techniques observed (last 24h)
 */

const FEED_ROWS: Array<{ time: string; kind: string; value: string; tone: "high" | "medium" | "info" }> = [
  { time: "00:14", kind: "ip",      value: "198.51.100.42 → wordpress brute (5 sites)", tone: "high"   },
  { time: "00:11", kind: "cve",     value: "CVE-2026-0142 active exploit (PHP 8.1)",    tone: "high"   },
  { time: "00:08", kind: "campaign",value: "Cobalt2025 — 14 new endpoints affected",     tone: "high"   },
  { time: "00:05", kind: "domain",  value: "billing-msft[.]xyz — new phishing kit",     tone: "medium" },
  { time: "00:02", kind: "ip",      value: "203.0.113.89 → m365 OAuth abuse",          tone: "medium" },
  { time: "23:58", kind: "mitre",   value: "T1078.004 — valid cloud accounts (+12%)",  tone: "info"   },
  { time: "23:51", kind: "ip",      value: "192.0.2.221 → ldap brute (Active Directory)", tone: "high" },
  { time: "23:43", kind: "cve",     value: "CVE-2025-9981 patched (WP Yoast SEO)",     tone: "info"   },
  { time: "23:32", kind: "hash",    value: "a4f7c91e... — new variant CleanLoader",    tone: "high"   },
  { time: "23:20", kind: "campaign",value: "BlackBasta — Aussie MSPs targeted",         tone: "high"   },
];

const CAMPAIGNS = [
  { name: "Cobalt2025",   stage: "spread",       affected: 14,  tone: "high"   as const },
  { name: "BlackBasta",   stage: "recon",        affected: 3,   tone: "medium" as const },
  { name: "Lumma Stealer",stage: "active C2",    affected: 0,   tone: "low"    as const },
];

const TECHNIQUES = [
  { id: "T1078.004", label: "Valid cloud accounts",  observed: 142 },
  { id: "T1110.001", label: "Password brute force",  observed: 87  },
  { id: "T1059.001", label: "PowerShell",            observed: 64  },
  { id: "T1505.003", label: "Web shell",             observed: 23  },
  { id: "T1486",     label: "Data encrypted (ransom)", observed: 4   },
];

export function ThreatIntelFeed() {
  const [head, setHead] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setHead((h) => (h + 1) % FEED_ROWS.length), 2400);
    return () => clearInterval(id);
  }, []);

  const visibleFeed = [...Array(7)].map((_, i) => FEED_ROWS[(head + i) % FEED_ROWS.length]);

  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl overflow-hidden shadow-2xl shadow-primary/10">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/40 bg-card/60">
        <div className="flex items-center gap-2">
          <Globe2 className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Live threat intel</span>
          <span className="text-[10px] font-mono text-muted-foreground ml-2">/ ANZ region</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-emerald-300">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-75" />
            <span className="relative rounded-full bg-emerald-500 h-1.5 w-1.5" />
          </span>
          STREAMING
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-0">
        {/* Live feed */}
        <div className="lg:col-span-7 p-4 border-b lg:border-b-0 lg:border-r border-border/40">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Indicator stream</div>
            <div className="text-[10px] font-mono text-muted-foreground">~120/hr ingest</div>
          </div>
          <ul className="space-y-1 text-[11px] font-mono">
            {visibleFeed.map((r, i) => (
              <li
                key={`${head}-${i}`}
                className="flex items-center gap-2 py-1 border-b border-border/20 last:border-b-0"
                style={{ opacity: 1 - i * 0.10 }}
              >
                <span className="text-muted-foreground/70 w-10 flex-shrink-0">{r.time}</span>
                <KindChip kind={r.kind} />
                <span className="truncate flex-1 text-foreground/90">{r.value}</span>
                <ToneDot tone={r.tone} />
              </li>
            ))}
          </ul>
        </div>

        {/* Right column */}
        <div className="lg:col-span-5 p-4 space-y-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-2 flex items-center gap-1.5">
              <Activity className="h-3 w-3" /> Active campaigns
            </div>
            <div className="space-y-1.5">
              {CAMPAIGNS.map((c) => (
                <CampaignRow key={c.name} {...c} />
              ))}
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-2 flex items-center gap-1.5">
              <Cpu className="h-3 w-3" /> Top MITRE techniques · 24h
            </div>
            <div className="space-y-1 text-[11px] font-mono">
              {TECHNIQUES.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2 py-0.5">
                  <span className="text-primary/80 w-20 flex-shrink-0">{t.id}</span>
                  <span className="truncate text-foreground/85 flex-1">{t.label}</span>
                  <span className="text-muted-foreground tabular-nums">{t.observed}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 py-2 border-t border-border/40 bg-card/40 text-[10px] font-mono text-muted-foreground flex items-center gap-2">
        <Shield className="h-3 w-3 text-primary/70" />
        <span>
          Mithras agents auto-correlate every alert against this feed before deciding — no IOC review queue, no analyst lag.
        </span>
      </div>
    </div>
  );
}

function KindChip({ kind }: { kind: string }) {
  const cls: Record<string, string> = {
    ip:       "border-red-500/30 text-red-300 bg-red-500/10",
    cve:      "border-amber-500/30 text-amber-300 bg-amber-500/10",
    campaign: "border-fuchsia-500/30 text-fuchsia-300 bg-fuchsia-500/10",
    domain:   "border-sky-500/30 text-sky-300 bg-sky-500/10",
    mitre:    "border-primary/30 text-primary bg-primary/10",
    hash:     "border-emerald-500/30 text-emerald-300 bg-emerald-500/10",
  };
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded border text-[9px] uppercase tracking-wider w-16 text-center flex-shrink-0 ${cls[kind] ?? "border-border/40"}`}>
      {kind}
    </span>
  );
}

function ToneDot({ tone }: { tone: "high" | "medium" | "info" }) {
  const cls =
    tone === "high"   ? "bg-red-500" :
    tone === "medium" ? "bg-amber-500" :
                        "bg-sky-500";
  return <span className={`h-1.5 w-1.5 rounded-full ${cls} flex-shrink-0`} />;
}

function CampaignRow({ name, stage, affected, tone }: {
  name: string; stage: string; affected: number; tone: "high" | "medium" | "low";
}) {
  const accent =
    tone === "high"   ? "border-red-500/30 bg-red-500/5" :
    tone === "medium" ? "border-amber-500/30 bg-amber-500/5" :
                        "border-border/40 bg-card/30";
  const stageCls =
    tone === "high"   ? "text-red-300" :
    tone === "medium" ? "text-amber-300" :
                        "text-muted-foreground";
  return (
    <div className={`flex items-center justify-between gap-2 rounded-md border ${accent} px-2 py-1.5`}>
      <div className="min-w-0">
        <div className="text-[11px] font-mono font-semibold text-foreground/90 truncate">{name}</div>
        <div className={`text-[10px] font-mono ${stageCls}`}>{stage}</div>
      </div>
      <div className="text-right">
        <div className="text-[12px] font-semibold tabular-nums">{affected}</div>
        <div className="text-[9px] uppercase tracking-wider text-muted-foreground">your fleet</div>
      </div>
    </div>
  );
}
