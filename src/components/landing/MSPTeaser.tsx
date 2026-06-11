import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Briefcase, ArrowRight, Building2, FileText, Handshake } from "lucide-react";

const POINTS = [
  { icon: <Building2 className="h-4 w-4" />, label: "Multi-tenant from day one" },
  { icon: <FileText className="h-4 w-4" />,  label: "Auto-drafted monthly reports" },
  { icon: <Handshake className="h-4 w-4" />, label: "Channel margins worth selling on" },
];

export function MSPTeaser() {
  return (
    <section id="msp-teaser" className="py-14 sm:py-20 px-4 sm:px-6">
      <div className="container mx-auto max-w-4xl">
        <div className="rounded-2xl border border-border/40 bg-gradient-to-br from-primary/5 via-card/40 to-card/30 backdrop-blur p-6 sm:p-8 md:p-10 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium tracking-wide uppercase mb-4 border border-primary/20">
            <Briefcase className="h-3.5 w-3.5" />
            For MSPs
          </div>
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-3 sm:mb-4 text-balance">
            The console your team runs in every morning.
          </h2>
          <p className="text-base sm:text-lg text-muted-foreground mb-6 max-w-2xl mx-auto leading-relaxed">
            Multi-tenant, AI-SOC-led, channel-friendly. Built for MSPs in
            Australia and New Zealand.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 mb-6 sm:mb-7">
            {POINTS.map((p) => (
              <span key={p.label} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border/50 bg-background/40 text-xs sm:text-sm text-foreground/80">
                <span className="text-primary">{p.icon}</span>
                {p.label}
              </span>
            ))}
          </div>
          <Button asChild>
            <Link to="/for-msps">
              See the MSP story
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
