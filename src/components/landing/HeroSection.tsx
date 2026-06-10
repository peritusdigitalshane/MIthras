import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight, ShieldCheck, Eye, Lock, History, CreditCard, Home } from "lucide-react";

const SALES_MAILTO =
  "mailto:hello@peritusdigital.com.au" +
  "?subject=" + encodeURIComponent("Mithras — 50+ endpoints, talk to sales") +
  "&body=" + encodeURIComponent(
    "Hi Mithras team,\n\nWe're evaluating Mithras Threat Defence.\n\n" +
    "• Organisation / MSP name:\n" +
    "• Endpoint count:\n" +
    "• Operating systems in scope:\n" +
    "• Anything urgent driving the evaluation (EOL Windows, CrowdStrike replacement, MSP rollout, etc.):\n\n" +
    "Best time to talk:\n"
  );

export function HeroSection() {
  return (
    <section className="relative pt-32 pb-24 px-6 overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[1100px] h-[600px] bg-primary/10 rounded-full blur-3xl" />
      </div>

      <div className="container mx-auto">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium tracking-wide uppercase mb-8 border border-primary/20">
            <ShieldCheck className="h-3.5 w-3.5" />
            Endpoint security for MSPs &middot; built in Australia
          </div>

          <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight mb-6 leading-[1.05]">
            Lock down your Windows fleet
            <span className="block bg-gradient-to-r from-primary via-primary/80 to-primary/50 bg-clip-text text-transparent">
              in under 10 minutes.
            </span>
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
            One agent, one console. Centrally manage Microsoft Defender, microsegment every endpoint,
            harden end-of-life Windows, and hand customers a real monthly report &mdash; without
            paying for Microsoft E5 or stitching together five tools.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-6">
            <Button size="lg" className="h-12 px-7 text-base shadow-lg shadow-primary/20" asChild>
              <Link to="/contact-sales">
                Talk to sales
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="h-12 px-7 text-base" asChild>
              <Link to="/channel-program">Become a partner</Link>
            </Button>
          </div>

          <p className="text-xs text-muted-foreground mb-3 flex items-center justify-center gap-1.5">
            <CreditCard className="h-3.5 w-3.5" />
            Sold through authorised channel partners across Australia and New Zealand.
          </p>
          <p className="text-xs text-muted-foreground mb-12">
            <Home className="h-3.5 w-3.5 inline-block mr-1 -mt-0.5" />
            Just want it for your home PC?{" "}
            <Link to="/personal" className="text-primary font-medium hover:underline">
              Get Mithras Personal — $6/mo →
            </Link>
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-3xl mx-auto text-sm">
            <ProofPoint icon={<Eye className="h-4 w-4" />} label="Learn-mode firewall" />
            <ProofPoint icon={<Lock className="h-4 w-4" />} label="One-click lockdown" />
            <ProofPoint icon={<History className="h-4 w-4" />} label="EOL Windows hardening" />
            <ProofPoint icon={<ShieldCheck className="h-4 w-4" />} label="No E5 required" />
          </div>
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
