import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight, Bot, ShieldCheck, Home } from "lucide-react";
import { SocConsoleHero } from "./visuals/SocConsoleHero";

export function HeroSection() {
  return (
    <section className="relative pt-24 md:pt-28 pb-16 md:pb-20 px-4 sm:px-6 overflow-hidden">
      {/* Layered ambient glow + subtle grid pattern */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[1200px] h-[700px] bg-primary/10 rounded-full blur-3xl" />
        <div className="absolute top-1/3 left-1/3 w-[600px] h-[400px] bg-emerald-500/5 rounded-full blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:24px_24px]" />
      </div>

      <div className="container mx-auto">
        <div className="max-w-5xl mx-auto text-center">
          {/* Top eyebrow */}
          <div className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-[11px] sm:text-xs font-medium tracking-wide uppercase mb-6 sm:mb-8 border border-primary/20 max-w-full">
            <Bot className="h-3.5 w-3.5 flex-shrink-0" />
            <span>AI-first endpoint security. Built in Australia.</span>
          </div>

          {/* Hero headline */}
          <h1 className="text-[2.25rem] sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight mb-6 leading-[1.05] text-balance">
            A SOC that{" "}
            <span className="bg-gradient-to-r from-primary via-primary/80 to-primary/50 bg-clip-text text-transparent">
              never sleeps.
            </span>
            <span className="block mt-2 text-foreground/90">
              Five AI agents. One bill.
            </span>
          </h1>

          <p className="text-base sm:text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto mb-8 sm:mb-10 leading-relaxed">
            Mithras runs five purpose-built AI agents over your fleet around the
            clock and triages every Microsoft 365 inbox for phishing, BEC and
            malware. Cross-checked verdicts in under a minute. Every conclusion
            cites the evidence that drove it. No analyst backlog, no $30k MDR
            contract, and you keep ownership of every endpoint.
          </p>

          {/* Primary + secondary CTA */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 mb-12 max-w-md sm:max-w-none mx-auto">
            <Button size="lg" className="h-12 px-7 text-base shadow-lg shadow-primary/20 w-full sm:w-auto" asChild>
              <Link to="/contact-sales">
                Talk to sales
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="h-12 px-7 text-base w-full sm:w-auto" asChild>
              <Link to="/ai-soc">See the AI agents</Link>
            </Button>
          </div>
        </div>

        {/* The signature animated SOC console — sits below the headline so
            the AI-SOC narrative pays off visually within one screen on
            desktop. */}
        <div className="mt-2 sm:mt-4">
          <SocConsoleHero />
        </div>

        {/* Channel + personal nudges */}
        <div className="max-w-3xl mx-auto text-center mt-10">
          <p className="text-xs text-muted-foreground mb-2 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 px-2">
            <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0" />
            <span>Sold through authorised partners across Australia and New Zealand.</span>
          </p>
          <p className="text-xs text-muted-foreground flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 px-2">
            <Home className="h-3.5 w-3.5 flex-shrink-0" />
            <span>Protecting your own PC?</span>
            <Link to="/personal" className="text-primary font-medium hover:underline">
              Mithras Personal is $6/mo &rarr;
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
