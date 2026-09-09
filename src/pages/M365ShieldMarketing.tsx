import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowRight, Shield, ShieldCheck, KeyRound, Activity, Plug, Eye,
  Clock, CheckCircle2, XCircle, Info, AlertTriangle, Sparkles, Calculator,
} from "lucide-react";
import { LandingNav } from "@/components/landing/LandingNav";
import { Footer } from "@/components/landing/CTAFooter";
import { Seo } from "@/components/seo/Seo";
import { organizationSchema, breadcrumbSchema, faqSchema } from "@/components/seo/jsonLd";
import { Card, CardContent } from "@/components/ui/card";

// Mithras M365 Shield — marketing surface. Sells the "stay on Basic/Standard,
// skip the Premium upgrade" story. Honest disclosure where Mithras
// approximates rather than replaces a Microsoft control.

const CAPABILITIES = [
  {
    title: "PIM-lite",
    body: "Time-boxed admin role elevation. Operator picks the user, role, duration, and reason. Mithras grants via Graph and auto-revokes when the timer expires.",
    replaces: "Entra ID P2 PIM ($9/user/mo)",
    icon: <KeyRound className="h-5 w-5" />,
    parity: "full",
  },
  {
    title: "Risky sign-in scoring",
    body: "Continuous per-user 0-100 risk score from sign-in patterns. Geo anomalies, impossible travel, TOR/hostile ASNs, off-hours bursts, failed MFA, password-spray patterns.",
    replaces: "Entra ID P2 Identity Protection ($9/user/mo)",
    icon: <Activity className="h-5 w-5" />,
    parity: "high",
  },
  {
    title: "OAuth governance",
    body: "Inventory of every third-party app users have consented to. Risk score per grant based on scope blast radius and publisher trust. One-click revoke.",
    replaces: "Defender for Cloud Apps OAuth ($5/user/mo)",
    icon: <Plug className="h-5 w-5" />,
    parity: "full",
  },
  {
    title: "Access reviews",
    body: "Quarterly attestation cycles for admins, external guests, mailbox delegates. Operator confirms keep-or-remove per row; Mithras enforces.",
    replaces: "Entra ID P2 Access Reviews ($9/user/mo)",
    icon: <CheckCircle2 className="h-5 w-5" />,
    parity: "full",
  },
  {
    title: "MFA enforcement loop",
    body: "Detect users signed in without MFA registered, revoke their sessions, send a guided enrollment link. Loop until enrolled.",
    replaces: "Entra ID P1 MFA controls ($6/user/mo)",
    icon: <ShieldCheck className="h-5 w-5" />,
    parity: "high",
  },
  {
    title: "Long-retention audit log",
    body: "Twelve-month searchable mirror of M365 audit + sign-in logs. Pre-built breach-investigation queries.",
    replaces: "Purview Audit Premium ($3/user/mo)",
    icon: <Eye className="h-5 w-5" />,
    parity: "full",
  },
];

const COMPARISON = [
  { feature: "Time-boxed admin elevation",      ms: "Entra ID P2 PIM",                    msPrice: "$9/user",  shield: true,  parity: "full" },
  { feature: "Risky sign-in detection",         ms: "Entra ID P2 Identity Protection",    msPrice: "$9/user",  shield: true,  parity: "high" },
  { feature: "OAuth consent governance",        ms: "Defender for Cloud Apps",            msPrice: "$5/user",  shield: true,  parity: "full" },
  { feature: "Access reviews",                  ms: "Entra ID P2",                        msPrice: "$9/user",  shield: true,  parity: "full" },
  { feature: "MFA enforcement",                 ms: "Entra ID P1",                        msPrice: "$6/user",  shield: true,  parity: "high" },
  { feature: "Audit log 12-month retention",    ms: "Purview Audit Premium",              msPrice: "$3/user",  shield: true,  parity: "full" },
  { feature: "Conditional Access at sign-in",   ms: "Entra ID P1",                        msPrice: "$6/user",  shield: false, parity: "approx", note: "Mithras reacts to sign-in, doesn't gate it." },
  { feature: "Self-service password reset",     ms: "Entra ID P1",                        msPrice: "$6/user",  shield: false, parity: "none",   note: "Lives in Microsoft's sign-in UI." },
  { feature: "Pre-delivery email pipeline",     ms: "Defender for O365 P1/P2",            msPrice: "$2-5/user",shield: false, parity: "approx", note: "Mithras retracts after delivery; not in the SMTP pipeline." },
];

