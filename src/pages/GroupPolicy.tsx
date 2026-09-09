import { useState } from "react";
import { Plus, Shield, Search } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GpoPolicyCard } from "@/components/gpo/GpoPolicyCard";
import { GpoPolicyEditor } from "@/components/gpo/GpoPolicyEditor";
import { useGpoPolicies, useCreateGpoPolicy, useUpdateGpoPolicy, useDeleteGpoPolicy } from "@/hooks/useGpoPolicies";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import type { GpoPolicy } from "@/lib/gpo-settings";
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

const GroupPolicy = () => {
  const { currentOrganization } = useTenant();
  const { user } = useAuth();
  const { data: policies, isLoading } = useGpoPolicies();
  const createPolicy = useCreateGpoPolicy();
  const updatePolicy = useUpdateGpoPolicy();
  const deletePolicy = useDeleteGpoPolicy();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<GpoPolicy | undefined>();
  const [deletingPolicy, setDeletingPolicy] = useState<GpoPolicy | null>(null);
  const [search, setSearch] = useState("");

  const filteredPolicies = (policies || []).filter(
    (p) => p.name.toLowerCase().includes(search.toLowerCase()) || (p.description || "").toLowerCase().includes(search.toLowerCase())
  );

  const handleSave = async (data: Partial<GpoPolicy>) => {
    try {
      if (editingPolicy) {
        await updatePolicy.mutateAsync({ id: editingPolicy.id, patch: data });
        toast({ title: "Policy updated" });
      } else {
        await createPolicy.mutateAsync({
          orgId: currentOrganization!.id,
          userId: user!.id,
          policy: data,
        });
        toast({ title: "Policy created" });
      }
      setEditorOpen(false);
      setEditingPolicy(undefined);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleEdit = (policy: GpoPolicy) => {
    setEditingPolicy(policy);
    setEditorOpen(true);
  };

  const handleDuplicate = (policy: GpoPolicy) => {
    const { id, created_at, updated_at, created_by, ...rest } = policy;
    setEditingPolicy(undefined);
    setEditorOpen(true);
    // Pre-fill with duplicated data after editor opens
    setTimeout(() => {
      const editor = document.getElementById("name") as HTMLInputElement;
      if (editor) editor.value = `${policy.name} (Copy)`;
    }, 100);
  };

  const handleDelete = async () => {
    if (!deletingPolicy) return;
    try {
      await deletePolicy.mutateAsync({ id: deletingPolicy.id, name: deletingPolicy.name });
      toast({ title: "Policy deleted" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
    setDeletingPolicy(null);
  };

  return (
    <MainLayout>
      <div className="animate-fade-in space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Group Policy</h1>
            <p className="text-sm text-muted-foreground">
              Manage Windows Group Policy settings and push them to enrolled endpoints via groups
            </p>
          </div>
          <Button onClick={() => { setEditingPolicy(undefined); setEditorOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            Create Policy
          </Button>
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search policies..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">Total Policies</p>
            <p className="text-2xl font-bold text-foreground">{policies?.length || 0}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">With Complexity Enforced</p>
            <p className="text-2xl font-bold text-foreground">{policies?.filter((p) => p.password_complexity_enabled).length || 0}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">With Restrictions Active</p>
            <p className="text-2xl font-bold text-foreground">
              {policies?.filter((p) => p.disable_registry_tools || p.disable_task_manager || p.disable_cmd_prompt).length || 0}
            </p>
          </div>
        </div>

        {/* Policy Cards */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2].map((i) => (
              <div key={i} className="h-48 rounded-lg border border-border bg-card animate-pulse" />
            ))}
          </div>
        ) : filteredPolicies.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-border rounded-lg">
            <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
            <h3 className="text-lg font-semibold text-foreground">No GPO Policies</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Create a Group Policy to manage Windows settings across your endpoints
            </p>
            <Button className="mt-4" onClick={() => { setEditingPolicy(undefined); setEditorOpen(true); }}>
              <Plus className="h-4 w-4 mr-2" />
              Create First Policy
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredPolicies.map((policy) => (
              <GpoPolicyCard
                key={policy.id}
                policy={policy}
                onEdit={handleEdit}
                onDelete={setDeletingPolicy}
                onDuplicate={handleDuplicate}
              />
            ))}
          </div>
        )}
      </div>

      {/* Editor */}
      {editorOpen && (
        <GpoPolicyEditor
          policy={editingPolicy}
          onSave={handleSave}
          onClose={() => { setEditorOpen(false); setEditingPolicy(undefined); }}
        />
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={!!deletingPolicy} onOpenChange={() => setDeletingPolicy(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete GPO Policy</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingPolicy?.name}"? This will remove the policy from any assigned groups.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
};

export default GroupPolicy;
