import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useResellerBillingSnapshot, useResellerOrg } from "@/hooks/useReseller";
import { QueryError } from "@/components/ui/query-error";
import { Receipt, AlertCircle, ShieldCheck, Users } from "lucide-react";
import { PortalHero } from "@/components/portal/PortalHero";
import { PortalEmptyState } from "@/components/portal/PortalEmptyState";

function fmtMoney(cents: number, currency = "AUD") {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(cents / 100);
}

export default function PartnerBilling() {
  const { data: lines, isLoading, error } = useResellerBillingSnapshot();
  const { data: org } = useResellerOrg();
  const currency = (org as any)?.currency_code ?? "AUD";
  const defaultPriceCents = (org as any)?.wholesale_price_cents ?? null;

  const totalEndpoints = lines?.reduce((s, l) => s + Number(l.endpoint_count), 0) ?? 0;
  const totalCents     = lines?.reduce((s, l) => s + Number(l.line_total_cents), 0) ?? 0;
  const customersWithNoPrice = (lines ?? []).filter(l => l.wholesale_price_cents === 0).length;

  if (error) {
    return <QueryError error={error} title="Couldn't load partner billing" />;
  }

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-6xl mx-auto">
        <PortalHero
          eyebrow="Partner portal"
          eyebrowIcon={<ShieldCheck className="h-3.5 w-3.5" />}
          title="Customer roll-up"
          subtitle={`What you're running across your customers, by the numbers. ${isLoading ? "" : `${totalEndpoints} active endpoints.`} Each endpoint consumes 1 credit per month — see /partner/credits for your credit pool and consumption.`}
          accent="indigo"
          status={(org as any)?.is_active === false ? { label: "Suspended", tone: "bad" } : { label: "Active", tone: "ok" }}
          actions={
            <div className="text-right">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Indicative monthly</div>
              <div className="text-2xl font-bold tabular-nums">{isLoading ? "—" : fmtMoney(totalCents, currency)}</div>
              <div className="text-[11px] text-muted-foreground">at your current rate</div>
            </div>
          }
        />

        {defaultPriceCents === null && !isLoading && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Default wholesale price not set</AlertTitle>
            <AlertDescription>
              Your account doesn't have a default per-endpoint wholesale price configured yet. Customers with no per-customer
              override will roll up at $0 — contact Mithras support to set your channel tier before invoicing begins.
            </AlertDescription>
          </Alert>
        )}

        {customersWithNoPrice > 0 && defaultPriceCents !== null && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{customersWithNoPrice} customer{customersWithNoPrice === 1 ? "" : "s"} priced at $0</AlertTitle>
            <AlertDescription>
              These customers have no per-endpoint override and your default isn't applying (likely a data issue). Refresh in a moment;
              if it persists, contact Mithras support.
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Per-customer breakdown</CardTitle>
            <CardDescription>
              Endpoint counts are point-in-time. Final invoices use endpoint-days
              over the full cycle, so the actual figure can drift slightly from this estimate.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : (lines ?? []).length === 0 ? (
              <PortalEmptyState
                icon={<Users className="h-7 w-7" />}
                title="Nothing to bill this cycle"
                description={<p>Once you onboard customers and their endpoints start reporting, this view will show your monthly billing roll-up. Add your first customer to get started.</p>}
                primaryAction={{ label: "Add a customer →", href: "/my-customers" }}
                className="border-0 shadow-none"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Endpoints</TableHead>
                    <TableHead className="text-right">Price / endpoint</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(lines ?? []).map(l => (
                    <TableRow key={l.customer_org_id}>
                      <TableCell className="font-medium">{l.customer_name}</TableCell>
                      <TableCell className="text-right">{Number(l.endpoint_count)}</TableCell>
                      <TableCell className="text-right">
                        {l.wholesale_price_cents > 0 ? (
                          fmtMoney(l.wholesale_price_cents, currency)
                        ) : (
                          <Badge variant="outline" className="border-amber-500 text-amber-600">No price set</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(Number(l.line_total_cents), currency)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your pricing</CardTitle>
            <CardDescription>Default wholesale rate, set by Mithras based on your channel tier.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Default wholesale / endpoint / month</span>
              <span className="font-medium">{defaultPriceCents === null ? "Not set" : fmtMoney(defaultPriceCents, currency)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Currency</span>
              <span className="font-medium">{currency}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Billing email</span>
              <span className="font-medium">{(org as any)?.billing_email ?? "Not set"}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
