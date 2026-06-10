import { Shield, Eye, ServerCog, Building2, FileText, Globe, History } from "lucide-react";

interface OverviewFeature {
  icon: React.ReactNode;
  title: string;
  description: string;
  meta?: string;
}

const FEATURES: OverviewFeature[] = [
  {
    icon: <Eye className="h-6 w-6" />,
    title: "Microsegmentation",
    description:
      "Audit-mode rules observe inbound traffic per service, per endpoint. Click 'Lock Down' to install the Windows Firewall block — with one-click source whitelisting from the same dashboard.",
    meta: "Learn → lock",
  },
  {
    icon: <History className="h-6 w-6" />,
    title: "EOL Windows hardening",
    description:
      "Harden Windows 7, 8.1, 10, Server 2012 and 2012 R2 endpoints with profile-driven controls and per-endpoint compliance scoring. Skip the Microsoft ESU bill — Mithras quantifies what you're avoiding.",
    meta: "Skip the ESU bill",
  },
  {
    icon: <Shield className="h-6 w-6" />,
    title: "Defender management",
    description:
      "Full Microsoft Defender posture coverage — real-time protection, cloud delivery, behaviour monitoring, all 16 ASR rules, controlled folder access, and centralised exclusions.",
    meta: "No E5 required",
  },
  {
    icon: <ServerCog className="h-6 w-6" />,
    title: "Cross-platform agents",
    description:
      "Lightweight, signed agents for Windows and Linux (Ubuntu, RHEL, Debian). Outbound-only — no inbound firewall holes. Tamper-evident communication and automatic updates.",
    meta: "Windows + Linux today",
  },
  {
    icon: <Building2 className="h-6 w-6" />,
    title: "Built for MSPs",
    description:
      "Multi-tenant from day one. One operator console, unlimited customer organisations, per-customer policies, strict data isolation, and a fleet-wide SOC dashboard.",
    meta: "Per-customer scoping",
  },
  {
    icon: <FileText className="h-6 w-6" />,
    title: "Monthly client PDFs",
    description:
      "Auto-generated monthly security report — KPIs, incidents, vulnerabilities, top software — emailed straight to your customer's IT manager. Optionally white-labelled with your branding.",
    meta: "Branded · PDF · Auto-delivered",
  },
  {
    icon: <Globe className="h-6 w-6" />,
    title: "WordPress site protection",
    description:
      "Add customers' WordPress sites alongside their endpoints. Plugin audit, file integrity, failed-login telemetry, and admin-action tracking from the same console.",
    meta: "Beyond the endpoint",
  },
];

export function FeaturesOverview() {
  return (
    <section id="features" className="py-24 px-6">
      <div className="container mx-auto">
        <div className="text-center mb-16 max-w-2xl mx-auto">
          <p className="text-xs font-semibold tracking-[0.18em] uppercase text-primary mb-4">
            What you get
          </p>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Seven headline capabilities. One console.
          </h2>
          <p className="text-muted-foreground">
            Endpoint security that goes beyond &ldquo;is Defender enabled?&rdquo; &mdash; with the
            day-to-day MSP workflows already in place.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="group relative p-6 rounded-2xl border border-border/40 bg-card hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 transition-all"
            >
              <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                {f.icon}
              </div>
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="text-lg font-semibold">{f.title}</h3>
                {f.meta && (
                  <span className="text-[10px] font-medium tracking-wide uppercase text-muted-foreground bg-muted/50 px-2 py-0.5 rounded">
                    {f.meta}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
