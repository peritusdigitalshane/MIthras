import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { PortalHero } from "@/components/portal/PortalHero";
import { PortalStatCard } from "@/components/portal/PortalStatCard";
import {
  ShieldCheck, Coins, Activity, Mail, AlertCircle, History, ArrowDownRight, ArrowUpRight, ShoppingCart, Loader2, Clock, X,
} from "lucide-react";
import { useResellerOrgId, useResellerOrg, useResellerCustomers, useResellerDistributor } from "@/hooks/useReseller";
import {
  useCreditBalance, useCreditTransactions, useResellerCreditHealth, type CreditTransaction,
  useCreditRequestsForReseller, useRequestCredits, useCancelCreditRequest,
} from "@/hooks/useCredits";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

export default function PartnerCredits() {
  const orgId = useResellerOrgId();
  const { data: org } = useResellerOrg();
  const { data: balance, isLoading: balLoading } = useCreditBalance(orgId);
  const { data: customers } = useResellerCustomers();
  const { data: txns, isLoading: tLoading } = useCreditTransactions(orgId, 100);
  const { data: health } = useResellerCreditHealth(orgId);
  const { data: requests, isLoading: reqLoading } = useCreditRequestsForReseller(orgId);
  const requestCredits = useRequestCredits();
  const cancelRequest  = useCancelCreditRequest();
  // Resolve the actual distributor sitting above this reseller (or fall back
  // to Mithras if none). Lets us write "Email Apex Cyber Distribution" instead
  // of the vague "Email your distributor".
  //
  // Must stay above the `if (!orgId)` early return below: it used to sit
  // after it, so the hook only ran for resellers. When orgId resolved from
  // undefined to a value, React saw an extra hook and threw
  // "Rendered more hooks than during the previous render".
  const { data: distributor } = useResellerDistributor();
  const [reqOpen, setReqOpen] = useState(false);
  const [reqQty,  setReqQty]  = useState("");
  const [reqNotes, setReqNotes] = useState("");
  const pending = (requests ?? []).filter(r => r.status === "pending");

  const handleSubmitRequest = async () => {
    const qty = parseInt(reqQty || "0", 10);
    if (!orgId) return;
    if (!qty || qty <= 0) { toast.error("Enter a positive credit quantity"); return; }
    try {
      await requestCredits.mutateAsync({ resellerOrgId: orgId, quantity: qty, notes: reqNotes.trim() || null });
      toast.success("Request sent to your distributor");
      setReqOpen(false); setReqQty(""); setReqNotes("");
    } catch (e: any) {
      toast.error(e.message ?? "Couldn't submit request");
    }
  };

  if (!orgId) {
    return (
      <MainLayout>
        <div className="p-6 max-w-2xl mx-auto">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>No reseller account</AlertTitle>
            <AlertDescription>This page is for reseller (partner) admins.</AlertDescription>
          </Alert>
        </div>
      </MainLayout>
    );
  }

  const monthlyBurn = (customers ?? []).reduce((s, c) => s + c.active_endpoint_count, 0);
  // Keep one-decimal precision so "3 months" doesn't actually mean 3.9.
  // Sub-month gets formatted as days in the UI hint below.
  const monthsRunwayExact = monthlyBurn > 0 ? (balance ?? 0) / monthlyBurn : null;
  const monthsRunway = monthsRunwayExact === null
    ? null
    : monthsRunwayExact < 1
      ? Math.round(monthsRunwayExact * 30) / 30  // expressed as decimal months — UI also shows the day count
      : Math.round(monthsRunwayExact * 10) / 10;
  const daysRunway = monthlyBurn > 0 ? Math.floor(((balance ?? 0) * 30) / monthlyBurn) : null;
  const distributorName    = distributor?.name ?? "Mithras";
  const distributorEmail   = distributor?.billing_email ?? "channel@mithras.com.au";

  // Mailto for "top me up" request — pre-fills a sensible message body and
  // routes to the actual distributor's billing inbox when there is one.
  const topUpMailto = `mailto:${distributorEmail}?subject=${encodeURIComponent(
    `Credit top-up request — ${(org as any)?.name ?? "Reseller"}`
  )}&body=${encodeURIComponent(
    `Hi ${distributor?.name ?? "channel team"},\n\nI'd like to top up our Mithras credit pool.\n\n` +
    `Current balance: ${balance ?? 0} credits\n` +
    `Active endpoints: ${monthlyBurn}\n` +
    `Months of runway: ${monthsRunway ?? "—"}\n\n` +
    `Please quote for: [enter quantity, e.g. 600]\n\n` +
    `Thanks.`
  )}`;

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-7xl mx-auto">
        <PortalHero
          eyebrow="Partner portal"
          eyebrowIcon={<ShieldCheck className="h-3.5 w-3.5" />}
          title="Credits"
          subtitle="Your inventory of endpoint-months. Each active customer endpoint consumes 1 credit per calendar month. Buy more from your distributor when you're low."
          accent="indigo"
          status={
            (balance ?? 0) < 0
              ? { label: `Overdraft: ${Math.abs(balance ?? 0)}`, tone: "bad" }
              : monthsRunway !== null && monthsRunway < 1
                ? { label: "Low — top up soon", tone: "warn" }
                : { label: `${balance ?? 0} available`, tone: "ok" }
          }
          actions={
            <div className="flex gap-2">
              <Button className="shadow-sm" onClick={() => setReqOpen(true)} disabled={pending.length > 0}>
                <ShoppingCart className="h-4 w-4 mr-1.5" />
                {pending.length > 0 ? "Request pending" : "Request more credits"}
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={topUpMailto}><Mail className="h-4 w-4 mr-1.5" /> Email disty</a>
              </Button>
            </div>
          }
        />

        {/* Request dialog — fires the request_credits RPC, which the disty sees on /distributor/credits */}
        <Dialog open={reqOpen} onOpenChange={setReqOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Request credits from {distributorName}</DialogTitle>
              <DialogDescription>
                They'll see this on their distributor portal and can approve in one click — credits drop straight into your pool. One pending request at a time.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="req-qty">Credits requested</Label>
                <Input id="req-qty" type="number" min="1" step="1" value={reqQty} onChange={(e) => setReqQty(e.target.value)} placeholder="e.g. 100" />
                <p className="text-[11px] text-muted-foreground">1 credit = 1 endpoint × 1 month. If you need 50 endpoints for the next 12 months, request 600.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="req-notes">Note for your distributor (optional)</Label>
                <Textarea id="req-notes" value={reqNotes} onChange={(e) => setReqNotes(e.target.value)} placeholder="e.g. New customer Acme Eng — 50 EPs, 12-month deal won" rows={3} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReqOpen(false)}>Cancel</Button>
              <Button onClick={handleSubmitRequest} disabled={requestCredits.isPending}>
                {requestCredits.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Send request
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <PortalStatCard
            label="Available credits"
            value={balance ?? 0}
            icon={<Coins className="h-4 w-4" />}
            loading={balLoading}
            hint="1 credit = 1 endpoint × 1 month"
          />
          <PortalStatCard
            label="Monthly burn"
            value={monthlyBurn}
            icon={<Activity className="h-4 w-4" />}
            hint="Active endpoints × 1 month"
          />
          <PortalStatCard
            label="Runway"
            value={
              monthsRunway === null ? "—"
              : monthsRunway < 1 ? `${daysRunway ?? 0}d`
              : `${monthsRunway} mo`
            }
            icon={<Activity className="h-4 w-4" />}
            hint={monthsRunway === null ? "No active endpoints yet" : "Top up before this hits 0"}
          />
          <PortalStatCard
            label="This cycle"
            value={(txns ?? []).filter(t => t.reason === "monthly_consume" || t.reason === "enrolment_consume").reduce((s, t) => s + t.quantity, 0)}
            icon={<History className="h-4 w-4" />}
            hint="Consumed across enrolments + burn"
          />
        </div>

        {(balance ?? 0) <= 0 && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>You're {Math.abs(balance ?? 0) > 0 ? `${Math.abs(balance ?? 0)} credit${Math.abs(balance ?? 0) === 1 ? "" : "s"} overdrawn` : "out of credits"}</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>New endpoint enrolments still work — they'll just push your balance further negative. Your distributor needs to top you up so monthly billing reconciles cleanly. Existing endpoints continue running.</p>
              <Button asChild size="sm" variant="outline">
                <a href={topUpMailto}>Email {distributorName}</a>
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {monthsRunway !== null && monthsRunway < 1 && (balance ?? 0) > 0 && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Less than 1 month of runway</AlertTitle>
            <AlertDescription>
              At your current endpoint count you'll exhaust your pool on the next monthly cycle. Top up now to avoid disrupting your customers.
            </AlertDescription>
          </Alert>
        )}

        {health?.is_midmonth_warning && (balance ?? 0) > 0 && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Over half your monthly credit allotment used</AlertTitle>
            <AlertDescription>
              You've burned {health.consumed_this_month} credits already this month against an active fleet of {health.active_endpoints} endpoints. Topping up now keeps you ahead of next month's monthly burn.
            </AlertDescription>
          </Alert>
        )}

        {(requests ?? []).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><ShoppingCart className="h-4 w-4 text-primary" /> Your purchase requests</CardTitle>
              <CardDescription>Pending requests at the top — your distributor approves or declines from their portal.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead className="text-right">Credits</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead>Resolved</TableHead>
                    <TableHead className="text-right w-[100px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(requests ?? []).map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs text-muted-foreground tabular-nums">
                        {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{r.quantity}</TableCell>
                      <TableCell>
                        {r.status === "pending"  && <Badge variant="outline" className="border-amber-500 text-amber-600"><Clock className="h-3 w-3 mr-1" />pending</Badge>}
                        {r.status === "approved" && <Badge variant="outline" className="border-emerald-500 text-emerald-600">approved</Badge>}
                        {r.status === "declined" && <Badge variant="destructive">declined</Badge>}
                        {r.status === "canceled" && <Badge variant="outline">canceled</Badge>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate max-w-xs">{r.notes ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.resolved_at ? formatDistanceToNow(new Date(r.resolved_at), { addSuffix: true }) : "—"}
                        {r.resolution_notes && <div className="text-[10px] mt-0.5 italic">"{r.resolution_notes}"</div>}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.status === "pending" && (
                          <Button variant="ghost" size="sm" onClick={async () => {
                            try { await cancelRequest.mutateAsync(r.id); toast.success("Request canceled"); }
                            catch (e: any) { toast.error(e.message ?? "Cancel failed"); }
                          }}>
                            <X className="h-3.5 w-3.5 mr-1" /> Cancel
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4 text-primary" /> Transaction history</CardTitle>
            <CardDescription>Every credit you've received and spent.</CardDescription>
          </CardHeader>
          <CardContent>
            {tLoading ? (
              <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : (txns ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No transactions yet — your distributor hasn't cut any credits to you. Email them to get started.</p>
            ) : (
              <TxnsTable orgId={orgId} txns={txns ?? []} />
            )}
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-muted/30 to-transparent">
          <CardContent className="p-5">
            <h3 className="font-semibold text-sm">How credits work</h3>
            <ul className="text-sm text-muted-foreground mt-2 space-y-1.5">
              <li>• <strong>1 credit = 1 endpoint × 1 month</strong> of protection.</li>
              <li>• <strong>Enrolment</strong>: we charge 1 credit the instant a customer endpoint enrols. That covers the current month.</li>
              <li>• <strong>Monthly burn</strong>: on the 1st of each calendar month we charge 1 credit per still-active endpoint.</li>
              <li>• Deactivating an endpoint stops future charges — the month already paid isn't refunded.</li>
              <li>• {distributorName} sets the per-credit price they charge you. Mithras doesn't enforce it.</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}

function TxnsTable({ orgId, txns }: { orgId: string; txns: CreditTransaction[] }) {
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
          const isInflow = t.to_org_id === orgId && (t.from_org_id !== orgId);
          return (
            <TableRow key={t.id}>
              <TableCell className="text-sm text-muted-foreground tabular-nums">{formatDistanceToNow(new Date(t.created_at), { addSuffix: true })}</TableCell>
              <TableCell><Badge variant="outline" className="font-normal">{labelFor(t.reason)}</Badge></TableCell>
              <TableCell>
                {isInflow
                  ? <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1"><ArrowDownRight className="h-3 w-3" />Received</span>
                  : <span className="text-rose-600 dark:text-rose-400 flex items-center gap-1"><ArrowUpRight className="h-3 w-3" />Spent</span>}
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

function labelFor(reason: CreditTransaction["reason"]): string {
  return {
    mithras_issue:     "Issued by Mithras",
    distributor_cut:   "Received from distributor",
    enrolment_consume: "Endpoint enrolled",
    monthly_consume:   "Monthly burn",
    admin_adjust:      "Admin adjust",
  }[reason];
}
