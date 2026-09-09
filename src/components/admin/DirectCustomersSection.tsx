import { useState } from "react";
import { format } from "date-fns";
import { useDirectCustomers, usePartners, useAssignCustomerToPartner, useRenameOrganization, useDeleteOrganization } from "@/hooks/usePartners";
import { useUpdateOrganizationNetworkModule, useUpdateOrganizationRouterModule, useUpdateOrganizationLegacyHardening } from "@/hooks/useSuperAdmin";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Building2, Monitor, ChevronRight, Loader2, Network, Router, Pencil, Trash2, Check, X, ShieldAlert, Brain, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { useTenant } from "@/contexts/TenantContext";
import { AiSocOrgDialog, type AiSocOrgDialogTarget } from "@/components/admin/AiSocOrgDialog";
import { PlanQuotaDialog, type PlanQuotaDialogTarget } from "@/components/admin/PlanQuotaDialog";

// Compact label for the per-customer AI SOC button. Triage and
// investigation are independent flags so the button surfaces which is on
// without needing to open the dialog.
function aiSocLabel(c: { ai_triage_enabled?: boolean; ai_investigation_enabled?: boolean }): string {
    const t = !!c.ai_triage_enabled;
    const i = !!c.ai_investigation_enabled;
    if (t && i) return "Triage + Investigate";
    if (t) return "Triage only";
    if (i) return "Investigate (no triage)";
    return "Off";
}

// Compact plan summary for the customer-row button. Shows the override
// when set, otherwise the plan's default name. Partner-child customers
// inherit unlimited from their MSP so the button reflects that.
function planLabel(c: {
    subscription_plan?: "free" | "pro" | "business" | string;
    device_quota_override?: number | null;
    parent_partner_id?: string | null;
}): string {
    if (c.parent_partner_id) return "via partner";
    if (c.device_quota_override !== null && c.device_quota_override !== undefined) {
        return `cap ${c.device_quota_override}`;
    }
    switch (c.subscription_plan) {
        case "business": return "Business · ∞";
        case "pro":      return "Pro · 25";
        case "free":     return "Free · 1";
        default:         return c.subscription_plan ?? "—";
    }
}

