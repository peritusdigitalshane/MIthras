import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuditFindings, FirewallAuditSession } from "@/hooks/useFirewall";
import { getPortServiceInfo, getServiceLabel } from "@/lib/port-service-map";
import { formatDistanceToNow } from "date-fns";
import { ChevronDown, Activity, Eye, Globe, Info, ShieldAlert, ShieldCheck, Shield } from "lucide-react";
import { useState } from "react";

interface AuditFindingsPanelProps {
  session: FirewallAuditSession;
}

const riskConfig = {
  low:      { label: "Low",      variant: "secondary" as const, icon: ShieldCheck, className: "text-green-600 bg-green-50 border-green-200" },
  medium:   { label: "Medium",   variant: "secondary" as const, icon: Shield,      className: "text-yellow-600 bg-yellow-50 border-yellow-200" },
  high:     { label: "High",     variant: "secondary" as const, icon: ShieldAlert,  className: "text-orange-600 bg-orange-50 border-orange-200" },
  critical: { label: "Critical", variant: "destructive" as const, icon: ShieldAlert, className: "" },
};

export function AuditFindingsPanel({ session }: AuditFindingsPanelProps) {
  const { data: findings, isLoading } = useAuditFindings(session);
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

  const totalConnections = findings.reduce((sum, f) => sum + f.total_connections, 0);
  const uniqueServices = findings.length;
  const allSources = new Set(findings.flatMap((f) => f.sample_sources));

  return (
    <TooltipProvider>
      <Collapsible open={open} onOpenChange={setOpen} className="mt-4">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full justify-between px-3 py-2 h-auto">
            <div className="flex items-center gap-4">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Observed Traffic</span>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {uniqueServices} services
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  {totalConnections} connections
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  {allSources.size} unique sources
                </Badge>
              </div>
            </div>
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="rounded-md border mt-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Port</TableHead>
                  <TableHead>Protocol</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead className="text-right">Connections</TableHead>
                  <TableHead className="text-right">Unique Sources</TableHead>
                  <TableHead>Source IPs</TableHead>
                  <TableHead>Last Seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {findings.map((finding) => {
                  const portInfo = getPortServiceInfo(finding.local_port);
                  const label = getServiceLabel(finding.local_port, finding.service_name);
                  const risk = portInfo?.risk || "medium";
                  const rc = riskConfig[risk];
                  const RiskIcon = rc.icon;

                  return (
                    <TableRow key={`${finding.service_name}:${finding.local_port}:${finding.protocol}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{label}</span>
                          {portInfo && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent side="right" className="max-w-xs">
                                <p className="text-sm font-medium">{portInfo.name}</p>
                                <p className="text-xs text-muted-foreground mt-1">{portInfo.description}</p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                          {!portInfo && finding.service_name === "Unknown" && (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">
                              Unclassified
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{finding.local_port}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="uppercase text-[10px]">
                          {finding.protocol}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={rc.variant} className={`text-[10px] gap-1 ${rc.className}`}>
                          <RiskIcon className="h-3 w-3" />
                          {rc.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{finding.total_connections}</TableCell>
                      <TableCell className="text-right">{finding.unique_sources}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {finding.sample_sources.map((ip) => (
                            <Badge key={ip} variant="secondary" className="font-mono text-[10px]">
                              {ip}
                            </Badge>
                          ))}
                          {finding.unique_sources > 5 && (
                            <Badge variant="secondary" className="text-[10px]">
                              +{finding.unique_sources - 5} more
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(finding.last_seen), { addSuffix: true })}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mt-3 px-1 flex-wrap">
            <p className="text-xs text-muted-foreground">
              <Globe className="h-3 w-3 inline mr-1" />
              These services will be included as "allow" rules in the generated template. All other inbound traffic will be blocked.
            </p>
            <div className="flex items-center gap-2 ml-auto">
              {(["low", "medium", "high", "critical"] as const).map((level) => {
                const c = riskConfig[level];
                const Icon = c.icon;
                return (
                  <span key={level} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Icon className="h-3 w-3" />
                    {c.label}
                  </span>
                );
              })}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </TooltipProvider>
  );
}
