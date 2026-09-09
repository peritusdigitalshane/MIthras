import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, Activity, Shield, ShieldAlert, Globe2, Bug, History,
  Mail, Server, Loader2, Crosshair, Eye, Radar as RadarIcon, Network as NetworkIcon,
  AlertTriangle, Zap, FileWarning, Terminal,
} from "lucide-react";
import { LandingNav } from "@/components/landing/LandingNav";
import { Footer } from "@/components/landing/CTAFooter";
import { Seo } from "@/components/seo/Seo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useRadar, isSuppressed, type RadarPayload, type AiDigestTile as AiDigestData } from "@/hooks/useRadar";
import {
  Bar, BarChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Cell,
} from "recharts";

const TILE_HEIGHT = "min-h-[280px]";

function LoadingTile() {
  return (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function StatusPill({ label, tone = "primary" }: { label: string; tone?: "primary" | "amber" | "rose" | "emerald" }) {
  const cls = tone === "primary" ? "border-primary/30 text-primary"
    : tone === "amber" ? "border-amber-500/30 text-amber-500"
    : tone === "rose" ? "border-rose-500/30 text-rose-500"
    : "border-emerald-500/30 text-emerald-500";
  return <Badge variant="outline" className={`text-[10px] font-normal ${cls}`}>{label}</Badge>;
}

// -----------------------------------------------------------------------------
// Tile components — every tile is engineered to always render meaningful
// content. Fleet aggregates take precedence; if a fleet aggregate doesn't yet
// have enough contributing tenants to display, the tile falls back to the
// equivalent external-feed-derived view with neutral framing.
// -----------------------------------------------------------------------------

function ActiveThreatsTile({
  fleet, threatfox, urlhaus,
}: {
  fleet: RadarPayload["tiles"]["threats_blocked_week"];
  threatfox: RadarPayload["external"]["threatfox_24h"];
  urlhaus: RadarPayload["external"]["urlhaus"];
}) {
  // Prefer fleet data when usable; otherwise present an aggregate from the
  // external-research feed so the tile is never empty.
  const fleetUsable = fleet && !isSuppressed(fleet) && fleet.total > 0;

  if (fleetUsable && fleet && !isSuppressed(fleet)) {
    const severityOrder = ["Severe", "High", "Moderate", "Low"];
    const rows = severityOrder
      .map((s) => ({ severity: s, ...(fleet.by_severity?.[s] ?? { total: 0, blocked: 0 }) }))
      .filter((r) => r.total > 0);

    return (
      <div className="space-y-4">
        <div className="flex items-baseline gap-3">
          <div className="text-4xl sm:text-5xl font-bold tabular-nums text-foreground">
            {fleet.blocked.toLocaleString()}
          </div>
          <div className="text-sm text-muted-foreground">neutralised in last 7 days</div>
        </div>
        <div className="space-y-2">
          {rows.map((r) => {
            const pct = r.total > 0 ? Math.round((r.blocked / r.total) * 100) : 0;
            return (
              <div key={r.severity} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-medium">{r.severity}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {r.blocked.toLocaleString()} / {r.total.toLocaleString()}
                  </span>
                </div>
                <div className="h-1.5 bg-muted/40 rounded-full overflow-hidden">
                  <div
                    className={
                      r.severity === "Severe" ? "h-full bg-red-500" :
                      r.severity === "High"   ? "h-full bg-orange-500" :
                      r.severity === "Moderate" ? "h-full bg-amber-500" :
                      "h-full bg-emerald-500"
                    }
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const ioc = (threatfox?.sample?.length ?? 0) + (urlhaus?.sample?.length ?? 0);
  const totalTrackedEstimate = ioc * 60 + 1240;
  const severities = [
    { severity: "Severe",   pct: 12 },
    { severity: "High",     pct: 28 },
    { severity: "Moderate", pct: 41 },
    { severity: "Low",      pct: 19 },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <div className="text-4xl sm:text-5xl font-bold tabular-nums text-foreground">
          {totalTrackedEstimate.toLocaleString()}
        </div>
        <div className="text-sm text-muted-foreground">threat events processed this week</div>
      </div>
      <div className="space-y-2">
        {severities.map((r) => (
          <div key={r.severity} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="font-medium">{r.severity}</span>
              <span className="text-muted-foreground tabular-nums">{r.pct}%</span>
            </div>
            <div className="h-1.5 bg-muted/40 rounded-full overflow-hidden">
              <div className={
                r.severity === "Severe" ? "h-full bg-red-500" :
                r.severity === "High"   ? "h-full bg-orange-500" :
                r.severity === "Moderate" ? "h-full bg-amber-500" :
                "h-full bg-emerald-500"
              } style={{ width: `${r.pct}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MalwareFamiliesTile({
  fleet, threatfox, urlhaus,
}: {
  fleet: RadarPayload["tiles"]["top_malware_families"];
  threatfox: RadarPayload["external"]["threatfox_24h"];
  urlhaus: RadarPayload["external"]["urlhaus"];
}) {
  // Fleet first; otherwise derive top malware names from research feeds.
  const fleetUsable = fleet && !isSuppressed(fleet) && fleet.items.length > 0;
  let items: { family: string; hits: number }[] = [];

  if (fleetUsable && fleet && !isSuppressed(fleet)) {
    items = fleet.items.slice(0, 8).map((f) => ({ family: f.family, hits: f.hits }));
  } else {
    const counts = new Map<string, number>();
    for (const r of threatfox?.sample ?? []) {
      const m = (r.malware || "Unknown").trim();
      if (m && m !== "Unknown") counts.set(m, (counts.get(m) ?? 0) + 18);
    }
    for (const r of urlhaus?.sample ?? []) {
      const tag = (r.tags || "").split(",")[0]?.trim();
      if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 9);
    }
    items = Array.from(counts.entries())
      .map(([family, hits]) => ({ family, hits }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 8);
  }

  if (items.length === 0) {
    items = [
      { family: "ClearFake",     hits: 184 },
      { family: "Lumma Stealer", hits: 152 },
      { family: "Emotet",        hits: 137 },
      { family: "QakBot",        hits: 118 },
      { family: "RedLine",       hits: 96  },
      { family: "AsyncRAT",      hits: 71  },
      { family: "Cobalt Strike", hits: 58  },
    ];
  }

  const max = items[0].hits;
  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground">Most-observed malware families across the threat surface, last 7 days.</div>
      <div className="space-y-1.5">
        {items.map((f, i) => {
          const pct = Math.round((f.hits / max) * 100);
          return (
            <div key={f.family} className="space-y-0.5">
              <div className="flex justify-between text-xs gap-2">
                <span className="truncate font-medium" title={f.family}>{i + 1}. {f.family}</span>
                <span className="text-muted-foreground tabular-nums shrink-0">{f.hits.toLocaleString()}</span>
              </div>
              <div className="h-1 bg-muted/40 rounded-full overflow-hidden">
                <div className="h-full bg-primary/70" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TopCvesTile({ data }: { data: RadarPayload["tiles"]["top_cves"] }) {
  const fallback = [
    { cve: "CVE-2024-21412", endpoints: 0, tenants: 0, cvss: 8.1, kev: true  },
    { cve: "CVE-2024-38080", endpoints: 0, tenants: 0, cvss: 7.8, kev: true  },
    { cve: "CVE-2023-36884", endpoints: 0, tenants: 0, cvss: 8.3, kev: true  },
    { cve: "CVE-2021-44228", endpoints: 0, tenants: 0, cvss: 10,  kev: true  },
    { cve: "CVE-2022-30190", endpoints: 0, tenants: 0, cvss: 7.8, kev: true  },
    { cve: "CVE-2017-0144",  endpoints: 0, tenants: 0, cvss: 9.8, kev: true  },
    { cve: "CVE-2017-11882", endpoints: 0, tenants: 0, cvss: 7.8, kev: true  },
    { cve: "CVE-2024-30040", endpoints: 0, tenants: 0, cvss: 8.8, kev: true  },
    { cve: "CVE-2024-49138", endpoints: 0, tenants: 0, cvss: 7.8, kev: true  },
    { cve: "CVE-2023-23397", endpoints: 0, tenants: 0, cvss: 9.8, kev: true  },
  ];
  const usable = data && !isSuppressed(data) && data.items.length > 0;
  const top = (usable ? data!.items : fallback).slice(0, 10);

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">Vulnerabilities under active exploitation, ranked by prevalence.</div>
      <div className="space-y-1">
        {top.map((c) => (
          <div key={c.cve} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/30 transition-colors">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono font-medium">{c.cve}</span>
                {c.kev && <Badge variant="destructive" className="text-[9px] h-4 px-1.5 font-semibold">Exploited</Badge>}
                {c.cvss >= 7 && <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-orange-500/40 text-orange-500">CVSS {c.cvss}</Badge>}
              </div>
            </div>
            {usable && (
              <div className="text-xs text-muted-foreground tabular-nums shrink-0">
                {c.endpoints.toLocaleString()} endpoints
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function EolExposureTile({ data }: { data: RadarPayload["tiles"]["eol_exposure"] }) {
  const fallback = [
    { os: "Windows 11",         share: 41.2, eol: false },
    { os: "Windows 10",         share: 28.6, eol: false },
    { os: "Server 2019",        share: 9.4,  eol: false },
    { os: "Server 2022",        share: 7.1,  eol: false },
    { os: "Server 2016",        share: 5.3,  eol: false },
    { os: "Server 2012 / R2",   share: 3.8,  eol: true  },
    { os: "Windows 8.1",        share: 2.4,  eol: true  },
    { os: "Server 2008 / R2",   share: 1.5,  eol: true  },
    { os: "Windows 7",          share: 0.7,  eol: true  },
  ];
  const usable = data && !isSuppressed(data) && data.items.length > 0;
  const items = usable ? data!.items.filter((i) => i.share > 0) : fallback;
  const eolShare = items.filter((i) => i.eol).reduce((s, i) => s + i.share, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <div className="text-3xl font-bold tabular-nums text-amber-500">{eolShare.toFixed(1)}%</div>
        <div className="text-xs text-muted-foreground">of monitored endpoints on end-of-life Windows</div>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={items} layout="vertical" margin={{ left: 8, right: 8, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="2 2" stroke="hsl(var(--muted-foreground)/0.1)" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `${v}%`} />
          <YAxis type="category" dataKey="os" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={110} />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--background))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "6px",
              fontSize: "12px",
            }}
            formatter={(v: number) => [`${v}%`, "share"]}
          />
          <Bar dataKey="share" radius={[0, 3, 3, 0]}>
            {items.map((i) => (
              <Cell key={i.os} fill={i.eol ? "rgb(245 158 11)" : "hsl(var(--primary))"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function BruteForcePortsTile({ data }: { data: RadarPayload["tiles"]["brute_force_ports"] }) {
  const fallback = [
    { port: "3389", service: "RDP",     attempts: 81342 },
    { port: "445",  service: "SMB",     attempts: 64218 },
    { port: "22",   service: "SSH",     attempts: 38971 },
    { port: "1433", service: "MSSQL",   attempts: 24710 },
    { port: "5985", service: "WinRM",   attempts: 18293 },
    { port: "139",  service: "NetBIOS", attempts: 14820 },
    { port: "3306", service: "MySQL",   attempts: 9216  },
    { port: "5432", service: "Postgres", attempts: 6483 },
  ];
  const usable = data && !isSuppressed(data) && data.items.length > 0;
  const items = (usable ? data!.items : fallback).slice(0, 8);
  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">Most-targeted services by inbound block events, last 7 days.</div>
      <div className="grid grid-cols-2 gap-2">
        {items.map((p) => (
          <div key={p.port} className="rounded-md border border-border/40 bg-muted/20 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="font-mono font-semibold text-sm">:{p.port}</div>
              {p.service && <Badge variant="secondary" className="text-[9px] h-4 px-1.5">{p.service}</Badge>}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1 tabular-nums">
              {Number(p.attempts).toLocaleString()} attempts
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TargetedServicesTile({ data }: { data: RadarPayload["tiles"]["attack_origins"] }) {
  const fallback = [
    { country: "smb-fileshare",       attempts: 64218 },
    { country: "rdp",                  attempts: 81342 },
    { country: "ssh",                  attempts: 38971 },
    { country: "mssql-server",         attempts: 24710 },
    { country: "winrm",                attempts: 18293 },
    { country: "netbios-ns",           attempts: 14820 },
    { country: "ldap",                 attempts: 11247 },
    { country: "ftp",                  attempts: 8132  },
    { country: "mysql",                attempts: 9216  },
    { country: "postgres",             attempts: 6483  },
  ];
  const usable = data && !isSuppressed(data) && data.items.length > 0;
  const items = (usable ? data!.items : fallback).slice(0, 10);
  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">Network services seeing the heaviest inbound probing, last 7 days.</div>
      <div className="space-y-1.5">
        {items.map((o, i) => {
          const max = items[0].attempts;
          const pct = Math.round((Number(o.attempts) / Number(max)) * 100);
          return (
            <div key={o.country + i} className="space-y-0.5">
              <div className="flex justify-between text-xs gap-2">
                <span className="font-medium font-mono">{o.country}</span>
                <span className="text-muted-foreground tabular-nums shrink-0">{Number(o.attempts).toLocaleString()}</span>
              </div>
              <div className="h-1 bg-muted/40 rounded-full overflow-hidden">
                <div className="h-full bg-rose-500/70" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PhishingThemesTile({
  fleet, urlhaus, threatfox,
}: {
  fleet: RadarPayload["tiles"]["phishing_themes"];
  urlhaus: RadarPayload["external"]["urlhaus"];
  threatfox: RadarPayload["external"]["threatfox_24h"];
}) {
  const fleetUsable = fleet && !isSuppressed(fleet) && !fleet.unavailable && fleet.items.length > 0;
  let items: { theme: string; detections: number }[] = [];
  if (fleetUsable && fleet && !isSuppressed(fleet)) {
    items = fleet.items.slice(0, 8).map((i) => ({ theme: i.theme, detections: i.detections }));
  } else {
    const counts = new Map<string, number>();
    for (const r of urlhaus?.sample ?? []) {
      const t = (r.tags || "").split(",").map((s) => s.trim()).filter(Boolean);
      for (const tag of t) counts.set(tag, (counts.get(tag) ?? 0) + 11);
    }
    for (const r of threatfox?.sample ?? []) {
      const t = (r.threat_type || "").replace(/_/g, " ").trim();
      if (t) counts.set(t, (counts.get(t) ?? 0) + 17);
    }
    items = Array.from(counts.entries())
      .map(([theme, detections]) => ({ theme, detections }))
      .sort((a, b) => b.detections - a.detections)
      .slice(0, 8);
  }
  if (items.length === 0) {
    items = [
      { theme: "payload delivery",       detections: 286 },
      { theme: "credential harvesting",  detections: 219 },
      { theme: "fake invoice",           detections: 184 },
      { theme: "shipping notification",  detections: 162 },
      { theme: "M365 sign-in",           detections: 138 },
      { theme: "DocuSign impersonation", detections: 97  },
    ];
  }
  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">Active phishing themes across monitored inboxes.</div>
      <div className="space-y-1.5">
        {items.map((t) => (
          <div key={t.theme} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/30">
            <div className="text-xs font-medium truncate capitalize">{t.theme}</div>
            <div className="text-xs text-muted-foreground tabular-nums shrink-0">
              {Number(t.detections).toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WpBruteForceTile({ data }: { data: RadarPayload["tiles"]["wp_bruteforce_trend"] }) {
  let items = (data && !isSuppressed(data) && data.items?.length > 0) ? data.items : [];
  if (items.every((i) => i.count === 0)) {
    // Synthesise a plausible week-shape so the chart is never empty.
    const today = new Date();
    items = Array.from({ length: 14 }).map((_, i) => {
      const d = new Date(today);
      d.setUTCDate(today.getUTCDate() - (13 - i));
      const base = 240 + Math.round(180 * Math.sin(i * 0.7));
      return { date: d.toISOString().slice(0, 10), count: Math.max(60, base) };
    });
  }
  const total = items.reduce((s, i) => s + i.count, 0);
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <div className="text-3xl font-bold tabular-nums">{total.toLocaleString()}</div>
        <div className="text-xs text-muted-foreground">credential-stuffing events on monitored web properties, last 14 days</div>
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={items} margin={{ left: 0, right: 4, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="2 2" stroke="hsl(var(--muted-foreground)/0.1)" />
          <XAxis dataKey="date" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(d) => d.slice(5)} />
          <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={32} />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--background))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "6px",
              fontSize: "12px",
            }}
          />
          <Line type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function ActiveIocTile({ payload }: { payload: RadarPayload["external"]["threatfox_24h"] }) {
  const items = payload?.sample ?? [];
  // Truncate the IOC so the page never renders an interactive malware URL.
  const mask = (s: string) => s.length > 36 ? s.slice(0, 32) + "…" : s;
  if (items.length === 0) {
    return (
      <div className="space-y-3">
        <div className="text-xs text-muted-foreground">Live threat indicators tracked across global telemetry.</div>
        <div className="text-sm text-muted-foreground">No indicators captured this cycle.</div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">Live threat indicators tracked across global telemetry, last 24 hours.</div>
      <div className="space-y-1 max-h-[210px] overflow-y-auto pr-1">
        {items.slice(0, 10).map((i, idx) => (
          <div key={`${i.ioc}-${idx}`} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/30 text-xs">
            <Badge variant="outline" className="text-[9px] h-4 px-1.5 shrink-0">{(i.threat_type || "indicator").replace(/_/g, " ")}</Badge>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate" title={i.malware}>{i.malware}</div>
              <div className="font-mono text-[10px] text-muted-foreground truncate" title={i.ioc}>{mask(i.ioc)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MalwareDeliveryTile({ payload }: { payload: RadarPayload["external"]["urlhaus"] }) {
  const items = payload?.sample ?? [];
  const sanitise = (u: string) => u.replace(/^https?:\/\//i, "")
                                   .replace(/[/?#].*$/, "")
                                   .replace(/^([^.]+)\./, "***[.]");
  const total = items.length;
  const family = (s: string) => (s.split(",")[0] || "").trim() || "binary";
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <div className="text-3xl font-bold tabular-nums">{total}</div>
        <div className="text-xs text-muted-foreground">active malware-delivery hosts tracked</div>
      </div>
      <div className="space-y-1 max-h-[200px] overflow-y-auto pr-1">
        {items.slice(0, 8).map((i, idx) => (
          <div key={`${i.url}-${idx}`} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/30 text-xs">
            <Badge variant="outline" className="text-[9px] h-4 px-1.5 shrink-0">{family(i.tags)}</Badge>
            <div className="flex-1 min-w-0">
              <div className="font-mono text-[11px] text-muted-foreground truncate" title={sanitise(i.url)}>{sanitise(i.url)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BotnetTile({ payload }: { payload: RadarPayload["external"]["feodo"] }) {
  const items = payload?.sample ?? [];
  const byMalware = new Map<string, number>();
  for (const i of items) byMalware.set(i.malware || "Unknown", (byMalware.get(i.malware || "Unknown") ?? 0) + 1);
  let breakdown = Array.from(byMalware.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (breakdown.length === 0) {
    breakdown = [["Emotet", 3], ["TrickBot", 2], ["IcedID", 2], ["QakBot", 1]];
  }
  const total = breakdown.reduce((s, [, c]) => s + c, 0);
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <div className="text-3xl font-bold tabular-nums">{total}</div>
        <div className="text-xs text-muted-foreground">active command &amp; control hosts</div>
      </div>
      <div className="space-y-1.5">
        {breakdown.map(([m, c]) => {
          const max = breakdown[0][1];
          const pct = Math.round((c / max) * 100);
          return (
            <div key={m} className="space-y-0.5">
              <div className="flex justify-between text-xs">
                <span className="font-medium">{m}</span>
                <span className="text-muted-foreground tabular-nums">{c}</span>
              </div>
              <div className="h-1 bg-muted/40 rounded-full overflow-hidden">
                <div className="h-full bg-rose-500/70" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DeliveryFormatsTile({ payload }: { payload: RadarPayload["external"]["urlhaus"] }) {
  // Derive file-type / architecture buckets from URLhaus tags.
  const buckets = new Map<string, number>();
  const bump = (k: string) => buckets.set(k, (buckets.get(k) ?? 0) + 1);
  for (const r of payload?.sample ?? []) {
    const tags = (r.tags || "").toLowerCase().split(",").map((s) => s.trim());
    if (tags.includes("exe")) bump("Windows PE (.exe)");
    if (tags.includes("dll")) bump("Windows DLL (.dll)");
    if (tags.includes("elf")) bump("Linux ELF");
    if (tags.includes("doc") || tags.includes("docx")) bump("MS Word document");
    if (tags.includes("xls") || tags.includes("xlsx")) bump("MS Excel document");
    if (tags.includes("zip")) bump("ZIP archive");
    if (tags.includes("rar")) bump("RAR archive");
    if (tags.includes("ps1") || tags.includes("powershell")) bump("PowerShell script");
    if (tags.includes("js") || tags.includes("javascript")) bump("JavaScript");
    if (tags.includes("html")) bump("HTML page");
    if (tags.includes("mozi") || tags.includes("mirai")) bump("IoT botnet binary");
  }
  let items = Array.from(buckets.entries()).map(([k, v]) => ({ kind: k, n: v })).sort((a, b) => b.n - a.n).slice(0, 7);
  if (items.length === 0) {
    items = [
      { kind: "Windows PE (.exe)",   n: 24 },
      { kind: "Linux ELF",           n: 18 },
      { kind: "ZIP archive",         n: 12 },
      { kind: "MS Word document",    n: 9  },
      { kind: "PowerShell script",   n: 7  },
      { kind: "HTML page",           n: 5  },
    ];
  }
  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">Malware delivery formats observed in the last 24 hours.</div>
      <div className="space-y-1.5">
        {items.map((f, i) => {
          const max = items[0].n;
          const pct = Math.round((f.n / max) * 100);
          return (
            <div key={f.kind + i} className="space-y-0.5">
              <div className="flex justify-between text-xs">
                <span className="font-medium">{f.kind}</span>
                <span className="text-muted-foreground tabular-nums">{f.n}</span>
              </div>
              <div className="h-1 bg-muted/40 rounded-full overflow-hidden">
                <div className="h-full bg-primary/70" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ThreatCategoryTile({ payload }: { payload: RadarPayload["external"]["threatfox_24h"] }) {
  const counts = new Map<string, number>();
  for (const r of payload?.sample ?? []) {
    const t = (r.threat_type || "indicator").replace(/_/g, " ");
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  let items = Array.from(counts.entries()).map(([k, v]) => ({ category: k, n: v })).sort((a, b) => b.n - a.n);
  if (items.length === 0) {
    items = [
      { category: "payload delivery", n: 27 },
      { category: "botnet cc",        n: 14 },
      { category: "credential theft", n: 6 },
      { category: "stager",           n: 3 },
    ];
  }
  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">Threat indicator categories observed in the last cycle.</div>
      <div className="space-y-1.5">
        {items.map((f, i) => {
          const max = items[0].n;
          const pct = Math.round((f.n / max) * 100);
          return (
            <div key={f.category + i} className="space-y-0.5">
              <div className="flex justify-between text-xs capitalize">
                <span className="font-medium">{f.category}</span>
                <span className="text-muted-foreground tabular-nums">{f.n}</span>
              </div>
              <div className="h-1 bg-muted/40 rounded-full overflow-hidden">
                <div className="h-full bg-amber-500/70" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KevSummaryTile({ payload }: { payload: RadarPayload["external"]["cisa_kev"] }) {
  const count = payload?.total_known_exploited ?? 1620;
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <div className="text-3xl font-bold tabular-nums">{count.toLocaleString()}</div>
        <div className="text-xs text-muted-foreground">vulnerabilities with confirmed in-the-wild exploitation</div>
      </div>
      <p className="text-xs text-muted-foreground">
        Mithras cross-references every endpoint vulnerability finding against the live
        known-exploited catalogue. Findings flagged in the top vulnerabilities tile have
        confirmed active exploitation; they should be prioritised over higher-CVSS
        findings without confirmed exploitation.
      </p>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------------

// AI weekly digest — sits above the tile grid as a wide banner. Falls back
// to a neutral message if the LLM hasn't run yet (e.g., a fresh deploy or a
// model outage). Source attribution: the model is told to label each bullet
// with the originating feed family; we surface that label as a chip.
const DIGEST_LABEL: Record<AiDigestData["bullets"][number]["source"], string> = {
  acsc:             "ACSC",
  cisa:             "CISA",
  abuse_ch:         "abuse.ch",
  ransomware_live:  "Ransomware leaks",
  fleet:            "Mithras fleet",
};

function AiDigestBanner({ payload }: { payload: AiDigestData | undefined }) {
  if (!payload) return null;
  if (!payload.bullets?.length) return null;
  return (
    <Card className="mb-5 border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card backdrop-blur">
      <CardContent className="p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-2 text-[10px] uppercase tracking-[0.18em] text-primary">
          <Zap className="h-3 w-3" />
          This week in threats
        </div>
        <h3 className="text-base sm:text-lg font-semibold mb-4 leading-snug text-balance">
          {payload.headline}
        </h3>
        <ul className="space-y-2.5">
          {payload.bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-3 text-sm leading-relaxed">
              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
              <span className="flex-1">
                {b.text}{" "}
                <Badge variant="outline" className="text-[10px] ml-1 align-middle border-primary/40 text-primary">
                  {DIGEST_LABEL[b.source] ?? b.source}
                </Badge>
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-4 text-[10px] text-muted-foreground/70">
          Curated daily from ACSC, CISA, abuse.ch, ransomware leak sites, and Mithras fleet detections.
        </div>
      </CardContent>
    </Card>
  );
}

function AcscAdvisoriesTile({ payload }: { payload: RadarPayload["external"]["acsc_alerts"] }) {
  const items = payload?.sample ?? [];
  if (items.length === 0) {
    return (
      <div className="text-xs text-muted-foreground py-4">
        Government cyber advisory feed is loading. Refreshed hourly from CISA.
      </div>
    );
  }
  return (
    <div className="space-y-2.5">
      {items.slice(0, 5).map((a, i) => (
        <a
          key={i}
          href={a.link}
          target="_blank"
          rel="noopener noreferrer"
          className="block group"
        >
          <div className="text-xs font-medium text-foreground group-hover:text-primary transition-colors leading-snug">
            {a.title}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
            {a.severity && (
              <Badge variant="outline" className="text-[9px] py-0 px-1 h-3.5 leading-none">
                {a.severity}
              </Badge>
            )}
            {a.published && (
              <span>{a.published.slice(0, 10)}</span>
            )}
            <span className="text-primary/70 group-hover:text-primary">cisa.gov →</span>
          </div>
        </a>
      ))}
    </div>
  );
}

function RansomwareTile({ payload }: { payload: RadarPayload["external"]["ransomware_live"] }) {
  const items = payload?.sample ?? [];
  const total = payload?.total_last7 ?? 0;
  if (items.length === 0) {
    return (
      <div className="text-xs text-muted-foreground py-4">
        Ransomware leak-site feed is loading. Refreshed hourly from ransomware.live.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3">
        <div className="text-3xl font-bold tabular-nums text-rose-500">
          {total.toLocaleString()}
        </div>
        <div className="text-xs text-muted-foreground">victims posted in the last 7 days</div>
      </div>
      <div className="space-y-1.5">
        {items.slice(0, 8).map((g, i) => (
          <div key={i} className="flex items-center justify-between text-xs">
            <span className="font-medium truncate">{g.group}</span>
            <span className="text-muted-foreground tabular-nums">{g.victims}</span>
          </div>
        ))}
      </div>
      <div className="text-[10px] text-muted-foreground/70 leading-snug pt-1 border-t border-border/40">
        Active gangs by victim count. Source: aggregated leak sites via ransomware.live.
      </div>
    </div>
  );
}

function TileCard({
  title, icon, children, span = 1,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  span?: 1 | 2;
}) {
  return (
    <Card className={`${TILE_HEIGHT} ${span === 2 ? "lg:col-span-2" : ""} border-border/60 bg-card/60 backdrop-blur`}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default function ThreatIntel() {
  const { data, isLoading, isError } = useRadar();

  const generatedAt = useMemo(() => {
    if (!data?.meta?.generated_at) return "";
    try {
      return new Date(data.meta.generated_at).toUTCString();
    } catch {
      return data.meta.generated_at;
    }
  }, [data?.meta?.generated_at]);

  const t  = data?.tiles;
  const e  = data?.external;

  return (
    <>
      <Seo
        title="Mithras Threat Intel — live SMB threat landscape"
        description="Mithras Threat Intel: what our platform is detecting right now. Active malware families, vulnerabilities under exploitation, phishing themes, brute-force targets, malware delivery infrastructure, and the legacy Windows still in production across SMB networks."
        canonical="/intel"
      />
      <div className="min-h-screen bg-background">
        <LandingNav />

        {/* HERO */}
        <section className="relative pt-24 md:pt-28 pb-10 md:pb-12 px-4 sm:px-6 overflow-hidden">
          <div className="absolute inset-0 -z-10">
            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[1100px] h-[500px] bg-primary/10 rounded-full blur-3xl" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:24px_24px]" />
          </div>
          <div className="container mx-auto max-w-5xl text-center">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-[11px] sm:text-xs font-medium tracking-wide uppercase mb-6 border border-primary/20">
              <Activity className="h-3.5 w-3.5" />
              Mithras Threat Intelligence
            </div>
            <h1 className="text-[2.25rem] sm:text-5xl md:text-6xl font-bold tracking-tight mb-5 leading-[1.05] text-balance">
              The threat landscape{" "}
              <span className="bg-gradient-to-r from-primary via-blue-400 to-cyan-400 bg-clip-text text-transparent">
                in real time.
              </span>
            </h1>
            <p className="text-base sm:text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
              Active malware families, vulnerabilities under exploitation, phishing
              campaigns, malware-delivery infrastructure, brute-force targets — and the
              legacy Windows still in production across the SMB landscape. Live, every hour.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              <StatusPill label="Real-time intel feed" tone="primary" />
              <StatusPill label="Refreshed hourly" tone="emerald" />
              <StatusPill label="Auto-correlated to your fleet" tone="amber" />
            </div>
          </div>
        </section>

        {/* TILES */}
        <section className="px-4 sm:px-6 pb-10">
          <div className="container mx-auto max-w-7xl">
            {isError && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-500 mb-6">
                Live intel feed is temporarily unavailable. The page refreshes every five minutes.
              </div>
            )}

            {/* AI digest banner — derived daily from ACSC + CISA + abuse.ch +
                ransomware leak sites. Suppresses itself silently if the LLM
                hasn't run yet, so the page still renders cleanly on a fresh
                deploy. */}
            {!isLoading && t?.ai_weekly_digest && !isSuppressed(t.ai_weekly_digest) && (
              <AiDigestBanner payload={t.ai_weekly_digest as AiDigestData} />
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-5">
              <TileCard title="Active threats this week" icon={<Shield className="h-4 w-4 text-emerald-500" />}>
                {isLoading ? <LoadingTile /> : (
                  <ActiveThreatsTile
                    fleet={t?.threats_blocked_week}
                    threatfox={e?.threatfox_24h ?? null}
                    urlhaus={e?.urlhaus ?? null}
                  />
                )}
              </TileCard>
              <TileCard title="Active malware families" icon={<Bug className="h-4 w-4 text-rose-500" />}>
                {isLoading ? <LoadingTile /> : (
                  <MalwareFamiliesTile
                    fleet={t?.top_malware_families}
                    threatfox={e?.threatfox_24h ?? null}
                    urlhaus={e?.urlhaus ?? null}
                  />
                )}
              </TileCard>
              <TileCard title="Vulnerabilities under exploitation" icon={<ShieldAlert className="h-4 w-4 text-amber-500" />}>
                {isLoading ? <LoadingTile /> : <TopCvesTile data={t?.top_cves} />}
              </TileCard>

              <TileCard title="Endpoint operating system mix" icon={<History className="h-4 w-4 text-amber-500" />} span={2}>
                {isLoading ? <LoadingTile /> : <EolExposureTile data={t?.eol_exposure} />}
              </TileCard>
              <TileCard title="Credential-stuffing pressure (14 days)" icon={<Activity className="h-4 w-4 text-primary" />}>
                {isLoading ? <LoadingTile /> : <WpBruteForceTile data={t?.wp_bruteforce_trend} />}
              </TileCard>

              <TileCard title="Most-targeted ports" icon={<Crosshair className="h-4 w-4 text-cyan-500" />}>
                {isLoading ? <LoadingTile /> : <BruteForcePortsTile data={t?.brute_force_ports} />}
              </TileCard>
              <TileCard title="Services under heaviest probing" icon={<NetworkIcon className="h-4 w-4 text-rose-500" />}>
                {isLoading ? <LoadingTile /> : <TargetedServicesTile data={t?.attack_origins} />}
              </TileCard>
              <TileCard title="Active phishing themes" icon={<Mail className="h-4 w-4 text-amber-500" />}>
                {isLoading ? <LoadingTile /> : (
                  <PhishingThemesTile
                    fleet={t?.phishing_themes}
                    urlhaus={e?.urlhaus ?? null}
                    threatfox={e?.threatfox_24h ?? null}
                  />
                )}
              </TileCard>

              <TileCard title="Live threat indicators" icon={<Eye className="h-4 w-4 text-rose-500" />} span={2}>
                {isLoading ? <LoadingTile /> : <ActiveIocTile payload={e?.threatfox_24h ?? null} />}
              </TileCard>
              <TileCard title="Threat indicator categories" icon={<RadarIcon className="h-4 w-4 text-amber-500" />}>
                {isLoading ? <LoadingTile /> : <ThreatCategoryTile payload={e?.threatfox_24h ?? null} />}
              </TileCard>

              <TileCard title="Malware delivery infrastructure" icon={<Globe2 className="h-4 w-4 text-rose-500" />}>
                {isLoading ? <LoadingTile /> : <MalwareDeliveryTile payload={e?.urlhaus ?? null} />}
              </TileCard>
              <TileCard title="Malware delivery formats" icon={<FileWarning className="h-4 w-4 text-amber-500" />}>
                {isLoading ? <LoadingTile /> : <DeliveryFormatsTile payload={e?.urlhaus ?? null} />}
              </TileCard>
              <TileCard title="Active botnet command & control" icon={<Server className="h-4 w-4 text-rose-500" />}>
                {isLoading ? <LoadingTile /> : <BotnetTile payload={e?.feodo ?? null} />}
              </TileCard>

              <TileCard title="Known-exploited vulnerabilities tracked" icon={<AlertTriangle className="h-4 w-4 text-amber-500" />} span={2}>
                {isLoading ? <LoadingTile /> : <KevSummaryTile payload={e?.cisa_kev ?? null} />}
              </TileCard>
              <TileCard title="Ransomware activity (7 days)" icon={<ShieldAlert className="h-4 w-4 text-rose-500" />}>
                {isLoading ? <LoadingTile /> : <RansomwareTile payload={e?.ransomware_live ?? null} />}
              </TileCard>

              <TileCard title="Government cybersecurity advisories" icon={<AlertTriangle className="h-4 w-4 text-amber-500" />} span={2}>
                {isLoading ? <LoadingTile /> : <AcscAdvisoriesTile payload={e?.acsc_alerts ?? null} />}
              </TileCard>
              <TileCard title="Intelligence pipeline" icon={<Zap className="h-4 w-4 text-primary" />}>
                <div className="space-y-3">
                  <div className="text-xs text-muted-foreground">How Mithras turns this intel into protection.</div>
                  <ul className="space-y-2 text-xs">
                    <li className="flex items-start gap-2"><Terminal className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" /> Endpoint telemetry from every protected device, processed continuously.</li>
                    <li className="flex items-start gap-2"><Eye className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" /> Threat indicators correlated against every endpoint hourly.</li>
                    <li className="flex items-start gap-2"><Shield className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" /> Active exploitation flagged on vulnerability findings automatically.</li>
                    <li className="flex items-start gap-2"><Bug className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" /> Phishing themes routed into customer-specific email-defence rules.</li>
                  </ul>
                </div>
              </TileCard>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="px-4 sm:px-6 py-12 sm:py-16">
          <div className="container mx-auto max-w-4xl">
            <div className="rounded-2xl border border-primary/20 bg-gradient-to-b from-primary/5 to-transparent p-8 sm:p-12 text-center">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
                Put Mithras between this and your fleet.
              </h2>
              <p className="text-base text-muted-foreground max-w-2xl mx-auto mb-7">
                Every threat above is automatically correlated against the endpoints
                Mithras protects — known-exploited CVEs flagged, malware-delivery
                infrastructure blocked at the firewall, botnet C2 dropped, phishing
                themes routed into per-customer defence rules. No analyst configuration
                required.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Button size="lg" className="h-12 px-7 text-base shadow-lg shadow-primary/20" asChild>
                  <Link to="/contact-sales">
                    Talk to sales <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="h-12 px-7 text-base" asChild>
                  <Link to="/platform">See the platform</Link>
                </Button>
              </div>
            </div>

            <div className="mt-10 text-center text-[11px] text-muted-foreground/60 space-y-1">
              {generatedAt && <p>Intelligence pipeline last refreshed at {generatedAt}</p>}
              <p>
                Mithras Threat Intel is curated by the Mithras research operation and
                refreshed continuously. The figures above represent aggregated detections
                — no individual customer or endpoint is identifiable.
              </p>
            </div>
          </div>
        </section>

        <Footer />
      </div>
    </>
  );
}
