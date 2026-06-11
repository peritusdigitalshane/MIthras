import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight, Bot, Brain, Eye, ShieldCheck, Zap, Clock, Home } from "lucide-react";

export function HeroSection() {
  return (
    <section className="relative pt-24 md:pt-32 pb-16 md:pb-24 px-4 sm:px-6 overflow-hidden">
      {/* Layered ambient glow + subtle grid pattern */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[1200px] h-[700px] bg-primary/10 rounded-full blur-3xl" />
        <div className="absolute top-1/3 left-1/3 w-[600px] h-[400px] bg-emerald-500/5 rounded-full blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:24px_24px]" />
      </div>

      <div className="container mx-auto">
        <div className="max-w-5xl mx-auto text-center">
          {/* Top eyebrow — establishes the category + an immediate trust signal.
              Allow the chip to wrap inside its pill on very small screens by
              using max-w with a sensible whitespace policy. */}
          <div className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-[11px] sm:text-xs font-medium tracking-wide uppercase mb-6 sm:mb-8 border border-primary/20 max-w-full">
            <Bot className="h-3.5 w-3.5 flex-shrink-0" />
            <span>AI-first endpoint security &middot; built in Australia</span>
          </div>

          {/* Hero headline — leads with the differentiator.
              text-balance keeps wrap visually even on narrow screens. */}
          <h1 className="text-[2.25rem] sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight mb-6 leading-[1.05] text-balance">
            Your{" "}
            <span className="bg-gradient-to-r from-primary via-primary/80 to-primary/50 bg-clip-text text-transparent">
              24/7 AI SOC.
            </span>
            <span className="block mt-2 text-foreground/90">
              Always on. Always watching.
            </span>
          </h1>

          <p className="text-base sm:text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto mb-8 sm:mb-10 leading-relaxed">
            Five specialised AI agents triage every alert, cross-check each
            other, and respond in seconds &mdash; for a fraction of what a
            traditional MDR costs. Built for MSPs who want SOC coverage that
            never sleeps, never burns out, and cites every conclusion it makes.
          </p>

          {/* Primary + secondary CTA. Full-width on mobile so the tap target
              spans the whole row; auto-width side-by-side on sm+. */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 mb-8 max-w-md sm:max-w-none mx-auto">
            <Button size="lg" className="h-12 px-7 text-base shadow-lg shadow-primary/20 w-full sm:w-auto" asChild>
              <Link to="/contact-sales">
                Talk to sales
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="h-12 px-7 text-base w-full sm:w-auto" asChild>
              <a href="#ai-soc">See the AI agents</a>
            </Button>
          </div>

          {/* Quick-look proof strip (no specific numbers per user pref) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 max-w-4xl mx-auto text-sm mb-10 sm:mb-12">
            <ProofPoint icon={<Clock className="h-4 w-4" />} label="Triage in seconds" />
            <ProofPoint icon={<Brain className="h-4 w-4" />} label="Verified by 3 agents" />
            <ProofPoint icon={<Eye className="h-4 w-4" />} label="24/7/365 coverage" />
            <ProofPoint icon={<Zap className="h-4 w-4" />} label="Citation-enforced" />
          </div>

          {/* Channel + personal nudges, kept small at the bottom.
              flex-wrap so the long sentence + link breaks gracefully on mobile. */}
          <p className="text-xs text-muted-foreground mb-2 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 px-2">
            <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0" />
            <span>Sold through authorised channel partners across Australia and New Zealand.</span>
          </p>
          <p className="text-xs text-muted-foreground flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 px-2">
            <Home className="h-3.5 w-3.5 flex-shrink-0" />
            <span>Just want it for your home PC?</span>
            <Link to="/personal" className="text-primary font-medium hover:underline">
              Get Mithras Personal &mdash; $6/mo &rarr;
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}

function ProofPoint({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-border/40 bg-card/50 backdrop-blur text-muted-foreground">
      <span className="text-primary">{icon}</span>
      <span className="font-medium">{label}</span>
    </div>
  );
}
