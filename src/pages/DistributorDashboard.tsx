import { format } from "date-fns";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Link } from "react-router-dom";
import { PortalHero } from "@/components/portal/PortalHero";
import { PortalStatCard } from "@/components/portal/PortalStatCard";
import { PortalEmptyState } from "@/components/portal/PortalEmptyState";
import { PortalOnboarding } from "@/components/portal/PortalOnboarding";
import {
  useDistributorOrg, useDistributorOrgId, useDistributorResellers,
} from "@/hooks/useDistributor";
import { useDistributorResellerHealth, type ResellerHealthRow } from "@/hooks/useCredits";
import { useTenant } from "@/contexts/TenantContext";
import { cn } from "@/lib/utils";
import {
  Warehouse, Briefcase, Users, Monitor, Receipt, ArrowUpRight, AlertCircle, Plus, BookOpen,
  AlertTriangle, Activity, Pause, BatteryLow,
} from "lucide-react";

function fmtMoney(cents: number, currency = "AUD") {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(cents / 100);
}

export default function DistributorDashboard() {
  const distId = useDistributorOrgId();
  const { isSuperAdmin } = useTenant();
  const { data: org } = useDistributorOrg();
  const { data: resellers, isLoading } = useDistributorResellers();
  const { data: health } = useDistributorResellerHealth(distId);
  const needsAttention = (health ?? []).filter(r => r.attention_score > 0);

  if (!distId) {
    return (
      <MainLayout>
        <div className="p-6 max-w-2xl mx-auto">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>No distributor selected</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>
                {isSuperAdmin
                  ? "You're signed in as a super-admin. To view the distributor portal, pivot into a specific distributor org from Admin → Channel partners → click \"View as\"."
                  : "Your account isn't linked to a distributor organisation."}
              </p>
              {isSuperAdmin && (
                <Button asChild size="sm">
                  <Link to="/admin">Go to channel partners</Link>
                </Button>
              )}
            </AlertDescription>
          </Alert>
        </div>
      </MainLayout>
    );
  }

  const resellerCount = resellers?.length ?? 0;
  const customerCount = resellers?.reduce((s, r) => s + Number(r.customer_count), 0) ?? 0;
  const endpointCount = resellers?.reduce((s, r) => s + Number(r.endpoint_count), 0) ?? 0;
  const mrrCents      = resellers?.reduce((s, r) => s + Number(r.line_total_cents), 0) ?? 0;
  const totalResellerHoldings = resellers?.reduce((s, r) => s + Number((r as any).credit_balance ?? 0), 0) ?? 0;
  const currency      = (org as any)?.currency_code ?? "AUD";
  const isActive      = (org as any)?.is_active !== false;

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-7xl mx-auto">
        <PortalHero
          eyebrow="Distributor portal"
          eyebrowIcon={<Warehouse className="h-3.5 w-3.5" />}
          title={(org as any)?.name ?? "Distributor"}
          subtitle="Sign up resellers and watch your channel grow. End-customer details belong to the reseller — you see endpoint counts for billing only."
          status={{ label: isActive ? "Active" : "Suspended", tone: isActive ? "ok" : "bad" }}
          actions={
            <Button asChild size="sm" className="shadow-sm">
              <Link to="/distributor/resellers"><Plus className="h-4 w-4 mr-1" /> Add reseller</Link>
            </Button>
          }
        />

        {needsAttention.length > 0 && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                {needsAttention.length} reseller{needsAttention.length === 1 ? "" : "s"} need{needsAttention.length === 1 ? "s" : ""} your attention
              </CardTitle>
              <CardDescription>Sorted by urgency — chase these up to keep your channel healthy.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="divide-y divide-border -mx-3">
                {needsAttention.slice(0, 6).map(r => <ResellerHealthRow key={r.reseller_id} row={r} />)}
              </div>
              {needsAttention.length > 6 && (
                <p className="text-xs text-muted-foreground mt-2">
                  +{needsAttention.length - 6} more — see <Link to="/distributor/credits" className="underline">all reseller health</Link>
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <PortalOnboarding
          scope="distributor"
          orgName={(org as any)?.name ?? "your account"}
          steps={[
            {
              key: "first-reseller",
              title: "Sign up your first reseller",
              description: "Create their org and send them the one-time enrolment URL.",
              action: { label: "Add reseller", href: "/distributor/resellers" },
              done: resellerCount > 0,
            },
            {
              key: "first-cut",
              title: "Cut your first credits to a reseller",
              description: "Resellers can't onboard customer endpoints until you fund their pool.",
              action: { label: "Cut credits", href: "/distributor/credits" },
              done: totalResellerHoldings > 0,
            },
            {
              key: "billing-check",
              title: "Confirm your billing email",
              description: "Make sure invoices reach the right inbox once revenue starts.",
              action: { label: "Check billing", href: "/distributor/billing" },
              done: !!(org as any)?.billing_email,
            },
            {
              key: "playbook",
              title: "Read the channel playbook & demo script",
              description: "Recommended reading before your first sales call.",
              action: { label: "Open resources", href: "/distributor/resources" },
              done: false,
              optional: true,
            },
          ]}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <PortalStatCard
            label="Resellers"
            value={resellerCount}
            hint="Active resellers under your distribution"
            icon={<Briefcase className="h-4 w-4" />}
            loading={isLoading}
          />
          <PortalStatCard
            label="End customers"
            value={customerCount}
            hint="Aggregate across all your resellers"
            icon={<Users className="h-4 w-4" />}
            loading={isLoading}
          />
          <PortalStatCard
            label="Active endpoints"
            value={endpointCount}
            hint="Deployed seats — the basis for billing"
            icon={<Monitor className="h-4 w-4" />}
            loading={isLoading}
          />
          <PortalStatCard
            label="Monthly billing estimate"
            value={fmtMoney(mrrCents, currency)}
            hint="Indicative — re-computed daily as reseller endpoint counts change. Not a contract."
            icon={<Receipt className="h-4 w-4" />}
            loading={isLoading}
          />
        </div>

        {resellerCount === 0 && !isLoading ? (
          <PortalEmptyState
            icon={<Briefcase className="h-7 w-7" />}
            title="Sign up your first reseller"
            description={
              <p>
                Resellers are the IT providers actually selling Mithras to their customers. Click below to create their organisation —
                you'll get a one-time enrolment URL to send them. They sign up using that link and become admin of their new account.
              </p>
            }
            primaryAction={{ label: "Add your first reseller →", href: "/distributor/resellers" }}
            secondaryAction={{ label: "Read the channel playbook", href: "/guides" }}
            accent="primary"
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Top resellers by endpoint count</CardTitle>
                <CardDescription>
                  Endpoint count rolls up across all of the reseller's end customers. You don't see the customer list — that relationship belongs to the reseller.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                  </div>
                ) : (
                  <div className="divide-y divide-border -mx-3">
                    {[...(resellers ?? [])]
                      .sort((a, b) => Number(b.endpoint_count) - Number(a.endpoint_count))
                      .slice(0, 5)
                      .map(r => (
                        <Link
                          key={r.id}
                          to="/distributor/resellers"
                          className="flex items-center justify-between px-3 py-3 hover:bg-muted/50 rounded transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                              <Briefcase className="h-4 w-4 text-primary" />
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium truncate">{r.name}</div>
                              <div className="text-xs text-muted-foreground">
                                since {format(new Date(r.created_at), "d MMM yyyy")}
                              </div>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-semibold tabular-nums">{Number(r.endpoint_count)}</div>
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
                    Payable to Mithras based on current endpoint counts under all your resellers.
                  </p>
                </div>
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link to="/distributor/billing">View full breakdown <ArrowUpRight className="h-4 w-4 ml-1" /></Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {resellerCount > 0 && (
          <Card className="bg-gradient-to-br from-muted/30 to-transparent">
            <CardContent className="p-5 flex items-start gap-4">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <BookOpen className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 space-y-2">
                <div>
                  <h3 className="font-semibold">Need help selling Mithras?</h3>
                  <p className="text-sm text-muted-foreground">
                    Sales kit, pitch deck, demo script, pricing sheet — everything your resellers' sales reps need to confidently pitch.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button asChild size="sm" variant="outline"><Link to="/distributor/resources">View sales kit</Link></Button>
                  <Button asChild size="sm" variant="ghost"><a href="mailto:channel@mithras.com.au">Email channel team</a></Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </MainLayout>
  );
}
