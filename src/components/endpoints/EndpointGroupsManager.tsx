import { useState } from "react";
import { 
  FolderOpen, 
  Plus, 
  MoreVertical, 
  Shield, 
  AppWindow, 
  Users, 
  Pencil, 
  Trash2,
  Loader2,
  MonitorCog,
  RefreshCw,
  Layers,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EndpointGroup,
  useEndpointGroups,
  useCreateEndpointGroup,
  useUpdateEndpointGroup,
  useDeleteEndpointGroup,
} from "@/hooks/useEndpointGroups";
import { usePolicyOptions } from "@/hooks/usePolicies";
import { useUacPolicies } from "@/hooks/useUacPolicies";
import { useWindowsUpdatePolicies } from "@/hooks/useWindowsUpdatePolicies";
import { useRuleSets, useGroupRuleSetAssignments, useRuleSetMutations } from "@/hooks/useRuleSets";
import { useGpoPolicyOptions } from "@/hooks/useGpoPolicies";
import { GroupMembersDialog } from "./GroupMembersDialog";

export function EndpointGroupsManager() {
  const { data: groups = [], isLoading } = useEndpointGroups();
  const { data: defenderPolicies = [] } = usePolicyOptions();
  const { data: uacPolicies = [] } = useUacPolicies();
  const { data: windowsUpdatePolicies = [] } = useWindowsUpdatePolicies();
  const { data: ruleSets = [] } = useRuleSets();
  const { data: gpoPolicies = [] } = useGpoPolicyOptions();
  const { assignToGroup, removeFromGroup } = useRuleSetMutations();
  const createGroup = useCreateEndpointGroup();
  const updateGroup = useUpdateEndpointGroup();
  const deleteGroup = useDeleteEndpointGroup();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [membersDialogOpen, setMembersDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<EndpointGroup | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<EndpointGroup | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    defender_policy_id: "",
    uac_policy_id: "",
    windows_update_policy_id: "",
    gpo_policy_id: "",
  });
  // Rule sets selected for assignment (used during create/edit)
  const [selectedRuleSetIds, setSelectedRuleSetIds] = useState<Set<string>>(new Set());

  // Fetch rule set assignments for the editing group
  const { data: editingGroupAssignments } = useGroupRuleSetAssignments(editingGroup?.id || null);

  const handleOpenCreate = () => {
    setEditingGroup(null);
    setFormData({
      name: "",
      description: "",
      defender_policy_id: "",
      uac_policy_id: "",
      windows_update_policy_id: "",
      gpo_policy_id: "",
    });
    setSelectedRuleSetIds(new Set());
    setDialogOpen(true);
  };

  const handleOpenEdit = (group: EndpointGroup) => {
    setEditingGroup(group);
    setFormData({
      name: group.name,
      description: group.description || "",
      defender_policy_id: group.defender_policy_id || "",
      uac_policy_id: (group as any).uac_policy_id || "",
      windows_update_policy_id: (group as any).windows_update_policy_id || "",
      gpo_policy_id: (group as any).gpo_policy_id || "",
    });
    // We'll load existing rule set assignments via the hook
    setSelectedRuleSetIds(new Set());
    setDialogOpen(true);
  };

  // Sync selected rule sets when editing group assignments load
  const syncedEditingGroupId = editingGroup?.id;
  const [lastSyncedGroupId, setLastSyncedGroupId] = useState<string | null>(null);
  if (syncedEditingGroupId && editingGroupAssignments && syncedEditingGroupId !== lastSyncedGroupId) {
    setSelectedRuleSetIds(new Set(editingGroupAssignments.map(a => a.rule_set_id)));
    setLastSyncedGroupId(syncedEditingGroupId);
  }

  const handleOpenDelete = (group: EndpointGroup) => {
    setSelectedGroup(group);
    setDeleteDialogOpen(true);
  };

  const handleOpenMembers = (group: EndpointGroup) => {
    setSelectedGroup(group);
    setMembersDialogOpen(true);
  };

  const handleSave = async () => {
    let groupId: string;
    if (editingGroup) {
      await updateGroup.mutateAsync({
        id: editingGroup.id,
        name: formData.name,
        description: formData.description || null,
        defender_policy_id: formData.defender_policy_id || null,
        wdac_policy_id: null,
        uac_policy_id: formData.uac_policy_id || null,
        windows_update_policy_id: formData.windows_update_policy_id || null,
        gpo_policy_id: formData.gpo_policy_id || null,
      } as any);
      groupId = editingGroup.id;

      // Sync rule set assignments
      const currentIds = new Set(editingGroupAssignments?.map(a => a.rule_set_id) || []);
      const toAdd = [...selectedRuleSetIds].filter(id => !currentIds.has(id));
      const toRemove = [...currentIds].filter(id => !selectedRuleSetIds.has(id));
      
      for (const ruleSetId of toAdd) {
        await assignToGroup.mutateAsync({ groupId, ruleSetId });
      }
      for (const ruleSetId of toRemove) {
        await removeFromGroup.mutateAsync({ groupId, ruleSetId });
      }
    } else {
      const result = await createGroup.mutateAsync({
        name: formData.name,
        description: formData.description || undefined,
        defender_policy_id: formData.defender_policy_id || null,
        wdac_policy_id: null,
        uac_policy_id: formData.uac_policy_id || null,
        windows_update_policy_id: formData.windows_update_policy_id || null,
        gpo_policy_id: formData.gpo_policy_id || null,
      } as any);
      groupId = result.id;

      // Assign selected rule sets
      for (const ruleSetId of selectedRuleSetIds) {
        await assignToGroup.mutateAsync({ groupId, ruleSetId });
      }
    }
    setLastSyncedGroupId(null);
    setDialogOpen(false);
  };

  const handleDelete = async () => {
    if (selectedGroup) {
      await deleteGroup.mutateAsync(selectedGroup.id);
      setDeleteDialogOpen(false);
      setSelectedGroup(null);
    }
  };

  const toggleRuleSet = (ruleSetId: string) => {
    setSelectedRuleSetIds(prev => {
      const next = new Set(prev);
      if (next.has(ruleSetId)) next.delete(ruleSetId);
      else next.add(ruleSetId);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Endpoint Groups</h2>
          <p className="text-sm text-muted-foreground">
            Organize endpoints and assign policies to groups
          </p>
        </div>
        <Button onClick={handleOpenCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Create Group
        </Button>
      </div>

      {/* Groups Grid */}
      {groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FolderOpen className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium mb-2">No groups yet</h3>
            <p className="text-sm text-muted-foreground mb-4 text-center max-w-md">
              Create groups to organize your endpoints and assign policies in bulk. 
              For example, create a "SQL Servers" group and assign specific policies.
            </p>
            <Button onClick={handleOpenCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Create your first group
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              onEdit={handleOpenEdit}
              onDelete={handleOpenDelete}
              onMembers={handleOpenMembers}
            />
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setLastSyncedGroupId(null); }}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingGroup ? "Edit Group" : "Create Group"}
            </DialogTitle>
            <DialogDescription>
              {editingGroup 
                ? "Update the group settings and policy assignments."
                : "Create a new endpoint group to organize your devices."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Group Name</Label>
              <Input
                id="name"
                placeholder="e.g., SQL Servers"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                placeholder="Describe the purpose of this group..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label>Defender Policy</Label>
              <Select
                value={formData.defender_policy_id}
                onValueChange={(v) => setFormData({ ...formData, defender_policy_id: v === "none" ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a policy..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No policy</SelectItem>
                  {defenderPolicies.map((policy) => (
                    <SelectItem key={policy.id} value={policy.id}>
                      {policy.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>UAC Policy</Label>
              <Select
                value={formData.uac_policy_id}
                onValueChange={(v) => setFormData({ ...formData, uac_policy_id: v === "none" ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a policy..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No policy</SelectItem>
                  {uacPolicies.map((policy) => (
                    <SelectItem key={policy.id} value={policy.id}>
                      {policy.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Windows Update Policy</Label>
              <Select
                value={formData.windows_update_policy_id}
                onValueChange={(v) => setFormData({ ...formData, windows_update_policy_id: v === "none" ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a policy..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No policy</SelectItem>
                  {windowsUpdatePolicies.map((policy) => (
                    <SelectItem key={policy.id} value={policy.id}>
                      {policy.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Group Policy (GPO)</Label>
              <Select
                value={formData.gpo_policy_id}
                onValueChange={(v) => setFormData({ ...formData, gpo_policy_id: v === "none" ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a policy..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No policy</SelectItem>
                  {gpoPolicies.map((policy) => (
                    <SelectItem key={policy.id} value={policy.id}>
                      {policy.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>App Control Rule Sets</Label>
              <p className="text-xs text-muted-foreground">Select rule sets to assign to this group</p>
              {ruleSets.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No rule sets available. Create one in Application Control first.</p>
              ) : (
                <div className="space-y-2 rounded-md border p-3">
                  {ruleSets.map((rs) => (
                    <div key={rs.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`rs-${rs.id}`}
                        checked={selectedRuleSetIds.has(rs.id)}
                        onCheckedChange={() => toggleRuleSet(rs.id)}
                      />
                      <label htmlFor={`rs-${rs.id}`} className="text-sm cursor-pointer flex-1">
                        {rs.name}
                        <span className="text-xs text-muted-foreground ml-2">({rs.rule_count || 0} rules)</span>
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); setLastSyncedGroupId(null); }}>
              Cancel
            </Button>
            <Button 
              onClick={handleSave} 
              disabled={!formData.name || createGroup.isPending || updateGroup.isPending}
            >
              {(createGroup.isPending || updateGroup.isPending) && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {editingGroup ? "Save Changes" : "Create Group"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Group</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedGroup?.name}"? 
              This will remove all endpoints from this group. The endpoints themselves will not be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Members Dialog */}
      {selectedGroup && (
        <GroupMembersDialog
          group={selectedGroup}
          open={membersDialogOpen}
          onOpenChange={setMembersDialogOpen}
        />
      )}
    </div>
  );
}

// Extracted group card to keep main component cleaner
function GroupCard({ group, onEdit, onDelete, onMembers }: {
  group: EndpointGroup;
  onEdit: (g: EndpointGroup) => void;
  onDelete: (g: EndpointGroup) => void;
  onMembers: (g: EndpointGroup) => void;
}) {
  const { data: ruleSetAssignments } = useGroupRuleSetAssignments(group.id);

  return (
    <Card className="relative">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <FolderOpen className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">{group.name}</CardTitle>
              {group.description && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                  {group.description}
                </p>
              )}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Group options">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onMembers(group)}>
                <Users className="mr-2 h-4 w-4" />
                Manage Members
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEdit(group)}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit Group
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => onDelete(group)}
                className="text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Group
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Endpoint count */}
        <div className="flex items-center gap-2 text-sm">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">
            {group.endpoint_count} endpoint{group.endpoint_count !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Policies */}
        <div className="flex flex-wrap gap-1.5">
          {group.defender_policy ? (
            <Badge variant="secondary" className="text-xs">
              <Shield className="mr-1 h-3 w-3" />
              {group.defender_policy.name}
            </Badge>
          ) : null}
          {(group as any).uac_policy ? (
            <Badge variant="secondary" className="text-xs">
              <MonitorCog className="mr-1 h-3 w-3" />
              {(group as any).uac_policy.name}
            </Badge>
          ) : null}
          {(group as any).windows_update_policy ? (
            <Badge variant="secondary" className="text-xs">
              <RefreshCw className="mr-1 h-3 w-3" />
              {(group as any).windows_update_policy.name}
            </Badge>
          ) : null}
          {ruleSetAssignments?.map(a => (
            <Badge key={a.id} variant="secondary" className="text-xs">
              <Layers className="mr-1 h-3 w-3" />
              {a.rule_set?.name || "Rule Set"}
            </Badge>
          ))}
          {(group as any).gpo_policy ? (
            <Badge variant="secondary" className="text-xs">
              <SlidersHorizontal className="mr-1 h-3 w-3" />
              {(group as any).gpo_policy.name}
            </Badge>
          ) : null}
          {!group.defender_policy && !(group as any).uac_policy && !(group as any).windows_update_policy && !(group as any).gpo_policy && (!ruleSetAssignments || ruleSetAssignments.length === 0) && (
            <span className="text-xs text-muted-foreground">No policies assigned</span>
          )}
        </div>

        {/* Quick action */}
        <Button 
          variant="outline" 
          size="sm" 
          className="w-full mt-2"
          onClick={() => onMembers(group)}
        >
          <Users className="mr-2 h-4 w-4" />
          Manage Members
        </Button>
      </CardContent>
    </Card>
  );
}
