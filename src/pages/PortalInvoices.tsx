import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Receipt, FileText, AlertCircle, Warehouse, ShieldCheck, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { PortalHero } from "@/components/portal/PortalHero";
import { PortalEmptyState } from "@/components/portal/PortalEmptyState";
import { useInvoices, useInvoiceLineItems, type Invoice } from "@/hooks/useInvoices";
import { useTenant } from "@/contexts/TenantContext";
import { QueryError } from "@/components/ui/query-error";

function fmtMoney(cents: number, currency = "AUD") {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(cents / 100);
}

function StatusBadge({ status }: { status: Invoice["status"] }) {
  const map: Record<Invoice["status"], { className: string; label: string }> = {
    draft:   { className: "border-muted-foreground/40", label: "Draft" },
    sent:    { className: "border-blue-500/40 text-blue-600 dark:text-blue-400 bg-blue-500/10", label: "Awaiting payment" },
    paid:    { className: "border-emerald-500/60 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10", label: "Paid" },
    overdue: { className: "border-rose-500/60 text-rose-600 dark:text-rose-400 bg-rose-500/10", label: "Overdue" },
    void:    { className: "border-muted-foreground/40 text-muted-foreground line-through", label: "Void" },
  };
  return <Badge variant="outline" className={map[status].className}>{map[status].label}</Badge>;
}

interface Props {
  // Tier we're rendering for. Controls hero accent + eyebrow + whether the
  // distributor "issued to resellers" tab is shown.
  tier: "distributor" | "partner";
}

export default function PortalInvoices({ tier }: Props) {
  const { currentOrganization } = useTenant();
  const { data: invoices, isLoading, error } = useInvoices();
  const [drillId, setDrillId] = useState<string | null>(null);

  // RLS already scopes rows to ones this user can see. We further split into
  //  received: invoices billed TO the active org (always shown)
  //  issued:   invoices ISSUED BY the active org (distributor-only tab)
  const received = (invoices ?? []).filter(i => i.bill_to_org_id === currentOrganization?.id);
  const issued   = (invoices ?? []).filter(i => i.issuer_org_id  === currentOrganization?.id);

  const accentMap = { distributor: "primary", partner: "indigo" } as const;
  const eyebrowIcon = tier === "distributor"
    ? <Warehouse className="h-3.5 w-3.5" />
    : <ShieldCheck className="h-3.5 w-3.5" />;
  const eyebrow = tier === "distributor" ? "Distributor portal" : "Partner portal";

  if (!currentOrganization) {
    return (
      <MainLayout>
        <div className="p-6 max-w-2xl mx-auto">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>No organisation selected</AlertTitle>
            <AlertDescription>Switch into your organisation to view invoices.</AlertDescription>
          </Alert>
        </div>
      </MainLayout>
    );
  }

  if (error) {
    return <QueryError error={error} title="Couldn't load invoices" />;
  }

  // Resolve the active invoice across both lists for the drill-down dialog.
  const drillInvoice = drillId
    ? (received.find(i => i.id === drillId) ?? issued.find(i => i.id === drillId) ?? null)
    : null;
  const drillDirection: "received" | "issued" =
    drillInvoice && drillInvoice.issuer_org_id === currentOrganization.id ? "issued" : "received";

  const showIssuedTab = tier === "distributor";

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-6xl mx-auto">
        <PortalHero
          eyebrow={eyebrow}
          eyebrowIcon={eyebrowIcon}
          title="Invoices"
          subtitle={
            showIssuedTab
              ? "Invoices Mithras issues to you for the seat pool, and invoices you issue to your resellers for their consumption."
              : "Invoices from Mithras for the seats deployed under your account. Mithras finance reconciles payment manually — your bank statement is the source of truth."
          }
          accent={accentMap[tier]}
          actions={
            <div className="text-right">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Outstanding</div>
              <div className="text-2xl font-bold tabular-nums">
                {isLoading ? "—" : fmtMoney(computeOutstanding(received))}
              </div>
            </div>
          }
        />

        {showIssuedTab ? (
          <Tabs defaultValue="received">
            <TabsList>
              <TabsTrigger value="received" className="gap-2">
                <ArrowDownToLine className="h-3.5 w-3.5" />
                Received from Mithras
                {received.length > 0 && <span className="text-[11px] text-muted-foreground">({received.length})</span>}
              </TabsTrigger>
              <TabsTrigger value="issued" className="gap-2">
                <ArrowUpFromLine className="h-3.5 w-3.5" />
                Issued to resellers
                {issued.length > 0 && <span className="text-[11px] text-muted-foreground">({issued.length})</span>}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="received" className="mt-6 space-y-6">
              <DirectionPanel
                direction="received"
                invoices={received}
                isLoading={isLoading}
                onDrill={setDrillId}
                empty={
                  <PortalEmptyState
                    icon={<Receipt className="h-7 w-7" />}
                    title="No invoices yet"
                    description={<p>Your first invoice from Mithras will be issued at the end of your current billing cycle.</p>}
                    className="border-0 shadow-none"
                  />
                }
              />
              <PaymentNote />
            </TabsContent>
            <TabsContent value="issued" className="mt-6 space-y-6">
              <DirectionPanel
                direction="issued"
                invoices={issued}
                isLoading={isLoading}
                onDrill={setDrillId}
                empty={
                  <PortalEmptyState
                    icon={<FileText className="h-7 w-7" />}
                    title="No invoices issued yet"
                    description={
                      <p>
                        You haven't issued any invoices to your resellers yet. Once a billing period closes,
                        invoices for each reseller's consumption will appear here.
                      </p>
                    }
                    className="border-0 shadow-none"
                  />
                }
              />
              <IssuedHelpNote />
            </TabsContent>
          </Tabs>
        ) : (
          <>
            <DirectionPanel
              direction="received"
              invoices={received}
              isLoading={isLoading}
              onDrill={setDrillId}
              empty={
                <PortalEmptyState
                  icon={<Receipt className="h-7 w-7" />}
                  title="No invoices yet"
                  description={<p>Your first invoice will be issued at the end of your current billing cycle. Until then, this page will stay empty.</p>}
                  className="border-0 shadow-none"
                />
              }
            />
            <PaymentNote />
          </>
        )}
      </div>

      <InvoiceDetailDialog
        invoice={drillInvoice}
        direction={drillDirection}
        onClose={() => setDrillId(null)}
      />
    </MainLayout>
  );
}

