import { useState } from "react";
import { Link } from "react-router-dom";
import { LandingNav } from "@/components/landing/LandingNav";
import { Footer } from "@/components/landing/CTAFooter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Seo } from "@/components/seo/Seo";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Check, X, ArrowRight, ShieldCheck, Loader2, Home, Mail, CreditCard, AlertCircle,
} from "lucide-react";

const PERSONAL_PRICE_AUD = 6;

const INCLUDED = [
  "Microsoft Defender hardening — auto-tuned for personal use",
  "Threat alerts emailed within minutes if something serious happens",
  "Monthly security report sent to your inbox",
  "Suspicious-process detection",
  "Ransomware behaviour protection",
  "Auto-update of the agent",
  "Cancel anytime — no contract",
];

const NOT_INCLUDED = [
  "Web console / dashboard — this plan is hands-off",
  "Network lockdown + application allow-listing (business-grade features)",
  "Phone support (email only)",
  "Multi-machine plans — one PC per subscription",
];

export default function Personal() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [stripeUnconfigured, setStripeUnconfigured] = useState(false);

  const handleSubscribe = async () => {
    if (!email.trim() || !email.includes("@")) {
      toast({ title: "Enter your email", description: "We'll send your agent install link there.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "");
      // Stripe checkout requires no auth — uses the anon key only. The
      // edge function returns either a Stripe checkout URL or an error
      // explaining Stripe hasn't been configured yet.
      const resp = await fetch(`${supabaseUrl}/functions/v1/stripe-checkout-personal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const json = await resp.json();
      if (!resp.ok) {
        if (json.error === "stripe_not_configured") {
          setStripeUnconfigured(true);
          return;
        }
        throw new Error(json.error ?? `HTTP ${resp.status}`);
      }
      // Hand off to Stripe Checkout
      window.location.href = json.url;
    } catch (e: any) {
      toast({ title: "Couldn't start checkout", description: e.message ?? "Try again or email support@mithras.com.au", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Seo
        title="Personal — Mithras Threat Defence"
        description="Protect your personal Windows PC for $6/month. The same Defender-hardening and threat-monitoring stack we sell to Australian businesses, tuned for home use."
        canonical="/personal"
      />
      <div className="min-h-screen bg-background">
        <LandingNav />

        {/* Hero */}
        <section className="relative pt-32 pb-12 px-6">
          <div className="absolute inset-0 -z-10">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-background to-background" />
            <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[500px] h-[300px] bg-emerald-500/10 rounded-full blur-3xl" />
          </div>
          <div className="container mx-auto max-w-4xl text-center space-y-5">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border bg-muted/50">
              <Home className="h-3.5 w-3.5 text-emerald-500" />
              <span className="text-xs font-medium uppercase tracking-wider">For personal use</span>
            </div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
              Enterprise-grade security<br className="hidden sm:inline" /> for your home PC.
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              The same Defender-hardening, threat-detection, and monitoring stack we sell to Australian businesses —
              tuned for one home PC, billed at <strong>${PERSONAL_PRICE_AUD}/month</strong>. No dashboard, no
              cybersecurity homework. We just protect your machine.
            </p>
          </div>
        </section>

        {/* Subscribe card */}
        <section className="px-6 pb-16">
          <div className="container mx-auto max-w-md">
            <Card className="border-2 border-emerald-500/30 shadow-xl shadow-emerald-500/10">
              <CardContent className="p-7 space-y-5">
                <div className="text-center space-y-1">
                  <div className="flex items-baseline justify-center gap-1">
                    <span className="text-5xl font-bold tabular-nums">${PERSONAL_PRICE_AUD}</span>
                    <span className="text-sm text-muted-foreground">AUD</span>
                  </div>
                  <div className="text-sm text-muted-foreground">per month · cancel anytime</div>
                </div>

                {stripeUnconfigured ? (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Subscriptions opening soon</AlertTitle>
                    <AlertDescription>
                      Online payment isn't quite ready yet. Email <a href="mailto:hello@mithras.com.au" className="underline">hello@mithras.com.au</a> and we'll set you up by hand in the meantime.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="personal-email" className="text-xs uppercase tracking-wider text-muted-foreground">Your email</Label>
                      <Input id="personal-email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                      <p className="text-[11px] text-muted-foreground">We'll email your install link here right after checkout.</p>
                    </div>
                    <Button onClick={handleSubscribe} size="lg" className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={submitting}>
                      {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CreditCard className="h-4 w-4 mr-2" />}
                      Subscribe via Stripe <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  </>
                )}

                <div className="text-[11px] text-muted-foreground text-center pt-2 border-t flex items-center justify-center gap-1.5">
                  <ShieldCheck className="h-3 w-3" />
                  Secure checkout. Card details never touch our servers.
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* What you get */}
        <section className="py-16 px-6 bg-muted/10 border-y border-border/40">
          <div className="container mx-auto max-w-4xl">
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-3 text-center">What's included</h2>
            <p className="text-center text-muted-foreground mb-10 max-w-xl mx-auto">
              We tuned the platform for personal use. Everything is automatic — install once and forget it's there.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardContent className="p-5 space-y-3">
                  <Badge variant="outline" className="border-emerald-500/60 text-emerald-600 dark:text-emerald-400">Included</Badge>
                  <ul className="space-y-2.5">
                    {INCLUDED.map(f => (
                      <li key={f} className="flex items-start gap-2.5 text-sm">
                        <Check className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5 space-y-3">
                  <Badge variant="outline" className="border-muted-foreground/40 text-muted-foreground">Not in this plan</Badge>
                  <ul className="space-y-2.5">
                    {NOT_INCLUDED.map(f => (
                      <li key={f} className="flex items-start gap-2.5 text-sm">
                        <X className="h-4 w-4 text-muted-foreground/60 mt-0.5 shrink-0" />
                        <span className="text-muted-foreground">{f}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-muted-foreground border-t pt-3">
                    Need any of these? Mithras for business is sold through resellers — <Link to="/contact-sales" className="underline">talk to sales</Link>.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="py-16 px-6">
          <div className="container mx-auto max-w-3xl">
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-10 text-center">How it works</h2>
            <ol className="space-y-5">
              <Step n={1} title="You subscribe">
                Enter your email and complete Stripe checkout. ${PERSONAL_PRICE_AUD}/month, cancel anytime.
              </Step>
              <Step n={2} title="We email you a one-click install command">
                Open PowerShell as Administrator on your Windows PC, paste the command, hit enter.
                Takes about 3 minutes. The Mithras agent starts protecting your machine immediately.
              </Step>
              <Step n={3} title="We watch your PC, you don't have to">
                The agent reports back to Mithras continuously. If we detect ransomware activity, a malicious script,
                or a major posture problem, we email you directly. Otherwise: stay quiet, stay protected.
              </Step>
              <Step n={4} title="Monthly status email">
                Once a month we send you a one-page summary of what we caught, what we blocked, and any
                recommendations to harden your machine further.
              </Step>
            </ol>
          </div>
        </section>

        {/* FAQ-ish */}
        <section className="py-16 px-6 bg-muted/10 border-t border-border/40">
          <div className="container mx-auto max-w-3xl space-y-6">
            <h2 className="text-2xl font-bold tracking-tight mb-2">Things people ask</h2>
            <Faq q="Can I install this on more than one PC?">
              One subscription protects one PC. If you need more, subscribe again with a different email per PC, or
              contact us for a small-family plan.
            </Faq>
            <Faq q="Does this replace Microsoft Defender?">
              No — we use the Defender that's already in Windows. We just tune it to enterprise-grade settings and
              watch it from our side.
            </Faq>
            <Faq q="What if I cancel?">
              Cancel any time from the Stripe billing portal link we email you. Your protection continues until the
              end of your billing cycle; the agent uninstalls itself automatically after that.
            </Faq>
            <Faq q="What if the agent finds something serious?">
              We email you with what we saw and what to do. If you don't respond and the threat is active, we
              email again with steps to remediate. For active ransomware we'll call you at the number on file.
            </Faq>
            <Faq q="Do I get a portal to log into?">
              No — that's the point. Personal plans are hands-off by design. If you want a portal, you want our
              business plan via a reseller — <Link to="/contact-sales" className="underline">talk to sales</Link>.
            </Faq>
          </div>
        </section>

        <Footer />
      </div>
    </>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-4">
      <div className="h-9 w-9 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-semibold shrink-0">
        {n}
      </div>
      <div className="space-y-1">
        <h3 className="font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>
      </div>
    </li>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="border-b pb-5">
      <h3 className="font-semibold mb-1.5">{q}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>
    </div>
  );
}
