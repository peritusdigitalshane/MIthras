import { useState, useCallback } from "react";
import { Monitor, Shield, Clock, ChevronRight, Loader2, Trash2, AlertTriangle, ArrowUpCircle } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { useEndpoints, useDeleteEndpoint, useLatestAgentVersion, isAgentOutdated } from "@/hooks/useDashboardData";
import { UpgradeAgentButton } from "@/components/endpoints/UpgradeAgentButton";
import { useAssignPolicy, usePolicyOptions } from "@/hooks/usePolicies";
import { formatDistanceToNow } from "date-fns";
import { Link } from "react-router-dom";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { BulkActionsToolbar } from "@/components/endpoints/BulkActionsToolbar";

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

const statusLabels = {
  healthy: "Online",
  warning: "Idle",
  critical: "Offline",
};

const getProtectionStatus = (status: "healthy" | "warning" | "critical") => {
  switch (status) {
    case "healthy":
      return "Protected";
    case "warning":
      return "Check Required";
    case "critical":
      return "Offline";
  }
};

interface EndpointsTableProps {
  limit?: number;
  showHeader?: boolean;
}

export function EndpointsTable({ limit, showHeader = true }: EndpointsTableProps) {
  const { data: endpoints, isLoading, error } = useEndpoints();
  const { data: latestAgentVersion } = useLatestAgentVersion();
  const { data: policyOptions } = usePolicyOptions();
  const assignPolicy = useAssignPolicy();
  const deleteEndpoint = useDeleteEndpoint();
  const { toast } = useToast();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    const all = endpoints || [];
    const display = limit ? all.slice(0, limit) : all;
    if (selectedIds.size === display.length && display.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(display.map(e => e.id)));
    }
  }, [endpoints, limit, selectedIds.size]);

  const handlePolicyChange = async (endpointId: string, policyId: string) => {
    try {
      await assignPolicy.mutateAsync({
        endpointId,
        policyId: policyId === "none" ? null : policyId,
      });
      toast({
        title: "Policy assigned",
        description: "The endpoint will apply the new policy on next sync.",
      });
    } catch (err) {
      toast({
        title: "Failed to assign policy",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card shadow-card">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-2">
            <Monitor className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-foreground">Managed Endpoints</h3>
          </div>
        </div>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card shadow-card">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-2">
            <Monitor className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-foreground">Managed Endpoints</h3>
          </div>
        </div>
        <div className="p-8 text-center text-muted-foreground">
          Failed to load endpoints
        </div>
      </div>
    );
  }

  const displayEndpoints = limit ? (endpoints?.slice(0, limit) || []) : (endpoints || []);

  return (
    <div className="rounded-xl border border-border bg-card shadow-card">
      {showHeader && (
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-2">
            <Monitor className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-foreground">Managed Endpoints</h3>
          </div>
          <Link to="/endpoints" className="text-sm text-primary hover:underline">
            Manage All
          </Link>
        </div>
      )}

      {/* Bulk Actions Toolbar */}
      {!limit && (
        <BulkActionsToolbar
          selectedIds={selectedIds}
          onClearSelection={() => setSelectedIds(new Set())}
          endpoints={displayEndpoints}
        />
      )}

      {displayEndpoints.length === 0 ? (
        <div className="p-8 text-center">
          <Monitor className="mx-auto h-12 w-12 text-muted-foreground/50 mb-3" />
          <p className="text-muted-foreground">No endpoints enrolled yet</p>
          <Link to="/deploy" className="text-sm text-primary hover:underline mt-2 inline-block">
            Deploy your first agent
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-secondary/50">
                {!limit && (
                  <th className="px-3 py-3 w-10">
                    <Checkbox
                      checked={selectedIds.size === displayEndpoints.length && displayEndpoints.length > 0}
                      onCheckedChange={toggleAll}
                    />
                  </th>
                )}
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Endpoint
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Operating System
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Agent Version
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Defender Version
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Policy
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Last Seen
                </th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {displayEndpoints.map((endpoint) => {
                const status = getEndpointStatus(endpoint.is_online, endpoint.last_seen_at);
                const lastSeenText = endpoint.last_seen_at
                  ? formatDistanceToNow(new Date(endpoint.last_seen_at), { addSuffix: true })
                  : "Never";

                return (
                  <tr
                    key={endpoint.id}
                    className="group transition-colors hover:bg-secondary/30"
                  >
                    {!limit && (
                      <td className="px-3 py-4">
                        <Checkbox
                          checked={selectedIds.has(endpoint.id)}
                          onCheckedChange={() => toggleSelect(endpoint.id)}
                        />
                      </td>
                    )}
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary">
                          <Shield className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <Link to={`/endpoints/${endpoint.id}`} className="text-sm font-medium text-foreground hover:text-primary hover:underline">
                            {endpoint.hostname}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            {getProtectionStatus(status)}
                          </p>
                          {!endpoint.policy_id && (
                            <Badge variant="destructive" className="mt-1 h-4 gap-1 px-1.5 text-[10px]" title="No Defender policy assigned — settings won't apply">
                              <AlertTriangle className="h-2.5 w-2.5" />
                              No Defender policy
                            </Badge>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span className="text-sm text-foreground">
                        {endpoint.os_version || "Unknown"}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-1.5">
                        <code className="rounded bg-secondary px-2 py-1 text-xs text-muted-foreground">
                          {endpoint.agent_version ? `v${endpoint.agent_version}` : "Unknown"}
                        </code>
                        {isAgentOutdated(endpoint.agent_version, latestAgentVersion) && (
                          <span className="inline-flex items-center gap-1">
                            <Badge
                              variant="outline"
                              className="h-5 gap-1 border-amber-500 px-1.5 text-[10px] text-amber-600 dark:text-amber-400"
                              title={`Latest stable is v${latestAgentVersion}`}
                            >
                              <ArrowUpCircle className="h-2.5 w-2.5" />
                              Outdated
                            </Badge>
                            <UpgradeAgentButton
                              endpointId={endpoint.id}
                              hostname={endpoint.hostname}
                              currentVersion={endpoint.agent_version}
                            />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <code className="rounded bg-secondary px-2 py-1 text-xs text-muted-foreground">
                        {endpoint.defender_version || "Unknown"}
                      </code>
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge
                        status={status}
                        label={statusLabels[status]}
                        pulse={status !== "healthy"}
                      />
                    </td>
                    <td className="px-4 py-4">
                      <Select
                        value={endpoint.policy_id || "none"}
                        onValueChange={(value) => handlePolicyChange(endpoint.id, value)}
                        disabled={assignPolicy.isPending}
                      >
                        <SelectTrigger className="w-[160px] h-8 text-xs">
                          <SelectValue placeholder="No policy" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">
                            <span className="text-muted-foreground">No policy</span>
                          </SelectItem>
                          {policyOptions && policyOptions.length > 0 ? (
                            policyOptions.map((policy) => (
                              <SelectItem key={policy.id} value={policy.id}>
                                {policy.name}
                              </SelectItem>
                            ))
                          ) : (
                            <SelectItem value="__no_policies" disabled>
                              No policies created yet
                            </SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-4 py-4">
                      <span className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {lastSeenText}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-1">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <button
                              className="rounded-lg p-2 text-muted-foreground transition-all hover:bg-destructive/10 hover:text-destructive"
                              title="Remove endpoint"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete {endpoint.hostname}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently remove this endpoint and all its associated data including logs, threats, status history, and group memberships. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={() => deleteEndpoint.mutate(endpoint.id)}
                                disabled={deleteEndpoint.isPending}
                              >
                                {deleteEndpoint.isPending ? "Deleting..." : "Delete Endpoint"}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                        <button className="rounded-lg p-2 text-muted-foreground opacity-0 transition-all hover:bg-secondary hover:text-foreground group-hover:opacity-100">
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
