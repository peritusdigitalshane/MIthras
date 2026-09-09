import { useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { PortalHero } from "@/components/portal/PortalHero";
import { useTenant } from "@/contexts/TenantContext";
import { usePartnersWithStats } from "@/hooks/usePartners";
import { useIssueCredits, useCreditPackQuote, useCreditPackTiers, useAdminCreditLedger } from "@/hooks/useCredits";
import { Coins, Plus, Loader2, ShieldAlert, Warehouse, History } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

const LEDGER_REASONS: { value: string; label: string }[] = [
  { value: "all",                label: "All transactions" },
  { value: "mithras_issue",      label: "Mithras → Distributor (issuance)" },
  { value: "distributor_cut",    label: "Distributor → Reseller (cut)" },
  { value: "enrolment_consume",  label: "Endpoint enrolment (consume)" },
  { value: "monthly_consume",    label: "Monthly burn (consume)" },
  { value: "admin_adjust",       label: "Manual adjustment" },
];

const REASON_BADGE: Record<string, { label: string; tone: "default" | "secondary" | "outline" | "destructive" }> = {
  mithras_issue:     { label: "Issuance",   tone: "default"     },
  distributor_cut:   { label: "Cut",        tone: "secondary"   },
  enrolment_consume: { label: "Enrolment",  tone: "outline"     },
  monthly_consume:   { label: "Monthly",    tone: "outline"     },
  admin_adjust:      { label: "Adjustment", tone: "destructive" },
};

function fmtMoney(cents: number, currency = "AUD") {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(cents / 100);
}

export default function AdminCredits() {
  const { isSuperAdmin, isLoading: tenantLoading } = useTenant();
  const { data: partners } = usePartnersWithStats();
  const { data: tiers } = useCreditPackTiers();
  const issue = useIssueCredits();

  const distys = useMemo(() => (partners ?? []).filter(p => p.organization_type === "distributor"), [partners]);

  const [issueOpen, setIssueOpen] = useState(false);
  const [distyId, setDistyId]     = useState("");
  const [qty, setQty]             = useState("");
  const [notes, setNotes]         = useState("");

  const qtyNum = parseInt(qty || "0", 10);
  const { data: quote } = useCreditPackQuote(qtyNum > 0 ? qtyNum : null);

  const [ledgerReason, setLedgerReason] = useState<string>("all");
  const { data: ledger, isLoading: ledgerLoading } = useAdminCreditLedger({
    limit: 100,
    reason: ledgerReason === "all" ? null : ledgerReason,
  });

  if (tenantLoading) return <MainLayout><div className="p-6"><Skeleton className="h-32 w-full" /></div></MainLayout>;
  if (!isSuperAdmin) {
    return (
      <MainLayout>
        <div className="p-6 max-w-2xl mx-auto">
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Super-admin only</AlertTitle>
            <AlertDescription>Credit issuance is a Mithras platform operation.</AlertDescription>
          </Alert>
        </div>
      </MainLayout>
    );
  }

  const handleIssue = async () => {
    if (!distyId) { toast.error("Pick a distributor"); return; }
    if (!qtyNum || qtyNum <= 0) { toast.error("Enter a positive quantity"); return; }
    try {
      await issue.mutateAsync({ distributorOrgId: distyId, quantity: qtyNum, notes: notes.trim() || null });
      toast.success(`Issued ${qtyNum} credits to distributor`);
      setIssueOpen(false);
      setDistyId(""); setQty(""); setNotes("");
    } catch (e: any) {
      toast.error(e.message ?? "Issue failed");
    }
  };

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-7xl mx-auto">
        <PortalHero
          eyebrow="Platform admin"
          eyebrowIcon={<Coins className="h-3.5 w-3.5" />}
          title="Credit issuance"
          subtitle="Mithras is the ultimate source of all credits. Issue them to distributors against paid purchase orders. Distributors then cut credits to their resellers; resellers spend credits onboarding customer endpoints."
          actions={
            <Dialog open={issueOpen} onOpenChange={setIssueOpen}>
              <DialogTrigger asChild>
                <Button className="shadow-sm"><Plus className="h-4 w-4 mr-2" /> Issue credits</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Issue credits to a distributor</DialogTitle>
                  <DialogDescription>
                    Records a mithras_issue transaction and increments their pool. Run this after you've received payment for the credit pack.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-1.5">
                    <Label>Distributor</Label>
                    <Select value={distyId} onValueChange={setDistyId}>
                      <SelectTrigger><SelectValue placeholder="Pick a distributor" /></SelectTrigger>
                      <SelectContent>
                        {distys.map(d => (
                          <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="iss-qty">Quantity</Label>
                    <Input id="iss-qty" type="number" min="1" step="1" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="e.g. 1000" />
                    {quote && (
                      <p className="text-xs text-muted-foreground">
                        At {quote.tier_name}: {fmtMoney(quote.per_credit_cents)} per credit · <strong>{fmtMoney(Number(quote.total_cents))}</strong> total.
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="iss-notes">PO / order reference (optional)</Label>
                    <Input id="iss-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="PO #4321, Mithras invoice #ACM-202607-0001" />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIssueOpen(false)}>Cancel</Button>
                  <Button onClick={handleIssue} disabled={issue.isPending}>
                    {issue.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Issue credits
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          }
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Distributors</CardTitle>
            <CardDescription>Each distributor's current credit pool. Click to view their cut history.</CardDescription>
          </CardHeader>
          <CardContent>
            {distys.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No distributors yet. Add one in Channel Partners.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Distributor</TableHead>
                    <TableHead className="text-right">Credit balance</TableHead>
                    <TableHead className="text-right">Resellers</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {distys.map(d => (
                    <TableRow key={d.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Warehouse className="h-4 w-4 text-primary" />
                          <span className="font-medium">{d.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {(d as any).credit_balance ?? 0}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{d.customer_count}</TableCell>
                      <TableCell className="text-sm text-muted-foreground tabular-nums">{new Date(d.created_at).toLocaleDateString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4" /> Transaction ledger</CardTitle>
                <CardDescription>Last 100 platform-wide credit movements. Filter by reason to drill into one phase.</CardDescription>
              </div>
              <Select value={ledgerReason} onValueChange={setLedgerReason}>
                <SelectTrigger className="sm:w-72"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LEDGER_REASONS.map(r => (<SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {ledgerLoading ? (
              <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : (ledger ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No transactions match this filter.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(ledger ?? []).map(r => {
                    const meta = REASON_BADGE[r.reason] ?? { label: r.reason, tone: "outline" as const };
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                        </TableCell>
                        <TableCell><Badge variant={meta.tone}>{meta.label}</Badge></TableCell>
                        <TableCell className="text-sm">{r.from_org_name ?? <span className="text-muted-foreground italic">Mithras</span>}</TableCell>
                        <TableCell className="text-sm">{r.to_org_name ?? "—"}</TableCell>
                        <TableCell className={`text-right tabular-nums font-medium ${r.quantity < 0 ? "text-destructive" : ""}`}>{r.quantity}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                          {r.unit_price_cents != null ? fmtMoney(r.unit_price_cents) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.unit_price_cents != null ? fmtMoney(r.total_cents) : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground truncate max-w-xs">{r.notes ?? "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Credit pack pricing</CardTitle>
            <CardDescription>Volume tier schedule. Distributors order packs by emailing channel@mithras.com.au.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pack</TableHead>
                  <TableHead className="text-right">Min quantity</TableHead>
                  <TableHead className="text-right">Per credit</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(tiers ?? []).map(t => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.min_quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtMoney(t.per_credit_cents)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{t.description ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
