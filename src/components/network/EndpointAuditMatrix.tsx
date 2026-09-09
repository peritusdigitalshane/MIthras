import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { useAuditFindingsByEndpoint, EndpointAuditFinding } from "@/hooks/useFirewallAudit";
import { FirewallAuditSession } from "@/hooks/useFirewall";
import { getPortServiceInfo, getServiceLabel } from "@/lib/port-service-map";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  Activity,
  Eye,
  Monitor,
  Globe,
  Info,
} from "lucide-react";
import { useState } from "react";

interface EndpointAuditMatrixProps {
  session: FirewallAuditSession;
}

const riskConfig = {
  low: { label: "Low", className: "bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30" },
  medium: { label: "Medium", className: "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border-yellow-500/30" },
  high: { label: "High", className: "bg-orange-500/20 text-orange-600 dark:text-orange-400 border-orange-500/30" },
  critical: { label: "Critical", className: "bg-destructive/20 text-destructive border-destructive/30" },
};

export function EndpointAuditMatrix({ session }: EndpointAuditMatrixProps) {
  const { data: findings, isLoading } = useAuditFindingsByEndpoint(session);
  const [open, setOpen] = useState(true);

  if (isLoading) {
    return (
      <div className="space-y-2 mt-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (!findings?.length) {
    return (
      <div className="mt-4 rounded-lg border border-dashed p-6 text-center">
        <Eye className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm font-medium">No Traffic Observed Yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Connections will appear here as endpoints report inbound traffic during the audit period.
        </p>
      </div>
    );
  }

  // Collect all unique services across all endpoints
  const allServicesMap = new Map<string, { service_name: string; local_port: number; protocol: string }>();
  findings.forEach((ep) => {
    ep.services.forEach((svc) => {
      const key = `${svc.local_port}:${svc.protocol}`;
      if (!allServicesMap.has(key)) {
        allServicesMap.set(key, {
          service_name: svc.service_name,
          local_port: svc.local_port,
          protocol: svc.protocol,
        });
      }
    });
  });

  // Sort services by port number
  const allServices = Array.from(allServicesMap.values()).sort((a, b) => a.local_port - b.local_port);

  const totalConnections = findings.reduce((sum, f) => sum + f.total_connections, 0);
  const totalEndpoints = findings.length;

  // Get a service finding for an endpoint
  const getEndpointService = (ep: EndpointAuditFinding, port: number, protocol: string) => {
    return ep.services.find((s) => s.local_port === port && s.protocol === protocol);
  };

  return (
    <TooltipProvider>
      <Collapsible open={open} onOpenChange={setOpen} className="mt-4">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full justify-between px-3 py-2 h-auto">
            <div className="flex items-center gap-4">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Observed Traffic by Endpoint</span>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {totalEndpoints} endpoints
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  {allServices.length} services
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  {totalConnections} connections
                </Badge>
              </div>
            </div>
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="rounded-md border mt-2 overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="p-2 text-left text-sm font-medium text-muted-foreground border-b border-border min-w-[180px] sticky left-0 bg-background z-10">
                    Endpoint
                  </th>
                  {allServices.map((svc) => {
                    const portInfo = getPortServiceInfo(svc.local_port);
                    const label = getServiceLabel(svc.local_port, svc.service_name);
                    const risk = portInfo?.risk || "medium";
                    return (
                      <th
                        key={`${svc.local_port}:${svc.protocol}`}
                        className="p-2 text-center text-sm font-medium text-muted-foreground border-b border-border min-w-[110px]"
                      >
                        <div className="flex items-center justify-center gap-1">
                          <span>{label}</span>
                          {portInfo && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs">
                                <p className="text-xs">{portInfo.description}</p>
                                <Badge variant="outline" className={cn("text-[10px] mt-1", riskConfig[risk].className)}>
                                  {riskConfig[risk].label} Risk
                                </Badge>
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                        <div className="text-xs font-normal text-muted-foreground/70">
                          {svc.local_port}/{svc.protocol}
                        </div>
                      </th>
                    );
                  })}
                  <th className="p-2 text-center text-sm font-medium text-muted-foreground border-b border-border min-w-[80px]">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {findings.map((ep) => (
                  <tr key={ep.endpoint_id} className="hover:bg-muted/20">
                    <td className="p-2 border-b border-border sticky left-0 bg-background z-10">
                      <div className="flex items-center gap-2">
                        <Monitor className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div>
                          <div className="font-medium text-sm">{ep.hostname}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {ep.unique_services} service{ep.unique_services !== 1 ? "s" : ""} detected
                          </div>
                        </div>
                      </div>
                    </td>
                    {allServices.map((svc) => {
                      const found = getEndpointService(ep, svc.local_port, svc.protocol);
                      if (!found) {
                        return (
                          <td key={`${svc.local_port}:${svc.protocol}`} className="p-1 border-b border-border">
                            <div className="w-full p-2 rounded-lg bg-muted/10 flex items-center justify-center min-h-[52px]">
                              <span className="text-xs text-muted-foreground/40">—</span>
                            </div>
                          </td>
                        );
                      }

                      const portInfo = getPortServiceInfo(found.local_port);
                      const risk = portInfo?.risk || "medium";

                      return (
                        <td key={`${svc.local_port}:${svc.protocol}`} className="p-1 border-b border-border">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div
                                className={cn(
                                  "w-full p-2 rounded-lg border transition-all cursor-default",
                                  "flex flex-col items-center justify-center gap-0.5 min-h-[52px]",
                                  found.total_connections > 50
                                    ? "bg-green-500/25 border-green-500/40 text-green-600 dark:text-green-400"
                                    : found.total_connections > 10
                                    ? "bg-green-500/15 border-green-500/30 text-green-600 dark:text-green-400"
                                    : "bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400"
                                )}
                              >
                                <span className="text-sm font-semibold">{found.total_connections}</span>
                                <span className="text-[10px] text-muted-foreground">
                                  {found.unique_sources} src{found.unique_sources !== 1 ? "s" : ""}
                                </span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs">
                              <div className="space-y-1.5">
                                <p className="text-xs font-medium">
                                  {found.total_connections} connections from {found.unique_sources} source{found.unique_sources !== 1 ? "s" : ""}
                                </p>
                                <div className="flex flex-wrap gap-1">
                                  {found.sample_sources.map((ip) => (
                                    <Badge key={ip} variant="secondary" className="font-mono text-[10px]">
                                      {ip}
                                    </Badge>
                                  ))}
                                  {found.unique_sources > 5 && (
                                    <Badge variant="secondary" className="text-[10px]">
                                      +{found.unique_sources - 5} more
                                    </Badge>
                                  )}
                                </div>
                                <Badge variant="outline" className={cn("text-[10px]", riskConfig[risk].className)}>
                                  {riskConfig[risk].label} Risk
                                </Badge>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </td>
                      );
                    })}
                    <td className="p-1 border-b border-border">
                      <div className="w-full p-2 rounded-lg bg-muted/20 flex flex-col items-center justify-center min-h-[52px]">
                        <span className="text-sm font-semibold">{ep.total_connections}</span>
                        <span className="text-[10px] text-muted-foreground">total</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mt-3 px-1 flex-wrap">
            <p className="text-xs text-muted-foreground">
              <Globe className="h-3 w-3 inline mr-1" />
              Each cell shows connection count &amp; unique sources. Only observed traffic per endpoint will be allowed when rules are generated.
            </p>
            <div className="flex items-center gap-3 ml-auto">
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <div className="w-3 h-3 rounded bg-green-500/25 border border-green-500/40" />
                High activity
              </span>
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <div className="w-3 h-3 rounded bg-green-500/10 border border-green-500/20" />
                Low activity
              </span>
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <div className="w-3 h-3 rounded bg-muted/10" />
                No traffic
              </span>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </TooltipProvider>
  );
}
