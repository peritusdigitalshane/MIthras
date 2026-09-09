import { useMemo, useState } from "react";
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
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PortalHero } from "@/components/portal/PortalHero";
import { PortalStatCard } from "@/components/portal/PortalStatCard";
import { PortalEmptyState } from "@/components/portal/PortalEmptyState";
import {
  ShieldCheck, Plus, AlertCircle, Loader2, Briefcase, Trophy, XCircle, Clock,
  Target, MoreHorizontal, ChevronRight, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useResellerOrgId, useResellerOrg } from "@/hooks/useReseller";
import {
  useResellerDeals, useRegisterDeal, useUpdateDealStage, useLoseDeal,
  useConvertDealToCustomer,
  type DealRegistration, type DealStage,
} from "@/hooks/useDealRegistrations";
import { formatDistanceToNow, differenceInDays } from "date-fns";

const ADVANCE_STAGES: DealStage[] = ["qualified", "demo", "poc", "quote"];

const STAGE_LABEL: Record<DealStage, string> = {
  qualified: "Qualified",
  demo:      "Demo",
  poc:       "POC",
  quote:     "Quote",
  won:       "Won",
  lost:      "Lost",
  expired:   "Expired",
};

export default function PartnerDeals() {
  const orgId = useResellerOrgId();
  const { data: org } = useResellerOrg();
  const { data: deals, isLoading } = useResellerDeals(orgId);
  const register = useRegisterDeal();
  const advance  = useUpdateDealStage();
  const lose     = useLoseDeal();
  const convert  = useConvertDealToCustomer();

  const [createOpen, setCreateOpen]       = useState(false);
  const [winDialog, setWinDialog]         = useState<DealRegistration | null>(null);
  const [winCustomerName, setWinCustomerName] = useState("");
  const [pName, setPName]                 = useState("");
  const [pEndpoints, setPEndpoints]       = useState("");
  const [pCloseDate, setPCloseDate]       = useState("");
  const [pEmail, setPEmail]               = useState("");
  const [pIndustry, setPIndustry]         = useState("");
  const [pRegion, setPRegion]             = useState("");
  const [pNotes, setPNotes]               = useState("");

  const [loseDialogId, setLoseDialogId]   = useState<string | null>(null);
  const [loseReason, setLoseReason]       = useState("");

  const stats = useMemo(() => {
    const all = deals ?? [];
    const active = all.filter(d => d.status === "active");
    return {
      active:    active.length,
      pipeline:  active.reduce((s, d) => s + Number(d.estimated_endpoints), 0),
      won:       all.filter(d => d.status === "won").length,
      winRate:   all.filter(d => ["won","lost"].includes(d.status)).length === 0
                  ? null
                  : Math.round(100 * all.filter(d => d.status === "won").length /
                       all.filter(d => ["won","lost"].includes(d.status)).length),
    };
  }, [deals]);

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

  const handleRegister = async () => {
    if (!pName.trim()) { toast.error("Prospect name required"); return; }
    try {
      await register.mutateAsync({
        resellerOrgId:        orgId,
        prospectName:         pName.trim(),
        estimatedEndpoints:   pEndpoints ? parseInt(pEndpoints, 10) : 0,
        estimatedCloseDate:   pCloseDate || null,
        prospectEmail:        pEmail.trim() || null,
        prospectIndustry:     pIndustry.trim() || null,
        prospectRegion:       pRegion.trim() || null,
        notes:                pNotes.trim() || null,
      });
      toast.success(`Registered ${pName.trim()} — protected for 60 days`);
      setCreateOpen(false);
      setPName(""); setPEndpoints(""); setPCloseDate("");
      setPEmail(""); setPIndustry(""); setPRegion(""); setPNotes("");
    } catch (e: any) {
      const msg = e?.message ?? "Registration failed";
      toast.error(
        msg.includes("deal_already_registered")
          ? "Another reseller in your distributor's chain has already registered this prospect. Contact your distributor to coordinate."
          : msg
      );
    }
  };

  const handleAdvance = async (deal: DealRegistration, next: DealStage) => {
    try {
      await advance.mutateAsync({ dealId: deal.id, newStage: next });
      toast.success(`${deal.prospect_name} → ${STAGE_LABEL[next]}`);
    } catch (e: any) {
      toast.error(e.message ?? "Stage change failed");
    }
  };

  const handleConvert = async () => {
    if (!winDialog) return;
    const customerName = winCustomerName.trim() || winDialog.prospect_name;
    // Pre-check that the slug is free. Server will silently auto-suffix
    // collisions with a UUID, which is ugly — give the partner a chance
    // to pick a unique name before that happens.
    const candidateSlug = customerName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
    if (candidateSlug.length > 0) {
      const { data: existing } = await supabase
        .from("organizations")
        .select("id, name")
        .eq("slug", candidateSlug)
        .maybeSingle();
      if (existing) {
        toast.error(
          `An organisation called "${existing.name}" already uses that name. Tweak the customer name (e.g. add a location or department) and try again.`,
          { duration: 8000 }
        );
        return;
      }
    }
    try {
      await convert.mutateAsync({
        dealId: winDialog.id,
        newCustomerName: customerName,
      });
      toast.success(`${winDialog.prospect_name} → customer created`);
      setWinDialog(null);
      setWinCustomerName("");
    } catch (e: any) {
      toast.error(e.message ?? "Conversion failed");
    }
  };

  const handleLose = async () => {
    if (!loseDialogId) return;
    try {
      await lose.mutateAsync({ dealId: loseDialogId, reason: loseReason.trim() || null });
      toast.success("Marked lost");
      setLoseDialogId(null); setLoseReason("");
    } catch (e: any) {
      toast.error(e.message ?? "Couldn't mark lost");
    }
  };

  const activeDeals = (deals ?? []).filter(d => d.status === "active");
  const closedDeals = (deals ?? []).filter(d => d.status !== "active");

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-7xl mx-auto">
        <PortalHero
          eyebrow="Partner portal"
          eyebrowIcon={<ShieldCheck className="h-3.5 w-3.5" />}
          title="Deal pipeline"
          subtitle="Register prospects you're working on. Registration protects you from intra-channel conflict — no other reseller (under your distributor) can register the same prospect, and Mithras won't sell direct."
          accent="indigo"
          actions={
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button className="shadow-sm"><Plus className="h-4 w-4 mr-2" /> Register a deal</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Register a new deal</DialogTitle>
                  <DialogDescription>
                    Locks this prospect for you for 60 days at the Qualified stage. Advance the stage as the deal progresses — each stage refreshes the protection window.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="d-name">Prospect company name *</Label>
                    <Input id="d-name" value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Acme Engineering Pty Ltd" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="d-eps">Est. endpoints</Label>
                      <Input id="d-eps" type="number" min="0" value={pEndpoints} onChange={(e) => setPEndpoints(e.target.value)} placeholder="50" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="d-close">Est. close date</Label>
                      <Input id="d-close" type="date" value={pCloseDate} onChange={(e) => setPCloseDate(e.target.value)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="d-industry">Industry</Label>
                      <Input id="d-industry" value={pIndustry} onChange={(e) => setPIndustry(e.target.value)} placeholder="Healthcare, Legal, etc." />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="d-region">Region</Label>
                      <Input id="d-region" value={pRegion} onChange={(e) => setPRegion(e.target.value)} placeholder="Sydney, AU" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="d-email">Contact email (optional)</Label>
                    <Input id="d-email" type="email" value={pEmail} onChange={(e) => setPEmail(e.target.value)} placeholder="it@acme.com.au" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="d-notes">Notes</Label>
                    <Textarea id="d-notes" rows={3} value={pNotes} onChange={(e) => setPNotes(e.target.value)} placeholder="How you found them, key drivers, current security stack, etc." />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                  <Button onClick={handleRegister} disabled={register.isPending}>
                    {register.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Register & protect for 60 days
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          }
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <PortalStatCard label="Active deals"        value={stats.active}            icon={<Briefcase className="h-4 w-4" />} loading={isLoading} hint="In your protected pipeline" />
          <PortalStatCard label="Pipeline endpoints"  value={stats.pipeline}          icon={<Target className="h-4 w-4" />}    loading={isLoading} hint="Sum across active prospects" />
          <PortalStatCard label="Won"                 value={stats.won}               icon={<Trophy className="h-4 w-4" />}    loading={isLoading} hint="Converted to paying customers" />
          <PortalStatCard label="Win rate"            value={stats.winRate === null ? "—" : `${stats.winRate}%`} icon={<ShieldCheck className="h-4 w-4" />} loading={isLoading} hint={stats.winRate === null ? "No closed deals yet" : "Won ÷ closed"} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-primary" /> Active pipeline
            </CardTitle>
            <CardDescription>Deals you're actively working. Advance the stage as you progress; protection auto-refreshes per stage.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : activeDeals.length === 0 ? (
              <PortalEmptyState
                icon={<Briefcase className="h-7 w-7" />}
                title="No active deals registered"
                description={<p>Register prospects you're actively working on — protection prevents another reseller in your distributor's chain from grabbing the same prospect.</p>}
                primaryAction={{ label: "Register your first deal →", onClick: () => setCreateOpen(true) }}
                accent="indigo"
                className="border-0 shadow-none"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Prospect</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead className="text-right">Est. endpoints</TableHead>
                    <TableHead className="text-right">Est. MRR if won</TableHead>
                    <TableHead>Protection</TableHead>
                    <TableHead>Close target</TableHead>
                    <TableHead className="w-[160px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeDeals.map(d => (
                    <ActiveRow
                      key={d.id}
                      deal={d}
                      onAdvance={handleAdvance}
                      onLose={() => setLoseDialogId(d.id)}
                      onWin={() => { setWinDialog(d); setWinCustomerName(d.prospect_name); }}
                    />
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {closedDeals.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Closed deals</CardTitle>
              <CardDescription>Won, lost, or expired — your historical pipeline.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Prospect</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead className="text-right">Endpoints</TableHead>
                    <TableHead>Closed</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {closedDeals.map(d => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">{d.prospect_name}</TableCell>
                      <TableCell><StatusBadge status={d.status} /></TableCell>
                      <TableCell className="text-right tabular-nums">{Number(d.estimated_endpoints)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {d.won_at ? formatDistanceToNow(new Date(d.won_at), { addSuffix: true })
                         : d.lost_at ? formatDistanceToNow(new Date(d.lost_at), { addSuffix: true })
                         : formatDistanceToNow(new Date(d.updated_at), { addSuffix: true })}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate max-w-xs">{d.lost_reason ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Win → convert dialog. Default customer name is the prospect_name;
          on submit the RPC creates the customer org under this reseller and
          inherits the locked retail price from the deal. */}
      <Dialog open={!!winDialog} onOpenChange={(o) => !o && setWinDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Trophy className="h-5 w-5 text-emerald-500" /> Convert to customer</DialogTitle>
            <DialogDescription>
              Marks "{winDialog?.prospect_name}" as won and creates a new customer organisation under your account. The customer inherits the retail price snapshot from this deal — your margin is locked.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="win-name">Customer organisation name</Label>
              <Input id="win-name" value={winCustomerName} onChange={(e) => setWinCustomerName(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">Defaults to the prospect name. Change if their legal entity differs.</p>
            </div>
            {winDialog?.locked_retail_cents !== null && winDialog?.locked_retail_cents !== undefined && (
              <div className="text-xs text-muted-foreground space-y-1 border-t pt-3">
                <div className="flex justify-between"><span>Locked retail per endpoint:</span><span className="font-medium">${((winDialog.locked_retail_cents ?? 0) / 100).toFixed(2)}/mo</span></div>
                <div className="flex justify-between"><span>Est. monthly revenue ({winDialog.estimated_endpoints} EPs):</span><span className="font-medium">${(((winDialog.locked_retail_cents ?? 0) * winDialog.estimated_endpoints) / 100).toFixed(2)}</span></div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWinDialog(null)}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleConvert} disabled={convert.isPending}>
              {convert.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Convert & create customer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lose dialog */}
      <Dialog open={!!loseDialogId} onOpenChange={(o) => !o && setLoseDialogId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark deal as lost</DialogTitle>
            <DialogDescription>Frees up the protection slot. Helps your distributor learn what's costing them deals.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="lose-reason">Reason (optional)</Label>
            <Textarea id="lose-reason" rows={3} value={loseReason} onChange={(e) => setLoseReason(e.target.value)} placeholder="e.g. price, lost to CrowdStrike, prospect went out of business" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLoseDialogId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleLose} disabled={lose.isPending}>
              {lose.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Mark lost
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}

function ActiveRow({ deal, onAdvance, onLose, onWin }: { deal: DealRegistration; onAdvance: (d: DealRegistration, s: DealStage) => void; onLose: () => void; onWin: () => void }) {
  const daysLeft   = differenceInDays(new Date(deal.protection_expires_at), new Date());
  const veryLow    = daysLeft <= 3;
  const lowTime    = daysLeft <= 14;
  const nextStages = ADVANCE_STAGES.filter(s => s !== deal.stage);

  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{deal.prospect_name}</div>
        {deal.prospect_region && <div className="text-xs text-muted-foreground">{deal.prospect_region}</div>}
      </TableCell>
      <TableCell><StageBadge stage={deal.stage} /></TableCell>
      <TableCell className="text-right tabular-nums">{Number(deal.estimated_endpoints)}</TableCell>
      <TableCell className="text-right tabular-nums">
        {deal.locked_retail_cents != null
          ? <span title={`Locked retail $${(deal.locked_retail_cents / 100).toFixed(2)}/EP/mo`} className="font-medium">
              ${((deal.locked_retail_cents * deal.estimated_endpoints) / 100).toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </span>
          : <span className="text-xs text-muted-foreground">no price on file</span>}
      </TableCell>
      <TableCell>
        <Badge
          variant={veryLow ? "destructive" : "outline"}
          className={
            veryLow ? "" :
            lowTime ? "border-amber-500/60 text-amber-600 dark:text-amber-400" :
            ""
          }
        >
          <Clock className="h-3 w-3 mr-1" />
          {daysLeft <= 0 ? "Expired" : daysLeft <= 3 ? `${daysLeft}d — act now` : `${daysLeft}d left`}
        </Badge>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground tabular-nums">
        {deal.estimated_close_date ? new Date(deal.estimated_close_date).toLocaleDateString() : "—"}
      </TableCell>
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              Update <ChevronRight className="h-3 w-3 ml-0.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem className="text-emerald-600 dark:text-emerald-400 font-medium" onClick={onWin}>
              <Trophy className="h-3.5 w-3.5 mr-1.5" /> Won — create customer
            </DropdownMenuItem>
            {nextStages.map(s => (
              <DropdownMenuItem key={s} onClick={() => onAdvance(deal, s)}>
                Move to {STAGE_LABEL[s]}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem className="text-rose-600 dark:text-rose-400" onClick={onLose}>
              <XCircle className="h-3.5 w-3.5 mr-1.5" /> Mark lost
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

function StageBadge({ stage }: { stage: DealStage }) {
  const cls = stage === "qualified" ? "border-muted-foreground/40"
            : stage === "demo"      ? "border-blue-500/60 text-blue-600 dark:text-blue-400 bg-blue-500/10"
            : stage === "poc"       ? "border-indigo-500/60 text-indigo-600 dark:text-indigo-400 bg-indigo-500/10"
            : stage === "quote"     ? "border-violet-500/60 text-violet-600 dark:text-violet-400 bg-violet-500/10"
            :                         "";
  return <Badge variant="outline" className={cls}>{STAGE_LABEL[stage]}</Badge>;
}

function StatusBadge({ status }: { status: "won" | "lost" | "expired" | "active" }) {
  if (status === "won")     return <Badge variant="outline" className="border-emerald-500/60 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"><Trophy className="h-3 w-3 mr-1" />Won</Badge>;
  if (status === "lost")    return <Badge variant="outline" className="border-rose-500/60 text-rose-600 dark:text-rose-400 bg-rose-500/10"><XCircle className="h-3 w-3 mr-1" />Lost</Badge>;
  if (status === "expired") return <Badge variant="outline" className="border-amber-500/60 text-amber-600 dark:text-amber-400 bg-amber-500/10"><Clock className="h-3 w-3 mr-1" />Expired</Badge>;
  return <Badge variant="outline">Active</Badge>;
}
