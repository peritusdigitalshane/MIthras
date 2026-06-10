import { CheckCircle2, Building2, ServerCog, FileText } from "lucide-react";

const MSP_BENEFITS = [
  "No Microsoft 365 E5 licence required — uses the Defender already in Windows",
  "End-of-life Windows hardening — skip the Microsoft extended-support bill",
  "Microsegmentation with one-click \"learn → lock down\" workflow",
  "Multi-tenant from day one — strict per-customer data isolation",
  "Windows agent (full enforcement) + Linux agent (heartbeat + telemetry); macOS on the roadmap",
  "Process-level threat detection — full kill-chain visibility",
  "All 16 attack-surface-reduction rules + Defender posture, exclusions, controlled folder access",
  "Application allow-listing with reusable rule sets",
  "Full Group Policy controls without Active Directory",
  "Monthly customer PDF report — auto-generated, auto-emailed",
  "WordPress site protection alongside endpoints",
  "AI-written executive summaries on every report",
  "M365 security posture: 11 controls audited daily, plain-English fix plans",
  "Activity audit trail per tenant for compliance",
];

export function MSPSection() {
  return (
    <section id="msp" className="py-24 px-6">
      <div className="container mx-auto">
        <div className="grid lg:grid-cols-2 gap-16 items-start">
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] uppercase text-primary mb-4">
              For MSPs &amp; SMBs
            </p>
            <h2 className="text-3xl md:text-4xl font-bold mb-6">
              The console your security team runs in every morning.
            </h2>
            <p className="text-muted-foreground mb-8 leading-relaxed">
              Mithras Threat Defence is built to be the daily-use tool for an MSP managing
              endpoint security across many customers &mdash; not another portal you log into
              once a quarter. Switch tenants instantly, scope every action by customer, and
              hand a polished monthly report to each one.
            </p>
            <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
              {MSP_BENEFITS.map((benefit) => (
                <li key={benefit} className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-status-healthy flex-shrink-0 mt-0.5" />
                  <span className="text-sm leading-snug">{benefit}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-6">
            <Spotlight
              icon={<Building2 className="h-5 w-5 text-primary" />}
              title="Multi-tenant by design"
              body="One operator console manages unlimited customer organisations. Every customer's data is strictly walled off from every other customer's. Super-admins switch context with one click and pivot into any tenant view to support without leaking data."
              chips={["Tenant switcher", "Super-admin view", "Per-tenant feature gates", "Enrolment tokens"]}
            />
            <Spotlight
              icon={<ServerCog className="h-5 w-5 text-primary" />}
              title="Outbound-only agents"
              body="Signed agents run as managed services. They talk outbound-only — no inbound firewall holes. Communication is tamper-evident and updates are signed and verified end-to-end. Windows is the enforcement target; Linux ships telemetry today with enforcement coming."
              chips={["Windows enforcement", "Linux telemetry", "Outbound only", "Tamper-evident"]}
            />
            <Spotlight
              icon={<FileText className="h-5 w-5 text-primary" />}
              title="White-label-ready reports"
              body="A polished PDF for every customer, every month. AI-written executive summary, KPI grid, incidents and vulnerabilities tables — delivered automatically to the owner, IT manager, or compliance lead you've configured."
              chips={["Monthly + weekly", "Per-recipient opt-in", "White-label branding", "Auto-attached PDF"]}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function Spotlight({
  icon,
  title,
  body,
  chips,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  chips: string[];
}) {
  return (
    <div className="rounded-2xl border border-border/40 bg-card p-6 hover:border-primary/40 transition-colors">
      <div className="flex items-center gap-3 mb-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          {icon}
        </div>
        <h3 className="text-lg font-semibold">{title}</h3>
      </div>
      <p className="text-sm text-muted-foreground mb-4 leading-relaxed">{body}</p>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <span
            key={chip}
            className="px-2.5 py-1 rounded-md bg-muted/60 text-xs font-medium text-foreground/80"
          >
            {chip}
          </span>
        ))}
      </div>
    </div>
  );
}
