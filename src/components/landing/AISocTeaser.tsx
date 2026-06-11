import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Bot, Brain, Shield, MessageSquare, AlertTriangle, ArrowRight } from "lucide-react";

const AGENT_BADGES = [
  { name: "Triage",       icon: <AlertTriangle className="h-3.5 w-3.5" />, accent: "border-orange-500/30 bg-orange-500/5 text-orange-400" },
  { name: "Verification", icon: <Brain className="h-3.5 w-3.5" />,         accent: "border-blue-500/30 bg-blue-500/5 text-blue-400" },
  { name: "Adversarial",  icon: <Shield className="h-3.5 w-3.5" />,        accent: "border-red-500/30 bg-red-500/5 text-red-400" },
  { name: "Response",     icon: <Bot className="h-3.5 w-3.5" />,           accent: "border-emerald-500/30 bg-emerald-500/5 text-emerald-400" },
  { name: "Comms",        icon: <MessageSquare className="h-3.5 w-3.5" />, accent: "border-purple-500/30 bg-purple-500/5 text-purple-400" },
];

export function AISocTeaser() {
  return (
    <section id="ai-soc-teaser" className="relative py-14 sm:py-20 px-4 sm:px-6 overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[400px] bg-primary/5 rounded-full blur-3xl" />
      </div>

      <div className="container mx-auto max-w-5xl">
        <div className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur p-6 sm:p-8 md:p-10">
          <div className="grid lg:grid-cols-[1fr_auto] gap-6 lg:gap-10 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium tracking-wide uppercase mb-4 border border-primary/20">
                <Bot className="h-3.5 w-3.5" />
                The AI SOC
              </div>
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-4 text-balance leading-tight">
                Five agents. One verdict. Every alert.
              </h2>
              <p className="text-base sm:text-lg text-muted-foreground mb-5 sm:mb-6 leading-relaxed">
                Every alert passes through an independent chain of AI agents
                that cross-check each other, cite their evidence, and only
                act when they agree. Triage in seconds, 24/7/365.
              </p>

              <div className="flex flex-wrap gap-1.5 sm:gap-2 mb-5 sm:mb-6">
                {AGENT_BADGES.map((a) => (
                  <span
                    key={a.name}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium ${a.accent}`}
                  >
                    {a.icon}
                    {a.name}
                  </span>
                ))}
              </div>

              <Button asChild>
                <Link to="/ai-soc">
                  See how the agents work
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>

            <div className="bg-background/40 rounded-xl border border-border/40 p-4 sm:p-5 hidden lg:block w-[280px]">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-2">Sample verdict trail</p>
              <div className="space-y-2 font-mono text-[11px] text-foreground/80">
                <div>triage &rarr; <span className="text-emerald-400">true_positive 0.95</span></div>
                <div>verify &rarr; <span className="text-amber-400">needs_human 0.50</span></div>
                <div>adversarial &rarr; <span className="text-emerald-400">not_refuted 0.85</span></div>
                <div>consensus &rarr; <span className="text-foreground">true_positive · disagreement</span></div>
                <div>response &rarr; <span className="text-blue-400">isolate · rollback armed</span></div>
                <div>comms &rarr; <span className="text-purple-400">draft ready · 7 citations</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
