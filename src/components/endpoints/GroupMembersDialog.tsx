import { useState, useMemo } from "react";
import { Monitor, Plus, X, Search, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  EndpointGroup,
  useGroupMembers,
  useRemoveEndpointFromGroup,
  useBulkAddEndpointsToGroup,
} from "@/hooks/useEndpointGroups";
import { useEndpoints } from "@/hooks/useDashboardData";
import { formatDistanceToNow } from "date-fns";

interface GroupMembersDialogProps {
  group: EndpointGroup;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const getEndpointStatus = (
  isOnline: boolean,
  lastSeenAt: string | null
): "healthy" | "warning" | "critical" => {
  if (!lastSeenAt) return "critical";
  const lastSeen = new Date(lastSeenAt);
  const now = new Date();
  const diffMinutes = (now.getTime() - lastSeen.getTime()) / (1000 * 60);
  if (diffMinutes <= 10) return "healthy";
  if (diffMinutes <= 60) return "warning";
  return "critical";
};

export function GroupMembersDialog({
  group,
  open,
  onOpenChange,
}: GroupMembersDialogProps) {
  const { data: members = [], isLoading: membersLoading } = useGroupMembers(group.id);
  const { data: allEndpoints = [], isLoading: endpointsLoading } = useEndpoints();
  const removeFromGroup = useRemoveEndpointFromGroup();
  const bulkAddToGroup = useBulkAddEndpointsToGroup();

  const [showAddPanel, setShowAddPanel] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedEndpoints, setSelectedEndpoints] = useState<Set<string>>(new Set());

  const memberEndpointIds = useMemo(
    () => new Set(members.map((m) => m.endpoint_id)),
    [members]
  );

  const availableEndpoints = useMemo(
    () => allEndpoints.filter((e) => !memberEndpointIds.has(e.id)),
    [allEndpoints, memberEndpointIds]
  );

  const filteredAvailable = useMemo(() => {
    if (!search) return availableEndpoints;
    const lower = search.toLowerCase();
    return availableEndpoints.filter(
      (e) =>
        e.hostname.toLowerCase().includes(lower) ||
        e.os_version?.toLowerCase().includes(lower)
    );
  }, [availableEndpoints, search]);

  const handleRemove = async (endpointId: string) => {
    await removeFromGroup.mutateAsync({ endpointId, groupId: group.id });
  };

  const handleToggleSelect = (endpointId: string) => {
    setSelectedEndpoints((prev) => {
      const next = new Set(prev);
      if (next.has(endpointId)) {
        next.delete(endpointId);
      } else {
        next.add(endpointId);
      }
      return next;
    });
  };

  const handleAddSelected = async () => {
    if (selectedEndpoints.size === 0) return;
    await bulkAddToGroup.mutateAsync({
      endpointIds: Array.from(selectedEndpoints),
      groupId: group.id,
    });
    setSelectedEndpoints(new Set());
    setShowAddPanel(false);
  };

  const handleSelectAll = () => {
    if (selectedEndpoints.size === filteredAvailable.length) {
      setSelectedEndpoints(new Set());
    } else {
      setSelectedEndpoints(new Set(filteredAvailable.map((e) => e.id)));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Manage Members: {group.name}</DialogTitle>
          <DialogDescription>
            Add or remove endpoints from this group. Endpoints in this group will inherit the assigned policies.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 space-y-4">
          {/* Current Members */}
          {!showAddPanel && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">
                  Current Members ({members.length})
                </h3>
                <Button size="sm" onClick={() => setShowAddPanel(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Endpoints
                </Button>
              </div>

              {membersLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : members.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Monitor className="h-10 w-10 text-muted-foreground/50 mb-3" />
                  <p className="text-sm text-muted-foreground">
                    No endpoints in this group yet
                  </p>
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => setShowAddPanel(true)}
                  >
                    Add your first endpoint
                  </Button>
                </div>
              ) : (
                <ScrollArea className="h-[300px] rounded-md border">
                  <div className="p-2 space-y-1">
                    {members.map((member) => {
                      const endpoint = member.endpoint;
                      if (!endpoint) return null;
                      const status = getEndpointStatus(
                        endpoint.is_online,
                        endpoint.last_seen_at
                      );
                      return (
                        <div
                          key={member.id}
                          className="flex items-center justify-between p-2 rounded-lg hover:bg-secondary/50"
                        >
                          <div className="flex items-center gap-3">
                            <Monitor className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <p className="text-sm font-medium">
                                {endpoint.hostname}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {endpoint.os_version || "Unknown OS"}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <StatusBadge
                              status={status}
                              label={
                                status === "healthy"
                                  ? "Online"
                                  : status === "warning"
                                  ? "Idle"
                                  : "Offline"
                              }
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => handleRemove(endpoint.id)}
                              disabled={removeFromGroup.isPending}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}

          {/* Add Panel */}
          {showAddPanel && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Add Endpoints</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowAddPanel(false);
                    setSelectedEndpoints(new Set());
                    setSearch("");
                  }}
                >
                  <X className="mr-2 h-4 w-4" />
                  Cancel
                </Button>
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search endpoints..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>

              {endpointsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : filteredAvailable.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Monitor className="h-10 w-10 text-muted-foreground/50 mb-3" />
                  <p className="text-sm text-muted-foreground">
                    {availableEndpoints.length === 0
                      ? "All endpoints are already in this group"
                      : "No matching endpoints found"}
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between px-2 py-1">
                    <Button variant="ghost" size="sm" onClick={handleSelectAll}>
                      {selectedEndpoints.size === filteredAvailable.length
                        ? "Deselect All"
                        : "Select All"}
                    </Button>
                    <Badge variant="secondary">
                      {selectedEndpoints.size} selected
                    </Badge>
                  </div>
                  <ScrollArea className="h-[250px] rounded-md border">
                    <div className="p-2 space-y-1">
                      {filteredAvailable.map((endpoint) => {
                        const isSelected = selectedEndpoints.has(endpoint.id);
                        const status = getEndpointStatus(
                          endpoint.is_online,
                          endpoint.last_seen_at
                        );
                        return (
                          <div
                            key={endpoint.id}
                            className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
                              isSelected
                                ? "bg-primary/10"
                                : "hover:bg-secondary/50"
                            }`}
                            onClick={() => handleToggleSelect(endpoint.id)}
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() =>
                                handleToggleSelect(endpoint.id)
                              }
                            />
                            <Monitor className="h-4 w-4 text-muted-foreground" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">
                                {endpoint.hostname}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {endpoint.os_version || "Unknown OS"}
                              </p>
                            </div>
                            <StatusBadge
                              status={status}
                              label={
                                status === "healthy"
                                  ? "Online"
                                  : status === "warning"
                                  ? "Idle"
                                  : "Offline"
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {showAddPanel ? (
            <Button
              onClick={handleAddSelected}
              disabled={selectedEndpoints.size === 0 || bulkAddToGroup.isPending}
            >
              {bulkAddToGroup.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              <Check className="mr-2 h-4 w-4" />
              Add {selectedEndpoints.size} Endpoint
              {selectedEndpoints.size !== 1 ? "s" : ""}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
