import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Warehouse, Receipt, AlertCircle } from "lucide-react";
import { PortalHero } from "@/components/portal/PortalHero";
import { useTenant } from "@/contexts/TenantContext";
import {
  useDistributorOrg, useDistributorOrgId, useDistributorBillingSnapshot,
} from "@/hooks/useDistributor";
import { QueryError } from "@/components/ui/query-error";

function fmtMoney(cents: number, currency = "AUD") {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(cents / 100);
}

export default function DistributorBilling() {
  const distId = useDistributorOrgId();
  const { isSuperAdmin } = useTenant();
  const { data: org } = useDistributorOrg();
  const { data: lines, isLoading, error } = useDistributorBillingSnapshot();

  const currency = (org as any)?.currency_code ?? "AUD";
  const defaultPriceCents = (org as any)?.wholesale_price_cents ?? null;
  const totalEndpoints = lines?.reduce((s, l) => s + Number(l.endpoint_count), 0) ?? 0;
  const totalCustomers = lines?.reduce((s, l) => s + Number(l.customer_count), 0) ?? 0;
  const totalCents     = lines?.reduce((s, l) => s + Number(l.line_total_cents), 0) ?? 0;
  const unpricedCount  = (lines ?? []).filter(l => l.wholesale_price_cents === 0).length;

  if (!distId) {
    return (
      <MainLayout>
        <div className="p-6 max-w-2xl mx-auto space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>No distributor selected</AlertTitle>
            <AlertDescription>
              {isSuperAdmin
                ? "Pivot into a specific distributor from Admin → Channel partners."
                : "Your account isn't linked to a distributor organisation."}
            </AlertDescription>
          </Alert>
        </div>
      </MainLayout>
    );
  }

  if (error) {
    return <QueryError error={error} title="Couldn't load distributor billing" />;
  }

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-6xl mx-auto">
        <PortalHero
          eyebrow="Distributor portal"
          eyebrowIcon={<Warehouse className="h-3.5 w-3.5" />}
          title="Endpoint roll-up"
          subtitle={`What your reseller network is running across ${isLoading ? "your customers" : `${totalEndpoints} active endpoints across ${totalCustomers} customers`}. The MRR figure below is an indicative roll-up at wholesale prices — your actual Mithras bill is settled through credit purchases on /distributor/credits.`}
          status={(org as any)?.is_active === false ? { label: "Suspended", tone: "bad" } : { label: "Active", tone: "ok" }}
          actions={
            <div className="text-right">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Indicative monthly</div>
              <div className="text-2xl font-bold tabular-nums">{isLoading ? "—" : fmtMoney(totalCents, currency)}</div>
              <div className="text-[11px] text-muted-foreground">at your reseller wholesale prices</div>
            </div>
          }
        />

        {defaultPriceCents === null && !isLoading && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Default wholesale price not set</AlertTitle>
            <AlertDescription>
              Mithras hasn't set a default per-seat wholesale price for your distribution tier yet. Resellers with no per-reseller override will roll up at $0. Contact Mithras to set this before invoicing begins.
            </AlertDescription>
          </Alert>
        )}

        {unpricedCount > 0 && defaultPriceCents !== null && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{unpricedCount} reseller{unpricedCount === 1 ? "" : "s"} priced at $0</AlertTitle>
            <AlertDescription>
              These resellers have no per-reseller override and the default isn't applying. Refresh in a moment; if it persists, contact Mithras support.
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Per-reseller breakdown</CardTitle>
            <CardDescription>
              End-customer details are owned by your reseller and not visible to you — only the endpoint count and
              billing subtotal. Final invoices use endpoint-days over the full cycle and may drift slightly from this snapshot.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : (lines ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No resellers signed up yet — nothing to bill this cycle.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reseller</TableHead>
                    <TableHead className="text-right">Customers</TableHead>
                    <TableHead className="text-right">Endpoints</TableHead>
                    <TableHead className="text-right">Price/seat</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(lines ?? []).map(l => (
                    <TableRow key={l.reseller_org_id}>
                      <TableCell className="font-medium">{l.reseller_name}</TableCell>
                      <TableCell className="text-right">{Number(l.customer_count)}</TableCell>
                      <TableCell className="text-right">{Number(l.endpoint_count)}</TableCell>
                      <TableCell className="text-right">
                        {l.wholesale_price_cents > 0
                          ? fmtMoney(l.wholesale_price_cents, currency)
                          : <Badge variant="outline" className="border-amber-500 text-amber-600">No price set</Badge>}
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
            <CardTitle className="text-base"><Receipt className="h-4 w-4 inline mr-1" /> Your pricing</CardTitle>
            <CardDescription>Default wholesale rate Mithras charges you. Resellers may have per-reseller overrides above this.</CardDescription>
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
