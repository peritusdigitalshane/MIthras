import { Link } from "react-router-dom";
import { ArrowRight, History, Network, ShieldCheck, Lock } from "lucide-react";

const HIGHLIGHTS = [
  {
    href: "/eol-windows",
    icon: <History className="h-5 w-5" />,
    title: "EOL Windows hardening",
    line: "Defend Win 7, 8.1, Server 2012 R2 without the ESU bill.",
  },
  {
    href: "/platform#microseg",
    icon: <Network className="h-5 w-5" />,
    title: "Microsegmentation",
    line: "Audit-mode firewall. One-click lock-down. Per-endpoint rules.",
  },
  {
    href: "/platform#defender",
    icon: <ShieldCheck className="h-5 w-5" />,
    title: "Defender management",
    line: "All 16 ASR rules + full posture. No Microsoft E5 required.",
  },
  {
    href: "/platform#app-control",
    icon: <Lock className="h-5 w-5" />,
    title: "Application control (WDAC)",
    line: "Audit first, enforce by ring. Publisher / path / hash rules.",
  },
];

export function PlatformHighlights() {
  return (
    <section id="features" className="py-14 sm:py-20 px-4 sm:px-6">
      <div className="container mx-auto max-w-6xl">
        <div className="text-center mb-10 sm:mb-12">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-3 sm:mb-4 text-balance">
            Eight capabilities. One agent. One console.
          </h2>
          <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto">
            The AI SOC sits on top of an integrated platform that covers
            every layer the agents enforce.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
          {HIGHLIGHTS.map((h) => (
            <Link
              key={h.href}
              to={h.href}
              className="group rounded-xl border border-border/40 bg-card/50 backdrop-blur p-5 hover:border-primary/40 hover:bg-card/70 transition-colors flex flex-col"
            >
              <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary border border-primary/20 flex items-center justify-center mb-4">
                {h.icon}
              </div>
              <h3 className="font-semibold text-base mb-2">{h.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">{h.line}</p>
              <span className="text-xs font-medium text-primary inline-flex items-center gap-1 mt-auto opacity-70 group-hover:opacity-100 transition-opacity">
                Learn more
                <ArrowRight className="h-3 w-3" />
              </span>
            </Link>
          ))}
        </div>
        <div className="text-center">
          <Link to="/platform" className="text-sm text-primary hover:underline inline-flex items-center gap-1">
            See the whole platform
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}
