import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, Mail, ShieldCheck, ScanLine, BellRing, Ban, ListChecks,
  AlertTriangle, Clock, Quote, CheckCircle2, XCircle, Zap, FileText, Eye,
} from "lucide-react";
import { LandingNav } from "@/components/landing/LandingNav";
import { Footer } from "@/components/landing/CTAFooter";
import { Seo } from "@/components/seo/Seo";
import { organizationSchema, breadcrumbSchema, faqSchema } from "@/components/seo/jsonLd";

const PHASES = [
  {
    number: "01",
    title: "Sweep",
    role: "Every two minutes, every mailbox",
    icon: <ScanLine className="h-5 w-5" />,
    body: "Mithras connects to your tenant's Microsoft 365 with a read scope and lists newly received messages across every mailbox. No mail server change, no MX record rerouting, no DNS migration — the integration is API-only.",
    accent: "from-cyan-500/20 to-cyan-500/5 border-cyan-500/30",
  },
  {
    number: "02",
    title: "Block rules",
    role: "Deterministic short-circuit",
    icon: <Ban className="h-5 w-5" />,
    body: "Before any AI runs, the message is checked against your tenant's block rules. Known-bad sender domains, addresses, or subject patterns are matched immediately. Matched mail is quarantined, the recipient is warned, or it's silently logged — your choice, your rule.",
    accent: "from-rose-500/20 to-rose-500/5 border-rose-500/30",
  },
  {
    number: "03",
    title: "AI classification",
    role: "Phishing, BEC, malware, spam, suspicious, legitimate",
    icon: <ShieldCheck className="h-5 w-5" />,
    body: "Mail that didn't match a rule is scored by Mithras's classifier. The model reads sender, key headers (SPF, DKIM, auth-results), and a body excerpt — never the full body, never attachments. It cites the evidence behind every verdict and emits a confidence score.",
    accent: "from-emerald-500/20 to-emerald-500/5 border-emerald-500/30",
  },
  {
    number: "04",
    title: "Operator action",
    role: "Quarantine, warn, release — per message or bulk",
    icon: <ListChecks className="h-5 w-5" />,
    body: "Flagged mail lands in the email security console with the AI reasoning, indicators of compromise, and an action row. Quarantine moves the message to Junk via Microsoft Graph. Warn emails the recipient a Mithras-branded notification with a self-service release link. Releases undo a false positive. Bulk select handles a campaign hitting many recipients in one click.",
    accent: "from-amber-500/20 to-amber-500/5 border-amber-500/30",
  },
  {
    number: "05",
    title: "User feedback",
    role: "Magic-link release, no IT round-trip",
    icon: <BellRing className="h-5 w-5" />,
    body: "If the recipient receives a warning email and the message was actually legitimate, they release it back to their inbox themselves with one click. The link is single-use, valid for 14 days, and the release is logged. Users decide; IT doesn't get drawn in for every false positive.",
    accent: "from-indigo-500/20 to-indigo-500/5 border-indigo-500/30",
  },
];

const CAPABILITIES = [
  {
    icon: <ShieldCheck className="h-5 w-5" />,
    title: "AI classification",
    body: "Every inbound message scored by an LLM against six categories: phishing, BEC, malware, spam, suspicious, legitimate. Citation-enforced output — the reasoning points at the indicator it caught.",
  },
  {
    icon: <ListChecks className="h-5 w-5" />,
    title: "Bulk action",
    body: "Tick rows, click once. Quarantine, warn, or release up to 200 messages in a single operation. The action runs through the same audit-logged path as the per-row buttons.",
  },
  {
    icon: <Ban className="h-5 w-5" />,
    title: "Per-tenant block rules",
    body: "Sender domain, sender address, or subject regex. Match auto-quarantines or auto-warns and skips the AI entirely — predictable behaviour for known-bad senders, lower token cost for repeat campaigns.",
  },
  {
    icon: <BellRing className="h-5 w-5" />,
    title: "Recipient warning + self-release",
    body: "Mithras-branded warning email with the sender, subject, AI reasoning, and a single-use release magic link. Users learn the pattern. IT skips the round-trip on false positives.",
  },
  {
    icon: <FileText className="h-5 w-5" />,
    title: "Daily digest to admins",
    body: "Per-organisation digest summarising the day's classifications and the top 15 detections. Delivered each morning to your configured recipient list.",
  },
  {
    icon: <Eye className="h-5 w-5" />,
    title: "SIEM forwarding",
    body: "Medium-and-above detections fan through the event outbox to your Splunk HEC, Sentinel Log Analytics, Elastic, or syslog destination. Same canonical event format as endpoint detections.",
  },
];