export function DirectCustomersSection() {
  const updateNetworkModule = useUpdateOrganizationNetworkModule();
  const updateRouterModule = useUpdateOrganizationRouterModule();
  const updateLegacyHardening = useUpdateOrganizationLegacyHardening();
  const { data: customers, isLoading } = useDirectCustomers();
  const { data: partners } = usePartners();
  const assignToPartner = useAssignCustomerToPartner();
  const renameOrg = useRenameOrganization();
  const deleteOrg = useDeleteOrganization();
  const { setImpersonatedOrg } = useTenant();

  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [aiSocTarget, setAiSocTarget] = useState<AiSocOrgDialogTarget | null>(null);
  const [planTarget, setPlanTarget] = useState<PlanQuotaDialogTarget | null>(null);

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

  const handleAssign = async (customerId: string, partnerId: string) => {
    try {
      await assignToPartner.mutateAsync({ customerId, partnerId });
      toast.success("Customer assigned to partner");
      setAssigningId(null);
    } catch (error: any) {
      toast.error(error.message || "Failed to assign customer");
    }
  };

  const handleViewAs = (customer: any) => {
    setImpersonatedOrg({
      id: customer.id,
      name: customer.name,
      slug: customer.slug,
      organization_type: customer.organization_type,
      parent_partner_id: null,
      network_module_enabled: customer.network_module_enabled ?? false,
      router_module_enabled: customer.router_module_enabled ?? false,
      legacy_hardening_enabled: customer.legacy_hardening_enabled ?? false,
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
      <div>
        <h3 className="text-lg font-semibold">Direct Customers</h3>
        <p className="text-sm text-muted-foreground">
          Individual signups not assigned to any partner
        </p>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Endpoints</TableHead>
              <TableHead className="text-center">Plan</TableHead>
              <TableHead className="text-center">Network</TableHead>
              <TableHead className="text-center">Routers</TableHead>
              <TableHead className="text-center">Hardening</TableHead>
              <TableHead className="text-center">AI SOC</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Assign to Partner</TableHead>
              <TableHead className="w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers?.map((customer) => (
              <TableRow key={customer.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary">
                      <Building2 className="h-4 w-4" />
                    </div>
                    {renamingId === customer.id ? (
                      <div className="flex items-center gap-1">
                        <Input
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          className="h-8 w-40"
                          onKeyDown={(e) => e.key === "Enter" && handleRename(customer.id)}
                          autoFocus
                        />
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => handleRename(customer.id)} disabled={renameOrg.isPending}>
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setRenamingId(null)}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <div>
                        <div className="font-medium">{customer.name}</div>
                        <div className="text-sm text-muted-foreground">{customer.slug}</div>
                      </div>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Monitor className="h-4 w-4 text-muted-foreground" />
                    <span>{customer.endpoint_count || 0}</span>
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() =>
                      setPlanTarget({
                        id: customer.id,
                        name: customer.name,
                        subscription_plan: (customer.subscription_plan ?? "free") as "free" | "pro" | "business",
                        device_quota_override: customer.device_quota_override ?? null,
                        is_partner_child: !!customer.parent_partner_id,
                      })
                    }
                    title="Subscription plan + device quota"
                  >
                    <CreditCard className="h-3 w-3 mr-1" />
                    {planLabel(customer)}
                  </Button>
                </TableCell>
                <TableCell className="text-center">
                  <Button
                    variant={customer.network_module_enabled ? "default" : "outline"}
                    size="sm"
                    className="text-xs"
                    onClick={() => {
                      updateNetworkModule.mutate(
                        { id: customer.id, networkModuleEnabled: !customer.network_module_enabled },
                        {
                          onSuccess: () => {
                            toast.success(
                              customer.network_module_enabled 
                                ? `Network module disabled for ${customer.name}` 
                                : `Network module enabled for ${customer.name}`
                            );
                          },
                        }
                      );
                    }}
                    disabled={updateNetworkModule.isPending}
                  >
                    <Network className="h-3 w-3 mr-1" />
                    {customer.network_module_enabled ? "Enabled" : "Disabled"}
                  </Button>
                </TableCell>
                <TableCell className="text-center">
                  <Button
                    variant={customer.router_module_enabled ? "default" : "outline"}
                    size="sm"
                    className="text-xs"
                    onClick={() => {
                      updateRouterModule.mutate(
                        { id: customer.id, routerModuleEnabled: !customer.router_module_enabled },
                        {
                          onSuccess: () => {
                            toast.success(
                              customer.router_module_enabled 
                                ? `Router module disabled for ${customer.name}` 
                                : `Router module enabled for ${customer.name}`
                            );
                          },
                        }
                      );
                    }}
                    disabled={updateRouterModule.isPending}
                  >
                    <Router className="h-3 w-3 mr-1" />
                    {customer.router_module_enabled ? "Enabled" : "Disabled"}
                  </Button>
                </TableCell>
                <TableCell className="text-center">
                  <Button
                    variant={customer.legacy_hardening_enabled ? "default" : "outline"}
                    size="sm"
                    className="text-xs"
                    onClick={() => {
                      updateLegacyHardening.mutate(
                        { id: customer.id, legacyHardeningEnabled: !customer.legacy_hardening_enabled },
                        {
                          onSuccess: () => {
                            toast.success(
                              customer.legacy_hardening_enabled 
                                ? `Legacy Hardening disabled for ${customer.name}` 
                                : `Legacy Hardening enabled for ${customer.name}`
                            );
                          },
                        }
                      );
                    }}
                    disabled={updateLegacyHardening.isPending}
                  >
                    <ShieldAlert className="h-3 w-3 mr-1" />
                    {customer.legacy_hardening_enabled ? "Enabled" : "Disabled"}
                  </Button>
                </TableCell>
                <TableCell className="text-center">
                  <Button
                    variant={(customer.ai_triage_enabled || customer.ai_investigation_enabled || customer.ai_email_remediation_enabled || customer.ai_endpoint_remediation_enabled) ? "default" : "outline"}
                    size="sm"
                    className="text-xs"
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
                  >
                    <Brain className="h-3 w-3 mr-1" />
                    {aiSocLabel(customer)}
                  </Button>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {format(new Date(customer.created_at), "d MMM yyyy")}
                </TableCell>
                <TableCell>
                  {assigningId === customer.id ? (
                    <div className="flex items-center gap-2">
                      <Select onValueChange={(value) => handleAssign(customer.id, value)}>
                        <SelectTrigger className="w-[180px]">
                          <SelectValue placeholder="Select partner" />
                        </SelectTrigger>
                        <SelectContent>
                          {partners?.map((partner) => (
                            <SelectItem key={partner.id} value={partner.id}>
                              {partner.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setAssigningId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAssigningId(customer.id)}
                      disabled={!partners?.length}
                    >
                      Assign
                    </Button>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => { setRenamingId(customer.id); setRenameValue(customer.name); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget({ id: customer.id, name: customer.name })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleViewAs(customer)}>
                      View as
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {customers?.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                  No direct customers found. All customers are assigned to partners.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <AiSocOrgDialog target={aiSocTarget} onClose={() => setAiSocTarget(null)} />
      <PlanQuotaDialog target={planTarget} onClose={() => setPlanTarget(null)} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this customer organization and all associated data. This action cannot be undone.
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
    </div>
  );
}