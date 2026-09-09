import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { LandingNav } from "@/components/landing/LandingNav";
import { Footer } from "@/components/landing/CTAFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Seo } from "@/components/seo/Seo";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Mail, Phone, Building2, Users, ShieldCheck, Loader2, CheckCircle2, ArrowRight,
} from "lucide-react";

type RoleIntent = "customer" | "reseller" | "distributor" | "unknown";

const ROLE_OPTIONS: { value: RoleIntent; label: string; blurb: string }[] = [
  { value: "customer",    label: "End customer — protect my own business",     blurb: "We'll connect you with a reseller in your region." },
  { value: "reseller",    label: "IT provider / MSP — sell to my customers",   blurb: "Apply to our reseller channel — 27-35% margin." },
  { value: "distributor", label: "Distributor — recruit resellers underneath", blurb: "Apply for distribution rights — 30-40% margin." },
  { value: "unknown",     label: "Just exploring",                              blurb: "We'll send some info and figure out the right fit." },
];

export default function ContactSales() {
  const [params] = useSearchParams();
  const intentParam = (params.get("intent") ?? "") as RoleIntent;
  const initialRole: RoleIntent =
    intentParam === "partner" ? "reseller" :
    ["customer","reseller","distributor","unknown"].includes(intentParam) ? intentParam :
    "unknown";

  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted]   = useState(false);

  const [company, setCompany] = useState("");
  const [name, setName]       = useState("");
  const [email, setEmail]     = useState("");
  const [phone, setPhone]     = useState("");
  const [role, setRole]       = useState<RoleIntent>(initialRole);
  const [endpoints, setEndpoints] = useState("");
  const [region, setRegion]   = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    // Re-sync if user changed the ?intent= param after page mount (shouldn't happen but safe).
    if (initialRole !== role && intentParam) setRole(initialRole);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intentParam]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company.trim() || !name.trim() || !email.trim()) {
      toast({ title: "Please fill in the required fields", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.from("sales_leads").insert({
        company_name:      company.trim(),
        contact_name:      name.trim(),
        contact_email:     email.trim(),
        contact_phone:     phone.trim() || null,
        role_intent:       role,
        endpoint_estimate: endpoints.trim() || null,
        region:            region.trim() || null,
        message:           message.trim() || null,
        source_url:        window.location.href,
        user_agent:        navigator.userAgent.slice(0, 500),
      } as any);
      if (error) throw error;
      setSubmitted(true);
    } catch (err: any) {
      toast({ title: "Couldn't submit", description: err.message ?? "Try again or email channel@mithras.com.au", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Seo
        title="Contact sales | Mithras Threat Defence"
        description="Talk to the Mithras team. SMBs get matched to a reseller in their region. MSPs and IT shops apply to the channel. Australian-built, Australia and New Zealand coverage."
        canonical="/contact-sales"
        keywords="Mithras sales contact, endpoint security quote Australia, MSP partner application, reseller match"
      />
      <div className="min-h-screen bg-background">
        <LandingNav />

        <section className="pt-32 pb-20 px-6">
          <div className="container mx-auto max-w-2xl">
            {submitted ? (
              <Card className="border-emerald-500/30 bg-emerald-500/5">
                <CardContent className="p-8 text-center space-y-4">
                  <div className="inline-flex h-14 w-14 rounded-2xl bg-emerald-500/15 items-center justify-center ring-1 ring-emerald-500/20">
                    <CheckCircle2 className="h-7 w-7 text-emerald-500" />
                  </div>
                  <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Thanks — we'll be in touch</h1>
                  <p className="text-muted-foreground">
                    Your enquiry is in. A real person responds personally within one business day. If it's urgent, email
                    {" "}<a className="underline" href="mailto:channel@mithras.com.au">channel@mithras.com.au</a>.
                  </p>
                  <Button asChild variant="outline">
                    <Link to="/">Back to home <ArrowRight className="h-4 w-4 ml-1" /></Link>
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="text-center mb-8 space-y-3">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border bg-muted/50">
                    <Mail className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs font-medium uppercase tracking-wider">Talk to sales</span>
                  </div>
                  <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Get in touch</h1>
                  <p className="text-muted-foreground max-w-lg mx-auto">
                    Mithras is sold through authorised channel partners. Tell us a bit about yourself and we'll route you correctly — to a reseller if you're an end customer, or to our channel team if you're an IT provider.
                  </p>
                </div>

                <Card>
                  <CardContent className="p-6 sm:p-7">
                    <form onSubmit={submit} className="space-y-4">
                      <div className="space-y-1.5">
                        <Label>I'm reaching out as*</Label>
                        <Select value={role} onValueChange={(v) => setRole(v as RoleIntent)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ROLE_OPTIONS.map(o => (
                              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">{ROLE_OPTIONS.find(o => o.value === role)?.blurb}</p>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="company">Company name*</Label>
                          <Input id="company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme Pty Ltd" required />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="name">Your name*</Label>
                          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" required />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="email">Work email*</Label>
                          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@acme.com.au" required />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="phone">Phone (optional)</Label>
                          <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+61 4xx xxx xxx" />
                        </div>
                      </div>

                      {(role === "customer" || role === "reseller") && (
                        <div className="space-y-1.5">
                          <Label htmlFor="endpoints">{role === "customer" ? "Roughly how many Windows endpoints?" : "Roughly how many endpoints across your customer base?"}</Label>
                          <Select value={endpoints} onValueChange={setEndpoints}>
                            <SelectTrigger><SelectValue placeholder="Pick a range" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="1-25">1 - 25</SelectItem>
                              <SelectItem value="26-100">26 - 100</SelectItem>
                              <SelectItem value="101-500">101 - 500</SelectItem>
                              <SelectItem value="501-2000">501 - 2,000</SelectItem>
                              <SelectItem value="2000+">2,000+</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <Label htmlFor="region">Region (optional)</Label>
                        <Input id="region" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="e.g. Sydney, AU / Auckland, NZ" />
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="message">Anything else we should know? (optional)</Label>
                        <Textarea id="message" value={message} onChange={(e) => setMessage(e.target.value)} placeholder={role === "reseller" ? "Tell us about your existing customer base and security stack." : "What's prompting you to look at this now?"} rows={4} />
                      </div>

                      <div className="flex flex-col sm:flex-row items-center gap-2 pt-2">
                        <Button type="submit" size="lg" disabled={submitting} className="w-full sm:w-auto">
                          {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                          {submitting ? "Submitting…" : "Send enquiry"}
                        </Button>
                        <p className="text-[11px] text-muted-foreground">
                          We respond personally within one business day. No newsletters, no auto-replies.
                        </p>
                      </div>
                    </form>
                  </CardContent>
                </Card>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6">
                  <DirectCard icon={<Mail className="h-4 w-4" />} label="Email" value="channel@mithras.com.au" href="mailto:channel@mithras.com.au" />
                  <DirectCard icon={<Phone className="h-4 w-4" />} label="AU support hours" value="9am – 5pm AEST" />
                  <DirectCard icon={<ShieldCheck className="h-4 w-4" />} label="Already a partner?" value="Sign in →" href="/login" />
                </div>
              </>
            )}
          </div>
        </section>

        <Footer />
      </div>
    </>
  );
}

function DirectCard({ icon, label, value, href }: { icon: React.ReactNode; label: string; value: string; href?: string }) {
  const inner = (
    <>
      <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">{icon}<span>{label}</span></div>
      <div className="font-medium text-sm">{value}</div>
    </>
  );
  return (
    <Card className={href ? "hover:border-primary/40 transition-colors" : ""}>
      <CardContent className="p-4 space-y-1">
        {href ? <a href={href} className="block">{inner}</a> : inner}
      </CardContent>
    </Card>
  );
}
