import { useState } from "react";
import { format } from "date-fns";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Briefcase, Plus, Loader2, Copy, KeyRound, Warehouse, AlertCircle,
} from "lucide-react";
import { PortalHero } from "@/components/portal/PortalHero";
import { PortalEmptyState } from "@/components/portal/PortalEmptyState";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { useTenant } from "@/contexts/TenantContext";
import {
  useDistributorOrgId, useDistributorOrg, useDistributorResellers, useCreateDistributorReseller,
} from "@/hooks/useDistributor";
import { usePendingEnrolmentInvites } from "@/hooks/useEnrollmentCodes";
import { PendingInvitesCard } from "@/components/portal/PendingInvitesCard";

function fmtMoney(cents: number, currency = "AUD") {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(cents / 100);
}

export default function DistributorResellers() {
  const distId = useDistributorOrgId();
  const { isSuperAdmin } = useTenant();
  const { data: org } = useDistributorOrg();
  const { data: resellers, isLoading } = useDistributorResellers();
  const { data: pendingInvites } = usePendingEnrolmentInvites(distId, "partner");
  const createReseller = useCreateDistributorReseller();

  const [createOpen, setCreateOpen]   = useState(false);
  const [newName, setNewName]         = useState("");
  const [newPrice, setNewPrice]       = useState("");
  const [createdCode, setCreatedCode] = useState<{ resellerName: string; code: string } | null>(null);

  const currency = (org as any)?.currency_code ?? "AUD";
  const defaultPriceCents = (org as any)?.wholesale_price_cents ?? null;

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

  const handleCreate = async () => {
    if (!newName.trim()) { toast.error("Reseller name required"); return; }
    let priceCents: number | null = null;
    if (newPrice.trim()) {
      const parsed = parseFloat(newPrice);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        toast.error("Wholesale price must be a positive number, or leave blank to inherit the default.");
        return;
      }
      priceCents = Math.round(parsed * 100);
    } else if (defaultPriceCents === null) {
      toast.error("No default wholesale price is set on your distributor account, so you must enter one here — otherwise this reseller will bill at $0.");
      return;
    }
    try {
      const { reseller, code } = await createReseller.mutateAsync({
        name: newName.trim(),
        wholesale_price_cents: priceCents,
      });
      toast.success(`Reseller created — enrolment URL ready`);
      setCreateOpen(false);
      setNewName(""); setNewPrice("");
      setCreatedCode({ resellerName: (reseller as any).name, code });
    } catch (e: any) {
      toast.error(e.message ?? "Failed to create reseller");
    }
  };

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-7xl mx-auto">
        <PortalHero
          eyebrow="Distributor portal"
          eyebrowIcon={<Warehouse className="h-3.5 w-3.5" />}
          title="Resellers"
          subtitle="The IT providers selling Mithras to their own customers under your distribution."
          actions={
            <Button className="shadow-sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" /> Add reseller
            </Button>
          }
        />

        {/* Add-reseller dialog. Mounted at page-level so the PortalHero
            button just toggles state — keeps the hero markup clean. */}
        <Dialog
          open={createOpen}
          onOpenChange={(o) => {
            setCreateOpen(o);
            if (!o) { setNewName(""); setNewPrice(""); }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Sign up a new reseller</DialogTitle>
              <DialogDescription>
                Creates the reseller organisation and issues a one-time admin enrolment URL to send their contact.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label htmlFor="r-name">Reseller company name</Label>
                <Input id="r-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Acme IT Pty Ltd" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="r-price">Wholesale price per endpoint (optional)</Label>
                <Input
                  id="r-price"
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                  placeholder={defaultPriceCents !== null ? `Default ${fmtMoney(defaultPriceCents, currency)}` : "e.g. 12.50"}
                  type="number"
                  step="0.01"
                  min="0"
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank to inherit your default wholesale rate. Charged to YOUR account in {currency}.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setCreateOpen(false); setNewName(""); setNewPrice(""); }}>Cancel</Button>
              <Button onClick={handleCreate} disabled={createReseller.isPending}>
                {createReseller.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create + generate URL
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <PendingInvitesCard invites={pendingInvites ?? []} childLabel="reseller" childLabelPlural="resellers" />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your resellers</CardTitle>
            <CardDescription>
              Endpoint counts roll up across all of each reseller's customers — you don't see the customer breakdown.
              <Link to="/distributor/billing" className="text-primary hover:underline ml-1">See full billing →</Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : (resellers ?? []).length === 0 ? (
              <PortalEmptyState
                icon={<Briefcase className="h-7 w-7" />}
                title="No resellers yet"
                description={<p>Resellers are the IT providers selling Mithras to their customers. Click "Add reseller" above to onboard your first one — they'll get a one-time signup URL.</p>}
                primaryAction={{ label: "Add your first reseller →", onClick: () => setCreateOpen(true) }}
                className="border-0 shadow-none"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reseller</TableHead>
                    <TableHead className="text-right">Customers</TableHead>
                    <TableHead className="text-right">Endpoints</TableHead>
                    <TableHead className="text-right">Price/seat</TableHead>
                    <TableHead className="text-right">Cycle subtotal</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(resellers ?? []).map(r => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Briefcase className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <div className="font-medium">{r.name}</div>
                            <div className="text-xs text-muted-foreground">since {format(new Date(r.created_at), "d MMM yyyy")}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{Number(r.customer_count)}</TableCell>
                      <TableCell className="text-right">{Number(r.endpoint_count)}</TableCell>
                      <TableCell className="text-right">
                        {r.wholesale_price_cents
                          ? fmtMoney(r.wholesale_price_cents, currency)
                          : defaultPriceCents
                            ? <Badge variant="outline">Inherits {fmtMoney(defaultPriceCents, currency)}</Badge>
                            : <Badge variant="destructive">⚠ No price set</Badge>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(Number(r.line_total_cents), currency)}</TableCell>
                      <TableCell>
                        {r.is_active === false
                          ? <Badge variant="destructive">Suspended</Badge>
                          : <Badge variant="outline" className="border-emerald-500 text-emerald-600">Active</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <EnrolmentUrlDialog
        target={createdCode}
        onClose={() => setCreatedCode(null)}
      />
    </MainLayout>
  );
}

function EnrolmentUrlDialog({
  target,
  onClose,
}: {
  target: { resellerName: string; code: string } | null;
  onClose: () => void;
}) {
  if (!target) return null;
  const url = `${window.location.origin}/signup?code=${encodeURIComponent(target.code)}`;
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            Enrolment URL for {target.resellerName}
          </DialogTitle>
          <DialogDescription>
            Send this link to your new reseller contact. The first person to use it becomes admin of the
            reseller organisation. The link is single-use — they can invite their team from inside the portal.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Signup URL</Label>
            <div className="flex items-center gap-2">
              <Input value={url} readOnly className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button size="icon" variant="outline" onClick={async () => {
                try { await navigator.clipboard.writeText(url); toast.success("URL copied"); }
                catch { toast.error("Couldn't copy — select manually"); }
              }} title="Copy URL"><Copy className="h-4 w-4" /></Button>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Or the code alone</Label>
            <div className="flex items-center gap-2">
              <Input value={target.code} readOnly className="font-mono text-base tracking-widest" onFocus={(e) => e.currentTarget.select()} />
              <Button size="icon" variant="outline" onClick={async () => {
                try { await navigator.clipboard.writeText(target.code); toast.success("Code copied"); }
                catch { toast.error("Couldn't copy — select manually"); }
              }} title="Copy code"><Copy className="h-4 w-4" /></Button>
            </div>
          </div>
        </div>
        <DialogFooter><Button onClick={onClose}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