const COMPARISON = [
  {
    feature: "Deployment model",
    mithras: "API-only via Microsoft Graph. No MX record change.",
    others: "Inline mail gateway — DNS migration, careful cutover, downtime window.",
  },
  {
    feature: "How it decides",
    mithras: "LLM with citation-enforced reasoning + deterministic block rules.",
    others: "Statistical rules + signatures; reasoning is opaque.",
  },
  {
    feature: "Action surface",
    mithras: "Post-delivery: move to Junk, warn the recipient, release on user click.",
    others: "Pre-delivery: drop or hold in a quarantine queue users can't see.",
  },
  {
    feature: "Pricing",
    mithras: "Included in the $11/seat Mithras subscription.",
    others: "Separate line item, often $3–$8/seat on top of your EDR.",
  },
  {
    feature: "Multi-tenant for MSPs",
    mithras: "Native. Manage every customer tenant from one console.",
    others: "Per-tenant licence + per-tenant admin login. Bring your own automation.",
  },
];

const FAQ = [
  {
    q: "Will this protect against phishing?",
    a: "Yes — phishing is the primary thing this stack is built to catch. The AI classifier reads every inbound message and scores it against six categories including phishing and BEC, citing the evidence behind the verdict. Confirmed phishing can be quarantined per-message or in bulk during a campaign, and you can stop repeat campaigns at the source with a block rule on the sender domain.",
  },
  {
    q: "Do I need to change my MX record or migrate my mail flow?",
    a: "No. Mithras connects to Microsoft 365 via the Graph API with a read scope. We don't sit in the mail path. We read newly delivered mail, classify it, and act post-delivery (move to Junk, warn the recipient, release on user click). The integration takes about ten minutes and there is no mail downtime.",
  },
  {
    q: "What about Microsoft Defender for Office 365 — isn't that enough?",
    a: "Defender for Office 365 catches a lot. It doesn't catch everything, and it doesn't show your team the reasoning for the catches it does make. Mithras adds a second classification pass with cited reasoning, gives your team a single console across every customer tenant, and adds per-tenant block rules that are managed centrally. Run both — they complement each other.",
  },
  {
    q: "Does the AI ever see the full email body?",
    a: "No. The classifier sees the sender, key headers (SPF, DKIM, auth-results), and a 2 KB excerpt of the body. Full bodies and attachment binaries are never sent to the model and never stored by Mithras. The persisted record is the verdict, the reasoning, and the indicators of compromise the model identified.",
  },
  {
    q: "How does the bulk action work during a phishing campaign?",
    a: "When a campaign lands across multiple mailboxes, your admin opens the email security page, ticks the rows that belong to the campaign (or uses Select all visible), and clicks Quarantine, Send warning, or Release in the bulk action bar at the bottom of the screen. Up to 200 messages process in a single request, each row gets a per-message audit entry, and the bar reports the per-row outcome.",
  },
  {
    q: "What is a block rule and when should I add one?",
    a: "A block rule short-circuits the AI for known-bad mail. You give Mithras a sender domain, a sender address, or a subject regex, and choose an action — quarantine silently, quarantine and warn the recipient, or just record the match. Add a rule when you've seen the same sender or pattern more than once. It saves AI tokens, gives predictable behaviour, and ends repeat campaigns at the source for your tenant.",
  },
  {
    q: "Can the recipient release a false positive themselves?",
    a: "Yes. When you choose Send warning, Mithras emails the recipient a branded notification with the sender, subject, AI reasoning, and a single-use release magic link. If the message was legitimate, the user clicks the link and the message is restored to their inbox. The link is valid for 14 days and the release is logged. Your admin team is not in the loop for routine false positives.",
  },
  {
    q: "Does this work for partners managing multiple customer tenants?",
    a: "Yes. The email security service is multi-tenant from the ground up. Partner admins see and action across every customer tenant in their portfolio. The SOC operator workflow includes cross-tenant campaign hunting — when the same sender domain produces detections in three or more tenants in a 4-hour window it's a tracked campaign and your team is notified.",
  },
];

