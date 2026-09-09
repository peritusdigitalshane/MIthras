import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { 
  ShieldCheck, 
  ShieldAlert, 
  ShieldQuestion, 
  Monitor,
  Info,
  RefreshCw 
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  useEndpointUacStatuses,
  useUacPolicies,
  useAssignUacPolicy,
  UAC_ADMIN_PROMPTS,
  type EndpointUacStatus,
} from "@/hooks/useUacPolicies";

export function EndpointUacList() {
  const { data: endpoints, isLoading, refetch } = useEndpointUacStatuses();
  const { data: policies } = useUacPolicies();
  const assignPolicy = useAssignUacPolicy();
  const [assigningEndpoint, setAssigningEndpoint] = useState<string | null>(null);

  const handleAssignPolicy = async (endpointId: string, policyId: string) => {
    setAssigningEndpoint(endpointId);
    await assignPolicy.mutateAsync({ 
      endpointId, 
      policyId: policyId === "none" ? null : policyId 
    });
    setAssigningEndpoint(null);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Monitor className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle>Endpoint UAC Status</CardTitle>
              <CardDescription>
                View and manage UAC settings across your endpoints
              </CardDescription>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!endpoints?.length ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Monitor className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium mb-2">No Endpoints</h3>
            <p className="text-sm text-muted-foreground">
              No endpoints have reported UAC status yet. Ensure agents are running and reporting.
            </p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>UAC Status</TableHead>
                  <TableHead>Admin Prompt</TableHead>
                  <TableHead>Secure Desktop</TableHead>
                  <TableHead>Assigned Policy</TableHead>
                  <TableHead>Last Reported</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {endpoints.map((endpoint) => (
                  <EndpointRow
                    key={endpoint.endpoint_id}
                    endpoint={endpoint}
                    policies={policies || []}
                    onAssignPolicy={handleAssignPolicy}
                    isAssigning={assigningEndpoint === endpoint.endpoint_id}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EndpointRow({
  endpoint,
  policies,
  onAssignPolicy,
  isAssigning,
}: {
  endpoint: EndpointUacStatus;
  policies: { id: string; name: string }[];
  onAssignPolicy: (endpointId: string, policyId: string) => void;
  isAssigning: boolean;
}) {
  const hasStatus = endpoint.uac_enabled !== null;
  const adminPromptInfo = endpoint.uac_consent_prompt_admin !== null 
    ? UAC_ADMIN_PROMPTS[endpoint.uac_consent_prompt_admin] 
    : null;

  return (
    <TableRow>
      <TableCell className="font-medium">{endpoint.hostname}</TableCell>
      <TableCell>
        {!hasStatus ? (
          <div className="flex items-center gap-2">
            <ShieldQuestion className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground text-sm">Unknown</span>
          </div>
        ) : endpoint.uac_enabled ? (
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-status-healthy" />
            <Badge variant="default" className="text-xs">Enabled</Badge>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-status-critical" />
            <Badge variant="destructive" className="text-xs">Disabled</Badge>
          </div>
        )}
      </TableCell>
      <TableCell>
        {adminPromptInfo ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1 cursor-help">
                  <span className="text-sm truncate max-w-[150px]">
                    {adminPromptInfo.label}
                  </span>
                  <Info className="h-3 w-3 text-muted-foreground" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                {adminPromptInfo.description}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        )}
      </TableCell>
      <TableCell>
        {endpoint.uac_prompt_on_secure_desktop === null ? (
          <span className="text-muted-foreground text-sm">—</span>
        ) : (
          <Badge 
            variant={endpoint.uac_prompt_on_secure_desktop ? "default" : "secondary"}
            className="text-xs"
          >
            {endpoint.uac_prompt_on_secure_desktop ? "Yes" : "No"}
          </Badge>
        )}
      </TableCell>
      <TableCell>
        <Select
          value={endpoint.uac_policy_id || "none"}
          onValueChange={(value) => onAssignPolicy(endpoint.endpoint_id, value)}
          disabled={isAssigning}
        >
          <SelectTrigger className="w-[180px] h-8">
            <SelectValue placeholder="No policy" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No policy</SelectItem>
            {policies.map((policy) => (
              <SelectItem key={policy.id} value={policy.id}>
                {policy.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="text-muted-foreground text-sm">
        {endpoint.collected_at 
          ? formatDistanceToNow(new Date(endpoint.collected_at), { addSuffix: true })
          : "Never"
        }
      </TableCell>
    </TableRow>
  );
}