const FAQS = [
  {
    q: "Why is this cheaper than Microsoft's add-ons?",
    a: "Mithras uses Microsoft Graph endpoints that come free with every M365 plan, even Business Basic. We pay for the platform that schedules the polls, runs the AI, and gives operators a console. Microsoft charges for features baked into their identity pipeline and ML backend. For the SMB use case, the Graph-based delivery reaches the same outcomes.",
  },
  {
    q: "Will this replace Entra ID P1 / P2 outright?",
    a: "It replaces the outcomes most SMBs buy P1/P2 for: time-boxed admin elevation, risky sign-in detection, access reviews, OAuth governance, MFA enforcement. It does not replace Microsoft's at-sign-in Conditional Access enforcement (Mithras reacts to sign-ins, doesn't gate them) or Microsoft's cross-tenant ML risk feed. If your insurer or auditor specifically mandates at-sign-in enforcement at the IdP, you still need P1.",
  },
  {
    q: "How fast does Mithras react?",
    a: "Risk scoring runs continuously. PIM auto-revoke runs on a short cron interval — typical post-expiry exposure is under that interval. OAuth inventory runs daily. The specific cadences are internal so we can tune them without rewriting customer commitments.",
  },
  {
    q: "Do I need to change anything in M365?",
    a: "One time: complete the Mithras M365 connect flow with admin consent. That grants the scopes Mithras needs (auditLog.Read.All, Application.Read.All, Directory.ReadWrite.All for remediation, User.RevokeSessions.All). After that, nothing in M365 changes. No new admin accounts, no DNS changes, no MX changes.",
  },
  {
    q: "What if Microsoft changes a Graph endpoint?",
    a: "Mithras tracks Graph API deprecations. We adapt the platform centrally so every customer benefits without lifting a finger. The honest tradeoff with a Graph-based delivery model is we are exposed to Microsoft API changes; we accept that as part of the architecture.",
  },
  {
    q: "Can I turn it off?",
    a: "Yes. The org admin (or your MSP) toggles M365 Shield on or off per organization. Disabling stops all polls immediately. Active PIM elevations continue to auto-revoke when their timers expire. Historical data is preserved.",
  },
];

