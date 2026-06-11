import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, History, ShieldCheck, X, AlertTriangle, DollarSign,
  Calendar, CheckCircle2, Lock, FileWarning,
} from "lucide-react";
import { LandingNav } from "@/components/landing/LandingNav";
import { Footer } from "@/components/landing/CTAFooter";
import { Seo } from "@/components/seo/Seo";

const SUPPORTED_OS = [
  { name: "Windows 7 SP1",        eol: "Out of mainstream since Jan 2020", mithras: true,  competitor: false },
  { name: "Windows 8.1",          eol: "Out of mainstream since Jan 2023", mithras: true,  competitor: false },
  { name: "Windows 10 22H2",      eol: "Mainstream ends Oct 2025",         mithras: true,  competitor: true  },
  { name: "Windows 11",           eol: "Current",                          mithras: true,  competitor: true  },
  { name: "Windows Server 2008/R2", eol: "Out of mainstream since 2020",  mithras: true,  competitor: false },
  { name: "Windows Server 2012 / 2012 R2", eol: "Mainstream ended Oct 2023", mithras: true, competitor: false },
  { name: "Windows Server 2016+", eol: "Supported",                        mithras: true,  competitor: true  },
];

const CONTROLS = [
  {
    title: "Defender posture, even on Win 7/8.1",
    detail: "Defender ships with every supported Windows. Mithras manages its config — real-time protection, ASR (where the OS supports it), cloud delivered detection — on every endpoint in your fleet, regardless of OS age.",
  },
  {
    title: "Application allow-listing",
    detail: "WDAC publisher / path / hash rules. On modern Windows: full enforcement. On legacy boxes: enforced via SRP-equivalent path-and-publisher controls that the agent ships with.",
  },
  {
    title: "Microsegmentation",
    detail: "Windows Firewall has been around since Windows XP SP2. The agent uses it to observe inbound traffic and lock down the rest — the same audit-then-enforce workflow on a Server 2012 R2 box as on a Server 2022 box.",
  },
  {
    title: "Microsoft Defender for SMB",
    detail: "Defender works on Win 7 SP1+ and Server 2008 R2+ via the Microsoft Defender for Endpoint downlevel agent. Mithras manages the policy, exclusions, and signature delivery without you needing M365 E5.",
  },
  {
    title: "Process-level threat detection",
    detail: "Sysmon-based process telemetry feeds the same AI SOC as your modern fleet. EOL endpoints aren't second-class citizens — same triage, same verification, same response policy.",
  },
  {
    title: "Compliance scoring per endpoint",
    detail: "Every legacy box gets a per-endpoint compliance score so you can show your customer exactly which controls are applied and which still need attention.",
  },
];

const ESU_PRICING = [
  { os: "Windows 10 ESU (Year 1)", price: "USD 61 per device · ~AUD 92", note: "Doubles every year" },
  { os: "Windows 10 ESU (Year 2)", price: "USD 122 per device · ~AUD 184", note: "" },
  { os: "Server 2012 R2 ESU (Year 1)", price: "USD 367 per server · ~AUD 555", note: "Per-core pricing on Server" },
  { os: "Server 2008 R2 ESU (Year 3)", price: "USD 200+ per server", note: "End of available extension" },
];

