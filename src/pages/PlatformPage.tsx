import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, ShieldCheck, Eye, Lock, Layers, Bug, Network, History,
  ServerCog, FileSearch, AlertTriangle,
} from "lucide-react";
import { LandingNav } from "@/components/landing/LandingNav";
import { Footer } from "@/components/landing/CTAFooter";
import { Seo } from "@/components/seo/Seo";
import { BrowserFrame } from "@/components/landing/visuals/BrowserFrame";
import { MockSocDashboard } from "@/components/landing/visuals/MockSocDashboard";

interface Pillar {
  id: string;
  name: string;
  icon: React.ReactNode;
  tagline: string;
  description: string;
  bullets: string[];
  href?: string;
}

const PILLARS: Pillar[] = [
  {
    id: "ai-soc",
    name: "AI SOC",
    icon: <Eye className="h-6 w-6" />,
    tagline: "Five agents triage every alert. Independent verdicts. Citation-enforced.",
    description:
      "Triage, Verification, Adversarial, Response, and Communications agents run in chain. None of them sees the next one's verdict until it's finished. Bounded auto-response with automatic rollback.",
    bullets: [
      "Triage in seconds, not minutes",
      "3-agent consensus before any action",
      "Every verdict cites the evidence",
      "24/7/365 — no analyst overhead",
    ],
    href: "/ai-soc",
  },
  {
    id: "microseg",
    name: "Microsegmentation",
    icon: <Network className="h-6 w-6" />,
    tagline: "Audit-mode rules learn what's normal. One click locks down the rest.",
    description:
      "Each endpoint runs in observe-first mode, recording who talks to it and on what port. Promote any observation to a Windows Firewall block from the same console, with one-click source whitelisting for the legitimate traffic.",
    bullets: [
      "Per-endpoint and per-service granularity",
      "Inbound and outbound rule sets",
      "Audit, then enforce — no surprises",
      "Promote observations to rules in one click",
    ],
  },
  {
    id: "eol-windows",
    name: "EOL Windows hardening",
    icon: <History className="h-6 w-6" />,
    tagline: "Defend Windows 7, 8.1, Server 2012 and 2012 R2 without the ESU bill.",
    description:
      "Profile-driven hardening for end-of-life Windows. Per-endpoint compliance scoring tells you exactly which controls are applied and which still need attention. Skip the Microsoft Extended Security Updates bill, with the avoided spend quantified for your customer.",
    bullets: [
      "Coverage CrowdStrike and SentinelOne won't offer",
      "Quantified avoided ESU spend",
      "Same console as your modern fleet",
      "Per-endpoint compliance scoring",
    ],
    href: "/eol-windows",
  },
  {
    id: "defender",
    name: "Defender management",
    icon: <ShieldCheck className="h-6 w-6" />,
    tagline: "Full Microsoft Defender posture coverage. No E5 required.",
    description:
      "Real-time protection, cloud-delivered detection, behavior monitoring, all 16 ASR rules, controlled folder access, network protection, exploit protection, and centralised exclusions — driven from per-customer policies and surfaced in a fleet view.",
    bullets: [
      "All 16 Attack Surface Reduction rules",
      "Controlled folder access against ransomware",
      "Per-customer exclusion management",
      "Defender posture as fleet KPIs",
    ],
  },
  {
    id: "app-control",
    name: "Application whitelisting (WDAC)",
    icon: <Lock className="h-6 w-6" />,
    tagline: "Zero-trust application control. Audit first, enforce second.",
    description:
      "Windows Defender Application Control with publisher rules, path rules, hash rules, reusable rule sets, and live app-discovery. Run in audit mode to baseline a fleet, then promote to enforce per ring.",
    bullets: [
      "Publisher / path / hash rules",
      "Reusable rule sets, deploy by ring",
      "App discovery + baseline snapshots",
      "Audit and block modes per endpoint",
    ],
  },
  {
    id: "vuln-scan",
    name: "AI vulnerability scanning",
    icon: <Bug className="h-6 w-6" />,
    tagline: "Nightly CVE scan with AI-driven exploitability assessment.",
    description:
      "Software inventory + CVE matching + LLM-assisted exploitability and mitigation guidance. Tells you not just what's vulnerable, but what to do about it in language a customer can act on.",
    bullets: [
      "Nightly per-org CVE sweep",
      "AI-drafted mitigation guidance",
      "Per-endpoint findings + history",
      "Surfaces in the monthly customer report",
    ],
  },
  {
    id: "agents",
    name: "Cross-platform agents",
    icon: <ServerCog className="h-6 w-6" />,
    tagline: "Lightweight, signed, tamper-protected. Windows and Linux today.",
    description:
      "Outbound-only agents (no inbound firewall holes), HMAC-authenticated heartbeats, automatic version management, signed bundles, and tamper protection on the service + install directory.",
    bullets: [
      "Windows 7+ and Linux (Ubuntu, RHEL, Debian)",
      "Outbound HTTPS only",
      "Tamper-protected service + DACL",
      "Automatic version management",
    ],
  },
  {
    id: "remote",
    name: "Remote desktop + RMM",
    icon: <Layers className="h-6 w-6" />,
    tagline: "MeshCentral-powered remote access from the same console.",
    description:
      "Click a button on any endpoint, get a remote session in your browser. SSO from the SOC console, audit-logged, scoped to your operators. No extra tools, no extra logins.",
    bullets: [
      "Browser-based remote desktop",
      "SSO from the SOC console",
      "Audit-logged sessions",
      "MSP-grade access controls",
    ],
  },
];

