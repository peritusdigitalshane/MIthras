import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, ShieldCheck, ScanLine, AlertTriangle, Clock, Lock,
  CheckCircle2, XCircle, Zap, Bot, Mail, Info, Eye, ListChecks, Cloud,
} from "lucide-react";
import { LandingNav } from "@/components/landing/LandingNav";
import { Footer } from "@/components/landing/CTAFooter";
import { Seo } from "@/components/seo/Seo";
import { organizationSchema, breadcrumbSchema, faqSchema } from "@/components/seo/jsonLd";

// Marketing page for Mithras Identity Defence — "Conditional Access
// outcomes without the Entra ID P1 licence". Honest disclosure throughout:
// we're a detect-and-respond control, not a preventive identity gate.
// No specific cadence numbers committed to in copy; the platform dial is
// internal and we want room to tune.

const PHASES = [
  {
    number: "01",
    title: "Detect",
    role: "Signals Mithras already collects",
    icon: <ScanLine className="h-5 w-5" />,
    body: "Mithras pulls signals from every surface it already watches: endpoint posture from the Windows agent, mailbox activity from the M365 Graph read scope, OAuth grants, network telemetry, vulnerability state. A new mailbox rule that forwards externally, a Defender critical detection, a sudden OAuth grant from a junior account — every one shows up on a continuous loop.",
    accent: "from-cyan-500/20 to-cyan-500/5 border-cyan-500/30",
  },
  {
    number: "02",
    title: "Decide",
    role: "Declarative access rules",
    icon: <ListChecks className="h-5 w-5" />,
    body: "Operators declare rules in plain English from a starting template. \"Revoke sessions on suspicious mailbox rule\", \"Isolate endpoint + revoke sessions on Defender critical\", \"Re-MFA admins every business day\". Every rule starts in report-only mode so you watch the dry-run output before flipping the switch.",
    accent: "from-amber-500/20 to-amber-500/5 border-amber-500/30",
  },
  {
    number: "03",
    title: "Verify",
    role: "Break-glass + rate-limits + cooldown",
    icon: <ShieldCheck className="h-5 w-5" />,
    body: "Every match goes through a safety pipeline before action. Break-glass accounts are excluded at the evaluator level — operator can't bypass. Per-user rate-limits prevent a rule kicking the same person all day. A first-24-hour cooldown caps total actions during the rule's first day in enforce mode. A per-org cap prevents a single bad rule nuking the whole tenant.",
    accent: "from-indigo-500/20 to-indigo-500/5 border-indigo-500/30",
  },
  {
    number: "04",
    title: "Respond",
    role: "Revoke, isolate, alert",
    icon: <Bot className="h-5 w-5" />,
    body: "Mithras revokes the user's M365 sessions via Graph (User.RevokeSessions.All) — every access token and refresh token across Outlook, Teams, OneDrive, SharePoint, browser, mobile all invalidated. For endpoint-driven rules, the agent isolates the device from the network in parallel. The SOC gets an alert with full evidence. The user re-authenticates from scratch through your existing MFA on the next attempt.",
    accent: "from-rose-500/20 to-rose-500/5 border-rose-500/30",
  },
  {
    number: "05",
    title: "Audit",
    role: "Append-only ledger, every decision",
    icon: <Eye className="h-5 w-5" />,
    body: "Every match — enforced or report-only or skipped-because-break-glass — lands in the actions ledger with the evidence that triggered it, the actions taken, the Graph response, and the operator who approved the rule. Twelve-month retention. SOC analysts review for false positives and tune the rule.",
    accent: "from-emerald-500/20 to-emerald-500/5 border-emerald-500/30",
  },
];

