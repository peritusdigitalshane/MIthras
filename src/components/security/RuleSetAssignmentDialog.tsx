import { useState } from "react";
import { useRuleSets, useRuleSetMutations, useEndpointRuleSetAssignments, useGroupRuleSetAssignments } from "@/hooks/useRuleSets";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Layers, Plus, Trash2 } from "lucide-react";

interface RuleSetAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetType: "endpoint" | "group";
  targetId: string;
  targetName: string;
}

export function RuleSetAssignmentDialog({
  open,
  onOpenChange,
  targetType,
  targetId,
  targetName,
}: RuleSetAssignmentDialogProps) {
  const { data: ruleSets, isLoading: ruleSetsLoading } = useRuleSets();
  const { data: endpointAssignments, isLoading: endpointLoading } = useEndpointRuleSetAssignments(
    targetType === "endpoint" ? targetId : null
  );
  const { data: groupAssignments, isLoading: groupLoading } = useGroupRuleSetAssignments(
    targetType === "group" ? targetId : null
  );
  
  const { assignToEndpoint, removeFromEndpoint, assignToGroup, removeFromGroup } = useRuleSetMutations();
  
  const [selectedRuleSets, setSelectedRuleSets] = useState<Set<string>>(new Set());

  const currentAssignments = targetType === "endpoint" ? endpointAssignments : groupAssignments;
  const assignedIds = new Set(currentAssignments?.map(a => a.rule_set_id) || []);
  const availableRuleSets = ruleSets?.filter(rs => !assignedIds.has(rs.id)) || [];
  
  const isLoading = ruleSetsLoading || (targetType === "endpoint" ? endpointLoading : groupLoading);

  const toggleRuleSet = (id: string) => {
    const newSelected = new Set(selectedRuleSets);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedRuleSets(newSelected);
  };

  const handleAssign = async () => {
    const promises = Array.from(selectedRuleSets).map(ruleSetId => {
      if (targetType === "endpoint") {
        return assignToEndpoint.mutateAsync({ endpointId: targetId, ruleSetId });
      } else {
        return assignToGroup.mutateAsync({ groupId: targetId, ruleSetId });
      }
    });
    
    await Promise.all(promises);
    setSelectedRuleSets(new Set());
  };

  const handleRemove = async (ruleSetId: string) => {
    if (targetType === "endpoint") {
      await removeFromEndpoint.mutateAsync({ endpointId: targetId, ruleSetId });
    } else {
      await removeFromGroup.mutateAsync({ groupId: targetId, ruleSetId });
    }
  };

  const isPending = assignToEndpoint.isPending || assignToGroup.isPending || 
                    removeFromEndpoint.isPending || removeFromGroup.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage Rule Sets for {targetName}</DialogTitle>
          <DialogDescription>
            Assign or remove application control rule sets for this {targetType}.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6 py-4">
            {/* Currently Assigned */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Assigned Rule Sets ({currentAssignments?.length || 0})</h4>
              {!currentAssignments?.length ? (
                <p className="text-sm text-muted-foreground py-2">
                  No rule sets assigned yet.
                </p>
              ) : (
                <ScrollArea className="h-[150px]">
                  <div className="space-y-2">
                    {currentAssignments.map((assignment) => (
                      <div 
                        key={assignment.id}
                        className="flex items-center justify-between p-3 rounded-lg border bg-muted/30"
                      >
                        <div className="flex items-center gap-3">
                          <Layers className="h-4 w-4 text-primary" />
                          <div>
                            <div className="font-medium text-sm">
                              {assignment.rule_set?.name || "Unknown"}
                            </div>
                            {assignment.rule_set?.description && (
                              <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                                {assignment.rule_set.description}
                              </div>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => handleRemove(assignment.rule_set_id)}
                          disabled={isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>

            {/* Available to Add */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Available Rule Sets ({availableRuleSets.length})</h4>
              {!availableRuleSets.length ? (
                <p className="text-sm text-muted-foreground py-2">
                  All rule sets are already assigned.
                </p>
              ) : (
                <ScrollArea className="h-[150px]">
                  <div className="space-y-2">
                    {availableRuleSets.map((rs) => (
                      <label
                        key={rs.id}
                        className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors"
                      >
                        <Checkbox
                          checked={selectedRuleSets.has(rs.id)}
                          onCheckedChange={() => toggleRuleSet(rs.id)}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{rs.name}</span>
                            <Badge variant="secondary" className="text-xs">
                              {rs.rule_count || 0} rules
                            </Badge>
                          </div>
                          {rs.description && (
                            <div className="text-xs text-muted-foreground truncate">
                              {rs.description}
                            </div>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {selectedRuleSets.size > 0 && (
            <Button onClick={handleAssign} disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <Plus className="h-4 w-4 mr-2" />
              Assign {selectedRuleSets.size} Rule Set(s)
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
