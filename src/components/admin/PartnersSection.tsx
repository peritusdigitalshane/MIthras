import { useState } from "react";
import { format } from "date-fns";
import { usePartnersWithStats, useCreatePartner, usePartnerCustomers, useCreatePartnerCustomer, useRenameOrganization, useDeleteOrganization } from "@/hooks/usePartners";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Building2, Users, ChevronRight, Loader2, Pencil, Trash2, Check, X, Brain, Copy, KeyRound, Briefcase, Warehouse } from "lucide-react";
import { toast } from "sonner";
import { useTenant } from "@/contexts/TenantContext";
import { AiSocOrgDialog, type AiSocOrgDialogTarget } from "@/components/admin/AiSocOrgDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateEnrollmentCode } from "@/hooks/useEnrollmentCodes";
import type { ChannelOrgType } from "@/hooks/usePartners";

export function PartnersSection() {
  const { data: partners, isLoading } = usePartnersWithStats();
  const createPartner = useCreatePartner();
  const createCode = useCreateEnrollmentCode();
  const { setImpersonatedOrg } = useTenant();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newPartnerName, setNewPartnerName] = useState("");
  const [newPartnerSlug, setNewPartnerSlug] = useState("");
  const [newPartnerType, setNewPartnerType] = useState<ChannelOrgType>("partner");
  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(null);

  // After-create dialog: shows the signup URL Shane sends to the new contact.
  const [createdOrg, setCreatedOrg] = useState<{ id: string; name: string; type: ChannelOrgType; code: string } | null>(null);

  const handleCreatePartner = async () => {
    if (!newPartnerName.trim() || !newPartnerSlug.trim()) {
      toast.error("Please fill in all fields");
      return;
    }

    try {
      const created = await createPartner.mutateAsync({
        name: newPartnerName.trim(),
        slug: newPartnerSlug.trim().toLowerCase().replace(/\s+/g, "-"),
        orgType: newPartnerType,
      });

      // Immediately generate a single-use admin enrolment code so Shane
      // can hand the URL to the new contact. Single-use because the FIRST
      // person to claim it becomes admin; once they're in they invite
      // their team via Users → Invite.
      const code = await createCode.mutateAsync({
        organizationId: (created as any).id,
        role: "admin",
        isSingleUse: true,
      });

      toast.success(`${newPartnerType === "distributor" ? "Distributor" : "Partner"} created — enrolment URL ready`);
      setIsCreateOpen(false);
      setNewPartnerName("");
      setNewPartnerSlug("");
      setNewPartnerType("partner");
      setCreatedOrg({ id: (created as any).id, name: (created as any).name, type: newPartnerType, code: code.code });
    } catch (error: any) {
      toast.error(error.message || "Failed to create");
    }
  };

  const handleViewAsPartner = (partner: any) => {
    setImpersonatedOrg({
      id: partner.id,
      name: partner.name,
      slug: partner.slug,
      organization_type: partner.organization_type,
      parent_partner_id: null,
      network_module_enabled: partner.network_module_enabled ?? false,
      router_module_enabled: partner.router_module_enabled ?? false,
      legacy_hardening_enabled: partner.legacy_hardening_enabled ?? false,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Channel partners</h3>
          <p className="text-sm text-muted-foreground">
            Resellers sell direct to end customers. Distributors recruit resellers underneath them.
          </p>
        </div>
        <Dialog
          open={isCreateOpen}
          onOpenChange={(o) => {
            setIsCreateOpen(o);
            if (!o) {
              setNewPartnerName("");
              setNewPartnerSlug("");
              setNewPartnerType("partner");
            }
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add channel partner
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create channel partner</DialogTitle>
              <DialogDescription>
                Add a new reseller or distributor organisation. After it's created you'll get a
                one-time enrolment URL to send the contact — they sign up using that link and become admin of the org.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="org-type">Type</Label>
                <Select value={newPartnerType} onValueChange={(v) => setNewPartnerType(v as ChannelOrgType)}>
                  <SelectTrigger id="org-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="partner">
                      <div className="flex items-center gap-2">
                        <Briefcase className="h-4 w-4" />
                        <span>Reseller</span>
                        <span className="text-xs text-muted-foreground">— sells direct to end customers</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="distributor">
                      <div className="flex items-center gap-2">
                        <Warehouse className="h-4 w-4" />
                        <span>Distributor</span>
                        <span className="text-xs text-muted-foreground">— signs up resellers under them</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="name">Company name</Label>
                <Input
                  id="name"
                  value={newPartnerName}
                  onChange={(e) => {
                    setNewPartnerName(e.target.value);
                    setNewPartnerSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""));
                  }}
                  placeholder={newPartnerType === "distributor" ? "Acme Distribution Pty Ltd" : "Acme IT Services"}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="slug">Slug</Label>
                <Input
                  id="slug"
                  value={newPartnerSlug}
                  onChange={(e) => setNewPartnerSlug(e.target.value)}
                  placeholder={newPartnerType === "distributor" ? "acme-distribution" : "acme-it-services"}
                />
                <p className="text-xs text-muted-foreground">URL-safe identifier. Lowercase, hyphens only.</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreatePartner} disabled={createPartner.isPending || createCode.isPending}>
                {(createPartner.isPending || createCode.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create + generate enrolment URL
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Organisation</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Customers</TableHead>
              <TableHead>Members</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-[150px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {partners?.map((partner) => (
              <TableRow key={partner.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                      {partner.organization_type === "distributor"
                        ? <Warehouse className="h-4 w-4 text-primary" />
                        : <Briefcase className="h-4 w-4 text-primary" />}
                    </div>
                    <div>
                      <div className="font-medium">{partner.name}</div>
                      <div className="text-sm text-muted-foreground">{partner.slug}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={partner.organization_type === "distributor" ? "default" : "secondary"}>
                    {partner.organization_type === "distributor" ? "Distributor" : "Reseller"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{partner.customer_count}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{partner.member_count}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {format(new Date(partner.created_at), "d MMM yyyy")}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedPartnerId(partner.id)}
                    >
                      <Users className="h-4 w-4 mr-1" />
                      Customers
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleViewAsPartner(partner)}
                    >
                      View as
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {partners?.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No channel partners yet. Add your first reseller or distributor to get started.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <PartnerCustomersSheet
        partnerId={selectedPartnerId}
        partnerName={partners?.find(p => p.id === selectedPartnerId)?.name}
        onClose={() => setSelectedPartnerId(null)}
      />

      <EnrollmentUrlDialog
        target={createdOrg}
        onClose={() => setCreatedOrg(null)}
      />
    </div>
  );
}

// Post-create dialog: shows the one-time signup URL Shane sends to the new
// distributor/reseller contact. They click it, fill in their details, and
// become admin of the org they were enrolled into.
function EnrollmentUrlDialog({
  target,
  onClose,
}: {
  target: { id: string; name: string; type: ChannelOrgType; code: string } | null;
  onClose: () => void;
}) {
  if (!target) return null;
  const url = `${window.location.origin}/signup?code=${encodeURIComponent(target.code)}`;
  const typeLabel = target.type === "distributor" ? "distributor" : "reseller";
  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            Enrolment URL for {target.name}
          </DialogTitle>
          <DialogDescription>
            Send this link to your new {typeLabel} contact. The first person to use it becomes admin of the
            organisation — they can then invite their own team from inside the portal. The link is single-use.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Signup URL</Label>
            <div className="flex items-center gap-2">
              <Input value={url} readOnly className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button
                size="icon"
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(url);
                    toast.success("URL copied to clipboard");
                  } catch {
                    toast.error("Couldn't copy — select the text and copy manually");
                  }
                }}
                title="Copy URL"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Or the code on its own</Label>
            <div className="flex items-center gap-2">
              <Input value={target.code} readOnly className="font-mono text-base tracking-widest" onFocus={(e) => e.currentTarget.select()} />
              <Button
                size="icon"
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(target.code);
                    toast.success("Code copied");
                  } catch {
                    toast.error("Couldn't copy — select and copy manually");
                  }
                }}
                title="Copy code"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              They can also enter this on the signup page if they prefer to navigate there manually.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PartnerCustomersSheet({ 
  partnerId, 
  partnerName, 
  onClose 
}: { 
  partnerId: string | null; 
  partnerName?: string;
  onClose: () => void;
}) {
  const { data: customers, isLoading } = usePartnerCustomers(partnerId);
  const createCustomer = useCreatePartnerCustomer();
  const renameOrg = useRenameOrganization();
  const deleteOrg = useDeleteOrganization();
  const { setImpersonatedOrg } = useTenant();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerSlug, setNewCustomerSlug] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [aiSocTarget, setAiSocTarget] = useState<AiSocOrgDialogTarget | null>(null);

  const handleRename = async (id: string) => {
    if (!renameValue.trim()) return;
    try {
      await renameOrg.mutateAsync({ id, name: renameValue.trim() });
      toast.success("Customer renamed");
      setRenamingId(null);
    } catch (e: any) {
      toast.error(e.message || "Failed to rename");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteOrg.mutateAsync(deleteTarget.id);
      toast.success(`${deleteTarget.name} deleted`);
      setDeleteTarget(null);
    } catch (e: any) {
      toast.error(e.message || "Failed to delete");
    }
  };

  const handleCreateCustomer = async () => {
    if (!partnerId || !newCustomerName.trim() || !newCustomerSlug.trim()) {
      toast.error("Please fill in all fields");
      return;
    }

    try {
      await createCustomer.mutateAsync({
        name: newCustomerName.trim(),
        slug: newCustomerSlug.trim().toLowerCase().replace(/\s+/g, "-"),
        partnerId,
      });
      toast.success("Customer created successfully");
      setIsCreateOpen(false);
      setNewCustomerName("");
      setNewCustomerSlug("");
    } catch (error: any) {
      toast.error(error.message || "Failed to create customer");
    }
  };

  const handleViewAsCustomer = (customer: any) => {
    setImpersonatedOrg({
      id: customer.id,
      name: customer.name,
      slug: customer.slug,
      organization_type: customer.organization_type,
      parent_partner_id: customer.parent_partner_id,
      network_module_enabled: customer.network_module_enabled ?? false,
      router_module_enabled: customer.router_module_enabled ?? false,
      legacy_hardening_enabled: customer.legacy_hardening_enabled ?? false,
    });
    onClose();
  };

  return (
    <Sheet open={!!partnerId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{partnerName} - Customers</SheetTitle>
          <SheetDescription>
            Manage customers for this partner organization
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <div className="flex justify-end">
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Customer
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Customer</DialogTitle>
                  <DialogDescription>
                    Add a new customer organization under {partnerName}
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="customer-name">Customer Name</Label>
                    <Input
                      id="customer-name"
                      value={newCustomerName}
                      onChange={(e) => {
                        setNewCustomerName(e.target.value);
                        setNewCustomerSlug(e.target.value.toLowerCase().replace(/\s+/g, "-"));
                      }}
                      placeholder="Customer Corp"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="customer-slug">Slug</Label>
                    <Input
                      id="customer-slug"
                      value={newCustomerSlug}
                      onChange={(e) => setNewCustomerSlug(e.target.value)}
                      placeholder="customer-corp"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreateCustomer} disabled={createCustomer.isPending}>
                    {createCustomer.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Create Customer
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : customers?.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No customers yet. Create your first customer.
            </div>
          ) : (
            <div className="space-y-2">
              {customers?.map((customer) => (
                <Card key={customer.id} className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded bg-secondary">
                        <Building2 className="h-4 w-4" />
                      </div>
                      {renamingId === customer.id ? (
                        <div className="flex items-center gap-1">
                          <Input
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            className="h-7 w-32 text-sm"
                            onKeyDown={(e) => e.key === "Enter" && handleRename(customer.id)}
                            autoFocus
                          />
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleRename(customer.id)} disabled={renameOrg.isPending}>
                            <Check className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setRenamingId(null)}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <div>
                          <div className="font-medium">{customer.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {customer.endpoint_count || 0} endpoints
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-[10px]"
                        onClick={() =>
                          setAiSocTarget({
                            id: customer.id,
                            name: customer.name,
                            ai_triage_enabled: !!customer.ai_triage_enabled,
                            ai_investigation_enabled: !!customer.ai_investigation_enabled,
                            ai_email_remediation_enabled: !!customer.ai_email_remediation_enabled,
                            ai_endpoint_remediation_enabled: !!customer.ai_endpoint_remediation_enabled,
                            ai_soc_daily_cap_cents: customer.ai_soc_daily_cap_cents ?? 500,
                          })
                        }
                        title="AI SOC settings"
                      >
                        <Brain className={`h-3 w-3 ${(customer.ai_triage_enabled || customer.ai_investigation_enabled || customer.ai_email_remediation_enabled || customer.ai_endpoint_remediation_enabled) ? "text-primary" : ""}`} />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setRenamingId(customer.id); setRenameValue(customer.name); }}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => setDeleteTarget({ id: customer.id, name: customer.name })}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleViewAsCustomer(customer)}>
                        View as
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete this customer and all associated data. This cannot be undone.
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

        <AiSocOrgDialog target={aiSocTarget} onClose={() => setAiSocTarget(null)} />
      </SheetContent>
    </Sheet>
  );
}