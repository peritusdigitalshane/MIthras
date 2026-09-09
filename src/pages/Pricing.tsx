import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight, Check, ShieldCheck, Users, Briefcase, Calculator } from "lucide-react";
import { LandingNav } from "@/components/landing/LandingNav";
import { Footer, CTASection } from "@/components/landing/CTAFooter";
import { PricingSection } from "@/components/landing/PricingSection";
import { Seo } from "@/components/seo/Seo";
import {
  organizationSchema,
  websiteSchema,
  softwareApplicationSchema,
  breadcrumbSchema,
  faqSchema,
} from "@/components/seo/jsonLd";

const PRICING_FAQ = [
  {
    question: "Why is Mithras sold through partners?",
    answer:
      "We pick partners who know the customer. A reseller deploys the agent, tunes the policies, and answers the 8pm phone call. That model gives a 50-seat accountant a better outcome than us trying to support them direct.",
  },
  {
    question: "Is the $11 price ex-GST or inc-GST?",
    answer: "$11 AUD per endpoint per month, ex-GST. Australian customers add 10% GST.",
  },
  {
    question: "Do you discount for volume?",
    answer:
      "Yes. Discounting kicks in from 250 endpoints. Your reseller has the wholesale grid and will quote against your fleet size. For more than 5,000 endpoints, reach out via contact sales and we will engage your distributor directly.",
  },
  {
    question: "Is there a free trial?",
    answer:
      "No public free trial. A reseller can run a paid 30-day proof of value with full refund if you are not happy. That is the cleanest way to test against a real fleet without a sales-led trial.",
  },
  {
    question: "What is included at $11?",
    answer:
      "Every capability. AI SOC, Defender management, microsegmentation, application control, end-of-life Windows hardening, M365 identity threat detection, embedded remote desktop, monthly customer reports, and the multi-tenant operator console. No add-on SKUs.",
  },
  {
    question: "How does the home subscription differ?",
    answer:
      "$6 per month for a single home PC, billed by Stripe direct. Defender posture and threat alerts only. No operator console, no phone support. If you want full features on a home machine, look at the business plan through a reseller.",
  },
];

export default function Pricing() {
  return (
    <>
      <Seo
        title="Pricing — Mithras Threat Defence ($11 AUD per endpoint, all included)"
        description="One simple price. $11 AUD per endpoint per month, every feature included. Sold through Mithras channel partners. Home users $6 AUD per PC direct. Volume discounts from 250 seats."
        canonical="/pricing"
        keywords="endpoint security pricing, MSP pricing Australia, Defender management pricing, EDR pricing per seat, mithras pricing"
        structuredData={[
          organizationSchema(),
          websiteSchema(),
          softwareApplicationSchema(),
          breadcrumbSchema([
            { name: "Home", path: "/" },
            { name: "Pricing", path: "/pricing" },
          ]),
          faqSchema(PRICING_FAQ),
        ]}
      />
      <div className="min-h-screen bg-background">
        <LandingNav />

        {/* HERO */}
        <section className="relative pt-24 md:pt-32 pb-10 px-4 sm:px-6 overflow-hidden">
          <div className="absolute inset-0 -z-10">
            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[1100px] h-[500px] bg-primary/10 rounded-full blur-3xl" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:24px_24px]" />
          </div>
          <div className="container mx-auto max-w-4xl text-center">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-[11px] sm:text-xs font-medium tracking-wide uppercase mb-6 border border-primary/20">
              Pricing
            </div>
            <h1 className="text-[2.25rem] sm:text-5xl md:text-6xl font-bold tracking-tight mb-5 leading-[1.05] text-balance">
              $11 a seat.{" "}
              <span className="bg-gradient-to-r from-primary via-blue-400 to-cyan-400 bg-clip-text text-transparent">
                Everything in.
              </span>
            </h1>
            <p className="text-base sm:text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              No tiers. No premium add-ons. The same $11 buys you AI SOC,
              Defender management, microsegmentation, end-of-life Windows
              hardening and every other capability we ship. Sold by partners
              who live in your timezone.
            </p>
          </div>
        </section>

        {/* The shared PricingSection composes the headline price card,
            home price card, and the seat-count calculator. */}
        <PricingSection />

        {/* Audience-specific routes */}
        <section className="py-16 px-4 sm:px-6 bg-muted/20">
          <div className="container mx-auto max-w-5xl">
            <div className="text-center mb-10">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
                How do I actually buy it?
              </h2>
              <p className="text-muted-foreground mt-3 max-w-2xl mx-auto">
                Three ways in. Pick the one that matches who you are.
              </p>
            </div>
            <div className="grid md:grid-cols-3 gap-5">
              <BuyCard
                icon={<Briefcase className="h-5 w-5 text-primary" />}
                title="You run an MSP"
                detail="Sign up to the channel program. You get wholesale pricing, a multi-tenant console, and deal protection on every customer you bring in."
                cta="Channel program"
                href="/channel-program"
              />
              <BuyCard
                icon={<ShieldCheck className="h-5 w-5 text-primary" />}
                title="You are an SMB"
                detail="Tell us roughly how many endpoints. We will match you to a reseller in your region who will quote, deploy, and own the relationship."
                cta="Talk to sales"
                href="/contact-sales"
              />
              <BuyCard
                icon={<Users className="h-5 w-5 text-primary" />}
                title="It is just your home PC"
                detail="$6 per month, direct subscription. No reseller, no console. Just Defender hardening and a monthly report by email."
                cta="Subscribe online"
                href="/personal"
              />
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-16 px-4 sm:px-6">
          <div className="container mx-auto max-w-3xl">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2 text-center">
              Pricing questions
            </h2>
            <p className="text-center text-muted-foreground mb-10">
              The ones we get asked most.
            </p>
            <div className="space-y-3">
              {PRICING_FAQ.map((q) => (
                <details
                  key={q.question}
                  className="group rounded-lg border border-border/60 bg-card/40 p-5 open:bg-card/70 transition-colors"
                >
                  <summary className="cursor-pointer font-semibold text-foreground list-none flex items-center justify-between gap-2">
                    {q.question}
                    <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90" />
                  </summary>
                  <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
                    {q.answer}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <CTASection />
        <Footer />
      </div>
    </>
  );
}

function BuyCard({
  icon, title, detail, cta, href,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  cta: string;
  href: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-6 flex flex-col">
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 mb-4">{icon}</div>
      <h3 className="font-semibold text-base mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed flex-1">{detail}</p>
      <Button asChild variant="outline" className="mt-5 w-full">
        <Link to={href}>
          {cta} <ArrowRight className="ml-2 h-4 w-4" />
        </Link>
      </Button>
    </div>
  );
}
