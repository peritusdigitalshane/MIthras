import React, { useState } from "react";
import { format } from "date-fns";
import { MainLayout } from "@/components/layout/MainLayout";
import { useTenant } from "@/contexts/TenantContext";
import { useOrganizationsWithStats, useCreateOrganization, useUpdateOrganizationRetention, useUpdateOrganizationNetworkModule } from "@/hooks/useSuperAdmin";
import { useBootstrapCustomer, BootstrapResult } from "@/hooks/useBootstrapCustomer";
import { BootstrapResultDialog } from "@/components/admin/BootstrapResultDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
} from "@/components/ui/dialog";
import { 
  Building2, 
  Plus, 
  Users, 
  Monitor, 
  Eye, 
  Ticket,
  Loader2,
  ShieldAlert,
  CreditCard,
  ChevronDown,
  ChevronUp,
  Clock,
  Settings,
  Handshake,
  UserPlus,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { EnrollmentCodesSection } from "@/components/admin/EnrollmentCodesSection";
import { RetentionSettingsDialog } from "@/components/admin/RetentionSettingsDialog";
import { PlatformSettingsSection } from "@/components/admin/PlatformSettingsSection";
import { PartnersSection } from "@/components/admin/PartnersSection";
import { DirectCustomersSection } from "@/components/admin/DirectCustomersSection";
import { SubscriptionPlansSection } from "@/components/admin/SubscriptionPlansSection";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Organization {
  id: string;
  name: string;
  slug: string;
  organization_type: "partner" | "customer";
  parent_partner_id: string | null;
  network_module_enabled: boolean;
  router_module_enabled: boolean;
  legacy_hardening_enabled: boolean;
}

const Admin = () => {
  const { isSuperAdmin, setImpersonatedOrg, isLoading: tenantLoading } = useTenant();
  const { data: organizations = [], isLoading } = useOrganizationsWithStats();
  const createOrg = useCreateOrganization();
  const bootstrap = useBootstrapCustomer();
  const [bootstrapResult, setBootstrapResult] = useState<BootstrapResult | null>(null);
  const [bootstrapName, setBootstrapName] = useState<string>("");
  const [bootstrapOpen, setBootstrapOpen] = useState(false);
  const updateRetention = useUpdateOrganizationRetention();
  const updateNetworkModule = useUpdateOrganizationNetworkModule();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgSlug, setNewOrgSlug] = useState("");
  const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null);
  const [retentionDialogOrg, setRetentionDialogOrg] = useState<{
    id: string;
    name: string;
    retention_days: number;
  } | null>(null);

  // Generate slug from name
  const handleNameChange = (name: string) => {
    setNewOrgName(name);
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    setNewOrgSlug(slug);
  };

  const handleCreateOrg = async () => {
    if (!newOrgName.trim() || !newOrgSlug.trim()) {
      toast({
        title: "Missing fields",
        description: "Please provide both name and slug.",
        variant: "destructive",
      });
      return;
    }

    try {
      // Bootstrap: org + super-admin membership + baseline policies + default
      // group + 50-use 30-day enrolment token, all in a single RPC.
      const result = await bootstrap.mutateAsync({ name: newOrgName.trim(), slug: newOrgSlug.trim() });
      setBootstrapResult(result);
      setBootstrapName(newOrgName.trim());
      setBootstrapOpen(true);
      setCreateDialogOpen(false);
      setNewOrgName("");
      setNewOrgSlug("");
      toast({
        title: "Customer ready",
        description: `${result.slug} created with baseline policies. Install command available now.`,
      });
    } catch (error: any) {
      toast({
        title: "Failed to bootstrap customer",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleViewAsTenant = (org: { id: string; name: string; slug: string; organization_type?: string; parent_partner_id?: string | null; network_module_enabled?: boolean }) => {
    const fullOrg: Organization = {
      id: org.id,
      name: org.name,
      slug: org.slug,
      organization_type: (org.organization_type as "partner" | "customer") || "customer",
      parent_partner_id: org.parent_partner_id ?? null,
      network_module_enabled: org.network_module_enabled ?? false,
      router_module_enabled: (org as any).router_module_enabled ?? false,
      legacy_hardening_enabled: (org as any).legacy_hardening_enabled ?? false,
    };
    setImpersonatedOrg(fullOrg);
    toast({
      title: "Viewing as tenant",
      description: `Now viewing as ${org.name}. Use the header to switch or exit.`,
    });
    navigate("/dashboard");
  };

  const toggleExpanded = (orgId: string) => {
    setExpandedOrgId(expandedOrgId === orgId ? null : orgId);
  };

  const handleSaveRetention = async (days: number) => {
    if (!retentionDialogOrg) return;
    try {
      await updateRetention.mutateAsync({ id: retentionDialogOrg.id, retentionDays: days });
      toast({
        title: "Retention updated",
        description: `Event logs will be retained for ${days} days.`,
      });
      setRetentionDialogOrg(null);
    } catch (error: any) {
      toast({
        title: "Failed to update retention",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    }
  };

  if (tenantLoading || isLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </MainLayout>
    );
  }

  if (!isSuperAdmin) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <ShieldAlert className="h-16 w-16 text-destructive mb-4" />
          <h1 className="text-2xl font-bold">Access Denied</h1>
          <p className="text-muted-foreground mt-2">
            You do not have permission to access the admin panel.
          </p>
          <Button className="mt-6" onClick={() => navigate("/dashboard")}>
            Return to Dashboard
          </Button>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-primary text-primary">
                Super Admin
              </Badge>
            </div>
            <h1 className="text-2xl font-bold mt-2">Administration</h1>
            <p className="text-muted-foreground">
              Manage partners, customers, and platform settings
            </p>
          </div>
        </div>

        <Tabs defaultValue="partners" className="space-y-6">
          <TabsList>
            <TabsTrigger value="partners" className="gap-2">
              <Handshake className="h-4 w-4" />
              Partners
            </TabsTrigger>
            <TabsTrigger value="direct-customers" className="gap-2">
              <UserPlus className="h-4 w-4" />
              Direct Customers
            </TabsTrigger>
            <TabsTrigger value="all-orgs" className="gap-2">
              <Building2 className="h-4 w-4" />
              All Organizations
            </TabsTrigger>
            <TabsTrigger value="plans" className="gap-2">
              <CreditCard className="h-4 w-4" />
              Subscription Plans
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-2">
              <Settings className="h-4 w-4" />
              Platform Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="partners" className="space-y-6">
            <PartnersSection />
          </TabsContent>

          <TabsContent value="direct-customers" className="space-y-6">
            <DirectCustomersSection />
          </TabsContent>

          <TabsContent value="all-orgs" className="space-y-6">
            {/* Add Customer Button */}
            <div className="flex justify-end">
              <Button onClick={() => setCreateDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add Organization
              </Button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Building2 className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Organizations</p>
                    <p className="text-2xl font-bold">{organizations.length}</p>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
                    <Monitor className="h-5 w-5 text-green-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Endpoints</p>
                    <p className="text-2xl font-bold">
                      {organizations.reduce((acc, org) => acc + org.endpoint_count, 0)}
                    </p>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                    <Users className="h-5 w-5 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Users</p>
                    <p className="text-2xl font-bold">
                      {organizations.reduce((acc, org) => acc + org.member_count, 0)}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Organizations Table */}
            <div className="rounded-lg border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organization</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-center">Endpoints</TableHead>
                    <TableHead className="text-center">Users</TableHead>
                    <TableHead className="text-center">Network</TableHead>
                    <TableHead className="text-center">Log Retention</TableHead>
                    <TableHead className="text-center">Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                {organizations.map((org) => (
                  <React.Fragment key={org.id}>
                    <TableRow key={org.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                            <Building2 className="h-4 w-4 text-primary" />
                          </div>
                          <div>
                            <span className="font-medium">{org.name}</span>
                            <div className="text-xs text-muted-foreground">{org.slug}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={(org as any).organization_type === "partner" ? "default" : "secondary"}>
                          {(org as any).organization_type || "customer"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">{org.endpoint_count}</TableCell>
                      <TableCell className="text-center">{org.member_count}</TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant={org.network_module_enabled ? "default" : "outline"}
                          size="sm"
                          className="text-xs"
                          onClick={() => {
                            updateNetworkModule.mutate(
                              { id: org.id, networkModuleEnabled: !org.network_module_enabled },
                              {
                                onSuccess: () => {
                                  toast({
                                    title: org.network_module_enabled ? "Network module disabled" : "Network module enabled",
                                    description: `Network security features ${org.network_module_enabled ? "disabled" : "enabled"} for ${org.name}`,
                                  });
                                },
                              }
                            );
                          }}
                          disabled={updateNetworkModule.isPending}
                        >
                          {org.network_module_enabled ? "Enabled" : "Disabled"}
                        </Button>
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => setRetentionDialogOrg({
                            id: org.id,
                            name: org.name,
                            retention_days: org.event_log_retention_days,
                          })}
                        >
                          <Clock className="h-3 w-3 mr-1" />
                          {org.event_log_retention_days}d
                        </Button>
                      </TableCell>
                      <TableCell className="text-center text-sm text-muted-foreground">
                        {format(new Date(org.created_at), "d MMM yyyy")}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleExpanded(org.id)}
                            title="Manage enrollment codes"
                          >
                            <Ticket className="h-4 w-4 mr-1" />
                            Codes
                            {expandedOrgId === org.id ? (
                              <ChevronUp className="h-4 w-4 ml-1" />
                            ) : (
                              <ChevronDown className="h-4 w-4 ml-1" />
                            )}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleViewAsTenant(org)}
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            View as
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {expandedOrgId === org.id && (
                      <TableRow>
                        <TableCell colSpan={8} className="bg-muted/30 p-4">
                          <EnrollmentCodesSection 
                            organizationId={org.id} 
                            organizationName={org.name} 
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
                {organizations.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No organizations found. Create your first organization to get started.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="plans" className="space-y-6">
            <SubscriptionPlansSection />
          </TabsContent>

          <TabsContent value="settings" className="space-y-6">
            <PlatformSettingsSection />
          </TabsContent>
        </Tabs>

        {/* Create Organization Dialog */}
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Organization</DialogTitle>
              <DialogDescription>
                Create a new customer organization. They will be able to manage their own endpoints and policies.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="org-name">Organization Name</Label>
                <Input
                  id="org-name"
                  placeholder="Acme Corporation"
                  value={newOrgName}
                  onChange={(e) => handleNameChange(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="org-slug">Slug (URL identifier)</Label>
                <Input
                  id="org-slug"
                  placeholder="acme-corporation"
                  value={newOrgSlug}
                  onChange={(e) => setNewOrgSlug(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Used in URLs and API calls. Only lowercase letters, numbers, and hyphens.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateOrg} disabled={createOrg.isPending}>
                {createOrg.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Organization
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Retention Settings Dialog */}
        {retentionDialogOrg && (
          <RetentionSettingsDialog
            open={!!retentionDialogOrg}
            onOpenChange={(open) => !open && setRetentionDialogOrg(null)}
            organizationName={retentionDialogOrg.name}
            currentRetentionDays={retentionDialogOrg.retention_days}
            onSave={handleSaveRetention}
            isPending={updateRetention.isPending}
          />
        )}

        {/* Post-bootstrap "customer is ready" dialog with install one-liner */}
        <BootstrapResultDialog
          open={bootstrapOpen}
          onOpenChange={setBootstrapOpen}
          result={bootstrapResult}
          customerName={bootstrapName}
        />
      </div>
    </MainLayout>
  );
};

export default Admin;
