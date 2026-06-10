import { useState } from "react";
import { format } from "date-fns";
import { MainLayout } from "@/components/layout/MainLayout";
import { useTenant } from "@/contexts/TenantContext";
import {
  usePartnerCustomers,
  useCreatePartnerCustomer,
  useRenameOrganization,
  useDeleteOrganization,
} from "@/hooks/usePartners";
import { useCreateEnrollmentCode, usePendingEnrolmentInvites } from "@/hooks/useEnrollmentCodes";
import { useCreditBalance } from "@/hooks/useCredits";
import { PendingInvitesCard } from "@/components/portal/PendingInvitesCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Building2, Plus, Loader2, Pencil, Trash2, Check, X, ChevronRight, ShieldAlert, Copy, KeyRound, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Link, useNavigate } from "react-router-dom";

// Partner-admin facing customer management page. Lets the MSP partner create
// new customer orgs under themselves, rename, delete, and pivot into any of
// their customers via "View as".
const MyCustomers = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { userOrganization, isSuperAdmin, isPartnerAdmin, isLoading: tenantLoading, setImpersonatedOrg } = useTenant();

  // For partners, customers are children of THEIR org. For super-admins this
  // page also works but Admin → Partners is the canonical surface.
  const partnerOrgId = userOrganization?.organization_type === "partner" ? userOrganization.id : null;
  const { data: customers, isLoading } = usePartnerCustomers(partnerOrgId);
  const createCustomer = useCreatePartnerCustomer();
  const createCode = useCreateEnrollmentCode();
  const { data: creditBalance } = useCreditBalance(partnerOrgId);
  const { data: pendingInvites } = usePendingEnrolmentInvites(partnerOrgId, "customer");
  const renameOrg = useRenameOrganization();
  const deleteOrg = useDeleteOrganization();

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  // After-create dialog: shows the optional invite URL the reseller sends
  // to their customer's IT contact so the customer can log into /customer.
  const [createdCustomer, setCreatedCustomer] = useState<{ name: string; code: string } | null>(null);

  if (tenantLoading) {
    return (
      <MainLayout>
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      </MainLayout>
    );
  }

  if (!isPartnerAdmin && !isSuperAdmin) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <ShieldAlert className="h-16 w-16 text-destructive mb-4" />
          <h1 className="text-2xl font-bold">Partner access required</h1>
          <p className="text-muted-foreground mt-2">This page is for MSP partners managing their customer organisations.</p>
          <Button className="mt-6" onClick={() => navigate("/dashboard")}>Back to dashboard</Button>
        </div>
      </MainLayout>
    );
  }

  if (!partnerOrgId && !isSuperAdmin) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Building2 className="h-16 w-16 text-muted-foreground mb-4" />
          <h1 className="text-2xl font-bold">No partner organisation</h1>
          <p className="text-muted-foreground mt-2">Your account is a partner admin but isn't linked to a partner org. Ask Mithras support to fix this.</p>
        </div>
      </MainLayout>
    );
  }

  const handleCreate = async () => {
    if (!partnerOrgId || !newName.trim() || !newSlug.trim()) {
      toast({ title: "Name and slug required", variant: "destructive" });
      return;
    }
    // Channel-credit gate: creating a customer org is free, but the user
    // should understand the pool implication before they start enrolling
    // endpoints. If they're already overdrawn, warn loudly — first endpoint
    // will fail to enrol later.
    if ((creditBalance ?? 0) <= 0) {
      toast({
        title: "You have no credits",
        description: "You can create the customer org, but endpoints won't enrol until your distributor cuts you more credits.",
        variant: "destructive",
      });
    }
    try {
      const created = await createCustomer.mutateAsync({
        name: newName.trim(),
        slug: newSlug.trim().toLowerCase().replace(/\s+/g, "-"),
        partnerId: partnerOrgId,
      });
      // Optional: generate a single-use admin code so the reseller can hand
      // the customer's IT contact a /signup URL. If code generation fails
      // (e.g. RLS edge case), still report success on the org itself.
      let code: string | null = null;
      let codeErrMessage: string | null = null;
      try {
        const c = await createCode.mutateAsync({
          organizationId: (created as any).id,
          role: "admin",
          isSingleUse: true,
        });
        code = c.code;
      } catch (codeErr) {
        // Non-fatal but the partner needs to know — they can't share a
        // signup URL with the customer until they regenerate the code
        // from the Pending invites card.
        codeErrMessage = codeErr instanceof Error ? codeErr.message : "Unknown error";
        console.warn("Customer created but enrolment code generation failed", codeErr);
      }
      setCreateOpen(false);
      setNewName(""); setNewSlug("");
      if (code) {
        setCreatedCustomer({ name: (created as any).name, code });
        toast({ title: "Customer created", description: "Invite URL ready below." });
      } else {
        toast({
          title: "Customer created — but invite URL failed",
          description: `The customer org is saved, but we couldn't generate their signup link (${codeErrMessage}). Use the "Regenerate" button on the Pending invites card to issue one.`,
          variant: "destructive",
        });
      }
    } catch (e) {
      toast({ title: "Failed to create", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
    }
  };

  const handleRename = async (id: string) => {
    if (!renameValue.trim()) return;
    try {
      await renameOrg.mutateAsync({ id, name: renameValue.trim() });
      toast({ title: "Renamed" });
      setRenamingId(null);
    } catch (e) {
      toast({ title: "Failed to rename", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteOrg.mutateAsync(deleteTarget.id);
      toast({ title: `${deleteTarget.name} deleted` });
      setDeleteTarget(null);
    } catch (e) {
      toast({ title: "Failed to delete", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
    }
  };

  const handleViewAs = (c: { id: string; name: string; slug: string; organization_type: string; parent_partner_id: string | null }) => {
    setImpersonatedOrg({
      id: c.id, name: c.name, slug: c.slug,
      organization_type: c.organization_type,
      parent_partner_id: c.parent_partner_id,
      network_module_enabled: false, router_module_enabled: false, legacy_hardening_enabled: false,
    });
    navigate("/dashboard");
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <Building2 className="h-6 w-6 text-primary" /> My customers
            </h1>
            <p className="text-sm text-muted-foreground">Create and manage the customer organisations under your partner account.</p>
          </div>
          <Dialog
            open={createOpen}
            onOpenChange={(o) => {
              setCreateOpen(o);
              if (!o) { setNewName(""); setNewSlug(""); }
            }}
          >
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />Add customer</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create customer</DialogTitle>
                <DialogDescription>
                  This new customer organisation sits under your partner account. After creating you'll get an optional one-time URL
                  you can send to the customer's IT contact — they sign up using it and become admin of their own /customer portal.
                </DialogDescription>
              </DialogHeader>
              {(creditBalance ?? 0) <= 0 && (
                <Alert variant="destructive" className="mt-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>You have no credits</AlertTitle>
                  <AlertDescription>
                    You can still create the customer organisation, but their endpoints won't enrol until your distributor cuts more credits to you.
                    <Link to="/partner/credits" className="underline ml-1">Request a top-up →</Link>
                  </AlertDescription>
                </Alert>
              )}
              <div className="space-y-4 py-2">
                <div className="grid gap-2">
                  <Label htmlFor="cust-name">Customer name</Label>
                  <Input id="cust-name" value={newName} placeholder="Acme Engineering" onChange={(e) => {
                    setNewName(e.target.value);
                    setNewSlug(e.target.value.toLowerCase().replace(/\s+/g, "-"));
                  }} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="cust-slug">Slug</Label>
                  <Input id="cust-slug" value={newSlug} placeholder="acme-engineering" onChange={(e) => setNewSlug(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button onClick={handleCreate} disabled={createCustomer.isPending}>
                  {createCustomer.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <PendingInvitesCard invites={pendingInvites ?? []} childLabel="customer" childLabelPlural="customers" />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Customers ({customers?.length ?? 0})</CardTitle>
            <CardDescription>Switch into any customer to view their endpoints, threats, and policies.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : (customers?.length ?? 0) === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Building2 className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p>No customers yet — click "Add customer" to get started.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Endpoints</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="w-[260px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers?.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        {renamingId === c.id ? (
                          <div className="flex items-center gap-1">
                            <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} className="h-8 w-48" autoFocus
                              onKeyDown={(e) => e.key === "Enter" && handleRename(c.id)} />
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => handleRename(c.id)} disabled={renameOrg.isPending}>
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setRenamingId(null)}>
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <div className="font-medium">{c.name}</div>
                              <div className="text-xs text-muted-foreground">{c.slug}</div>
                            </div>
                          </div>
                        )}
                      </TableCell>
                      <TableCell><Badge variant="secondary">{c.endpoint_count ?? 0}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{format(new Date(c.created_at), "d MMM yyyy")}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="Rename"
                            onClick={() => { setRenamingId(c.id); setRenameValue(c.name); }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" title="Delete"
                            onClick={() => setDeleteTarget({ id: c.id, name: c.name })}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => handleViewAs(c)}>
                            Open <ChevronRight className="h-3.5 w-3.5 ml-1" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes the customer and all their endpoints, threats, policies, and reports. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Post-create invite-URL dialog. Mirror of the disty→partner flow:
            single-use admin code attached to the new customer org, served
            via /signup?code=… so the customer's IT contact can claim the
            admin seat themselves. Optional — the reseller can ignore the
            URL if the customer just wants the reseller to manage on their
            behalf. */}
        {createdCustomer && (() => {
          const url = `${window.location.origin}/signup?code=${encodeURIComponent(createdCustomer.code)}`;
          return (
            <Dialog open={!!createdCustomer} onOpenChange={(o) => !o && setCreatedCustomer(null)}>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <KeyRound className="h-5 w-5 text-primary" />
                    Invite URL for {createdCustomer.name}
                  </DialogTitle>
                  <DialogDescription>
                    Send this link to your customer's IT contact if they want to log in and see their own security posture at /customer.
                    Optional — you can ignore it if you'll be managing everything on their behalf. Single-use.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-2">
                  <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Signup URL</Label>
                    <div className="flex items-center gap-2">
                      <Input value={url} readOnly className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                      <Button size="icon" variant="outline" onClick={async () => {
                        try { await navigator.clipboard.writeText(url); toast({ title: "URL copied" }); }
                        catch { toast({ title: "Couldn't copy", description: "Select the field and copy manually.", variant: "destructive" }); }
                      }} title="Copy URL">
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Or the code on its own</Label>
                    <div className="flex items-center gap-2">
                      <Input value={createdCustomer.code} readOnly className="font-mono text-base tracking-widest" onFocus={(e) => e.currentTarget.select()} />
                      <Button size="icon" variant="outline" onClick={async () => {
                        try { await navigator.clipboard.writeText(createdCustomer.code); toast({ title: "Code copied" }); }
                        catch { toast({ title: "Couldn't copy", variant: "destructive" }); }
                      }} title="Copy code">
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={() => setCreatedCustomer(null)}>Done</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          );
        })()}
      </div>
    </MainLayout>
  );
};

export default MyCustomers;
