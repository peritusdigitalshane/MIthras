import { Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PortalHero } from "@/components/portal/PortalHero";
import { useCustomerOrg, useCustomerReseller } from "@/hooks/useCustomerScope";
import {
  ShieldCheck, Mail, Phone, AlertTriangle, Clock, ArrowUpRight, BookOpen,
} from "lucide-react";

export default function CustomerContact() {
  const { data: org } = useCustomerOrg();
  const { data: reseller } = useCustomerReseller();

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-4xl mx-auto">
        <PortalHero
          eyebrow="Customer portal"
          eyebrowIcon={<ShieldCheck className="h-3.5 w-3.5" />}
          title="Need help?"
          subtitle="Who to contact for what, with response times you can rely on."
          accent="emerald"
        />

        {reseller && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" /> Your security team
              </CardTitle>
              <CardDescription>
                {reseller.name} is your Mithras reseller. They run your SOC and are your first point of contact for anything security-related.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <ContactCard
                  icon={<Mail className="h-4 w-4" />}
                  label="Email"
                  value={
                    reseller.support_email ? (
                      <a className="underline" href={`mailto:${reseller.support_email}`}>{reseller.support_email}</a>
                    ) : (
                      "Listed on your monthly invoice from your reseller."
                    )
                  }
                  hint="Best for non-urgent questions and routine requests."
                />
                <ContactCard
                  icon={<Phone className="h-4 w-4" />}
                  label="Web"
                  value={
                    reseller.support_url ? (
                      <a className="underline" href={reseller.support_url} target="_blank" rel="noreferrer">
                        {reseller.support_url.replace(/^https?:\/\//, "")}
                      </a>
                    ) : (
                      "Phone details are on your reseller's invoice or website."
                    )
                  }
                  hint="Best for time-sensitive issues during business hours."
                />
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-500" /> Active security incident?
            </CardTitle>
            <CardDescription>
              If you suspect your business is being attacked right now — phishing email opened, ransomware demand, suspicious bank-transfer request — escalate immediately.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>24/7 SOC escalation</AlertTitle>
              <AlertDescription>
                Email <a className="underline font-semibold" href="mailto:soc@mithras.com.au?subject=URGENT%20security%20incident">soc@mithras.com.au</a> with subject line "URGENT security incident".
                Target response: 1 hour, 24/7. Include your organisation name, the affected machine, and what you observed.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" /> Response times
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border">
              <ResponseRow severity="Critical" badge="bad" timeline="≤ 1 hour, 24/7" desc="Active attack, data breach, ransomware, business-email compromise" />
              <ResponseRow severity="High"     badge="warn" timeline="≤ 4 hours, business hours" desc="Suspicious activity, multiple failed logins, malware detected on a key machine" />
              <ResponseRow severity="Medium"   badge="info" timeline="Next business day" desc="Posture warnings, isolated detections, policy questions" />
              <ResponseRow severity="Low"      badge="ok" timeline="Within 5 business days" desc="Feature requests, account changes, general questions" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-muted/30 to-transparent">
          <CardContent className="p-5 flex items-start gap-4">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <BookOpen className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 space-y-2">
              <div>
                <h3 className="font-semibold">Glossary & quick definitions</h3>
                <p className="text-sm text-muted-foreground">
                  What does each posture indicator mean? What's a "Severe" threat vs "Low"?
                  The glossary explains the terms you'll see on this dashboard.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to="/glossary">
                  Open glossary <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        {!reseller && (
          <Card>
            <CardContent className="p-5">
              <h3 className="font-semibold text-sm">Direct from Mithras</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Your account isn't currently routed through a reseller. Email <a className="underline" href="mailto:support@mithras.com.au">support@mithras.com.au</a> for anything.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </MainLayout>
  );
}

function ContactCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: React.ReactNode; hint: string }) {
  return (
    <div className="rounded-lg border bg-background p-4 space-y-1.5">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        {icon}<span>{label}</span>
      </div>
      <div className="text-sm font-medium">{value}</div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function ResponseRow({ severity, badge, timeline, desc }: { severity: string; badge: "bad"|"warn"|"info"|"ok"; timeline: string; desc: string }) {
  const cls = badge === "bad"  ? "border-rose-500/60 text-rose-600 dark:text-rose-400 bg-rose-500/10"
            : badge === "warn" ? "border-amber-500/60 text-amber-600 dark:text-amber-400 bg-amber-500/10"
            : badge === "info" ? "border-blue-500/60 text-blue-600 dark:text-blue-400 bg-blue-500/10"
            : "border-emerald-500/60 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10";
  return (
    <div className="flex items-start gap-4 py-3">
      <Badge variant="outline" className={`shrink-0 ${cls}`}>{severity}</Badge>
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="text-sm font-medium">{timeline}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
    </div>
  );
}
