import { MarketingShell } from "@/components/layout/MarketingShell";
import { Seo } from "@/components/seo/Seo";
import { CheckCircle2 } from "lucide-react";

const COMPONENTS = [
  { name: "Web application (app.mithras.com.au)", status: "operational" },
  { name: "API / Edge functions (api.mithras.com.au)", status: "operational" },
  { name: "SOC dashboard (soc.mithras.com.au)", status: "operational" },
  { name: "Agent enrollment + heartbeat", status: "operational" },
  { name: "Outbound email (reports + alerts)", status: "operational" },
];

const Status = () => (
  <MarketingShell>
    <Seo
      title="Status — Mithras Threat Defence"
      description="Current operational status of the Mithras Threat Defence platform components."
      canonical="/status"
    />
    <article className="container mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold mb-2">System status</h1>
      <p className="text-muted-foreground mb-10">
        Live status of the Mithras Threat Defence platform. Major incidents and planned
        maintenance windows are posted here.
      </p>

      <div className="rounded-xl border border-border/40 bg-card divide-y divide-border/40">
        {COMPONENTS.map((c) => (
          <div key={c.name} className="flex items-center justify-between p-4">
            <span className="text-sm font-medium">{c.name}</span>
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-500">
              <CheckCircle2 className="h-4 w-4" />
              {c.status}
            </span>
          </div>
        ))}
      </div>

      <h2 className="text-xl font-bold mt-10 mb-3">Reporting an issue</h2>
      <p className="text-muted-foreground">
        Seeing something we're not? Email{" "}
        <a className="underline" href="mailto:support@peritusdigital.com.au">
          support@peritusdigital.com.au
        </a>{" "}
        with the time, endpoint, and console URL you were on. We'll respond inside one
        business hour during AU business days.
      </p>

      <p className="text-xs text-muted-foreground mt-8">
        Note: this is a manually maintained status page. A fully automated status feed
        backed by uptime probes is on the roadmap.
      </p>
    </article>
  </MarketingShell>
);

export default Status;
