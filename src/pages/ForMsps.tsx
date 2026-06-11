import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, Building2, Briefcase, FileText, ShieldCheck, Bot,
  Layers, TrendingUp, Users, Handshake, DollarSign, FileCheck2, CheckCircle2,
} from "lucide-react";
import { LandingNav } from "@/components/landing/LandingNav";
import { Footer } from "@/components/landing/CTAFooter";
import { Seo } from "@/components/seo/Seo";

const PILLARS = [
  {
    icon: <Building2 className="h-6 w-6" />,
    title: "Multi-tenant by design",
    description:
      "Unlimited customer organisations. Strict per-customer data isolation enforced at the database layer. Switch tenants instantly — every action is scoped to the customer you're on.",
  },
  {
    icon: <Bot className="h-6 w-6" />,
    title: "The AI SOC handles triage",
    description:
      "Five independent AI agents triage every alert across every customer, 24/7. You see consensus verdicts with cited evidence. Your team only touches the alerts that need a human.",
  },
  {
    icon: <FileText className="h-6 w-6" />,
    title: "Monthly customer reports — auto-drafted",
    description:
      "Auto-generated PDF report for every customer at the end of each month. KPIs, incidents, vulnerabilities, top software, AI-written executive summary. White-label with your branding if you want.",
  },
  {
    icon: <Handshake className="h-6 w-6" />,
    title: "Channel margins worth a sales team's effort",
    description:
      "Distributor → Reseller margin model designed for the Australian / NZ channel. Deal registration, lock-in, full pipeline visibility, monthly invoicing in each tier.",
  },
  {
    icon: <Layers className="h-6 w-6" />,
    title: "One console for every layer",
    description:
      "AI SOC, microseg, Defender management, EOL Windows hardening, application control, vuln scanning, monthly reports, remote access. One agent, one console, one bill.",
  },
  {
    icon: <Briefcase className="h-6 w-6" />,
    title: "Built in Australia for the channel",
    description:
      "Local team, local hosting option, local channel program. Sold exclusively through authorised partners — never end-runs around you.",
  },
];

const FEATURES = [
  "No Microsoft 365 E5 licence required — uses the Defender already in Windows",
  "End-of-life Windows hardening — skip the Microsoft extended-support bill",
  "Microsegmentation with one-click \"learn → lock down\" workflow",
  "Multi-tenant from day one — strict per-customer data isolation",
  "Windows + Linux agents (macOS on the roadmap)",
  "Process-level threat detection — full kill-chain visibility",
  "All 16 attack-surface-reduction rules + Defender posture",
  "Application allow-listing (WDAC) with reusable rule sets",
  "Full Group Policy controls without Active Directory",
  "Monthly customer PDF — auto-generated, auto-emailed",
  "WordPress site protection alongside endpoints",
  "M365 security posture — 11 controls audited daily",
  "Activity audit trail per tenant for compliance",
  "Browser-based remote desktop from the SOC console",
];

const REVENUE_MODEL = [
  {
    icon: <DollarSign className="h-5 w-5" />,
    title: "Predictable per-endpoint pricing",
    detail: "$11/endpoint/month list. Per-customer overrides. Pre-pay credits for term discounts.",
  },
  {
    icon: <TrendingUp className="h-5 w-5" />,
    title: "Margins that scale with your fleet",
    detail: "Distributor and reseller tiers each carry meaningful margin. Volume discounts pass through to the channel, not around it.",
  },
  {
    icon: <FileCheck2 className="h-5 w-5" />,
    title: "Deal registration that protects your pipeline",
    detail: "Lodge a deal early, lock in your margin, get full pipeline visibility against your distributor. No deal poaching.",
  },
  {
    icon: <Users className="h-5 w-5" />,
    title: "Recurring revenue with low churn",
    detail: "Security is sticky. Monthly billing on auto-pay. Renewals managed inside the same console.",
  },
];