const OUTCOMES = [
  { title: "Two-minute classification cycle", detail: "Mail flagged in under two minutes of arrival. Campaigns hitting multiple users surface together, not as scattered tickets." },
  { title: "Bulk action when it counts", detail: "Up to 200 messages quarantined or warned per click. One operator handles a campaign during a coffee, not a shift." },
  { title: "Predictable block rules", detail: "Known-bad senders auto-handled without spending an AI classification. Repeat campaigns end at the source." },
  { title: "Users self-serve false positives", detail: "Warning emails with release magic links cut IT round-trips for legitimate mail that triggered the model." },
  { title: "Cited reasoning, not black-box catches", detail: "Every verdict points at the evidence — sender mismatch, lookalike domain, urgent payment request. Defensible during a compliance review." },
  { title: "Bundled with the rest of the platform", detail: "Included in the $11/seat subscription. No separate email security SKU, no incremental endpoint count." },
];

const PhishingProtection = () => {
  return (
    <>
      <Seo
        title="Email security + phishing protection for Microsoft 365 | Mithras"
        description="AI-classified email security for Microsoft 365: phishing, BEC, malware and spam triaged every two minutes with citation-enforced reasoning. Bulk quarantine for campaigns, per-tenant block rules, self-service recipient release. Included in the $11/seat Mithras subscription."
        canonical="/phishing-protection"
        keywords="email security, phishing protection, BEC protection, M365 email security, Microsoft 365 phishing, AI email classification, business email compromise, email quarantine, anti-phishing for MSPs, Mithras Threat Defence"
        structuredData={[
          organizationSchema(),
          breadcrumbSchema([
            { name: "Home", path: "/" },
            { name: "Phishing protection", path: "/phishing-protection" },
          ]),
          faqSchema(FAQ.map(f => ({ question: f.q, answer: f.a }))),
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
              <Mail className="h-3.5 w-3.5" />
              Email security &amp; phishing protection
            </div>
            <h1 className="text-[2.25rem] sm:text-5xl md:text-6xl font-bold tracking-tight mb-6 leading-[1.05] text-balance">
              The phishing email never reaches{" "}
              <span className="bg-gradient-to-r from-primary via-primary/80 to-primary/50 bg-clip-text text-transparent">
                the click.
              </span>
            </h1>
            <p className="text-base sm:text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto mb-8 leading-relaxed">
              Mithras connects to Microsoft 365 with a read scope, classifies every
              inbound message with AI, and quarantines phishing, BEC, malware and
              spam in under two minutes. Per-tenant block rules stop repeat campaigns
              at the source. Bulk action handles the bad day when 80 inboxes get hit
              at once.
            </p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 mb-12 max-w-md sm:max-w-none mx-auto">
              <Button size="lg" className="h-12 px-7 text-base shadow-lg shadow-primary/20 w-full sm:w-auto" asChild>
                <Link to="/contact-sales">
                  Talk to sales
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="h-12 px-7 text-base w-full sm:w-auto" asChild>
                <Link to="/ai-soc">See the AI SOC</Link>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground inline-flex items-center justify-center gap-1.5">
              <Zap className="h-3.5 w-3.5" />
              Included in every Mithras subscription. No separate email security SKU.
            </p>
          </div>
        </section>

        {/* How it works — 5 phases */}
        <section className="py-20 px-4 sm:px-6">
          <div className="container mx-auto max-w-6xl">
            <div className="text-center mb-12">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-[11px] font-medium uppercase tracking-wider mb-4">
                <ShieldCheck className="h-3.5 w-3.5" />
                How it works
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
                Five phases. Every message. Every two minutes.
              </h2>
              <p className="text-base sm:text-lg text-muted-foreground max-w-3xl mx-auto">
                A deterministic block-rule pass, an AI classification pass, an operator
                action surface, and a user release path. Each phase is auditable end to
                end.
              </p>
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              {PHASES.map(p => (
                <div
                  key={p.number}
                  className={`rounded-xl border bg-gradient-to-br p-6 ${p.accent}`}
                >
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0">
                      <div className="text-[10px] font-mono tracking-[0.2em] text-muted-foreground mb-1">{p.number}</div>
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
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
                What's inside.
              </h2>
              <p className="text-base sm:text-lg text-muted-foreground max-w-3xl mx-auto">
                Six capabilities that ship together. No add-ons. No incremental SKUs.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {CAPABILITIES.map(c => (
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
                Versus the inline-gateway approach.
              </h2>
              <p className="text-base sm:text-lg text-muted-foreground max-w-3xl mx-auto">
                Proofpoint, Mimecast, and the classic Secure Email Gateways sit
                <em> in front of </em> your mail flow. Mithras reads through Microsoft
                Graph and acts after delivery. Two different architectures, two
                different cutover stories.
              </p>
            </div>
            <div className="rounded-xl border border-border/40 overflow-hidden">
              <div className="grid grid-cols-3 gap-0 text-[11px] uppercase tracking-wider bg-card/70 border-b border-border/40">
                <div className="px-4 py-3 font-semibold">Dimension</div>
                <div className="px-4 py-3 font-semibold text-primary">Mithras</div>
                <div className="px-4 py-3 font-semibold text-muted-foreground">Inline gateways</div>
              </div>
              {COMPARISON.map((row, i) => (
                <div key={row.feature} className={`grid grid-cols-3 gap-0 text-sm ${i % 2 === 0 ? "bg-background" : "bg-card/40"}`}>
                  <div className="px-4 py-4 font-medium">{row.feature}</div>
                  <div className="px-4 py-4 flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                    <span>{row.mithras}</span>
                  </div>
                  <div className="px-4 py-4 text-muted-foreground flex items-start gap-2">
                    <XCircle className="h-4 w-4 text-muted-foreground/50 flex-shrink-0 mt-0.5" />
                    <span>{row.others}</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground text-center mt-4">
              Neither approach is universally right. Inline gateways are stronger for pre-delivery URL rewrite and attachment sandboxing. Mithras is stronger for fleet-wide visibility, citation-quality reasoning, and zero-cutover deployment.
            </p>
          </div>
        </section>

        {/* Outcomes */}
        <section className="py-20 px-4 sm:px-6 bg-card/30">
          <div className="container mx-auto max-w-5xl">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-center mb-12">
              What changes for your team.
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {OUTCOMES.map(o => (
                <div key={o.title} className="rounded-lg border border-border/40 bg-background/50 p-5">
                  <h3 className="font-semibold text-base mb-1">{o.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{o.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-20 px-4 sm:px-6">
          <div className="container mx-auto max-w-3xl">
            <div className="text-center mb-12">
              <p className="text-xs font-semibold tracking-[0.18em] uppercase text-primary mb-4">
                FAQ
              </p>
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                Common questions about email security.
              </h2>
            </div>
            <div className="space-y-4">
              {FAQ.map((item) => (
                <div key={item.q} className="rounded-lg border border-border/40 bg-card/40 p-5">
                  <h3 className="text-base font-semibold mb-2 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-primary mt-1 flex-shrink-0" />
                    {item.q}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{item.a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20 px-4 sm:px-6">
          <div className="container mx-auto max-w-3xl text-center">
            <Quote className="h-8 w-8 text-primary/40 mx-auto mb-4" />
            <p className="text-xl sm:text-2xl font-medium leading-relaxed mb-8 text-balance">
              "The block rules killed two known campaigns within a day of switching on.
              The bulk action saved us a Friday afternoon when the same lure hit forty
              of our staff inboxes."
            </p>
            <p className="text-sm text-muted-foreground mb-10">— A Mithras partner. We've kept their name off the site at their request.</p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 max-w-md sm:max-w-none mx-auto">
              <Button size="lg" className="h-12 px-7 text-base shadow-lg shadow-primary/20 w-full sm:w-auto" asChild>
                <Link to="/contact-sales">
                  Talk to sales
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="h-12 px-7 text-base w-full sm:w-auto" asChild>
                <Link to="/platform">See the rest of the platform</Link>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-8 inline-flex items-center justify-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              Integration takes about ten minutes. No mail downtime.
            </p>
          </div>
        </section>

        <Footer />
      </div>
    </>
  );
};

export default PhishingProtection;