const Platform = () => {
  return (
    <>
      <Seo
        title="The Mithras Platform — AI SOC, EOL hardening, Defender management, microseg"
        description="Eight integrated capabilities in one platform: AI SOC, microsegmentation, EOL Windows hardening, Defender management, WDAC application control, AI vulnerability scanning, tamper-protected cross-platform agents, and browser-based remote access."
        canonical="/platform"
      />
      <div className="min-h-screen bg-background">
        <LandingNav />

        {/* HERO */}
        <section className="relative pt-24 md:pt-32 pb-12 md:pb-16 px-4 sm:px-6 overflow-hidden">
          <div className="absolute inset-0 -z-10">
            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[1100px] h-[600px] bg-primary/10 rounded-full blur-3xl" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:24px_24px]" />
          </div>
          <div className="container mx-auto max-w-5xl text-center">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-[11px] sm:text-xs font-medium tracking-wide uppercase mb-6 sm:mb-8 border border-primary/20">
              <Layers className="h-3.5 w-3.5" />
              The Mithras Platform
            </div>
            <h1 className="text-[2.25rem] sm:text-5xl md:text-6xl font-bold tracking-tight mb-6 leading-[1.05] text-balance">
              One agent.{" "}
              <span className="bg-gradient-to-r from-primary via-primary/80 to-primary/50 bg-clip-text text-transparent">
                One console.
              </span>{" "}
              Eight capabilities.
            </h1>
            <p className="text-base sm:text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto mb-12 leading-relaxed">
              AI SOC, microsegmentation, EOL Windows hardening, Defender
              management, application control, AI vulnerability scanning,
              cross-platform agents, and remote access &mdash; integrated end
              to end, multi-tenant from day one.
            </p>
          </div>

          {/* Platform-overview screenshot */}
          <div className="container mx-auto max-w-6xl">
            <BrowserFrame url="console.mithras.com.au/soc" tilt>
              <MockSocDashboard />
            </BrowserFrame>
          </div>
        </section>

        {/* PILLARS */}
        <section className="py-12 sm:py-16 md:py-20 px-4 sm:px-6">
          <div className="container mx-auto max-w-6xl space-y-4 sm:space-y-6">
            {PILLARS.map((p) => (
              <div
                key={p.id}
                id={p.id}
                className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur p-5 sm:p-7 md:p-9"
              >
                <div className="grid md:grid-cols-[1fr_320px] gap-6 md:gap-10 items-start">
                  <div>
                    <div className="flex items-start gap-3 mb-3">
                      <div className="h-11 w-11 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 border border-primary/20">
                        {p.icon}
                      </div>
                      <div className="min-w-0">
                        <h2 className="text-xl sm:text-2xl font-bold tracking-tight leading-tight">{p.name}</h2>
                        <p className="text-sm sm:text-base text-primary/80 mt-1">{p.tagline}</p>
                      </div>
                    </div>
                    <p className="text-sm sm:text-base text-muted-foreground leading-relaxed mb-5">{p.description}</p>
                    {p.href && (
                      <Button size="sm" variant="outline" asChild>
                        <Link to={p.href}>
                          Deep dive
                          <ArrowRight className="ml-2 h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    )}
                  </div>
                  <div className="bg-background/40 rounded-xl border border-border/40 p-4 sm:p-5">
                    <ul className="space-y-2.5">
                      {p.bullets.map((b) => (
                        <li key={b} className="flex items-start gap-2 text-sm">
                          <span className="text-primary mt-0.5 flex-shrink-0">▸</span>
                          <span className="text-foreground/85">{b}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* HOW IT FITS TOGETHER */}
        <section className="py-12 sm:py-16 md:py-20 px-4 sm:px-6 bg-muted/20">
          <div className="container mx-auto max-w-4xl text-center">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-4 sm:mb-6 text-balance">
              All driven by the same multi-tenant policy engine.
            </h2>
            <p className="text-base sm:text-lg text-muted-foreground leading-relaxed mb-6">
              One operator console. Many customer organisations. Strict data
              isolation. Per-customer policies that drive every layer above.
              A monthly client report auto-generated from the same data and
              delivered straight to your customer&apos;s IT manager.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mt-8 text-left">
              <Bullet icon={<FileSearch className="h-4 w-4" />} title="Multi-tenant from day one" detail="Unlimited customer organisations. Per-customer policies. Strict data isolation." />
              <Bullet icon={<ShieldCheck className="h-4 w-4" />} title="Auto-generated client reports" detail="Monthly PDF, KPIs, incidents, vulnerabilities, top software. White-labelled if you want." />
              <Bullet icon={<AlertTriangle className="h-4 w-4" />} title="One alert pipeline" detail="Defender, ASR, WDAC, firewall, sysmon, network — all into the same AI SOC." />
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-16 sm:py-20 md:py-24 px-4 sm:px-6 text-center">
          <div className="container mx-auto max-w-3xl">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-4 text-balance">
              See it in your environment.
            </h2>
            <p className="text-base sm:text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
              30-minute demo. We&apos;ll walk through your current stack and
              show you what migrating to Mithras would look like.
            </p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 max-w-md sm:max-w-none mx-auto">
              <Button size="lg" className="h-12 px-7 text-base shadow-lg shadow-primary/20 w-full sm:w-auto" asChild>
                <Link to="/contact-sales">
                  Talk to sales
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="h-12 px-7 text-base w-full sm:w-auto" asChild>
                <Link to="/for-msps">
                  For MSPs
                </Link>
              </Button>
            </div>
          </div>
        </section>

        <Footer />
      </div>
    </>
  );
};

function Bullet({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return (
    <div className="rounded-xl border border-border/40 bg-card/60 p-4 backdrop-blur">
      <div className="text-primary mb-2">{icon}</div>
      <h3 className="font-semibold text-sm mb-1">{title}</h3>
      <p className="text-xs text-muted-foreground leading-relaxed">{detail}</p>
    </div>
  );
}

export default Platform;