const ForMsps = () => {
  return (
    <>
      <Seo
        title="Mithras for MSPs — Multi-tenant endpoint security with channel margins"
        description="Built for MSPs. AI SOC across every customer, multi-tenant from day one, auto-generated monthly reports, channel margins worth selling on. Sold exclusively through authorised partners across Australia and New Zealand."
        canonical="/for-msps"
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
              <Briefcase className="h-3.5 w-3.5" />
              For MSPs
            </div>
            <h1 className="text-[2.25rem] sm:text-5xl md:text-6xl font-bold tracking-tight mb-6 leading-[1.05] text-balance">
              The console your team{" "}
              <span className="bg-gradient-to-r from-primary via-primary/80 to-primary/50 bg-clip-text text-transparent">
                runs in every morning.
              </span>
            </h1>
            <p className="text-base sm:text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto mb-8 sm:mb-10 leading-relaxed">
              Multi-tenant from day one. AI SOC triages every alert across
              every customer. Monthly reports auto-drafted. Channel margins
              worth a sales team&apos;s effort. Built in Australia, sold
              through authorised partners.
            </p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 max-w-md sm:max-w-none mx-auto">
              <Button size="lg" className="h-12 px-7 text-base shadow-lg shadow-primary/20 w-full sm:w-auto" asChild>
                <Link to="/contact-sales">
                  Talk to sales
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="h-12 px-7 text-base w-full sm:w-auto" asChild>
                <Link to="/channel-program">Become a partner</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* CORE PILLARS */}
        <section className="py-12 sm:py-16 md:py-20 px-4 sm:px-6">
          <div className="container mx-auto max-w-6xl">
            <div className="text-center mb-10 sm:mb-12 md:mb-14">
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-3 sm:mb-4 text-balance">
                Why MSPs pick Mithras
              </h2>
              <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto">
                Built around the realities of running endpoint security for
                many customers at once. Not a single-tenant tool with a
                tenant-switcher bolted on.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {PILLARS.map((p) => (
                <div key={p.title} className="rounded-xl border border-border/40 bg-card/50 backdrop-blur p-5 sm:p-6">
                  <div className="h-11 w-11 rounded-lg bg-primary/10 text-primary border border-primary/20 flex items-center justify-center mb-4">
                    {p.icon}
                  </div>
                  <h3 className="font-semibold text-base sm:text-lg mb-2">{p.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{p.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* REVENUE MODEL */}
        <section className="py-12 sm:py-16 md:py-20 px-4 sm:px-6 bg-muted/20">
          <div className="container mx-auto max-w-6xl">
            <div className="text-center mb-10 sm:mb-12">
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-3 sm:mb-4 text-balance">
                A revenue model the channel actually likes
              </h2>
              <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto">
                Margins designed for distributor → reseller → end customer.
                Deal registration to protect your pipeline. Monthly billing
                that funds your security team.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 gap-3 sm:gap-4">
              {REVENUE_MODEL.map((r) => (
                <div key={r.title} className="rounded-xl border border-border/40 bg-card/60 backdrop-blur p-5 sm:p-6 flex items-start gap-4">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary border border-primary/20 flex items-center justify-center flex-shrink-0">
                    {r.icon}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-base mb-1.5">{r.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{r.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FEATURE LIST */}
        <section className="py-12 sm:py-16 md:py-20 px-4 sm:px-6">
          <div className="container mx-auto max-w-5xl">
            <div className="text-center mb-10 sm:mb-12">
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-3 sm:mb-4 text-balance">
                Everything in one platform
              </h2>
              <p className="text-base sm:text-lg text-muted-foreground max-w-3xl mx-auto">
                One agent on every endpoint. One console for your team. Sold
                as a single line item to your customer.
              </p>
            </div>
            <ul className="grid sm:grid-cols-2 gap-x-6 sm:gap-x-10 gap-y-3">
              {FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                  <span className="text-sm leading-snug">{f}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* CTA */}
        <section className="py-16 sm:py-20 md:py-24 px-4 sm:px-6 text-center">
          <div className="container mx-auto max-w-3xl">
            <ShieldCheck className="h-10 w-10 mx-auto text-primary/40 mb-6" />
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-4 text-balance">
              Talk to sales. 30 minutes.
            </h2>
            <p className="text-base sm:text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
              We&apos;ll walk through your current stack, your customer mix,
              and what migrating to Mithras would look like over a quarter.
              No hard sell, no slide deck.
            </p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 max-w-md sm:max-w-none mx-auto">
              <Button size="lg" className="h-12 px-7 text-base shadow-lg shadow-primary/20 w-full sm:w-auto" asChild>
                <Link to="/contact-sales">
                  Talk to sales
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="h-12 px-7 text-base w-full sm:w-auto" asChild>
                <Link to="/channel-program">Become a partner</Link>
              </Button>
            </div>
          </div>
        </section>

        <Footer />
      </div>
    </>
  );
};

export default ForMsps;
