import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Edit, Trash2, RefreshCw, Settings } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  useWindowsUpdatePolicies,
  useDeleteWindowsUpdatePolicy,
  AUTO_UPDATE_MODES,
  WindowsUpdatePolicy,
} from "@/hooks/useWindowsUpdatePolicies";
import { WindowsUpdatePolicyDialog } from "./WindowsUpdatePolicyDialog";

export function WindowsUpdatePoliciesManager() {
  const { data: policies, isLoading, refetch } = useWindowsUpdatePolicies();
  const deletePolicy = useDeleteWindowsUpdatePolicy();
  
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<WindowsUpdatePolicy | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [policyToDelete, setPolicyToDelete] = useState<WindowsUpdatePolicy | null>(null);

  const handleCreate = () => {
    setEditingPolicy(null);
    setDialogOpen(true);
  };

  const handleEdit = (policy: WindowsUpdatePolicy) => {
    setEditingPolicy(policy);
    setDialogOpen(true);
  };

  const handleDeleteClick = (policy: WindowsUpdatePolicy) => {
    setPolicyToDelete(policy);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (policyToDelete) {
      await deletePolicy.mutateAsync({ id: policyToDelete.id, name: policyToDelete.name });
      setDeleteDialogOpen(false);
      setPolicyToDelete(null);
    }
  };

  const formatActiveHours = (start: number, end: number) => {
    const formatHour = (h: number) => `${h.toString().padStart(2, '0')}:00`;
    return `${formatHour(start)} - ${formatHour(end)}`;
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Windows Update Policies
              </CardTitle>
              <CardDescription>
                Define update configurations to apply to your endpoints
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="icon" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button onClick={handleCreate}>
                <Plus className="h-4 w-4 mr-2" />
                Create Policy
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : !policies?.length ? (
            <div className="text-center py-8 text-muted-foreground">
              <Settings className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No Windows Update policies created yet</p>
              <p className="text-sm">Create a policy to manage update settings on your endpoints</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Auto Update Mode</TableHead>
                  <TableHead>Active Hours</TableHead>
                  <TableHead>Deferrals</TableHead>
                  <TableHead>Paused</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {policies.map((policy) => (
                  <TableRow key={policy.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{policy.name}</p>
                        {policy.description && (
                          <p className="text-sm text-muted-foreground">{policy.description}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {AUTO_UPDATE_MODES[policy.auto_update_mode]?.label || `Mode ${policy.auto_update_mode}`}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatActiveHours(policy.active_hours_start, policy.active_hours_end)}
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="space-y-1">
                        <div>Feature: {policy.feature_update_deferral} days</div>
                        <div>Quality: {policy.quality_update_deferral} days</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {policy.pause_feature_updates && (
                          <Badge variant="secondary" className="text-xs">Feature</Badge>
                        )}
                        {policy.pause_quality_updates && (
                          <Badge variant="secondary" className="text-xs">Quality</Badge>
                        )}
                        {!policy.pause_feature_updates && !policy.pause_quality_updates && (
                          <span className="text-muted-foreground text-sm">None</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(policy)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteClick(policy)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
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

      <WindowsUpdatePolicyDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        policy={editingPolicy}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Policy</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{policyToDelete?.name}"? This will unassign the policy from any endpoints.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
