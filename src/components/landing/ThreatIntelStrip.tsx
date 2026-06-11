import { ThreatIntelFeed } from "./visuals/ThreatIntelFeed";
import { Globe2 } from "lucide-react";

/**
 * Section wrapper for the Landing page that frames the live ThreatIntelFeed
 * component with a marketing heading.
 */
export function ThreatIntelStrip() {
  return (
    <section className="relative py-20 sm:py-24 px-4 sm:px-6 overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[600px] bg-fuchsia-500/5 rounded-full blur-3xl" />
      </div>
      <div className="container mx-auto max-w-7xl">
        <div className="text-center mb-10 sm:mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-fuchsia-500/10 border border-fuchsia-500/20 text-fuchsia-300 text-[11px] font-medium uppercase tracking-wider mb-4">
            <Globe2 className="h-3.5 w-3.5" />
            Threat intelligence
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-4">
            Every alert checked against{" "}
            <span className="bg-gradient-to-r from-fuchsia-400 to-primary bg-clip-text text-transparent">
              live threat intel.
            </span>
          </h2>
          <p className="text-base sm:text-lg text-muted-foreground max-w-3xl mx-auto">
            Active campaigns, fresh IOCs, new CVEs — your agents correlate against the
            ANZ region&apos;s threat landscape every time a triage decision is made.
            No analyst sits in a queue waiting for an IP to be reviewed.
          </p>
        </div>
        <ThreatIntelFeed />
      </div>
    </section>
  );
}