const CAPABILITIES = [
  {
    icon: <Lock className="h-5 w-5" />,
    title: "Session revocation",
    body: "Kill every active M365 session for a user in one Graph call. Outlook, Teams, OneDrive, SharePoint, browser, mobile — all logged out simultaneously. User re-authenticates through your existing MFA on next attempt.",
  },
  {
    icon: <Bot className="h-5 w-5" />,
    title: "Joint endpoint + identity action",
    body: "When the agent flags a critical Defender detection, Mithras can revoke the user's M365 sessions AND isolate the endpoint from the network — two responses, one rule, one decision.",
  },
  {
    icon: <Mail className="h-5 w-5" />,
    title: "Mailbox-rule monitoring",
    body: "Classic post-compromise tell: attacker creates a forwarding rule to exfiltrate mail. Mithras spots external-forwarder + silent-delete rules and revokes the session before they can do anything with the access.",
  },
  {
    icon: <ListChecks className="h-5 w-5" />,
    title: "Report-only dry runs",
    body: "Every rule ships in report-only mode by default. Watch the dry-run output for a week, see exactly which users would have been affected, then promote to enforce when you're confident.",
  },
  {
    icon: <AlertTriangle className="h-5 w-5" />,
    title: "Safety guardrails",
    body: "Break-glass account exclusion enforced at the evaluator level. Per-user rate-limits. First-24h cooldown on newly-promoted rules. Per-org enforced-action cap. Kill switch that drops every rule back to report-only in one click.",
  },
  {
    icon: <Eye className="h-5 w-5" />,
    title: "Append-only audit ledger",
    body: "Every decision, every evidence trail, every Graph response — twelve-month retention. SOC analysts review for false positives, mark them, and the data feeds the next rule iteration.",
  },
];

// Honest comparison vs paying for Entra ID P1.
const COMPARISON = [
  { feature: "Cost per user",        mithras: "Included in $11/seat — no add-on", others: "+$9/user/month for Entra ID P1" },
  { feature: "Enforcement mechanism", mithras: "Detect signal → revoke session", others: "Refuse sign-in at the door" },
  { feature: "Compromise window",     mithras: "Short detect-and-respond cycle", others: "Zero (blocked before sign-in completes)" },
  { feature: "Visibility signals",    mithras: "Endpoint + mailbox + network + OAuth + vuln state", others: "Identity-stack signals only" },
  { feature: "Mailbox-rule + OAuth post-compromise detection", mithras: "Native — works on every M365 plan", others: "Needs P1 sign-in logs + manual correlation" },
  { feature: "Endpoint-side joint action", mithras: "Revoke + network-isolate in one rule", others: "Identity and endpoint are separate products" },
  { feature: "Setup",                 mithras: "Pick a template, click \"Add rule\"", others: "Build CA policies one at a time" },
  { feature: "Honest about limits",   mithras: "Yes — disclosure strip on every rule", others: "n/a" },
];

const FAQS = [
  {
    q: "Does this really replace an Entra ID P1 licence?",
    a: "It replaces the most-used P1 feature — Conditional Access — with detect-and-respond enforcement rather than at-the-door enforcement. For most SMB threat models that's the right trade. There are scenarios where P1 is genuinely better — high-value financial accounts, regulated workloads — and for those we tell you so you can buy P1 on top.",
  },
  {
    q: "What's the actual gap between compromise and response?",
    a: "Short and continuous, but we don't put a specific number in marketing copy — the cadence is an operational dial we tune for cost and reliability. Operators see the real cadence in-product. The relevant comparison is: Conditional Access blocks at the sign-in itself (zero seconds); Mithras detects a signal and reacts. For the threat models where that difference is decision-critical (a logged-in attacker exfiltrating mail for 30 seconds), buy P1 alongside Mithras and you get both.",
  },
  {
    q: "What stops a buggy rule from locking my whole team out?",
    a: "Five guardrails, all enforced at the evaluator level: every new rule starts in report-only mode (no real action); break-glass accounts are excluded at the rule evaluator and the operator cannot disable that exclusion; per-user-per-day rate-limits cap how many times a rule can act on one person; a first-24-hour cooldown on newly-promoted rules caps total enforced actions; and a per-org cap prevents one rule processing-cycle exceeding 10% of users. Plus a big red \"Pause all enforcement\" button that drops every rule back to report-only in one click.",
  },
  {
    q: "What signals work without an Entra ID P1 licence?",
    a: "Every signal Mithras already has access to: endpoint posture from the agent (Defender state, threats, microseg compliance, app whitelist), mailbox activity from the M365 Graph read scope (works on the free tier), OAuth grants, mail send patterns, network telemetry from the agent's firewall audit, vulnerability findings. The signals that genuinely require P1 are the sign-in audit log and Microsoft's own risky-sign-in scoring — for those we honestly say \"buy P1 if you need this dimension.\"",
  },
  {
    q: "Can I still use my existing Conditional Access policies alongside this?",
    a: "Yes, and you should. If you already have P1 and CA configured, Identity Defence runs as a defence-in-depth layer on top. CA blocks at the door; Mithras catches anything that gets past — and adds endpoint-side action (isolate the device) that CA can't do.",
  },
  {
    q: "Does this work on the Mithras Personal plan?",
    a: "Yes — and it's where the feature is most directly impactful. Home users connecting their M365 mailbox get the same detect-and-respond layer applied to their personal account. No Entra ID licence required; the M365 free tier provides every scope we need.",
  },
];

