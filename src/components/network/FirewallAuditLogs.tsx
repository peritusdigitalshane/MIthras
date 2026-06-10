import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFirewallAuditLogs, COMMON_SERVICES } from "@/hooks/useFirewall";
import { useAllowSource } from "@/hooks/useMicrosegmentation";
import { useEndpointGroups } from "@/hooks/useEndpointGroups";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { ScrollText, Plus, RefreshCw, Search, Info, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export function FirewallAuditLogs() {
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  const { data: logs, isLoading, refetch, isFetching } = useFirewallAuditLogs({
    serviceName: serviceFilter === "all" ? undefined : serviceFilter,
    limit: 100,
  });
  const { data: groups } = useEndpointGroups();
  const allowSource = useAllowSource();
  const { toast } = useToast();

  const handleAddException = (
    log: { rule_id: string | null; remote_address: string; service_name: string },
  ) => {
    if (!log.rule_id) {
      toast({
        title: "No matching rule",
        description:
          "This connection didn't match any tracked policy rule, so there's nothing to attach an exception to. Add a rule for this service first.",
        variant: "destructive",
      });
      return;
    }
    allowSource.mutate({ ruleId: log.rule_id, ip: log.remote_address });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-96 mt-2" />
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ScrollText className="h-5 w-5" />
            Firewall Audit Logs
          </CardTitle>
          <CardDescription>
            Connections that would have been blocked in Enforce mode. Review and
            add exceptions for legitimate traffic.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Select value={serviceFilter} onValueChange={setServiceFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Filter service" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Services</SelectItem>
              {COMMON_SERVICES.map((service) => (
                <SelectItem key={service.name} value={service.name}>
                  {service.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!logs?.length ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Search className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Audit Logs Yet</h3>
            <p className="text-muted-foreground max-w-md">
              When you have firewall rules in Audit mode, connection attempts
              that match those rules will appear here. This helps you learn
              normal traffic patterns before enabling enforcement.
            </p>
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Source IP</TableHead>
                  <TableHead>Port</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-sm text-muted-foreground" title={new Date(log.event_time).toLocaleString()}>
                      {formatDistanceToNow(new Date(log.event_time), {
                        addSuffix: true,
                      })}
                    </TableCell>
                    <TableCell className="font-medium">
                      {log.endpoint?.hostname || "Unknown"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{log.service_name}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {log.remote_address}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {log.local_port}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
                      >
                        <Search className="h-3 w-3 mr-1" />
                        Audited
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleAddException(log)}
                        disabled={allowSource.isPending}
                      >
                        {allowSource.isPending ? (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : (
                          <Plus className="h-3 w-3 mr-1" />
                        )}
                        Add Exception
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-muted/50 border">
              <Info className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <p className="text-xs text-muted-foreground">
                These connections were allowed but logged because the matching rule
                is in Audit mode. Click "Add Exception" to whitelist a source, or
                switch the rule to Enforce mode when you're confident the audit
                logs only show suspicious activity.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
