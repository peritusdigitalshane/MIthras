import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Monitor, AlertTriangle, CheckCircle, Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDistanceToNow } from "date-fns";
import {
  useEndpointWindowsUpdateStatuses,
  useWindowsUpdatePolicies,
  useAssignWindowsUpdatePolicy,
  AUTO_UPDATE_MODES,
  EndpointWindowsUpdateStatus,
} from "@/hooks/useWindowsUpdatePolicies";

export function EndpointWindowsUpdateList() {
  const { data: statuses, isLoading, refetch } = useEndpointWindowsUpdateStatuses();
  const { data: policies } = useWindowsUpdatePolicies();
  const assignPolicy = useAssignWindowsUpdatePolicy();
  const [assigningEndpoint, setAssigningEndpoint] = useState<string | null>(null);

  const handlePolicyAssign = async (endpointId: string, policyId: string | null) => {
    setAssigningEndpoint(endpointId);
    try {
      await assignPolicy.mutateAsync({ endpointId, policyId });
    } finally {
      setAssigningEndpoint(null);
    }
  };

  const formatLastInstall = (date: string | null) => {
    if (!date) return "Never";
    try {
      return formatDistanceToNow(new Date(date), { addSuffix: true });
    } catch {
      return "Unknown";
    }
  };

  const getUpdateModeLabel = (mode: number | null) => {
    if (mode === null) return "Unknown";
    return AUTO_UPDATE_MODES[mode]?.label || `Mode ${mode}`;
  };

  const formatActiveHours = (start: number | null, end: number | null) => {
    if (start === null || end === null) return "—";
    const formatHour = (h: number) => `${h.toString().padStart(2, '0')}:00`;
    return `${formatHour(start)} - ${formatHour(end)}`;
  };

  const hasData = (status: EndpointWindowsUpdateStatus) => {
    return status.wu_auto_update_mode !== null;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Monitor className="h-5 w-5" />
              Endpoint Windows Update Status
            </CardTitle>
            <CardDescription>
              View update settings and assign policies to endpoints
            </CardDescription>
          </div>
          <Button variant="outline" size="icon" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : !statuses?.length ? (
          <div className="text-center py-8 text-muted-foreground">
            <Monitor className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No endpoints reporting Windows Update status</p>
            <p className="text-sm">Update the agent to start collecting Windows Update data</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Endpoint</TableHead>
                <TableHead>Update Mode</TableHead>
                <TableHead>Active Hours</TableHead>
                <TableHead>Pending</TableHead>
                <TableHead>Last Install</TableHead>
                <TableHead>Restart</TableHead>
                <TableHead>Assigned Policy</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statuses.map((status) => (
                <TableRow key={status.endpoint_id}>
                  <TableCell className="font-medium">{status.hostname}</TableCell>
                  <TableCell>
                    {hasData(status) ? (
                      <Badge variant="outline">
                        {getUpdateModeLabel(status.wu_auto_update_mode)}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-sm">No data</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatActiveHours(status.wu_active_hours_start, status.wu_active_hours_end)}
                  </TableCell>
                  <TableCell>
                    {status.wu_pending_updates_count !== null ? (
                      status.wu_pending_updates_count > 0 ? (
                        <Badge variant="secondary" className="gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          {status.wu_pending_updates_count}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-status-healthy border-status-healthy/30">
                          <CheckCircle className="h-3 w-3" />
                          0
                        </Badge>
                      )
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      {formatLastInstall(status.wu_last_install_date)}
                    </div>
                  </TableCell>
                  <TableCell>
                    {status.wu_restart_pending !== null ? (
                      status.wu_restart_pending ? (
                        <Badge variant="destructive" className="text-xs">Required</Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">No</span>
                      )
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={status.windows_update_policy_id || "none"}
                      onValueChange={(value) =>
                        handlePolicyAssign(status.endpoint_id, value === "none" ? null : value)
                      }
                      disabled={assigningEndpoint === status.endpoint_id}
                    >
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Select policy..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No policy</SelectItem>
                        {policies?.map((policy) => (
                          <SelectItem key={policy.id} value={policy.id}>
                            {policy.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
