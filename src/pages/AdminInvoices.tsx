import { useState, useMemo } from "react";
import { format } from "date-fns";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Receipt, Plus, Loader2, ShieldAlert, Send, CheckCircle2, FileText } from "lucide-react";
import { toast } from "sonner";
import { useTenant } from "@/contexts/TenantContext";
import { usePartnersWithStats } from "@/hooks/usePartners";
import {
  useInvoices, useInvoiceLineItems, useGenerateInvoice, useUpdateInvoiceStatus, useSendInvoice,
  type Invoice,
} from "@/hooks/useInvoices";
import { PortalHero } from "@/components/portal/PortalHero";

function fmtMoney(cents: number, currency = "AUD") {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(cents / 100);
}

function StatusBadge({ status }: { status: Invoice["status"] }) {
  const map: Record<Invoice["status"], { variant: any; className: string }> = {
    draft:   { variant: "outline",     className: "border-muted-foreground/40" },
    sent:    { variant: "secondary",   className: "border-blue-500/40 text-blue-600 dark:text-blue-400 bg-blue-500/10" },
    paid:    { variant: "outline",     className: "border-emerald-500/60 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" },
    overdue: { variant: "destructive", className: "" },
    void:    { variant: "outline",     className: "border-muted-foreground/40 text-muted-foreground line-through" },
  };
  return <Badge variant={map[status].variant} className={map[status].className}>{status}</Badge>;
}