export default function IdentityDefenceMarketingPage() {
  return (
    <>
      <Seo
        title="Mithras Identity Defence — Conditional Access outcomes without the P1 licence"
        description="Replace what most SMBs pay $9/user/month for. Mithras detects M365 compromise signals — mailbox forwarders, OAuth grants, endpoint critical detections — and revokes the user's sessions before damage. No Entra ID P1 required."
        canonical="/identity-defence"
        structuredData={[
          organizationSchema(),
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "Identity Defence", url: "/identity-defence" },
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
            <div className="absolute top-1/3 left-1/3 w-[600px] h-[400px] bg-emerald-500/5 rounded-full blur-3xl" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:24px_24px]" />
          </div>
          <div className="container mx-auto max-w-5xl text-center">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium tracking-wide uppercase mb-6 border border-primary/20">
              <Lock className="h-3.5 w-3.5" />
              Identity Defence
            </div>
            <h1 className="text-[2.25rem] sm:text-5xl md:text-6xl font-bold tracking-tight mb-6 leading-[1.05] text-balance">
              Conditional Access outcomes{" "}
              <span className="bg-gradient-to-r from-primary via-primary/80 to-primary/50 bg-clip-text text-transparent">
                without the P1 licence.
              </span>
            </h1>
            <p className="text-base sm:text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto mb-8 leading-relaxed">
              Mithras detects M365 compromise signals — suspicious mailbox forwarders,
              OAuth grants, endpoint critical detections — and revokes the user's sessions
              before the attacker can do anything with the access. No Entra ID P1, no
              Microsoft re-consent. The signals work on every M365 plan, including the free tier.
            </p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 mb-12 max-w-md sm:max-w-none mx-auto">
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
              <Zap className="h-3.5 w-3.5" />
              Included in every Mithras subscription. No add-on. No incremental SKU.
            </p>
          </div>
        </section>

        {/* Honest disclosure */}
        <section className="px-4 sm:px-6 pb-4">
          <div className="container mx-auto max-w-5xl">
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 sm:p-6 flex items-start gap-4">
              <Info className="h-5 w-5 text-amber-500 mt-1 shrink-0" />
              <div className="text-sm leading-relaxed">
                <span className="font-semibold">Honest disclosure.</span>{" "}
                Mithras Identity Defence is a detect-and-respond control, not a preventive identity gate.
                Microsoft Conditional Access refuses sign-ins at the door; Mithras detects compromise signals
                and revokes the session. There is a short window between the two. For most SMB threat models
                that gap is acceptable — for the ones it isn't, buy Entra ID P1 alongside Mithras and you get both.
                We will always tell you which one you need.
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="py-20 px-4 sm:px-6">
          <div className="container mx-auto max-w-6xl">
            <div className="text-center mb-12">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-[11px] font-medium uppercase tracking-wider mb-4">
                <ShieldCheck className="h-3.5 w-3.5" />
                How it works
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
                Detect. Decide. Verify. Respond. Audit.
              </h2>
              <p className="text-base sm:text-lg text-muted-foreground max-w-3xl mx-auto">
                Five phases. Continuous. Every rule auditable end to end.
              </p>
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              {PHASES.map((p) => (
                <div
                  key={p.number}
                  className={`rounded-xl border bg-gradient-to-br p-6 ${p.accent}`}
                >
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0">
                      <div className="text-[10px] font-mono tracking-[0.2em] text-muted-foreground mb-1">
                        {p.number}
                      </div>
                      <div className="h-10 w-10 rounded-lg bg-background/40 border border-border/40 flex items-center justify-center">
                        {p.icon}
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-lg font-semibold">{p.title}</h3>
                      <div className="text-[11px] text-muted-foreground mb-2 uppercase tracking-wider">{p.role}</div>
                      <p className="text-sm leading-relaxed">{p.body}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Capabilities */}
        <section className="py-20 px-4 sm:px-6 bg-card/30">
          <div className="container mx-auto max-w-6xl">
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">What's inside.</h2>
              <p className="text-base sm:text-lg text-muted-foreground max-w-3xl mx-auto">
                Six capabilities ship together. No add-ons.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {CAPABILITIES.map((c) => (
                <div key={c.title} className="rounded-xl border border-border/40 bg-card/50 p-5">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary border border-primary/20 flex items-center justify-center mb-3">
                    {c.icon}
                  </div>
                  <h3 className="text-base font-semibold mb-1.5">{c.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{c.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Comparison */}
        <section className="py-20 px-4 sm:px-6">
          <div className="container mx-auto max-w-5xl">
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
                Mithras vs Entra ID P1.
              </h2>
              <p className="text-base sm:text-lg text-muted-foreground max-w-3xl mx-auto">
                Two paths to similar outcomes. The honest comparison.
              </p>
            </div>
            <div className="rounded-xl border border-border/40 overflow-hidden">
              <div className="grid grid-cols-1 md:grid-cols-[2fr_3fr_3fr] bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground p-3">
                <div>Feature</div>
                <div className="hidden md:block">Mithras Identity Defence</div>
                <div className="hidden md:block">Entra ID P1 + Conditional Access</div>
              </div>
              {COMPARISON.map((row, i) => (
                <div key={i} className="grid grid-cols-1 md:grid-cols-[2fr_3fr_3fr] gap-2 md:gap-4 p-4 border-t border-border/40 text-sm">
                  <div className="font-medium">{row.feature}</div>
                  <div className="flex items-start gap-2 text-emerald-500/90">
                    <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                    <span className="text-foreground/90">{row.mithras}</span>
                  </div>
                  <div className="flex items-start gap-2 text-muted-foreground">
                    <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{row.others}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-20 px-4 sm:px-6 bg-card/30">
          <div className="container mx-auto max-w-3xl">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-10 text-center">
              Common questions.
            </h2>
            <div className="space-y-4">
              {FAQS.map((f, i) => (
                <details key={i} className="group rounded-xl border border-border/40 bg-card/50 p-5">
                  <summary className="cursor-pointer text-base font-semibold flex items-center justify-between list-none">
                    {f.q}
                    <ArrowRight className="h-4 w-4 transition-transform group-open:rotate-90" />
                  </summary>
                  <p className="text-sm text-muted-foreground mt-3 leading-relaxed">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="px-4 sm:px-6 py-16 sm:py-20">
          <div className="container mx-auto max-w-4xl">
            <div className="rounded-2xl border border-primary/20 bg-gradient-to-b from-primary/5 to-transparent p-8 sm:p-12 text-center">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
                Stop paying for Conditional Access you barely use.
              </h2>
              <p className="text-base text-muted-foreground max-w-2xl mx-auto mb-7">
                If you're an SMB paying $9/user/month for Entra ID P1 because you wanted Conditional Access,
                Mithras delivers the outcomes that matter at $11/seat all-in — and bundles email security,
                endpoint EDR, microseg, vuln management, and the AI SOC into the same number. Talk to your reseller
                about switching.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Button size="lg" className="h-12 px-7 text-base shadow-lg shadow-primary/20" asChild>
                  <Link to="/contact-sales">
                    Talk to sales <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="h-12 px-7 text-base" asChild>
                  <Link to="/platform">See the full platform</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        <Footer />
      </div>
    </>
  );
}
