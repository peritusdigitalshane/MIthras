import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "react-router-dom";
import { PortalHero } from "@/components/portal/PortalHero";
import { PortalStatCard } from "@/components/portal/PortalStatCard";
import { PortalEmptyState } from "@/components/portal/PortalEmptyState";
import {
  useCustomerOrg, useCustomerOrgId, useCustomerEndpointSummary,
  useCustomerThreatSummary, useCustomerReseller,
} from "@/hooks/useCustomerScope";
import { useState } from "react";
import {
  Shield, Monitor, Wifi, AlertTriangle, ShieldCheck, FileText, Phone, ArrowUpRight,
  AlertCircle, Mail, Sparkles, X,
} from "lucide-react";

export default function CustomerDashboard() {
  const orgId = useCustomerOrgId();
  const { data: org } = useCustomerOrg();
  const { data: reseller } = useCustomerReseller();
  const { data: ep, isLoading: epLoading } = useCustomerEndpointSummary();
  const { data: tr, isLoading: trLoading } = useCustomerThreatSummary();

  if (!orgId) {
    return (
      <MainLayout>
        <div className="p-6 max-w-2xl mx-auto">
          <Card>
            <CardContent className="p-6 space-y-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-muted-foreground" />
                <h2 className="text-lg font-semibold">No customer organisation selected</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Your account isn't currently scoped to a customer organisation. If you're a reseller, switch tenants from the sidebar.
              </p>
            </CardContent>
          </Card>
        </div>
      </MainLayout>
    );
  }

  const isActive = org?.is_active !== false;
  const status: { label: string; tone: "ok" | "warn" | "bad" } = (tr?.active ?? 0) > 0
    ? { label: `${tr?.active} active threats`, tone: "warn" }
    : { label: "Secure", tone: "ok" };

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-7xl mx-auto">
        <PortalHero
          eyebrow="Customer portal"
          eyebrowIcon={<ShieldCheck className="h-3.5 w-3.5" />}
          title={org?.name ?? "Your organisation"}
          subtitle={
            reseller
              ? `Your Windows machines are under round-the-clock watch. ${reseller.name} handles threats automatically — this is your progress report. We'll only reach out if something needs your attention.`
              : "Your Windows machines are under round-the-clock watch. We handle threats automatically — this is your progress report. We'll only email you if something needs your attention."
          }
          status={status}
          accent="emerald"
        />

        {!isActive && (
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardContent className="p-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <div className="font-semibold text-sm">Protection paused — billing issue</div>
                <p className="text-xs text-muted-foreground">
                  Your protection has been paused because of a subscription or billing issue. Your machines aren't being monitored right now.
                  Please contact {reseller?.name ?? "your IT provider"} to restore service — this is usually fixed in a few minutes.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <PortalStatCard
            label="Protected machines"
            value={ep?.total ?? 0}
            hint="Windows PCs and servers being watched"
            icon={<Monitor className="h-4 w-4" />}
            loading={epLoading}
          />
          <PortalStatCard
            label="Currently online"
            value={ep?.online ?? 0}
            hint="Checked in within the last 10 min — offline usually just means powered off"
            icon={<Wifi className="h-4 w-4" />}
            loading={epLoading}
          />
          <PortalStatCard
            label="Active threats"
            value={tr?.active ?? 0}
            hint={(tr?.active ?? 0) === 0 ? "All clear — nothing for you to do" : `${reseller?.name ?? "Your IT team"} is on it — they'll email if they need you`}
            icon={<AlertTriangle className="h-4 w-4" />}
            loading={trLoading}
            positiveIsBad={true}
          />
          <PortalStatCard
            label="Caught this week"
            value={tr?.last7Days ?? 0}
            hint="Threats spotted and handled — most are blocked instantly"
            icon={<Shield className="h-4 w-4" />}
            loading={trLoading}
          />
        </div>

        {/* First-time onboarding card — appears for customers with ≥1 endpoint who
            haven't dismissed it yet. Localstorage flag mirrors the disty/partner pattern. */}
        <CustomerFirstTimeCard reseller={reseller} />

        {(ep?.total ?? 0) === 0 && !epLoading ? (
          <PortalEmptyState
            icon={<Monitor className="h-7 w-7" />}
            title="No endpoints yet"
            description={
              <p>
                Once {reseller?.name ?? "your reseller"} installs the Mithras agent on your Windows machines, they'll appear here.
                Telemetry — threats, posture, software inventory — flows back automatically within 60 seconds of install.
              </p>
            }
            secondaryAction={reseller ? { label: `Contact ${reseller.name}`, href: "/customer/contact" } : undefined}
            accent="emerald"
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="h-4 w-4 text-primary" /> Your security posture
                </CardTitle>
                <CardDescription>
                  A quick health check across your Windows machines right now.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <PostureRow ok={(ep?.total ?? 0) > 0} label="Windows Defender being watched on every machine" />
                <PostureRow ok={(tr?.active ?? 0) === 0} label={(tr?.active ?? 0) === 0 ? "No threats need attention" : `${tr?.active} threat${tr?.active === 1 ? "" : "s"} ${reseller?.name ?? "your IT team"} is handling`} bad={(tr?.active ?? 0) > 0} />
                <PostureRow ok={(ep?.offline ?? 0) === 0} label={(ep?.offline ?? 0) === 0 ? "Every machine is reporting in" : `${ep?.offline} machine${ep?.offline === 1 ? "" : "s"} powered off or asleep`} warn={(ep?.offline ?? 0) > 0} />
                <PostureRow ok={true} label="Around-the-clock monitoring active" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Phone className="h-4 w-4 text-primary" /> Your security team
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {reseller ? (
                  <>
                    <div>
                      <div className="font-medium">{reseller.name}</div>
                      <div className="text-xs text-muted-foreground">Your Mithras reseller</div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Threats are actioned by {reseller.name}'s SOC team automatically — you don't need to respond unless they reach out.
                    </p>
                    <Button asChild variant="outline" size="sm" className="w-full">
                      <Link to="/customer/contact">View contact details <ArrowUpRight className="h-3 w-3 ml-1" /></Link>
                    </Button>
                  </>
                ) : (
                  // Reachable only for direct customers (no reseller) — currently
                  // unused in production but kept so super-admin-created customer
                  // orgs without a reseller render cleanly.
                  <p className="text-sm text-muted-foreground">Your account is managed directly by Mithras. Email <a className="underline" href="mailto:support@mithras.com.au">support@mithras.com.au</a> for help.</p>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        <Card className="bg-gradient-to-br from-muted/30 to-transparent">
          <CardContent className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
            <QuickLink icon={<Monitor className="h-5 w-5" />} label="My endpoints" hint="Read-only list of your protected machines" href="/customer/endpoints" />
            <QuickLink icon={<AlertTriangle className="h-5 w-5" />} label="My threats" hint={`${tr?.active ?? 0} active right now`} href="/customer/threats" />
            <QuickLink icon={<FileText className="h-5 w-5" />} label="Monthly reports" hint="Compliance summaries you can share" href="/customer/reports" />
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}

function PostureRow({ ok, label, warn, bad }: { ok: boolean; label: string; warn?: boolean; bad?: boolean }) {
  const Icon = bad ? AlertCircle : warn ? AlertTriangle : ShieldCheck;
  const tint = bad ? "text-rose-500" : warn ? "text-amber-500" : "text-emerald-500";
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${tint}`} />
      <span className="text-sm">{label}</span>
    </div>
  );
}

// First-time onboarding card for the customer portal. Dismissable, persists
// via localStorage so it doesn't reappear after a session refresh. Mirrors
// the disty/partner onboarding cards but with non-technical language.
function CustomerFirstTimeCard({ reseller }: { reseller: { name: string } | null | undefined }) {
  const storageKey = "mithras-customer-firsttime-dismissed";
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(storageKey) === "true";
  });
  const dismiss = () => {
    setDismissed(true);
    try { window.localStorage.setItem(storageKey, "true"); } catch {}
  };
  if (dismissed) return null;

  const team = reseller?.name ?? "Mithras";

  return (
    <Card className="relative overflow-hidden border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 via-emerald-500/0 to-transparent">
      <button
        onClick={dismiss}
        className="absolute right-3 top-3 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Dismiss"
        title="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
      <CardContent className="p-5 sm:p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-emerald-500/15 flex items-center justify-center shrink-0 ring-1 ring-emerald-500/20">
            <Sparkles className="h-5 w-5 text-emerald-500" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-base">First time here?</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              {team} watches your Windows machines 24/7. This dashboard is just a summary — you don't have to act on anything unless they email or call you. Here's a quick tour:
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 ml-13">
          <Tour line="The big numbers above tell you how many machines are protected and whether anything is going wrong." />
          <Tour line='"Protected machines" = your Windows PCs and servers. "Currently online" means they checked in recently.' />
          <Tour line='"Threats" are spotted automatically. Most are blocked instantly — you only hear from us if something needs your attention.' />
          <Tour line='"Monthly reports" gives you a PDF you can forward to your boss or insurer.' />
        </div>
        <div className="flex justify-end pt-1">
          <Button size="sm" variant="ghost" onClick={dismiss}>Got it</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Tour({ line }: { line: string }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 mt-2 shrink-0" />
      <span className="text-muted-foreground">{line}</span>
    </div>
  );
}

function QuickLink({ icon, label, hint, href }: { icon: React.ReactNode; label: string; hint: string; href: string }) {
  return (
    <Link to={href} className="flex items-center gap-3 p-2 -mx-2 rounded-lg hover:bg-muted/50 transition-colors">
      <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{label}</div>
        <div className="text-xs text-muted-foreground truncate">{hint}</div>
      </div>
      <ArrowUpRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </Link>
  );
}
