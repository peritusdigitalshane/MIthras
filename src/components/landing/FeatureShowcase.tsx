import { Fragment, useState } from "react";
import {
  Eye, Shield, ServerCog, Crosshair, SlidersHorizontal,
  Network, FileText, Sparkles, History,
  CheckCircle2, XCircle, AlertTriangle, Clock, Search,
  Building2, ChevronRight, Activity, Lock, Monitor, ShieldCheck,
} from "lucide-react";

interface FeatureShowcaseItem {
  icon: React.ReactNode;
  title: string;
  description: string;
  highlights: string[];
  mockupType: "microseg" | "defender" | "hunting" | "gpo" | "agent" | "reports" | "incidents" | "tenant" | "eol";
  gradient: string;
}

const PLATFORM_FEATURES: FeatureShowcaseItem[] = [
  {
    icon: <Eye className="h-6 w-6" />,
    title: "Microsegmentation",
    description:
      "Every audit-mode firewall rule shows you exactly what's hitting it — 24h + 7d traffic, top remote sources, distinct endpoint count, sparkline trend. When you're confident, flip the rule to block — agents apply the Windows Firewall change on their next poll (within ~15 minutes).",
    highlights: [
      "Per-rule traffic stats with 7-day sparkline",
      "One-click \"Allow this source\" whitelist popover",
      "Per-endpoint drill-in: who sent what, when",
      "Block-all + Allow-whitelist rule pair (Allow > Block)",
    ],
    mockupType: "microseg",
    gradient: "from-teal-500/20 via-teal-500/10 to-transparent",
  },
  {
    icon: <History className="h-6 w-6" />,
    title: "EOL Windows hardening",
    description:
      "Customers running Windows 7, 8.1, Server 2012, or Server 2012 R2 in the back office? Don't pay Microsoft's escalating Extended Security Update bill — apply a Mithras hardening profile, track compliance per endpoint, and quantify the dollars saved.",
    highlights: [
      "Profiles for Win 7 / 8.1 / 10 / Server 2012 / 2012 R2",
      "Per-endpoint compliance score with finding drill-in",
      "ESU annual cost estimate per device, fleet-wide rollup",
      "Recommendations engine with one-click remediation push",
    ],
    mockupType: "eol",
    gradient: "from-amber-500/20 via-amber-500/10 to-transparent",
  },
  {
    icon: <Shield className="h-6 w-6" />,
    title: "Defender posture & policy",
    description:
      "Configure and enforce every Microsoft Defender knob from one policy editor — real-time protection, cloud-delivered protection, behaviour monitoring, all 16 ASR rules, exclusions, controlled folder access, and exploit guard.",
    highlights: [
      "All 16 ASR rules with Audit/Block/Warn",
      "Path / process / extension exclusions",
      "Controlled folder access + exploit guard",
      "Posture drift detection per endpoint",
    ],
    mockupType: "defender",
    gradient: "from-primary/20 via-primary/10 to-transparent",
  },
  {
    icon: <ServerCog className="h-6 w-6" />,
    title: "Cross-platform agents",
    description:
      "Lightweight, signed agents for Windows (Server 2012+, 10, 11) and Linux (Ubuntu, RHEL, Debian). Outbound-only — no inbound firewall holes. Tamper-evident communication and signed automatic updates.",
    highlights: [
      "Windows: runs as a managed service",
      "Linux: ships as a system service (Ubuntu / RHEL / Debian)",
      "Tamper-evident enrolment and check-ins",
      "Automatic updates with signature verification",
    ],
    mockupType: "agent",
    gradient: "from-blue-500/20 via-blue-500/10 to-transparent",
  },
  {
    icon: <Crosshair className="h-6 w-6" />,
    title: "Threat hunting & IOC library",
    description:
      "Build an IOC library — hashes, IPs, domains, filenames — and hunt across every endpoint. Bulk-import from CSV, run jobs with live progress, review matches enriched with VirusTotal intel.",
    highlights: [
      "Hash / IP / domain / filename IOCs",
      "Bulk CSV import",
      "Cross-fleet hunt jobs with progress",
      "VirusTotal enrichment on matches",
    ],
    mockupType: "hunting",
    gradient: "from-cyan-500/20 via-cyan-500/10 to-transparent",
  },
  {
    icon: <SlidersHorizontal className="h-6 w-6" />,
    title: "Group Policy without AD",
    description:
      "Full Windows Group Policy parity without Active Directory. Password and lockout policies, 9 audit categories, user rights assignments, UAC, power management, remote desktop, and arbitrary registry settings.",
    highlights: [
      "Password + account lockout policies",
      "9 audit categories with Success/Failure/Both",
      "UAC + power + remote-desktop controls",
      "Custom registry settings with any type",
    ],
    mockupType: "gpo",
    gradient: "from-amber-500/20 via-amber-500/10 to-transparent",
  },
  {
    icon: <Network className="h-6 w-6" />,
    title: "Network security",
    description:
      "Visual service-by-group access matrix. Start a 30-day audit session to baseline legitimate traffic, then promote the auto-generated whitelist to enforce mode with full confidence.",
    highlights: [
      "Visual service × group access matrix",
      "30-day audit-to-enforce workflow",
      "Smart traffic labelling (RDP/SMB/HTTP…)",
      "Risk-classified observed-traffic panel",
    ],
    mockupType: "incidents",
    gradient: "from-orange-500/20 via-orange-500/10 to-transparent",
  },
  {
    icon: <FileText className="h-6 w-6" />,
    title: "Monthly customer PDF",
    description:
      "On the 1st of every month a branded PDF report ships to the customer contacts you've configured. KPI grid, incidents, vulnerabilities, top software, AI-written executive summary — emailed via your own SMTP creds.",
    highlights: [
      "Auto-generated on the 1st of every month",
      "Per-customer recipient list with topic opt-in",
      "AI-written executive summary block",
      "Delivered via encrypted email",
    ],
    mockupType: "reports",
    gradient: "from-fuchsia-500/20 via-fuchsia-500/10 to-transparent",
  },
  {
    icon: <Sparkles className="h-6 w-6" />,
    title: "Multi-tenant by design",
    description:
      "Built for MSPs from day one. Every customer's data is walled off from every other customer's. Operators switch context with one click; super-admins can pivot into any tenant view to support without leaking data between accounts.",
    highlights: [
      "Strict per-customer data isolation",
      "One-click tenant switching for operators",
      "Per-tenant feature gates (network, routers…)",
      "Full activity audit trail per tenant",
    ],
    mockupType: "tenant",
    gradient: "from-violet-500/20 via-violet-500/10 to-transparent",
  },
];