const PARITY_BADGE: Record<string, { label: string; tone: string }> = {
  full:   { label: "Full parity",          tone: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  high:   { label: "High parity",          tone: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  approx: { label: "Approximation",        tone: "bg-amber-100  text-amber-800   border-amber-200" },
  none:   { label: "Not replaced",         tone: "bg-slate-100  text-slate-700   border-slate-200" },
};

function SavingsCalculator() {
  const [seats, setSeats] = useState<number>(25);
  const safe = Number.isFinite(seats) && seats > 0 ? seats : 0;

  // M365 SKUs in AUD per user per month (illustrative; matches Microsoft AU pricing
  // at time of writing — actual quoted price varies by reseller).
  const BASIC_AUD = 8.10;
  const PREMIUM_AUD = 30.30;
  const MITHRAS_AUD = 11.00;

  const upgradeDelta   = safe * (PREMIUM_AUD - BASIC_AUD);
  const withMithras    = safe * (BASIC_AUD + MITHRAS_AUD);
  const microsoftPath  = safe * PREMIUM_AUD;
  const monthlySavings = microsoftPath - withMithras;
  const yearlySavings  = monthlySavings * 12;

  return (
    <div className="rounded-xl border bg-card p-6 md:p-8">
      <div className="flex items-center gap-2 mb-4">
        <Calculator className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold">Savings calculator</h3>
      </div>
      <div className="grid md:grid-cols-3 gap-6 items-end">
        <div>
          <Label htmlFor="seats" className="text-xs uppercase tracking-wide text-muted-foreground">Seats</Label>
          <Input id="seats" type="number" min={1} value={seats} onChange={(e) => setSeats(Number(e.target.value))} className="mt-1 text-lg" />
          <p className="text-xs text-muted-foreground mt-1">Number of M365 users.</p>
        </div>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">M365 Business Basic alone</span>
            <span className="font-medium">${(safe * BASIC_AUD).toFixed(2)}/mo</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Upgrade to Business Premium</span>
            <span className="font-medium">${microsoftPath.toFixed(2)}/mo</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Basic + Mithras Shield</span>
            <span className="font-medium text-primary">${withMithras.toFixed(2)}/mo</span>
          </div>
        </div>
        <div className="rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 p-4 text-center">
          <div className="text-xs uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Save</div>
          <div className="text-3xl font-bold text-emerald-700 dark:text-emerald-300">
            ${monthlySavings.toFixed(0)}<span className="text-base font-normal">/mo</span>
          </div>
          <div className="text-xs text-emerald-700/80 dark:text-emerald-300/80 mt-1">${yearlySavings.toFixed(0)}/year</div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-4">
        Indicative AUD pricing. M365 list prices vary by region and reseller; quote your actuals against Mithras to see the real number.
        Mithras Shield is included in every Mithras subscription — no add-on SKU.
      </p>
    </div>
  );
}

export default function M365ShieldMarketingPage() {
  return (
    <>
      <Seo
        title="Mithras M365 Shield — Entra ID P1, P2, and Defender outcomes for a fraction of the price"
        description="Stay on Microsoft 365 Business Basic. Get PIM-lite, risky sign-in detection, OAuth governance, and access reviews via Mithras. Skip the $14/user/month upgrade to Business Premium."
        canonical="/m365-shield"
        structuredData={[
          organizationSchema(),
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "M365 Shield", url: "/m365-shield" },
          ]),
          faqSchema(FAQS.map((f) => ({ question: f.q, answer: f.a }))),
        ]}
      />
      <div className="min-h-screen bg-background">
        <LandingNav />

        {/* Hero */}
        <section className="relative pt-24 md:pt-28 pb-16 md:pb-20 px-4 sm:px-6 overflow-hidden">
          <div className="absolute inset-0 -z-10">
            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[1200px] h-[700px] bg-primary/10 rounded-full blur-3xl" />
          </div>
          <div className="container mx-auto max-w-5xl text-center">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium tracking-wide uppercase mb-6 border border-primary/20">
              <Shield className="h-3.5 w-3.5" />
              M365 Shield
            </div>
            <h1 className="text-[2.25rem] sm:text-5xl md:text-6xl font-bold tracking-tight mb-6 leading-[1.05] text-balance">
              Entra ID P1, P2, and Defender outcomes{" "}
              <span className="bg-gradient-to-r from-primary via-primary/80 to-primary/50 bg-clip-text text-transparent">
                for a fraction of the price.
              </span>
            </h1>
            <p className="text-base sm:text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto mb-8 leading-relaxed">
              Stay on Microsoft 365 Business Basic. Mithras Shield delivers PIM-lite,
              risky sign-in detection, OAuth governance, access reviews, and 12-month
              audit retention — using Microsoft Graph endpoints that come with every
              M365 plan. Skip the upgrade to Business Premium.
            </p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 mb-8 max-w-md sm:max-w-none mx-auto">
              <Button size="lg" className="h-12 px-7 text-base shadow-lg shadow-primary/20 w-full sm:w-auto" asChild>
                <Link to="/contact-sales">
                  Talk to sales
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="h-12 px-7 text-base w-full sm:w-auto" asChild>
                <Link to="/pricing">See pricing</Link>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground inline-flex items-center justify-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              Included in every Mithras subscription. One module switch per customer.
            </p>
          </div>
        </section>

        {/* Savings calculator */}
        <section className="px-4 sm:px-6 pb-16">
          <div className="container mx-auto max-w-5xl">
            <SavingsCalculator />
          </div>
        </section>

        {/* Honest disclosure */}
        <section className="px-4 sm:px-6 pb-16">
          <div className="container mx-auto max-w-4xl">
            <div className="rounded-xl border border-amber-500/30 bg-amber-50/30 dark:bg-amber-500/5 p-6">
              <div className="flex gap-3">
                <Info className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <h2 className="text-lg font-semibold mb-2">How honestly we deliver these outcomes</h2>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Mithras reacts to signals it observes in Microsoft Graph and applies controls
                    through Graph endpoints. Microsoft Entra ID P1/P2 enforces some of the same
                    controls at the sign-in itself. The practical difference for an SMB: Mithras's
                    reaction loop is short enough that the gap doesn't matter for almost every real
                    attack pattern. For specific compliance regimes that mandate at-sign-in
                    enforcement at the IdP layer (a small share of buyers), P1 remains the right
                    tool. For everyone else, Shield reaches the same outcome for a fraction of the cost.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Capabilities */}
        <section className="px-4 sm:px-6 pb-20">
          <div className="container mx-auto max-w-6xl">
            <h2 className="text-3xl md:text-4xl font-bold text-center mb-12">What's in the module</h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {CAPABILITIES.map((c) => (
                <Card key={c.title}>
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="rounded-md bg-primary/10 text-primary p-2">{c.icon}</div>
                      <div className="font-semibold">{c.title}</div>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">{c.body}</p>
                    <div className="text-xs">
                      <span className="text-muted-foreground">Replaces </span>
                      <span className="font-medium">{c.replaces}</span>
                    </div>
                    <span className={`inline-flex text-[11px] px-2 py-0.5 rounded-full border ${PARITY_BADGE[c.parity].tone}`}>
                      {PARITY_BADGE[c.parity].label}
                    </span>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Comparison table */}
        <section className="px-4 sm:px-6 pb-20 bg-muted/30">
          <div className="container mx-auto max-w-5xl py-12">
            <h2 className="text-3xl md:text-4xl font-bold text-center mb-3">Shield vs Microsoft add-ons</h2>
            <p className="text-center text-sm text-muted-foreground mb-8">Honest map of what we replace, approximate, or leave to Microsoft.</p>

            <div className="rounded-xl border bg-card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3 font-medium">Capability</th>
                    <th className="text-left p-3 font-medium">Microsoft SKU</th>
                    <th className="text-right p-3 font-medium">MS price</th>
                    <th className="text-center p-3 font-medium">Mithras</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.map((r) => (
                    <tr key={r.feature} className="border-t">
                      <td className="p-3">
                        <div>{r.feature}</div>
                        {r.note && <div className="text-xs text-muted-foreground mt-0.5">{r.note}</div>}
                      </td>
                      <td className="p-3 text-muted-foreground">{r.ms}</td>
                      <td className="p-3 text-right text-muted-foreground">{r.msPrice}</td>
                      <td className="p-3 text-center">
                        {r.shield ? (
                          <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${PARITY_BADGE[r.parity].tone}`}>
                            <CheckCircle2 className="h-3 w-3" />
                            {PARITY_BADGE[r.parity].label}
                          </span>
                        ) : (
                          <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${PARITY_BADGE[r.parity].tone}`}>
                            <XCircle className="h-3 w-3" />
                            {PARITY_BADGE[r.parity].label}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="px-4 sm:px-6 pb-20">
          <div className="container mx-auto max-w-3xl">
            <h2 className="text-3xl md:text-4xl font-bold text-center mb-12">Frequently asked</h2>
            <div className="space-y-4">
              {FAQS.map((f, i) => (
                <Card key={i}>
                  <CardContent className="p-5">
                    <div className="font-semibold mb-2">{f.q}</div>
                    <p className="text-sm text-muted-foreground leading-relaxed">{f.a}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="px-4 sm:px-6 pb-20">
          <div className="container mx-auto max-w-3xl text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Stay on Basic. Get Premium-grade security.</h2>
            <p className="text-base text-muted-foreground mb-8 max-w-2xl mx-auto">
              Talk to us about turning M365 Shield on for your tenant. We'll run the connect flow,
              gate the elevated remediation scopes behind your consent, and show you what the platform
              would have caught in the last 30 days.
            </p>
            <Button size="lg" className="h-12 px-8" asChild>
              <Link to="/contact-sales">Talk to sales <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          </div>
        </section>

        <Footer />
      </div>
    </>
  );
}
