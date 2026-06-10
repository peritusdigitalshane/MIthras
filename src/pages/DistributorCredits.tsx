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
import { PortalStatCard } from "@/components/portal/PortalStatCard";
import { PortalEmptyState } from "@/components/portal/PortalEmptyState";
import {
  Warehouse, Coins, Briefcase, Plus, AlertCircle, Mail, Loader2, ArrowDownRight, ArrowUpRight, Activity, History,
} from "lucide-react";
import { toast } from "sonner";
import { useTenant } from "@/contexts/TenantContext";
import { useDistributorOrgId, useDistributorOrg } from "@/hooks/useDistributor";
import {
  useCreditBalance, useCreditTransactions, useDistributorResellersForCredits,
  useCutCredits, useCreditPackQuote, type CreditTransaction,
  useCreditRequestsForDistributor, useApproveCreditRequest, useDeclineCreditRequest,
} from "@/hooks/useCredits";
import { formatDistanceToNow } from "date-fns";
import { Inbox, Check, X } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

function fmtMoney(cents: number, currency = "AUD") {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(cents / 100);
}

export default function DistributorCredits() {
  const { isSuperAdmin } = useTenant();
  const distId = useDistributorOrgId();
  const { data: org } = useDistributorOrg();
  const { data: balance, isLoading: balLoading } = useCreditBalance(distId);
  const { data: resellers, isLoading: rLoading } = useDistributorResellersForCredits(distId);
  const { data: txns, isLoading: tLoading } = useCreditTransactions(distId, 100);
  const cut = useCutCredits();

  const totalBurnRate = useMemo(
    () => (resellers ?? []).reduce((s, r) => s + Number(r.active_endpoint_count), 0),
    [resellers]
  );
  const totalResellerHoldings = useMemo(
    () => (resellers ?? []).reduce((s, r) => s + Number(r.credit_balance), 0),
    [resellers]
  );
  // Quote the current pack price for THIS distributor's balance — uses live
  // pricing rather than the hardcoded $6/credit assumption.
  const { data: poolQuote } = useCreditPackQuote(balance ?? null);

  const [cutOpen, setCutOpen]         = useState(false);
  const [cutResellerId, setCutResellerId] = useState<string>("");
  const [cutQty, setCutQty]           = useState("");
  const [cutPrice, setCutPrice]       = useState("");
  const [cutNotes, setCutNotes]       = useState("");

  const { data: requests } = useCreditRequestsForDistributor(distId);
  const approveReq = useApproveCreditRequest();
  const declineReq = useDeclineCreditRequest();
  const pendingRequests = useMemo(() => (requests ?? []).filter(r => r.status === "pending"), [requests]);
  const [declineOpen, setDeclineOpen] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [approveOpen, setApproveOpen]   = useState<string | null>(null);
  const [approvePrice, setApprovePrice] = useState("");
  const [approveNotes, setApproveNotes] = useState("");

  if (!distId) {
    return (
      <MainLayout>
        <div className="p-6 max-w-2xl mx-auto">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>No distributor selected</AlertTitle>
            <AlertDescription>
              {isSuperAdmin
                ? "Pivot into a distributor org from Admin → Channel partners."
                : "Your account isn't linked to a distributor organisation."}
            </AlertDescription>
          </Alert>
        </div>
      </MainLayout>
    );
  }

  const handleCut = async () => {
    if (!cutResellerId) { toast.error("Pick a reseller"); return; }
    const qty = parseInt(cutQty || "0", 10);
    if (!qty || qty <= 0) { toast.error("Enter a positive quantity"); return; }
    const price = cutPrice.trim() ? Math.round(parseFloat(cutPrice) * 100) : null;
    try {
      await cut.mutateAsync({
        resellerOrgId: cutResellerId,
        quantity: qty,
        unitPriceCents: price,
        notes: cutNotes.trim() || null,
      });
      toast.success(`Cut ${qty} credits to reseller`);
      setCutOpen(false);
      setCutResellerId(""); setCutQty(""); setCutPrice(""); setCutNotes("");
    } catch (e: any) {
      const msg = e?.message ?? "Cut failed";
      // Translate common Postgres error code to a friendly message
      toast.error(
        msg.includes("insufficient_distributor_balance")
          ? "Not enough credits in your pool. Order more from Mithras and try again."
          : msg
      );
    }
  };

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-7xl mx-auto">
        <PortalHero
          eyebrow="Distributor portal"
          eyebrowIcon={<Warehouse className="h-3.5 w-3.5" />}
          title="Credits"
          subtitle="Your inventory of endpoint-months. 1 credit = 1 endpoint protected for 1 calendar month. Cut credits to your resellers; they spend them onboarding customer endpoints. Auto-burn happens on the 1st of each month."
          actions={
            <Dialog open={cutOpen} onOpenChange={setCutOpen}>
              <DialogTrigger asChild>
                <Button className="shadow-sm"><Plus className="h-4 w-4 mr-2" /> Cut credits to reseller</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Cut credits</DialogTitle>
                  <DialogDescription>
                    Transfer credits from your pool to one of your resellers. The price you charge them is your call — defaults to private unless you record it.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-1.5">
                    <Label>Reseller</Label>
                    <Select value={cutResellerId} onValueChange={setCutResellerId}>
                      <SelectTrigger><SelectValue placeholder="Pick one of your resellers" /></SelectTrigger>
                      <SelectContent>
                        {(resellers ?? []).map(r => (
                          <SelectItem key={r.reseller_id} value={r.reseller_id}>
                            {r.reseller_name} ({r.credit_balance} credits, {r.active_endpoint_count} endpoints)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="cut-qty">Quantity</Label>
                      <Input id="cut-qty" type="number" min="1" step="1" value={cutQty} onChange={(e) => setCutQty(e.target.value)} placeholder="e.g. 600" />
                      <p className="text-[11px] text-muted-foreground">e.g. 600 = 50 endpoints × 12 months</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="cut-price">Price per credit (optional)</Label>
                      <Input id="cut-price" type="number" min="0" step="0.01" value={cutPrice} onChange={(e) => setCutPrice(e.target.value)} placeholder="e.g. 8.00 AUD" />
                      <p className="text-[11px] text-muted-foreground">For your records — not visible to reseller.</p>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cut-notes">Notes (optional)</Label>
                    <Input id="cut-notes" value={cutNotes} onChange={(e) => setCutNotes(e.target.value)} placeholder="PO #, deal name, etc." />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCutOpen(false)}>Cancel</Button>
                  <Button onClick={handleCut} disabled={cut.isPending}>
                    {cut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Cut credits
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          }
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <PortalStatCard label="Your pool" value={balance ?? 0} icon={<Coins className="h-4 w-4" />} loading={balLoading} hint={poolQuote ? `At ${fmtMoney(Number(poolQuote.total_cents))} (${poolQuote.tier_name})` : "Standard rate applies"} />
          <PortalStatCard label="Resellers" value={resellers?.length ?? 0} icon={<Briefcase className="h-4 w-4" />} loading={rLoading} hint="Active under your distribution" />
          <PortalStatCard label="Reseller holdings" value={totalResellerHoldings} icon={<ArrowDownRight className="h-4 w-4" />} loading={rLoading} hint="Credits sitting with your resellers" />
          <PortalStatCard label="Monthly burn" value={totalBurnRate} icon={<Activity className="h-4 w-4" />} loading={rLoading} hint="Credits consumed by reseller endpoints next 1st" />
        </div>

        {(balance ?? 0) <= 0 && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>You're out of credits</AlertTitle>
            <AlertDescription>
              Order more from Mithras before you can cut credits to resellers. <a className="underline font-medium" href="mailto:channel@mithras.com.au">channel@mithras.com.au</a>
            </AlertDescription>
          </Alert>
        )}

        {pendingRequests.length > 0 && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Inbox className="h-4 w-4 text-amber-500" />
                {pendingRequests.length} pending request{pendingRequests.length === 1 ? "" : "s"} from your resellers
              </CardTitle>
              <CardDescription>Approve to cut credits straight from your pool. Decline if it doesn't fit your current quota.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reseller</TableHead>
                    <TableHead className="text-right">Credits</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead className="text-right w-[200px]">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingRequests.map(r => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="font-medium">{(r as any).reseller?.name ?? "—"}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{r.quantity}</TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate max-w-xs">{r.notes ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground tabular-nums">
                        {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="outline" className="text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950" onClick={() => { setDeclineOpen(r.id); setDeclineReason(""); }}>
                            <X className="h-3.5 w-3.5 mr-1" /> Decline
                          </Button>
                          <Button size="sm" onClick={() => { setApproveOpen(r.id); setApprovePrice(""); setApproveNotes(""); }}>
                            <Check className="h-3.5 w-3.5 mr-1" /> Approve
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Approve dialog — gives disty the chance to record a per-credit unit price + a note. */}
        <Dialog open={!!approveOpen} onOpenChange={(o) => !o && setApproveOpen(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Approve credit request</DialogTitle>
              <DialogDescription>
                Approving cuts the requested credits from your pool into the reseller's. Optional fields just get recorded on the transaction.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="ap-price">Unit price charged (optional, $/credit)</Label>
                <Input id="ap-price" type="number" step="0.01" min="0" value={approvePrice} onChange={(e) => setApprovePrice(e.target.value)} placeholder="e.g. 0.08" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ap-notes">Note (optional)</Label>
                <Input id="ap-notes" value={approveNotes} onChange={(e) => setApproveNotes(e.target.value)} placeholder="PO ref, deal name, etc." />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setApproveOpen(null)}>Cancel</Button>
              <Button onClick={async () => {
                if (!approveOpen) return;
                const price = approvePrice.trim() ? Math.round(parseFloat(approvePrice) * 100) : null;
                try {
                  await approveReq.mutateAsync({ requestId: approveOpen, notes: approveNotes.trim() || null, unitPriceCents: price });
                  toast.success("Request approved — credits cut to reseller");
                  setApproveOpen(null);
                } catch (e: any) {
                  const msg = e?.message ?? "Approve failed";
                  toast.error(msg.includes("insufficient_distributor_balance")
                    ? "Not enough credits in your pool. Order more from Mithras and try again."
                    : msg);
                }
              }} disabled={approveReq.isPending}>
                {approveReq.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Approve + cut credits
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!declineOpen} onOpenChange={(o) => !o && setDeclineOpen(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Decline credit request</DialogTitle>
              <DialogDescription>The reseller will see your reason on their portal.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5 py-2">
              <Label htmlFor="dec-reason">Reason</Label>
              <Textarea id="dec-reason" value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} placeholder="e.g. 'Hold while you settle last invoice', 'Need a PO for >500 credits'" rows={3} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeclineOpen(null)}>Cancel</Button>
              <Button variant="destructive" onClick={async () => {
                if (!declineOpen) return;
                if (!declineReason.trim()) { toast.error("Reason required"); return; }
                try {
                  await declineReq.mutateAsync({ requestId: declineOpen, reason: declineReason.trim() });
                  toast.success("Request declined");
                  setDeclineOpen(null);
                } catch (e: any) {
                  toast.error(e.message ?? "Decline failed");
                }
              }} disabled={declineReq.isPending}>
                {declineReq.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Decline
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Your resellers</CardTitle>
              <CardDescription>Balance + monthly burn rate per reseller. Watch resellers approaching zero — they'll come asking for more.</CardDescription>
            </CardHeader>
            <CardContent>
              {rLoading ? (
                <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : (resellers ?? []).length === 0 ? (
                <PortalEmptyState
                  icon={<Briefcase className="h-7 w-7" />}
                  title="No resellers yet"
                  description={<p>Sign up your first reseller to start cutting credits to them. Once they consume their pool they'll come back for more — that's how the channel turns.</p>}
                  primaryAction={{ label: "Add reseller →", href: "/distributor/resellers" }}
                  className="border-0 shadow-none"
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reseller</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead className="text-right">Monthly burn</TableHead>
                      <TableHead className="text-right">Months of runway</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(resellers ?? []).map(r => {
                      const burn = Number(r.active_endpoint_count);
                      const runwayExact = burn > 0 ? Number(r.credit_balance) / burn : null;
                      const runway = runwayExact === null ? null : Math.round(runwayExact * 10) / 10;
                      const daysRunway = burn > 0 ? Math.floor((Number(r.credit_balance) * 30) / burn) : null;
                      const lowRunway = runway !== null && runway < 1;
                      return (
                        <TableRow key={r.reseller_id}>
                          <TableCell className="font-medium">{r.reseller_name}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            <span className={r.credit_balance < 0 ? "text-rose-600 font-semibold" : ""}>
                              {Number(r.credit_balance)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{burn}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {runway === null
                              ? "—"
                              : lowRunway
                                ? <Badge variant="outline" className="border-rose-500/60 text-rose-600">{daysRunway}d left</Badge>
                                : <span>{runway} mo</span>}
                          </TableCell>
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
              <CardTitle className="text-base flex items-center gap-2">
                <Mail className="h-4 w-4 text-primary" /> Need more credits?
              </CardTitle>
              <CardDescription>Order from Mithras directly.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                Email <a className="underline font-medium" href={`mailto:channel@mithras.com.au?subject=Credit%20pack%20order%20-%20${encodeURIComponent((org as any)?.name ?? "")}`}>channel@mithras.com.au</a> with a pack size. Volume tiers reduce per-credit cost.
              </p>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>1–499 credits: standard rate</li>
                <li>500+ credits: 2.5% off</li>
                <li>1,000+ credits: 5% off</li>
                <li>10,000+ credits: 10% off</li>
              </ul>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4 text-primary" /> Recent transactions</CardTitle>
            <CardDescription>Full audit of credits in and out.</CardDescription>
          </CardHeader>
          <CardContent>
            {tLoading ? (
              <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : (txns ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No credit transactions yet.</p>
            ) : (
              <TransactionsTable distId={distId} txns={txns ?? []} />
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}

function TransactionsTable({ distId, txns }: { distId: string; txns: CreditTransaction[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Direction</TableHead>
          <TableHead className="text-right">Quantity</TableHead>
          <TableHead>Notes</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {txns.map(t => {
          const isInflow = t.to_org_id === distId;
          return (
            <TableRow key={t.id}>
              <TableCell className="text-sm text-muted-foreground tabular-nums">{formatDistanceToNow(new Date(t.created_at), { addSuffix: true })}</TableCell>
              <TableCell><Badge variant="outline" className="font-normal">{reasonLabel(t.reason)}</Badge></TableCell>
              <TableCell>
                {isInflow
                  ? <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1"><ArrowDownRight className="h-3 w-3" />Received</span>
                  : <span className="text-rose-600 dark:text-rose-400 flex items-center gap-1"><ArrowUpRight className="h-3 w-3" />Sent</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums font-medium">{isInflow ? "+" : "−"}{t.quantity}</TableCell>
              <TableCell className="text-xs text-muted-foreground truncate max-w-xs">{t.notes ?? "—"}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function reasonLabel(reason: CreditTransaction["reason"]): string {
  return {
    mithras_issue:     "Issued by Mithras",
    distributor_cut:   "Cut to reseller",
    enrolment_consume: "Enrolment",
    monthly_consume:   "Monthly burn",
    admin_adjust:      "Admin adjust",
  }[reason];
}