// ===========================================================================
// FeatureMockup — high-fidelity product UI rendered in JSX.
//
// Every "screenshot" on the landing page is one of these. All data is
// synthetic — Acme Corp / Northwind / Contoso / Fabrikam / Tailspin Toys are
// standard Microsoft demo-tenant names, well-recognised as placeholders.
// Threat signature names (Win32/Emotet, Trojan:Win32/Wacatac.B!ml, etc.)
// are public Defender catalogue entries.
//
// If a customer-supplied PNG exists at /screenshots/<mockupType>.png it
// overrides the JSX mockup (drop a file, no rebuild needed).
// ===========================================================================
function FeatureMockup({ feature }: { feature: FeatureShowcaseItem }) {
  const { mockupType, gradient } = feature;
  const [useScreenshot, setUseScreenshot] = useState(true);
  const screenshotUrl = `/screenshots/${mockupType}.png`;

  if (useScreenshot) {
    return (
      <div className="aspect-[16/10] rounded-2xl bg-card border border-border/40 overflow-hidden shadow-lg shadow-primary/5">
        <img
          src={screenshotUrl}
          alt={`${feature.title} — Mithras product screenshot`}
          loading="lazy"
          className="w-full h-full object-cover object-top"
          onError={() => setUseScreenshot(false)}
        />
      </div>
    );
  }

  // Reusable card frame (16:10 aspect, dark gradient, framed like a screenshot)
  const Frame = ({ children }: { children: React.ReactNode }) => (
    <div
      className={`aspect-[16/10] rounded-2xl bg-gradient-to-br ${gradient} border border-border/40 overflow-hidden shadow-lg shadow-primary/5 flex flex-col`}
    >
      {children}
    </div>
  );

  // Tab/header strip that sits at the top of each mockup. Suggests "this
  // is a real page in the product" without claiming to be a real screenshot.
  const TopBar = ({ crumbs, status }: { crumbs: string[]; status?: { dot: "ok" | "warn" | "bad"; label: string } }) => (
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/40 bg-card/40 backdrop-blur-sm">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight className="h-2.5 w-2.5 opacity-50" />}
            <span className={i === crumbs.length - 1 ? "text-foreground font-medium" : ""}>{c}</span>
          </span>
        ))}
      </div>
      {status && (
        <div className="flex items-center gap-1.5 text-[10px]">
          <span className={`h-1.5 w-1.5 rounded-full ${
            status.dot === "ok"   ? "bg-emerald-500" :
            status.dot === "warn" ? "bg-amber-500"   : "bg-rose-500"
          } ${status.dot === "ok" ? "animate-pulse" : ""}`} />
          <span className="text-muted-foreground">{status.label}</span>
        </div>
      )}
    </div>
  );

  const Body = ({ children }: { children: React.ReactNode }) => (
    <div className="flex-1 p-3 space-y-2 overflow-hidden">{children}</div>
  );

  // -------------------------------------------------------------------------
  // 1. Microsegmentation
  // -------------------------------------------------------------------------
  if (mockupType === "microseg") {
    return (
      <Frame>
        <TopBar crumbs={["Endpoints", "ACME-WS-04", "Microseg"]} status={{ dot: "ok", label: "Live · 47 rules" }} />
        <Body>
          <div className="grid grid-cols-4 gap-1.5">
            {[
              { l: "Inbound", v: "12" },
              { l: "Outbound", v: "8" },
              { l: "Hits 24h", v: "1.4k" },
              { l: "Suspicious", v: "3" },
            ].map(s => (
              <div key={s.l} className="rounded-md bg-card/60 border border-border/30 px-2 py-1.5">
                <div className="text-[7px] text-muted-foreground uppercase tracking-wider">{s.l}</div>
                <div className="text-xs font-bold tabular-nums">{s.v}</div>
              </div>
            ))}
          </div>
          <div className="rounded-md bg-card/70 border border-border/30 divide-y divide-border/20 overflow-hidden">
            {[
              { name: "Allow RDP from Finance subnet", hits: "142", eps: 8,  mode: "enforce" },
              { name: "Allow SMB from server group",   hits: "891", eps: 12, mode: "enforce" },
              { name: "Custom: TeamViewer outbound",   hits: "2",   eps: 3,  mode: "audit"   },
              { name: "Block legacy SMBv1 inbound",    hits: "0",   eps: 22, mode: "enforce" },
            ].map(r => (
              <div key={r.name} className="flex items-center justify-between px-2.5 py-1.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Lock className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                  <span className="text-[10px] truncate">{r.name}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[9px] text-muted-foreground tabular-nums">{r.hits} hits · {r.eps} EPs</span>
                  <span className={`text-[8px] px-1.5 py-0.5 rounded font-semibold uppercase ${
                    r.mode === "enforce" ? "bg-emerald-500/15 text-emerald-600" : "bg-amber-500/15 text-amber-600"
                  }`}>
                    {r.mode}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between pt-1">
            <div className="text-[9px] text-muted-foreground">7-day trend</div>
            <button className="text-[9px] font-semibold px-2 py-1 rounded bg-primary text-primary-foreground">Promote 1 audit rule →</button>
          </div>
          <svg viewBox="0 0 100 16" className="w-full h-4 text-teal-500">
            <path d="M0 13 L10 12 L20 10 L30 11 L40 8 L50 9 L60 5 L70 7 L80 4 L90 3 L100 2" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <path d="M0 13 L10 12 L20 10 L30 11 L40 8 L50 9 L60 5 L70 7 L80 4 L90 3 L100 2 L100 16 L0 16 Z" fill="currentColor" opacity="0.12" />
          </svg>
        </Body>
      </Frame>
    );
  }

  // -------------------------------------------------------------------------
  // 2. EOL Windows hardening
  // -------------------------------------------------------------------------
  if (mockupType === "eol") {
    return (
      <Frame>
        <TopBar crumbs={["Endpoints", "LEGACY-FILE-01", "Hardening"]} status={{ dot: "ok", label: "Strong · verified 2h ago" }} />
        <Body>
          <div className="flex items-center justify-between rounded-md bg-card/70 border border-border/30 px-3 py-2">
            <div className="flex items-center gap-2">
              <Monitor className="h-4 w-4 text-amber-500" />
              <div>
                <div className="text-xs font-semibold">LEGACY-FILE-01</div>
                <div className="text-[9px] text-muted-foreground">Windows 7 SP1 · file server</div>
              </div>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <span className="text-[8px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 font-semibold uppercase">End-of-life</span>
              <span className="text-[9px] text-emerald-600 font-semibold">Compliance 92%</span>
            </div>
          </div>
          <div className="rounded-md bg-card/70 border border-border/30 divide-y divide-border/20">
            {[
              { ok: true,  label: "SMBv1 disabled",                   detail: "Registry + service removed" },
              { ok: true,  label: "TLS 1.0 / 1.1 disabled",           detail: "Schannel hardening profile applied" },
              { ok: true,  label: "Microsegmentation enforced",       detail: "47 rules · 0 deviations" },
              { ok: true,  label: "Application allow-list active",    detail: "12 publishers · 89 binaries trusted" },
              { ok: true,  label: "Defender signatures fresh",        detail: "Last update 38 min ago" },
              { ok: false, label: "Vulnerable PowerShell v2",         detail: "Auto-remediate available" },
            ].map(r => (
              <div key={r.label} className="flex items-center gap-2 px-2.5 py-1.5">
                {r.ok
                  ? <CheckCircle2 className="h-3 w-3 text-emerald-500 flex-shrink-0" />
                  : <AlertTriangle className="h-3 w-3 text-amber-500 flex-shrink-0" />
                }
                <span className="text-[10px] flex-1">{r.label}</span>
                <span className="text-[9px] text-muted-foreground truncate max-w-[160px]">{r.detail}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between text-[9px] pt-0.5">
            <span className="text-muted-foreground">ESU avoided: <span className="text-emerald-600 font-semibold">$61/yr</span> per device · fleet save $1,891</span>
            <button className="font-semibold px-2 py-1 rounded bg-amber-500/15 text-amber-700">Fix 1 issue →</button>
          </div>
        </Body>
      </Frame>
    );
  }

  // -------------------------------------------------------------------------
  // 3. Defender posture (threat list)
  // -------------------------------------------------------------------------
  if (mockupType === "defender") {
    return (
      <Frame>
        <TopBar crumbs={["Threats"]} status={{ dot: "warn", label: "14 active · 47 endpoints" }} />
        <Body>
          <div className="flex items-center gap-1">
            {[{ l: "All", n: 14, on: true }, { l: "Severe", n: 2 }, { l: "High", n: 5 }, { l: "Moderate", n: 7 }].map(f => (
              <div key={f.l} className={`text-[9px] px-2 py-0.5 rounded border ${
                f.on ? "bg-primary/15 border-primary/40 text-primary font-semibold" : "border-border/40 text-muted-foreground"
              }`}>
                {f.l} <span className="opacity-70">{f.n}</span>
              </div>
            ))}
          </div>
          <div className="rounded-md bg-card/70 border border-border/30 divide-y divide-border/20 overflow-hidden">
            {[
              { sev: "severe",   name: "Backdoor:Win32/Bladabindi",      host: "ACME-PC-04",       ago: "14m", status: "Active",      tone: "bad"  },
              { sev: "high",     name: "Trojan:Win32/Wacatac.B!ml",      host: "NORTHWIND-LAP-12", ago: "1h",  status: "Quarantined", tone: "ok"   },
              { sev: "severe",   name: "Ransom:Win32/Conti.gen!A",       host: "ACME-SQL-01",      ago: "2h",  status: "Blocked",     tone: "ok"   },
              { sev: "high",     name: "PUA:Win32/InstallCore",          host: "CONTOSO-WS-03",    ago: "3h",  status: "Cleaned",     tone: "ok"   },
              { sev: "moderate", name: "PUA:Win32/Adload",               host: "FABRIKAM-LAP-08",  ago: "4h",  status: "Cleaned",     tone: "ok"   },
            ].map(t => (
              <div key={t.name + t.host} className="flex items-center px-2.5 py-1.5 gap-2 text-[10px]">
                <span className={`text-[8px] px-1.5 py-0.5 rounded font-semibold uppercase w-[60px] text-center ${
                  t.sev === "severe"   ? "bg-rose-500/15 text-rose-600" :
                  t.sev === "high"     ? "bg-orange-500/15 text-orange-600" :
                                         "bg-amber-500/15 text-amber-600"
                }`}>{t.sev}</span>
                <span className="font-medium truncate flex-1">{t.name}</span>
                <span className="text-muted-foreground truncate w-24 text-right tabular-nums">{t.host}</span>
                <span className="text-muted-foreground text-[9px] w-10 text-right tabular-nums">{t.ago}</span>
                <span className={`text-[9px] font-semibold w-20 text-right ${
                  t.tone === "ok" ? "text-emerald-600" : "text-rose-600"
                }`}>{t.status}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-end text-[9px] gap-2">
            <button className="font-semibold px-2 py-1 rounded border border-border/40">Triage with AI</button>
            <button className="font-semibold px-2 py-1 rounded bg-primary text-primary-foreground">Acknowledge all →</button>
          </div>
        </Body>
      </Frame>
    );
  }

  // -------------------------------------------------------------------------
  // 4. Cross-platform agents (endpoint list)
  // -------------------------------------------------------------------------
  if (mockupType === "agent") {
    return (
      <Frame>
        <TopBar crumbs={["Endpoints"]} status={{ dot: "ok", label: "44 online · 3 offline" }} />
        <Body>
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1.5 flex-1 rounded-md border border-border/40 bg-card/70 px-2 py-1">
              <Search className="h-2.5 w-2.5 text-muted-foreground" />
              <span className="text-[9px] text-muted-foreground">Search 47 endpoints…</span>
            </div>
            <div className="text-[9px] px-2 py-1 rounded border border-border/40 text-muted-foreground">Windows 41 · Linux 6</div>
          </div>
          <div className="rounded-md bg-card/70 border border-border/30 divide-y divide-border/20 overflow-hidden">
            {[
              { host: "ACME-WS-01",        os: "Windows 11",    v: "v0.6.8", state: "online",  seen: "12s ago"  },
              { host: "ACME-WS-02",        os: "Windows 11",    v: "v0.6.8", state: "online",  seen: "47s ago"  },
              { host: "ACME-SRV-01",       os: "Server 2019",   v: "v0.6.8", state: "online",  seen: "2m ago"   },
              { host: "LEGACY-FILE-01",    os: "Windows 7 SP1", v: "v0.6.8", state: "online",  seen: "5m ago"   },
              { host: "NORTHWIND-LAP-03",  os: "Windows 10",    v: "v0.6.7", state: "update",  seen: "6m ago"   },
              { host: "NORTHWIND-LAP-05",  os: "Ubuntu 22.04",  v: "v0.6.8", state: "online",  seen: "1m ago"   },
              { host: "CONTOSO-WS-09",     os: "Windows 10",    v: "v0.6.8", state: "offline", seen: "4h ago"   },
            ].map(r => (
              <div key={r.host} className="flex items-center px-2.5 py-1.5 gap-2 text-[10px]">
                <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${
                  r.state === "online"  ? "bg-emerald-500" :
                  r.state === "update"  ? "bg-amber-500"   : "bg-rose-500"
                }`} />
                <span className="font-medium truncate flex-1 tabular-nums">{r.host}</span>
                <span className="text-muted-foreground w-24 truncate">{r.os}</span>
                <span className="text-muted-foreground w-14 text-right tabular-nums">{r.v}</span>
                <span className={`text-[8px] font-semibold uppercase w-16 text-right ${
                  r.state === "online" ? "text-emerald-600" :
                  r.state === "update" ? "text-amber-600"   : "text-rose-600"
                }`}>
                  {r.state === "update" ? "Update" : r.state}
                </span>
                <span className="text-[9px] text-muted-foreground w-14 text-right tabular-nums">{r.seen}</span>
              </div>
            ))}
          </div>
        </Body>
      </Frame>
    );
  }

  // -------------------------------------------------------------------------
  // 5. Threat hunting (IOC hunt in progress)
  // -------------------------------------------------------------------------
  if (mockupType === "hunting") {
    return (
      <Frame>
        <TopBar crumbs={["Hunting", "emotet-iocs-jun26"]} status={{ dot: "warn", label: "Running · 3 matches" }} />
        <Body>
          <div className="rounded-md bg-card/70 border border-border/30 px-3 py-2 space-y-1.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className="font-semibold">Hash, IP &amp; filename hunt across fleet</span>
              <span className="text-muted-foreground tabular-nums">76%</span>
            </div>
            <div className="h-1.5 rounded-full bg-border/40 overflow-hidden">
              <div className="h-full bg-cyan-500 rounded-full" style={{ width: "76%" }} />
            </div>
            <div className="flex justify-between text-[9px] text-muted-foreground tabular-nums">
              <span>47 scanned</span>
              <span>12 remaining</span>
              <span className="text-rose-600 font-semibold">3 matches</span>
            </div>
          </div>
          <div className="text-[9px] text-muted-foreground uppercase tracking-wider mt-1">Matches</div>
          <div className="rounded-md bg-card/70 border border-border/30 divide-y divide-border/20">
            {[
              { host: "ACME-WS-04",        ioc: "5a8e3d2f… (hash)",        kind: "process injection",  proc: "explorer.exe"  },
              { host: "ACME-WS-12",        ioc: "5a8e3d2f… (hash)",        kind: "file on disk",       proc: "%temp%\\wmic.exe" },
              { host: "NORTHWIND-LAP-12",  ioc: "185.220.103.x (ip)",      kind: "outbound C2 attempt",proc: "rundll32.exe"   },
            ].map(m => (
              <div key={m.host} className="flex items-center px-2.5 py-1.5 gap-2 text-[10px]">
                <Crosshair className="h-3 w-3 text-rose-500 flex-shrink-0" />
                <span className="font-medium truncate w-28 tabular-nums">{m.host}</span>
                <span className="text-muted-foreground font-mono text-[9px] truncate flex-1">{m.ioc}</span>
                <span className="text-[9px] text-rose-600 font-semibold truncate w-32 text-right">{m.kind}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-end gap-2 text-[9px]">
            <button className="font-semibold px-2 py-1 rounded border border-border/40">Export CSV</button>
            <button className="font-semibold px-2 py-1 rounded bg-rose-500/15 text-rose-700">Isolate 3 endpoints →</button>
          </div>
        </Body>
      </Frame>
    );
  }

  // -------------------------------------------------------------------------
  // 6. Group Policy without AD
  // -------------------------------------------------------------------------
  if (mockupType === "gpo") {
    return (
      <Frame>
        <TopBar crumbs={["Policies", "default-hardening"]} status={{ dot: "ok", label: "Applied · 23 endpoints" }} />
        <Body>
          <div className="rounded-md bg-card/70 border border-border/30 p-2.5 space-y-1.5">
            <div className="text-[10px] font-semibold flex items-center gap-1.5">
              <Lock className="h-3 w-3 text-primary" /> Password &amp; lockout
            </div>
            <div className="grid grid-cols-4 gap-1.5 text-[9px]">
              {[
                { l: "Min length", v: "14" },
                { l: "Complexity", v: "On" },
                { l: "Max age",    v: "60d" },
                { l: "Lockout",    v: "5 attempts" },
              ].map(p => (
                <div key={p.l} className="rounded bg-background/40 px-1.5 py-1">
                  <div className="text-[7px] text-muted-foreground uppercase">{p.l}</div>
                  <div className="font-semibold tabular-nums">{p.v}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-md bg-card/70 border border-border/30 p-2.5 space-y-1">
            <div className="text-[10px] font-semibold flex items-center gap-1.5">
              <Activity className="h-3 w-3 text-primary" /> Audit categories
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[9px]">
              {[
                { l: "Account logon",      v: "S+F" },
                { l: "Account management", v: "S+F" },
                { l: "Logon events",       v: "S+F" },
                { l: "Object access",      v: "F only" },
                { l: "Policy change",      v: "S+F" },
                { l: "Privilege use",      v: "F only" },
                { l: "Detailed tracking",  v: "Off" },
                { l: "DS access",          v: "F only" },
              ].map(c => (
                <div key={c.l} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{c.l}</span>
                  <span className={`font-semibold tabular-nums ${c.v === "Off" ? "text-muted-foreground" : "text-emerald-600"}`}>{c.v}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 text-[9px]">
            <span className="text-muted-foreground">Edited 2m ago by alice.h</span>
            <button className="font-semibold px-2 py-1 rounded bg-primary text-primary-foreground">Push to 23 endpoints →</button>
          </div>
        </Body>
      </Frame>
    );
  }

  // -------------------------------------------------------------------------
  // 7. Network security (service × group access matrix)
  // -------------------------------------------------------------------------
  if (mockupType === "incidents") {
    const groups   = ["Finance", "IT Ops", "Servers", "Guest"];
    const services = ["RDP", "SMB", "WinRM", "HTTPS", "SSH"];
    type Cell = "allow" | "block" | "audit";
    const matrix: Cell[][] = [
      ["block", "allow", "allow", "block"],   // RDP
      ["allow", "allow", "allow", "block"],   // SMB
      ["block", "allow", "audit", "block"],   // WinRM
      ["allow", "allow", "allow", "allow"],   // HTTPS
      ["block", "audit", "allow", "block"],   // SSH
    ];
    const cellStyle = (c: Cell) =>
      c === "allow" ? "bg-emerald-500/15 text-emerald-600" :
      c === "block" ? "bg-rose-500/10 text-rose-600"       :
                      "bg-amber-500/15 text-amber-700";
    const cellGlyph = (c: Cell) => c === "allow" ? "✓" : c === "block" ? "✕" : "?";
    return (
      <Frame>
        <TopBar crumbs={["Network", "Service × Group access"]} status={{ dot: "warn", label: "Audit · 12 days remaining" }} />
        <Body>
          <div className="rounded-md bg-card/70 border border-border/30 p-2.5">
            <div className="grid gap-1" style={{ gridTemplateColumns: `60px repeat(${groups.length}, 1fr)` }}>
              <div />
              {groups.map(g => (
                <div key={g} className="text-[8px] font-semibold text-muted-foreground uppercase text-center">{g}</div>
              ))}
              {services.map((svc, ri) => (
                <Fragment key={svc}>
                  <div className="text-[9px] font-semibold flex items-center">{svc}</div>
                  {matrix[ri].map((c, ci) => (
                    <div key={ci} className={`text-[10px] font-bold text-center py-1 rounded ${cellStyle(c)}`}>
                      {cellGlyph(c)}
                    </div>
                  ))}
                </Fragment>
              ))}
            </div>
          </div>
          <div className="rounded-md bg-card/70 border border-border/30 px-2.5 py-1.5">
            <div className="text-[9px] font-semibold mb-1">Observed traffic (last 24h)</div>
            <div className="space-y-0.5 text-[9px] font-mono">
              <div className="flex justify-between"><span className="text-muted-foreground">SMB · Finance → Servers</span><span className="tabular-nums">1,842 ✓</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">RDP · IT Ops → Servers</span><span className="tabular-nums">142 ✓</span></div>
              <div className="flex justify-between"><span className="text-rose-600">WinRM · Guest → Servers</span><span className="tabular-nums text-rose-600">3 ⚠ would block</span></div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 text-[9px]">
            <button className="font-semibold px-2 py-1 rounded border border-border/40">Extend audit</button>
            <button className="font-semibold px-2 py-1 rounded bg-primary text-primary-foreground">Promote to enforce →</button>
          </div>
        </Body>
      </Frame>
    );
  }

  // -------------------------------------------------------------------------
  // 8. Monthly customer PDF (page preview)
  // -------------------------------------------------------------------------
  if (mockupType === "reports") {
    return (
      <Frame>
        <div className="flex items-center justify-between px-4 py-2 bg-gradient-to-r from-fuchsia-600 to-violet-600 text-white">
          <div>
            <div className="text-[9px] uppercase tracking-[0.18em] opacity-90">Acme Corp</div>
            <div className="text-sm font-bold">Monthly Security Report</div>
          </div>
          <div className="text-right">
            <div className="text-[9px] opacity-90">May 2026</div>
            <div className="text-[9px] opacity-80">Issued 1 Jun</div>
          </div>
        </div>
        <Body>
          <div className="grid grid-cols-4 gap-1.5">
            {[
              { l: "Endpoints",        v: "47" },
              { l: "Online %",         v: "96%" },
              { l: "Threats blocked",  v: "12" },
              { l: "Compliance",       v: "98%" },
            ].map(k => (
              <div key={k.l} className="rounded-md bg-card/70 border border-border/30 px-2 py-1.5 text-center">
                <div className="text-base font-bold tabular-nums">{k.v}</div>
                <div className="text-[8px] text-muted-foreground uppercase tracking-wider">{k.l}</div>
              </div>
            ))}
          </div>
          <div className="rounded-md bg-card/70 border border-border/30 p-2.5 space-y-1">
            <div className="text-[9px] font-semibold flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-fuchsia-500" /> Executive summary
            </div>
            <div className="text-[9px] leading-relaxed text-muted-foreground space-y-1">
              <p>Defender blocked all 12 detections this month — no incidents required customer action. Microsegmentation enforcement on the finance subnet prevented two lateral-movement attempts from a compromised guest device.</p>
              <p>One Windows 10 laptop is overdue for a critical patch; we recommend pushing it before the next billing cycle.</p>
            </div>
          </div>
          <div className="rounded-md bg-card/70 border border-border/30 px-2.5 py-1.5">
            <div className="text-[9px] font-semibold mb-1">Top vulnerabilities</div>
            <div className="space-y-0.5 text-[9px]">
              <div className="flex justify-between"><span>CVE-2026-0142 · Chrome RCE</span><span className="text-rose-600 font-semibold tabular-nums">CVSS 9.1 · 3 EPs</span></div>
              <div className="flex justify-between"><span>CVE-2026-0089 · 7-Zip path traversal</span><span className="text-amber-600 font-semibold tabular-nums">CVSS 7.4 · 1 EP</span></div>
            </div>
          </div>
          <div className="flex items-center justify-between text-[8px] text-muted-foreground pt-0.5">
            <span>Prepared by Northwind MSP</span>
            <span>Powered by Mithras Threat Defence</span>
          </div>
        </Body>
      </Frame>
    );
  }

  // -------------------------------------------------------------------------
  // 9. Multi-tenant (tenant switcher dropdown)
  // -------------------------------------------------------------------------
  if (mockupType === "tenant") {
    return (
      <Frame>
        <TopBar crumbs={["Operator console", "Switch tenant"]} status={{ dot: "ok", label: "Super-admin: Northwind MSP" }} />
        <Body>
          <div className="flex items-center gap-1.5 rounded-md border border-border/40 bg-card/70 px-2 py-1.5">
            <Search className="h-2.5 w-2.5 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">Filter 5 customers…</span>
          </div>
          <div className="rounded-md bg-card/70 border border-border/30 divide-y divide-border/20 overflow-hidden">
            {[
              { name: "Acme Corp",          eps: 47, threats: 3, current: false, tone: "warn" },
              { name: "Northwind Trading",  eps: 22, threats: 0, current: true,  tone: "ok"   },
              { name: "Contoso Ltd",        eps: 89, threats: 1, current: false, tone: "warn" },
              { name: "Fabrikam Inc",       eps: 31, threats: 0, current: false, tone: "ok"   },
              { name: "Tailspin Toys",      eps: 12, threats: 0, current: false, tone: "ok"   },
            ].map(t => (
              <div key={t.name} className={`flex items-center px-2.5 py-1.5 gap-2 text-[10px] ${
                t.current ? "bg-primary/10" : ""
              }`}>
                <Building2 className={`h-3.5 w-3.5 flex-shrink-0 ${t.current ? "text-primary" : "text-muted-foreground"}`} />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate flex items-center gap-1.5">
                    {t.name}
                    {t.current && <span className="text-[7px] uppercase tracking-wider px-1 rounded bg-primary text-primary-foreground">Current</span>}
                  </div>
                  <div className="text-[8px] text-muted-foreground tabular-nums">
                    {t.eps} endpoints · {t.threats} active threats
                  </div>
                </div>
                <span className={`h-1.5 w-1.5 rounded-full ${
                  t.tone === "ok"   ? "bg-emerald-500" :
                  t.tone === "warn" ? "bg-amber-500"   : "bg-rose-500"
                }`} />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between text-[9px] pt-0.5">
            <span className="text-muted-foreground">5 customers · 201 endpoints fleet-wide</span>
            <button className="font-semibold px-2 py-1 rounded border border-border/40">View fleet ↗</button>
          </div>
        </Body>
      </Frame>
    );
  }

  // Fallback for any future mockupType added without a matching block.
  return (
    <Frame>
      <Body>
        <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
          <ShieldCheck className="h-4 w-4 mr-1" /> {feature.title}
        </div>
      </Body>
    </Frame>
  );
}

export function FeatureShowcase() {
  return (
    <section id="platform" className="py-24 px-6">
      <div className="container mx-auto">
        <div className="text-center mb-20 max-w-2xl mx-auto">
          <p className="text-xs font-semibold tracking-[0.18em] uppercase text-primary mb-4">
            The platform
          </p>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            A focused tour of the workflows that matter.
          </h2>
          <p className="text-muted-foreground">
            Nine deep-dive capabilities. Each one built around the daily work of running
            endpoint security for many customers at once.
          </p>
        </div>

        <div className="space-y-24">
          {PLATFORM_FEATURES.map((feature, index) => (
            <div
              key={feature.title}
              className="grid lg:grid-cols-2 gap-12 items-center"
            >
              <div className={index % 2 === 1 ? "lg:order-2" : ""}>
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    {feature.icon}
                  </div>
                  <h3 className="text-2xl font-bold">{feature.title}</h3>
                </div>
                <p className="text-muted-foreground mb-6 leading-relaxed">{feature.description}</p>
                <ul className="space-y-3">
                  {feature.highlights.map((highlight) => (
                    <li key={highlight} className="flex items-start gap-3">
                      <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <div className="h-2 w-2 rounded-full bg-primary" />
                      </div>
                      <span className="text-sm">{highlight}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className={index % 2 === 1 ? "lg:order-1" : ""}>
                <FeatureMockup feature={feature} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
