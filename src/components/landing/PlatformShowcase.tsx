import { BrowserFrame } from "./visuals/BrowserFrame";
import { MockSocDashboard } from "./visuals/MockSocDashboard";
import { MockIncidentView } from "./visuals/MockIncidentView";
import { Bot, ShieldAlert } from "lucide-react";

/**
 * "Look inside the console" — two stacked browser frames on the Landing page
 * showing the real platform UI styled, lit up, populated with synthetic data.
 * Used to give buyers a sense of what they're actually getting without
 * leaking real customer screenshots.
 */
export function PlatformShowcase() {
  return (
    <section className="relative py-20 sm:py-24 px-4 sm:px-6 overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-1/3 left-1/4 w-[700px] h-[500px] bg-primary/8 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-[600px] h-[400px] bg-emerald-500/5 rounded-full blur-3xl" />
      </div>
      <div className="container mx-auto max-w-7xl">
        <div className="text-center mb-12 sm:mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-[11px] font-medium uppercase tracking-wider mb-4">
            <Bot className="h-3.5 w-3.5" />
            Look inside the console
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-4">
            Built for analysts who are tired of triaging from a spreadsheet.
          </h2>
          <p className="text-base sm:text-lg text-muted-foreground max-w-3xl mx-auto">
            Every alert lands in a workspace that already knows what happened, who&apos;s
            affected, and what the agents decided. Click to open the incident — the
            evidence trail, agent verdicts, and playbook are already filled in.
          </p>
        </div>

        <div className="space-y-10 sm:space-y-14">
          {/* Frame 1: SOC overview */}
          <div className="relative">
            <FrameLabel
              icon={<Bot className="h-3.5 w-3.5" />}
              eyebrow="/soc"
              title="The whole fleet, at a glance"
              body="14 organisations, 487 endpoints, 142 alerts in the last 24 hours — 119 already auto-resolved by the agent team. The 23 that need human eyes are surfaced first."
            />
            <BrowserFrame url="console.mithras.com.au/soc" tilt>
              <MockSocDashboard />
            </BrowserFrame>
          </div>

          {/* Frame 2: Incident detail */}
          <div className="relative">
            <FrameLabel
              icon={<ShieldAlert className="h-3.5 w-3.5" />}
              eyebrow="/soc/incidents/INC-2418"
              title="Every incident, fully reasoned"
              body="When an analyst opens an incident, the AI commander has already laid out who, what, when, why — and what the playbook just did about it. Every claim cites the evidence row it&apos;s based on."
            />
            <BrowserFrame url="console.mithras.com.au/soc/incidents/INC-2418" tilt>
              <MockIncidentView />
            </BrowserFrame>
          </div>
        </div>
      </div>
    </section>
  );
}

function FrameLabel({
  icon, eyebrow, title, body,
}: {
  icon: React.ReactNode; eyebrow: string; title: string; body: string;
}) {
  return (
    <div className="max-w-3xl mb-5">
      <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-card/60 border border-border/40 text-[11px] font-mono text-muted-foreground mb-2">
        <span className="text-primary">{icon}</span>
        {eyebrow}
      </div>
      <h3 className="text-xl sm:text-2xl font-semibold mb-2 tracking-tight">{title}</h3>
      <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}