export default function AdminInvoices() {
  const { isSuperAdmin, isLoading: tenantLoading } = useTenant();
  const { data: invoices, isLoading: invoicesLoading } = useInvoices();
  const { data: partners } = usePartnersWithStats();
  const generate = useGenerateInvoice();
  const updateStatus = useUpdateInvoiceStatus();
  const sendInvoice = useSendInvoice();
  // Track which invoice id is currently being acted on so per-row buttons
  // disable only that row instead of the global `sendInvoice.isPending`
  // disabling every row at once.
  const [pendingInvoiceId, setPendingInvoiceId] = useState<string | null>(null);

  const [createOpen, setCreateOpen]   = useState(false);
  const [billToOrg, setBillToOrg]     = useState<string>("");
  const [periodStart, setPeriodStart] = useState<string>(firstOfMonth(new Date()));
  const [periodEnd, setPeriodEnd]     = useState<string>(lastOfMonth(new Date()));

  const [drillId, setDrillId] = useState<string | null>(null);

  const stats = useMemo(() => {
    const all = invoices ?? [];
    return {
      draft:     all.filter(i => i.status === "draft").length,
      sent:      all.filter(i => i.status === "sent").length,
      paid:      all.filter(i => i.status === "paid").length,
      overdue:   all.filter(i => i.status === "overdue").length,
      outstandingCents: all.filter(i => ["sent","overdue"].includes(i.status)).reduce((s, i) => s + i.total_cents, 0),
      paidCents:        all.filter(i => i.status === "paid").reduce((s, i) => s + i.total_cents, 0),
    };
  }, [invoices]);

  if (tenantLoading) return <MainLayout><div className="p-6"><Skeleton className="h-32 w-full" /></div></MainLayout>;
  if (!isSuperAdmin) {
    return (
      <MainLayout>
        <div className="p-6 max-w-2xl mx-auto">
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Super-admin only</AlertTitle>
            <AlertDescription>Invoice management is for Peritus operators.</AlertDescription>
          </Alert>
        </div>
      </MainLayout>
    );
  }

  const handleGenerate = async () => {
    if (!billToOrg) { toast.error("Pick a bill-to org"); return; }
    try {
      const id = await generate.mutateAsync({ orgId: billToOrg, periodStart, periodEnd });
      toast.success("Draft invoice generated");
      setCreateOpen(false);
      setDrillId(id);
    } catch (e: any) {
      toast.error(e.message ?? "Couldn't generate");
    }
  };

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-7xl mx-auto">
        <PortalHero
          eyebrow="Platform admin"
          eyebrowIcon={<Receipt className="h-3.5 w-3.5" />}
          title="Invoices"
          subtitle="Generate, send, and track invoices to distributors and direct resellers. Period-end totals come from the live billing snapshot."
          actions={
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button className="shadow-sm"><Plus className="h-4 w-4 mr-2" /> Generate invoice</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Generate draft invoice</DialogTitle>
                  <DialogDescription>
                    Creates a draft invoice from Peritus to the selected distributor or reseller for the period below.
                    Re-running for the same org + period replaces the existing draft.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-2">
                  <div className="grid gap-2">
                    <Label>Bill to</Label>
                    <Select value={billToOrg} onValueChange={setBillToOrg}>
                      <SelectTrigger><SelectValue placeholder="Pick a distributor or reseller" /></SelectTrigger>
                      <SelectContent>
                        {(partners ?? []).map(p => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} <span className="text-xs text-muted-foreground ml-2">— {p.organization_type}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-2">
                      <Label>Period start</Label>
                      <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
                    </div>
                    <div className="grid gap-2">
                      <Label>Period end</Label>
                      <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                  <Button onClick={handleGenerate} disabled={generate.isPending}>
                    {generate.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Generate draft
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          }
        />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Drafts" value={stats.draft} />
          <StatCard label="Outstanding" value={fmtMoney(stats.outstandingCents)} hint={`${stats.sent + stats.overdue} unpaid`} />
          <StatCard label="Paid" value={fmtMoney(stats.paidCents)} hint={`${stats.paid} invoices`} />
          <StatCard label="Overdue" value={stats.overdue} tone="bad" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">All invoices</CardTitle>
            <CardDescription>Click a row to view line items and change status.</CardDescription>
          </CardHeader>
          <CardContent>
            {invoicesLoading ? (
              <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : (invoices ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No invoices yet. Click "Generate invoice" to create the first one.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Number</TableHead>
                    <TableHead>Bill to</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(invoices ?? []).map(inv => (
                    <TableRow key={inv.id} className="cursor-pointer" onClick={() => setDrillId(inv.id)}>
                      <TableCell className="font-mono text-xs">{inv.invoice_number}</TableCell>
                      <TableCell className="font-medium">{inv.bill_to_name ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground tabular-nums">
                        {inv.period_start} → {inv.period_end}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">{inv.due_date}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {fmtMoney(inv.total_cents, inv.currency_code)}
                      </TableCell>
                      <TableCell><StatusBadge status={inv.status} /></TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          {inv.status === "draft" && (
                            <>
                              <Button size="sm"
                                onClick={() => {
                                  setPendingInvoiceId(inv.id);
                                  sendInvoice.mutate(inv.id, {
                                    onSuccess: (r) => toast.success(`Sent to ${r.sent_to}`),
                                    onError:   (e: any) => toast.error(e.message ?? "Couldn't send"),
                                    onSettled: () => setPendingInvoiceId(null),
                                  });
                                }}
                                disabled={pendingInvoiceId === inv.id || updateStatus.isPending}>
                                <Send className="h-3 w-3 mr-1" /> {pendingInvoiceId === inv.id ? "Sending…" : "Email"}
                              </Button>
                              <Button size="sm" variant="ghost"
                                disabled={updateStatus.isPending || pendingInvoiceId === inv.id}
                                onClick={() => {
                                  setPendingInvoiceId(inv.id);
                                  updateStatus.mutate({ invoiceId: inv.id, status: "sent" }, {
                                    onSuccess: () => toast.success("Marked sent (manual)"),
                                    onSettled: () => setPendingInvoiceId(null),
                                  });
                                }}>
                                Mark sent
                              </Button>
                            </>
                          )}
                          {(inv.status === "sent" || inv.status === "overdue") && (
                            <Button size="sm" variant="outline"
                              disabled={updateStatus.isPending || pendingInvoiceId === inv.id}
                              onClick={() => {
                                setPendingInvoiceId(inv.id);
                                updateStatus.mutate({ invoiceId: inv.id, status: "paid", paidVia: "bank_transfer" }, {
                                  onSuccess: () => toast.success("Marked paid"),
                                  onSettled: () => setPendingInvoiceId(null),
                                });
                              }}>
                              <CheckCircle2 className="h-3 w-3 mr-1" /> Mark paid
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <InvoiceDetailDialog
        invoice={(invoices ?? []).find(i => i.id === drillId) ?? null}
        onClose={() => setDrillId(null)}
      />
    </MainLayout>
  );
}

function StatCard({ label, value, hint, tone }: { label: string; value: any; hint?: string; tone?: "ok" | "bad" }) {
  return (
    <Card>
      <CardContent className="p-4 space-y-1">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
        <div className={`text-2xl font-bold tabular-nums ${tone === "bad" ? "text-rose-600 dark:text-rose-400" : ""}`}>{value}</div>
        {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
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
            {invoice.issuer_name ?? "Issuer"} → {invoice.bill_to_name ?? "Bill to"} ·
            period {invoice.period_start} to {invoice.period_end} ·
            due {invoice.due_date}
          </DialogDescription>
        </DialogHeader>
        <div className="border-t pt-4 space-y-3">
          {(lines ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-3">No line items — endpoint count was zero in this period.</p>
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
          <div className="flex justify-between border-t pt-3 text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="font-medium tabular-nums">{fmtMoney(invoice.subtotal_cents, invoice.currency_code)}</span>
          </div>
          <div className="flex justify-between text-base font-semibold">
            <span>Total due</span>
            <span className="tabular-nums">{fmtMoney(invoice.total_cents, invoice.currency_code)}</span>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
            <span>Status: <StatusBadge status={invoice.status} /></span>
            {invoice.paid_at && <span>Paid {format(new Date(invoice.paid_at), "d MMM yyyy")} via {invoice.paid_via ?? "—"}</span>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function firstOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0,10); }
function lastOfMonth(d: Date)  { return new Date(d.getFullYear(), d.getMonth()+1, 0).toISOString().slice(0,10); }
