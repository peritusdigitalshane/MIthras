import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Check, ArrowRight, Calculator, ShieldCheck, Home } from "lucide-react";

// Single retail price, channel-sold. Distributor and reseller wholesale
// numbers are intentionally NOT shown publicly — those live inside the
// distributor + reseller portals after sign-in. Public marketing keeps
// pricing simple: one retail rate, channel partners quote it.
const RETAIL_PER_ENDPOINT_AUD = 11;

const INCLUDED_FEATURES = [
  "Windows + Linux agent — central rollout, auto-update",
  "Defender posture management + threat ingest",
  "Microsegmentation (audit + lockdown)",
  "Application whitelisting (WDAC)",
  "End-of-life Windows hardening (Win7 / Server 2008 / 2012)",
  "AI SOC triage + investigation",
  "M365 email security (AI phishing/BEC/malware quarantine)",
  "Embedded remote desktop (MeshCentral)",
  "Monthly customer reports (PDF)",
  "Multi-tenant operator console",
];

export function PricingSection() {
  return (
    <section id="pricing" className="py-24 px-6 bg-muted/20">
      <div className="container mx-auto max-w-5xl">
        <div className="text-center mb-12 max-w-2xl mx-auto">
          <p className="text-xs font-semibold tracking-[0.18em] uppercase text-primary mb-4">
            Pricing
          </p>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            One simple price. Sold through partners.
          </h2>
          <p className="text-muted-foreground">
            Every feature, every workflow, every endpoint type — included.
            Bought from an authorised Mithras reseller in your region.
          </p>
        </div>

        {/* Business retail (featured) + Personal (slim secondary) side by side */}
        <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto mb-12 items-start">
          <div className="relative rounded-2xl p-8 border-2 border-primary bg-card shadow-xl shadow-primary/10 text-center md:col-span-2">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 px-3 py-1 rounded-full bg-primary text-primary-foreground text-xs font-semibold">
              <ShieldCheck className="h-3 w-3" />
              Business
            </div>
            <div className="mb-6">
              <div className="flex items-baseline justify-center gap-1">
                <span className="text-6xl font-bold tracking-tight">${RETAIL_PER_ENDPOINT_AUD}</span>
                <span className="text-sm text-muted-foreground">AUD</span>
              </div>
              <div className="text-sm text-muted-foreground mt-2">per endpoint / per month</div>
              <div className="text-xs text-muted-foreground mt-1">Billed monthly · Volume discounts from 250 endpoints</div>
            </div>
            <ul className="space-y-2 mb-7 text-left">
              {INCLUDED_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2.5">
                  <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                  <span className="text-sm">{f}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button size="lg" className="flex-1" asChild>
                <Link to="/contact-sales">
                  Find a reseller <ArrowRight className="h-4 w-4 ml-2" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="flex-1" asChild>
                <Link to="/channel-program">Channel program</Link>
              </Button>
            </div>
          </div>

          {/* Personal — slim secondary card. Direct-to-consumer Stripe channel. */}
          <div className="relative rounded-2xl p-6 border bg-card/60 text-center md:sticky md:top-24">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 px-3 py-1 rounded-full bg-muted text-foreground text-xs font-semibold border">
              <Home className="h-3 w-3" />
              Home
            </div>
            <div className="mb-5 mt-2">
              <div className="flex items-baseline justify-center gap-1">
                <span className="text-4xl font-bold tracking-tight">$6</span>
                <span className="text-xs text-muted-foreground">AUD</span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">per PC / per month</div>
              <div className="text-[11px] text-muted-foreground mt-1">Cancel anytime</div>
            </div>
            <ul className="space-y-1.5 mb-5 text-left text-xs">
              <li className="flex items-start gap-2"><Check className="h-3.5 w-3.5 text-primary flex-shrink-0 mt-0.5" /><span>Defender hardening, auto-tuned</span></li>
              <li className="flex items-start gap-2"><Check className="h-3.5 w-3.5 text-primary flex-shrink-0 mt-0.5" /><span>Threat alerts emailed within minutes</span></li>
              <li className="flex items-start gap-2"><Check className="h-3.5 w-3.5 text-primary flex-shrink-0 mt-0.5" /><span>Monthly security report</span></li>
              <li className="flex items-start gap-2"><Check className="h-3.5 w-3.5 text-primary flex-shrink-0 mt-0.5" /><span>One PC per subscription</span></li>
            </ul>
            <div className="text-[11px] text-muted-foreground mb-3 italic">
              No console. No phone support. Just protection.
            </div>
            <Button size="sm" className="w-full" variant="secondary" asChild>
              <Link to="/personal">
                Subscribe online <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Link>
            </Button>
          </div>
        </div>

        <PricingCalculator />

        <p className="text-center text-xs text-muted-foreground mt-12 max-w-2xl mx-auto">
          All prices AUD ex-GST. Volume discounts available for customers with 250+ endpoints — your reseller will quote.
        </p>
      </div>
    </section>
  );
}

function PricingCalculator() {
  const [endpoints, setEndpoints] = useState(50);

  const monthly = useMemo(() => endpoints * RETAIL_PER_ENDPOINT_AUD, [endpoints]);
  const yearly  = monthly * 12;

  return (
    <div className="border bg-card rounded-2xl p-7 max-w-2xl mx-auto">
      <div className="flex items-center gap-2 mb-5 text-sm font-semibold">
        <Calculator className="h-4 w-4 text-primary" />
        Quick estimate
      </div>
      <div className="space-y-5">
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Endpoints</span>
            <span className="font-mono font-semibold tabular-nums">{endpoints}</span>
          </div>
          <Slider
            value={[endpoints]}
            min={5} max={500} step={5}
            onValueChange={([v]) => setEndpoints(v)}
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>5</span><span>500+</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 pt-3 border-t">
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Per month</div>
            <div className="text-2xl font-bold tabular-nums">${monthly.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Per year</div>
            <div className="text-2xl font-bold tabular-nums">${yearly.toLocaleString()}</div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Retail estimate at ${RETAIL_PER_ENDPOINT_AUD}/seat. Your reseller may bundle, discount, or extend annual prepay terms.
        </p>
      </div>
    </div>
  );
}
