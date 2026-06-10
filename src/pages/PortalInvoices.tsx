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
import { Receipt, FileText, AlertCircle, Warehouse, ShieldCheck } from "lucide-react";
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
  // Tier we're rendering for. Controls hero accent + eyebrow + the empty-state copy.
  tier: "distributor" | "partner";
}

export default function PortalInvoices({ tier }: Props) {
  const { currentOrganization } = useTenant();
  const { data: invoices, isLoading, error } = useInvoices();
  const [drillId, setDrillId] = useState<string | null>(null);

  // Filter to invoices billed to the currently active org. RLS already
  // restricts to allowed rows, but the user can be admin of multiple orgs.
  const filtered = (invoices ?? []).filter(i => i.bill_to_org_id === currentOrganization?.id);

  const outstandingCents = filtered.filter(i => ["sent","overdue"].includes(i.status)).reduce((s, i) => s + i.total_cents, 0);
  const paidCents        = filtered.filter(i => i.status === "paid").reduce((s, i) => s + i.total_cents, 0);
  const overdueCount     = filtered.filter(i => i.status === "overdue").length;

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

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-6xl mx-auto">
        <PortalHero
          eyebrow={eyebrow}
          eyebrowIcon={eyebrowIcon}
          title="Invoices"
          subtitle="Invoices from Mithras for the seats deployed under your account. Mithras finance reconciles payment manually — your bank statement is the source of truth."
          accent={accentMap[tier]}
          actions={
            <div className="text-right">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Outstanding</div>
              <div className="text-2xl font-bold tabular-nums">
                {isLoading ? "—" : fmtMoney(outstandingCents)}
              </div>
            </div>
          }
        />

        {overdueCount > 0 && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{overdueCount} invoice{overdueCount === 1 ? "" : "s"} overdue</AlertTitle>
            <AlertDescription>
              Settle these as soon as possible to avoid your account being suspended. Contact <a className="underline" href="mailto:billing@mithras.com.au">billing@mithras.com.au</a> if you've already paid.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-4 space-y-1">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Outstanding</div>
              <div className="text-2xl font-bold tabular-nums">{isLoading ? "—" : fmtMoney(outstandingCents)}</div>
              <div className="text-[11px] text-muted-foreground">Awaiting payment or overdue</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 space-y-1">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Paid (lifetime)</div>
              <div className="text-2xl font-bold tabular-nums">{isLoading ? "—" : fmtMoney(paidCents)}</div>
              <div className="text-[11px] text-muted-foreground">Across all invoices</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 space-y-1">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Issued</div>
              <div className="text-2xl font-bold tabular-nums">{isLoading ? "—" : filtered.length}</div>
              <div className="text-[11px] text-muted-foreground">Total invoices on record</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">All invoices</CardTitle>
            <CardDescription>Click a row to view the line items.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : filtered.length === 0 ? (
              <PortalEmptyState
                icon={<Receipt className="h-7 w-7" />}
                title="No invoices yet"
                description={<p>Your first invoice will be issued at the end of your current billing cycle. Until then, this page will stay empty.</p>}
                className="border-0 shadow-none"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Number</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(inv => (
                    <TableRow key={inv.id} className="cursor-pointer" onClick={() => setDrillId(inv.id)}>
                      <TableCell className="font-mono text-xs">{inv.invoice_number}</TableCell>
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

        <Card className="bg-gradient-to-br from-muted/30 to-transparent">
          <CardContent className="p-5">
            <h3 className="font-semibold text-sm">Payment</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Pay via direct deposit to Peritus Digital, BSB / account details on each invoice email. Reference the invoice number on the transaction. Reconciled within 2 business days of receipt.
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Questions? Email <a className="underline" href="mailto:billing@mithras.com.au">billing@mithras.com.au</a>.
            </p>
          </CardContent>
        </Card>
      </div>

      <InvoiceDetailDialog
        invoice={filtered.find(i => i.id === drillId) ?? null}
        onClose={() => setDrillId(null)}
      />
    </MainLayout>
  );
}

function InvoiceDetailDialog({ invoice, onClose }: { invoice: Invoice | null; onClose: () => void }) {
  const { data: lines } = useInvoiceLineItems(invoice?.id ?? null);
  if (!invoice) return null;
  return (
    <Dialog open={!!invoice} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            {invoice.invoice_number}
          </DialogTitle>
          <DialogDescription>
            From {invoice.issuer_name ?? "Mithras"} · period {invoice.period_start} → {invoice.period_end} · due {invoice.due_date}
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
