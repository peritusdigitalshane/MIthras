import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "react-router-dom";
import { PortalHero } from "@/components/portal/PortalHero";
import { PortalStatCard } from "@/components/portal/PortalStatCard";
import { PortalEmptyState } from "@/components/portal/PortalEmptyState";
import { PortalOnboarding } from "@/components/portal/PortalOnboarding";
import {
  useResellerCustomers, useResellerBillingSnapshot, useResellerOrg, useResellerOrgId,
} from "@/hooks/useReseller";
import { useCreditBalance, useResellerCreditHealth } from "@/hooks/useCredits";
import { useResellerDeals } from "@/hooks/useDealRegistrations";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import {
  Building2, Users, Monitor, Wifi, Receipt, ArrowUpRight, ShieldCheck, Plus, BookOpen,
} from "lucide-react";

function fmtMoney(cents: number, currency = "AUD") {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(cents / 100);
}

export default function PartnerDashboard() {
  const { data: customers, isLoading: customersLoading } = useResellerCustomers();
  const { data: billing, isLoading: billingLoading } = useResellerBillingSnapshot();
  const { data: org } = useResellerOrg();
  const orgId = useResellerOrgId();
  const { data: creditHealth } = useResellerCreditHealth(orgId);
  const { data: creditBalance } = useCreditBalance(orgId);
  const { data: deals } = useResellerDeals(orgId);

  const customerCount = customers?.length ?? 0;
  const totalEndpoints = customers?.reduce((s, c) => s + c.active_endpoint_count, 0) ?? 0;
  const onlineEndpoints = customers?.reduce((s, c) => s + c.online_endpoint_count, 0) ?? 0;
  const mrrCents = billing?.reduce((s, b) => s + b.line_total_cents, 0) ?? 0;
  const currency = (org as any)?.currency_code ?? "AUD";
  const isActive = (org as any)?.is_active !== false;

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-7xl mx-auto">
        <PortalHero
          eyebrow="Partner portal"
          eyebrowIcon={<ShieldCheck className="h-3.5 w-3.5" />}
          title={(org as any)?.name ?? "Reseller"}
          subtitle="Manage your customers, deploy the Mithras agent, and track wholesale billing in one place."
          status={{ label: isActive ? "Active" : "Suspended", tone: isActive ? "ok" : "bad" }}
          accent="indigo"
          actions={
            <Button asChild size="sm" className="shadow-sm">
              <Link to="/my-customers"><Plus className="h-4 w-4 mr-1" /> Add customer</Link>
            </Button>
          }
        />

        {creditHealth?.is_overdrawn && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Your credit pool is overdrawn ({creditHealth.balance})</AlertTitle>
            <AlertDescription>
              You're {Math.abs(creditHealth.balance)} credit{Math.abs(creditHealth.balance) === 1 ? "" : "s"} below zero. New endpoint enrolments will still work but your distributor needs to top you up so your monthly billing reconciles.
              <Link to="/partner/credits" className="underline ml-1 font-medium">Request a top-up →</Link>
            </AlertDescription>
          </Alert>
        )}

        {creditHealth?.is_low_runway && !creditHealth.is_overdrawn && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Less than 1 month of credit runway</AlertTitle>
            <AlertDescription>
              At your current endpoint count you'll run out next monthly cycle. Top up now to keep onboarding new customers without friction.
              <Link to="/partner/credits" className="underline ml-1 font-medium">Open credits →</Link>
            </AlertDescription>
          </Alert>
        )}

        <PortalOnboarding
          scope="partner"
          orgName={(org as any)?.name ?? "your account"}
          steps={[
            {
              key: "request-credits",
              title: "Request your first batch of credits",
              description: "1 credit = 1 endpoint × 1 month. Your disty approves the request in one click.",
              action: { label: "Open credits", href: "/partner/credits" },
              done: (creditBalance ?? 0) > 0,
            },
            {
              key: "first-customer",
              title: "Add your first customer",
              description: "Create their org and send the one-time signup URL to their IT contact.",
              action: { label: "Add customer", href: "/my-customers" },
              done: customerCount > 0,
            },
            {
              key: "first-deal",
              title: "Register your first deal",
              description: "Lock in protection on a prospect — you keep priority over other resellers in your channel.",
              action: { label: "Register deal", href: "/partner/deals" },
              done: (deals ?? []).length > 0,
            },
            {
              key: "first-endpoint",
              title: "Deploy the agent on one endpoint",
              description: "Confirm telemetry flowing — usually under 60 seconds after install.",
              action: { label: "Open deploy guide", href: "/deploy" },
              done: totalEndpoints > 0,
            },
            {
              key: "billing-check",
              title: "Confirm your billing email",
              description: "Make sure invoices reach the right inbox once revenue starts.",
              action: { label: "Check billing", href: "/partner/billing" },
              done: !!(org as any)?.billing_email,
            },
          ]}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <PortalStatCard
            label="Customers"
            value={customerCount}
            hint="Organisations under your account"
            icon={<Building2 className="h-4 w-4" />}
            loading={customersLoading}
          />
          <PortalStatCard
            label="Active endpoints"
            value={totalEndpoints}
            hint="Across all your customers"
            icon={<Monitor className="h-4 w-4" />}
            loading={customersLoading}
          />
          <PortalStatCard
            label="Online now"
            value={onlineEndpoints}
            hint="Seen in the last 10 minutes"
            icon={<Wifi className="h-4 w-4" />}
            loading={customersLoading}
          />
          <PortalStatCard
            label="Wholesale MRR"
            value={fmtMoney(mrrCents, currency)}
            hint="What you owe Mithras this cycle"
            icon={<Receipt className="h-4 w-4" />}
            loading={billingLoading}
          />
        </div>

        {customerCount === 0 && !customersLoading ? (
          <PortalEmptyState
            icon={<Building2 className="h-7 w-7" />}
            title="Add your first customer"
            description={
              <p>
                Create a customer organisation and you'll get an agent install command you can run on their Windows endpoints.
                Defender posture, threats, and policy enforcement flow back into Mithras within seconds of deployment.
              </p>
            }
            primaryAction={{ label: "Add your first customer →", href: "/my-customers" }}
            secondaryAction={{ label: "How agent deployment works", href: "/guides" }}
            accent="indigo"
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Top customers by endpoint count</CardTitle>
                <CardDescription>Your biggest deployments, sorted by active agent count.</CardDescription>
              </CardHeader>
              <CardContent>
                {customersLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                  </div>
                ) : (
                  <div className="divide-y divide-border -mx-3">
                    {[...(customers ?? [])]
                      .sort((a, b) => b.active_endpoint_count - a.active_endpoint_count)
                      .slice(0, 5)
                      .map(c => (
                        <Link
                          key={c.id}
                          to="/my-customers"
                          className="flex items-center justify-between px-3 py-3 hover:bg-muted/50 rounded transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                              <Building2 className="h-4 w-4 text-primary" />
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium truncate">{c.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {c.online_endpoint_count > 0 ? `${c.online_endpoint_count} online · ` : ""}
                                {c.active_endpoint_count - c.online_endpoint_count} offline
                              </div>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-semibold tabular-nums">{c.active_endpoint_count}</div>
                            <div className="text-[11px] text-muted-foreground uppercase tracking-wider">endpoints</div>
                          </div>
                        </Link>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-primary" /> Billing this cycle
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="text-3xl font-bold tabular-nums">{fmtMoney(mrrCents, currency)}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Payable to Mithras based on the seats you have deployed.
                  </p>
                </div>
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link to="/partner/billing">View full breakdown <ArrowUpRight className="h-4 w-4 ml-1" /></Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Sales kit is the resource pack partners need to pitch & close. Visible
            from day 0 so a brand-new partner with no customers yet can read the
            playbook before their first call. */}
        <Card className="bg-gradient-to-br from-muted/30 to-transparent">
          <CardContent className="p-5 flex items-start gap-4">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <BookOpen className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 space-y-2">
              <div>
                <h3 className="font-semibold">Sales kit + technical docs</h3>
                <p className="text-sm text-muted-foreground">
                  Pitch deck, one-pager, demo script, EOL Windows hardening guide — everything you need to win the next deal.
                </p>
              </div>
              <div className="flex gap-2">
                <Button asChild size="sm" variant="outline"><Link to="/partner/resources">Open sales kit</Link></Button>
                <Button asChild size="sm" variant="ghost"><a href="mailto:channel@mithras.com.au">Email channel team</a></Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