function computeOutstanding(list: Invoice[]) {
  return list.filter(i => ["sent","overdue"].includes(i.status)).reduce((s, i) => s + i.total_cents, 0);
}

function DirectionPanel({
  direction,
  invoices,
  isLoading,
  onDrill,
  empty,
}: {
  direction: "received" | "issued";
  invoices: Invoice[];
  isLoading: boolean;
  onDrill: (id: string) => void;
  empty: React.ReactNode;
}) {
  const outstanding = computeOutstanding(invoices);
  const paid        = invoices.filter(i => i.status === "paid").reduce((s, i) => s + i.total_cents, 0);
  const overdueCount = invoices.filter(i => i.status === "overdue").length;
  const counterpartyLabel = direction === "received" ? "From" : "To";

  return (
    <>
      {overdueCount > 0 && direction === "received" && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{overdueCount} invoice{overdueCount === 1 ? "" : "s"} overdue</AlertTitle>
          <AlertDescription>
            Settle these as soon as possible to avoid your account being suspended. Contact <a className="underline" href="mailto:billing@mithras.com.au">billing@mithras.com.au</a> if you've already paid.
          </AlertDescription>
        </Alert>
      )}
      {overdueCount > 0 && direction === "issued" && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{overdueCount} reseller invoice{overdueCount === 1 ? "" : "s"} overdue</AlertTitle>
          <AlertDescription>
            Follow up with the reseller directly. Mithras does not collect on your behalf.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4 space-y-1">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
              {direction === "received" ? "Outstanding (you owe)" : "Outstanding (owed to you)"}
            </div>
            <div className="text-2xl font-bold tabular-nums">{isLoading ? "—" : fmtMoney(outstanding)}</div>
            <div className="text-[11px] text-muted-foreground">Awaiting payment or overdue</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-1">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
              {direction === "received" ? "Paid (lifetime)" : "Collected (lifetime)"}
            </div>
            <div className="text-2xl font-bold tabular-nums">{isLoading ? "—" : fmtMoney(paid)}</div>
            <div className="text-[11px] text-muted-foreground">Across all invoices</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-1">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
              {direction === "received" ? "Issued by Mithras" : "Issued by you"}
            </div>
            <div className="text-2xl font-bold tabular-nums">{isLoading ? "—" : invoices.length}</div>
            <div className="text-[11px] text-muted-foreground">Total invoices on record</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {direction === "received" ? "All invoices" : "Invoices issued to your resellers"}
          </CardTitle>
          <CardDescription>Click a row to view the line items.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : invoices.length === 0 ? (
            empty
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>{counterpartyLabel}</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map(inv => (
                  <TableRow key={inv.id} className="cursor-pointer" onClick={() => onDrill(inv.id)}>
                    <TableCell className="font-mono text-xs">{inv.invoice_number}</TableCell>
                    <TableCell className="text-sm">
                      {direction === "received" ? (inv.issuer_name ?? "Mithras") : (inv.bill_to_name ?? "—")}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground tabular-nums">{inv.period_start} → {inv.period_end}</TableCell>
                    <TableCell className="text-sm tabular-nums">{inv.due_date}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{fmtMoney(inv.total_cents, inv.currency_code)}</TableCell>
                    <TableCell><StatusBadge status={inv.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function PaymentNote() {
  return (
    <Card className="bg-gradient-to-br from-muted/30 to-transparent">
      <CardContent className="p-5">
        <h3 className="font-semibold text-sm">Payment</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Pay via direct deposit using the BSB / account details on each invoice email. Reference the invoice number on the transaction. Reconciled within 2 business days of receipt.
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          Questions? Email <a className="underline" href="mailto:billing@mithras.com.au">billing@mithras.com.au</a>.
        </p>
      </CardContent>
    </Card>
  );
}

function IssuedHelpNote() {
  return (
    <Card className="bg-gradient-to-br from-muted/30 to-transparent">
      <CardContent className="p-5">
        <h3 className="font-semibold text-sm">Issued invoices &amp; reseller payments</h3>
        <p className="text-sm text-muted-foreground mt-1">
          These invoices reflect what each of your resellers owes you for the seats consumed under their account. Mithras issues them automatically at the close of each billing period, scoped to your wholesale price for each reseller. You collect payment directly — Mithras is not in the loop on these transactions.
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          Click any row to view line items. To change a reseller's wholesale price, head to <a className="underline" href="/distributor/resellers">Resellers</a>.
        </p>
      </CardContent>
    </Card>
  );
}

function InvoiceDetailDialog({
  invoice,
  direction,
  onClose,
}: {
  invoice: Invoice | null;
  direction: "received" | "issued";
  onClose: () => void;
}) {
  const { data: lines } = useInvoiceLineItems(invoice?.id ?? null);
  if (!invoice) return null;
  const counterparty =
    direction === "received"
      ? `From ${invoice.issuer_name ?? "Mithras"}`
      : `To ${invoice.bill_to_name ?? "reseller"}`;
  return (
    <Dialog open={!!invoice} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            {invoice.invoice_number}
          </DialogTitle>
          <DialogDescription>
            {counterparty} · period {invoice.period_start} → {invoice.period_end} · due {invoice.due_date}
          </DialogDescription>
        </DialogHeader>
        <div className="border-t pt-4 space-y-3">
          {(lines ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-3">No line items — no endpoints were active in this period.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(lines ?? []).map(l => (
                  <TableRow key={l.id}>
                    <TableCell className="text-sm">{l.description}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{l.quantity}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{fmtMoney(l.unit_price_cents, invoice.currency_code)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{fmtMoney(l.line_total_cents, invoice.currency_code)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="flex justify-between text-base font-semibold border-t pt-3">
            <span>Total due</span>
            <span className="tabular-nums">{fmtMoney(invoice.total_cents, invoice.currency_code)}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