const EolWindows = () => {
  return (
    <>
      <Seo
        title="Defend EOL Windows — Win 7 / 8.1 / Server 2012 R2 without the ESU bill"
        description="Microsoft is sunsetting your endpoints. Most modern EDR products won't even install on them. Mithras covers Windows 7, 8.1, Server 2008/2012 R2 with the same agent and AI SOC as your current fleet — no Extended Security Updates bill required."
        canonical="/eol-windows"
      />
      <div className="min-h-screen bg-background">
        <LandingNav />

        {/* HERO */}
        <section className="relative pt-24 md:pt-32 pb-12 md:pb-16 px-4 sm:px-6 overflow-hidden">
          <div className="absolute inset-0 -z-10">
            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[1100px] h-[600px] bg-amber-500/10 rounded-full blur-3xl" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:24px_24px]" />
          </div>
          <div className="container mx-auto max-w-5xl text-center">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 text-amber-500 text-[11px] sm:text-xs font-medium tracking-wide uppercase mb-6 sm:mb-8 border border-amber-500/20">
              <History className="h-3.5 w-3.5" />
              EOL Windows hardening
            </div>
            <h1 className="text-[2.25rem] sm:text-5xl md:text-6xl font-bold tracking-tight mb-6 leading-[1.05] text-balance">
              Defend the boxes{" "}
              <span className="bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500 bg-clip-text text-transparent">
                CrowdStrike won&apos;t.
              </span>
            </h1>
            <p className="text-base sm:text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto mb-8 sm:mb-10 leading-relaxed">
              Microsoft is sunsetting Windows 7, 8.1, Server 2008 R2 and
              Server 2012 R2. Most modern EDR products won&apos;t even
              install on them. Mithras covers them with the same agent and
              the same AI SOC as your current fleet &mdash; without the
              Microsoft Extended Security Updates bill.
            </p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 max-w-md sm:max-w-none mx-auto">
              <Button size="lg" className="h-12 px-7 text-base shadow-lg shadow-primary/20 w-full sm:w-auto" asChild>
                <Link to="/contact-sales">
                  Talk to sales
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="h-12 px-7 text-base w-full sm:w-auto" asChild>
                <Link to="/platform">See the platform</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* PROBLEM */}
        <section className="py-12 sm:py-16 md:py-20 px-4 sm:px-6">
          <div className="container mx-auto max-w-4xl">
            <div className="text-center mb-10 sm:mb-12">
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-4 text-balance">
                Your legacy fleet is the easiest target on the network.
              </h2>
              <p className="text-base sm:text-lg text-muted-foreground leading-relaxed">
                Decommissioning the line-of-business app vendor still
                hasn&apos;t certified for Windows 11 isn&apos;t happening
                this quarter. Meanwhile your EDR doesn&apos;t support the
                box, and Microsoft wants thousands per device for Extended
                Security Updates.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-4 sm:gap-6">
              <div className="rounded-2xl border border-red-500/30 bg-red-500/5 backdrop-blur p-5 sm:p-6">
                <div className="flex items-center gap-2 text-red-500 mb-3">
                  <X className="h-5 w-5" />
                  <h3 className="font-semibold text-base">Without Mithras</h3>
                </div>
                <ul className="space-y-2.5 text-sm">
                  <li className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                    <span>EDR vendor refuses to install &mdash; or quietly stops getting signature updates</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                    <span>ESU bill scales every year; doubles in year two</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                    <span>Legacy boxes become uncovered blind spots in your security reporting</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                    <span>The customer's auditor wants to know what's protecting them &mdash; you don't have an answer</span>
                  </li>
                </ul>
              </div>

              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 backdrop-blur p-5 sm:p-6">
                <div className="flex items-center gap-2 text-emerald-500 mb-3">
                  <CheckCircle2 className="h-5 w-5" />
                  <h3 className="font-semibold text-base">With Mithras</h3>
                </div>
                <ul className="space-y-2.5 text-sm">
                  <li className="flex items-start gap-2">
                    <ShieldCheck className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                    <span>Same agent on Win 7 SP1 as Win 11 &mdash; same console, same AI SOC</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <ShieldCheck className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                    <span>Microsegmentation + WDAC enforce a zero-trust posture independent of OS age</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <ShieldCheck className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                    <span>Per-endpoint compliance score gives you an answer for the auditor</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <ShieldCheck className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                    <span>Skip the ESU bill &mdash; we quantify the avoided spend on the customer report</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* COVERAGE TABLE */}
        <section className="py-12 sm:py-16 md:py-20 px-4 sm:px-6 bg-muted/20">
          <div className="container mx-auto max-w-5xl">
            <div className="text-center mb-10 sm:mb-12">
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-3 sm:mb-4 text-balance">
                What we cover. What modern EDR doesn&apos;t.
              </h2>
              <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto">
                Modern EDR vendors generally drop support a year or two after
                Microsoft does. Our agent is built to bridge that gap.
              </p>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border/40 bg-card/50 backdrop-blur">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Operating system</th>
                    <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Status</th>
                    <th className="text-center px-4 py-3 font-medium">Mithras</th>
                    <th className="text-center px-4 py-3 font-medium">Typical EDR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {SUPPORTED_OS.map((os) => (
                    <tr key={os.name}>
                      <td className="px-4 py-3 font-medium">{os.name}</td>
                      <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{os.eol}</td>
                      <td className="px-4 py-3 text-center">
                        {os.mithras ? <CheckCircle2 className="h-5 w-5 text-emerald-500 mx-auto" /> : <X className="h-5 w-5 text-red-500 mx-auto" />}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {os.competitor ? <CheckCircle2 className="h-5 w-5 text-emerald-500/60 mx-auto" /> : <X className="h-5 w-5 text-red-500/70 mx-auto" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground text-center mt-4">
              &quot;Typical EDR&quot; based on publicly documented OS support
              policies for CrowdStrike, SentinelOne, Sophos, and Defender for
              Business as of 2026.
            </p>
          </div>
        </section>

        {/* CONTROLS APPLIED */}
        <section className="py-12 sm:py-16 md:py-20 px-4 sm:px-6">
          <div className="container mx-auto max-w-6xl">
            <div className="text-center mb-10 sm:mb-12">
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-3 sm:mb-4 text-balance">
                The controls that actually work on legacy Windows
              </h2>
              <p className="text-base sm:text-lg text-muted-foreground max-w-3xl mx-auto">
                Some modern controls don&apos;t exist on Win 7 or Server
                2012 R2. The ones below do &mdash; and Mithras applies them
                consistently across your fleet.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {CONTROLS.map((c) => (
                <div key={c.title} className="rounded-xl border border-border/40 bg-card/50 backdrop-blur p-5">
                  <Lock className="h-5 w-5 text-primary mb-3" />
                  <h3 className="font-semibold text-base mb-2">{c.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{c.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ESU AVOIDANCE */}
        <section className="py-12 sm:py-16 md:py-20 px-4 sm:px-6 bg-muted/20">
          <div className="container mx-auto max-w-4xl">
            <div className="text-center mb-10 sm:mb-12">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 text-amber-500 text-xs font-medium tracking-wide uppercase mb-4 border border-amber-500/20">
                <DollarSign className="h-3.5 w-3.5" />
                Skip the ESU bill
              </div>
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-4 text-balance">
                What Microsoft is charging
              </h2>
              <p className="text-base sm:text-lg text-muted-foreground leading-relaxed">
                Microsoft Extended Security Updates are designed to be a
                short-term bridge, priced to push you off the platform. Real
                numbers for context.
              </p>
            </div>

            <div className="space-y-3 mb-8">
              {ESU_PRICING.map((row) => (
                <div key={row.os} className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 sm:p-5 flex items-start gap-4">
                  <FileWarning className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-4">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-sm sm:text-base">{row.os}</h3>
                      {row.note && <p className="text-xs text-muted-foreground">{row.note}</p>}
                    </div>
                    <span className="font-mono text-sm text-amber-500 flex-shrink-0">{row.price}</span>
                  </div>
                </div>
              ))}
            </div>

            <p className="text-sm text-muted-foreground text-center">
              Mithras is &lt;$15/endpoint/month with full coverage of all the
              controls above. On a 50-endpoint legacy fleet you avoid
              roughly five figures in ESU spend per year &mdash; with a
              better security posture.
            </p>
          </div>
        </section>

        {/* CTA */}
        <section className="py-16 sm:py-20 md:py-24 px-4 sm:px-6 text-center">
          <div className="container mx-auto max-w-3xl">
            <Calendar className="h-10 w-10 mx-auto text-primary/40 mb-6" />
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-4 text-balance">
              Stop paying for ESU. Cover the boxes properly.
            </h2>
            <p className="text-base sm:text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
              Tell us how many EOL endpoints you have and we&apos;ll quantify
              the ESU avoidance + give you a fixed monthly cost in writing
              within 24 hours.
            </p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 max-w-md sm:max-w-none mx-auto">
              <Button size="lg" className="h-12 px-7 text-base shadow-lg shadow-primary/20 w-full sm:w-auto" asChild>
                <Link to="/contact-sales">
                  Talk to sales
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="h-12 px-7 text-base w-full sm:w-auto" asChild>
                <Link to="/platform">See the platform</Link>
              </Button>
            </div>
          </div>
        </section>

        <Footer />
      </div>
    </>
  );
};

export default EolWindows;
