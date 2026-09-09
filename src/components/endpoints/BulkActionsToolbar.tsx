import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { usePolicyOptions, useAssignPolicy } from "@/hooks/usePolicies";
import { useEndpointGroups, useAddEndpointToGroup } from "@/hooks/useEndpointGroups";
import { Shield, FolderPlus, X } from "lucide-react";

interface BulkActionsToolbarProps {
  selectedIds: Set<string>;
  onClearSelection: () => void;
  endpoints: Array<{ id: string; hostname: string; organization_id: string }>;
}

export function BulkActionsToolbar({ selectedIds, onClearSelection, endpoints }: BulkActionsToolbarProps) {
  const { toast } = useToast();
  const { data: policyOptions = [] } = usePolicyOptions();
  const { data: groups = [] } = useEndpointGroups();
  const assignPolicy = useAssignPolicy();
  const addToGroup = useAddEndpointToGroup();
  const [bulkPolicyId, setBulkPolicyId] = useState<string>("");
  const [bulkGroupId, setBulkGroupId] = useState<string>("");

  if (selectedIds.size === 0) return null;

  const handleBulkAssignPolicy = async () => {
    if (!bulkPolicyId) return;
    const selected = endpoints.filter(e => selectedIds.has(e.id));
    let success = 0;
    for (const ep of selected) {
      try {
        await assignPolicy.mutateAsync({
          endpointId: ep.id,
          policyId: bulkPolicyId === "none" ? null : bulkPolicyId,
          orgId: ep.organization_id,
          endpointName: ep.hostname,
        });
        success++;
      } catch { /* continue */ }
    }
    toast({ title: `Policy assigned to ${success} endpoint(s)` });
    onClearSelection();
    setBulkPolicyId("");
  };

  const handleBulkAddToGroup = async () => {
    if (!bulkGroupId) return;
    const selected = endpoints.filter(e => selectedIds.has(e.id));
    let success = 0;
    for (const ep of selected) {
      try {
        await addToGroup.mutateAsync({ endpointId: ep.id, groupId: bulkGroupId });
        success++;
      } catch { /* may already be member */ }
    }
    toast({ title: `${success} endpoint(s) added to group` });
    onClearSelection();
    setBulkGroupId("");
  };

  return (
    <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5">
      <span className="text-sm font-medium">{selectedIds.size} selected</span>

      <div className="flex items-center gap-2">
        <Select value={bulkPolicyId} onValueChange={setBulkPolicyId}>
          <SelectTrigger className="w-[180px] h-8 text-xs">
            <SelectValue placeholder="Assign policy…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No policy</SelectItem>
            {policyOptions.map(p => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1"
          onClick={handleBulkAssignPolicy}
          disabled={!bulkPolicyId || assignPolicy.isPending}
        >
          <Shield className="h-3.5 w-3.5" />
          Apply
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Select value={bulkGroupId} onValueChange={setBulkGroupId}>
          <SelectTrigger className="w-[180px] h-8 text-xs">
            <SelectValue placeholder="Move to group…" />
          </SelectTrigger>
          <SelectContent>
            {groups.map(g => (
              <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1"
          onClick={handleBulkAddToGroup}
          disabled={!bulkGroupId || addToGroup.isPending}
        >
          <FolderPlus className="h-3.5 w-3.5" />
          Add
        </Button>
      </div>

      <Button size="sm" variant="ghost" className="h-8 gap-1 ml-auto" onClick={onClearSelection}>
        <X className="h-3.5 w-3.5" />
        Clear
      </Button>
    </div>
  );
}
