import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useWdacPolicies, useWdacDiscoveredApps, WdacPolicy, WdacDiscoveredApp } from "@/hooks/useWdac";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { logActivity } from "@/hooks/useActivityLogs";
import { 
  Search, 
  Monitor, 
  Loader2, 
  Shield, 
  ShieldAlert,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  Package,
  Settings
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

interface Endpoint {
  id: string;
  hostname: string;
  os_version: string | null;
  is_online: boolean;
  last_seen_at: string | null;
  wdac_policy_id: string | null;
  wdac_policies?: WdacPolicy | null;
}

export function EndpointWdacList() {
  const { currentOrganization } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [search, setSearch] = useState("");
  const [expandedEndpoint, setExpandedEndpoint] = useState<string | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedEndpoint, setSelectedEndpoint] = useState<Endpoint | null>(null);
  const [selectedPolicyId, setSelectedPolicyId] = useState<string>("");

  // Fetch endpoints with WDAC policy info
  const { data: endpoints, isLoading: endpointsLoading } = useQuery({
    queryKey: ["endpoints-wdac", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization?.id) return [];
      
      const { data, error } = await supabase
        .from("endpoints")
        .select(`
          id,
          hostname,
          os_version,
          is_online,
          last_seen_at,
          wdac_policy_id,
          wdac_policies (
            id,
            name,
            mode
          )
        `)
        .eq("organization_id", currentOrganization.id)
        .is("deleted_at", null)
        .order("hostname");

      if (error) throw error;
      return data as Endpoint[];
    },
    enabled: !!currentOrganization?.id,
  });

  const { data: policies } = useWdacPolicies();
  const { data: allApps } = useWdacDiscoveredApps();

  // Group apps by endpoint
  const appsByEndpoint = useMemo(() => {
    if (!allApps) return new Map<string, WdacDiscoveredApp[]>();
    const map = new Map<string, WdacDiscoveredApp[]>();
    allApps.forEach((app) => {
      const existing = map.get(app.endpoint_id) || [];
      existing.push(app);
      map.set(app.endpoint_id, existing);
    });
    return map;
  }, [allApps]);

  // Filter endpoints
  const filteredEndpoints = useMemo(() => {
    if (!endpoints) return [];
    if (!search) return endpoints;
    const searchLower = search.toLowerCase();
    return endpoints.filter((ep) => 
      ep.hostname.toLowerCase().includes(searchLower) ||
      ep.os_version?.toLowerCase().includes(searchLower)
    );
  }, [endpoints, search]);

  // Assign WDAC policy mutation
  const assignPolicy = useMutation({
    mutationFn: async ({ endpointId, policyId }: { endpointId: string; policyId: string | null }) => {
      const { error } = await supabase
        .from("endpoints")
        .update({ wdac_policy_id: policyId })
        .eq("id", endpointId);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["endpoints-wdac"] });
      const policyName = policies?.find(p => p.id === variables.policyId)?.name;
      logActivity(
        currentOrganization!.id, 
        variables.policyId ? "assign" : "unassign", 
        "wdac_policy", 
        selectedEndpoint?.id,
        { 
          endpoint_hostname: selectedEndpoint?.hostname,
          policy_name: policyName || "None",
        }
      );
      toast({ 
        title: variables.policyId ? "Policy assigned" : "Policy removed",
        description: `${selectedEndpoint?.hostname} is now ${variables.policyId ? `assigned to ${policyName}` : "unassigned"}`,
      });
      setAssignDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to assign policy", description: error.message, variant: "destructive" });
    },
  });

  const openAssignDialog = (endpoint: Endpoint) => {
    setSelectedEndpoint(endpoint);
    setSelectedPolicyId(endpoint.wdac_policy_id || "none");
    setAssignDialogOpen(true);
  };

  const handleAssign = () => {
    if (!selectedEndpoint) return;
    assignPolicy.mutate({
      endpointId: selectedEndpoint.id,
      policyId: selectedPolicyId === "none" ? null : selectedPolicyId,
    });
  };

  const getModeIcon = (endpoint: Endpoint) => {
    if (!endpoint.wdac_policy_id) {
      return <Shield className="h-4 w-4 text-muted-foreground" />;
    }
    const policy = endpoint.wdac_policies as WdacPolicy | null;
    if (policy?.mode === "enforced") {
      return <ShieldCheck className="h-4 w-4 text-green-500" />;
    }
    return <ShieldAlert className="h-4 w-4 text-amber-500" />;
  };

  const getModeBadge = (endpoint: Endpoint) => {
    if (!endpoint.wdac_policy_id) {
      return <Badge variant="secondary">No Policy</Badge>;
    }
    const policy = endpoint.wdac_policies as WdacPolicy | null;
    if (policy?.mode === "enforced") {
      return <Badge className="bg-green-500/10 text-green-600 border-green-500/20">Enforced</Badge>;
    }
    return <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">Audit</Badge>;
  };

  if (endpointsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold">Endpoints</h2>
        <p className="text-sm text-muted-foreground">
          View discovered apps per device and assign WDAC policies. Move devices to enforcement when ready.
        </p>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search endpoints..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Endpoints</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{endpoints?.length || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">In Audit Mode</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-500">
              {endpoints?.filter(e => e.wdac_policies && (e.wdac_policies as WdacPolicy).mode === "audit").length || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Enforced</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">
              {endpoints?.filter(e => e.wdac_policies && (e.wdac_policies as WdacPolicy).mode === "enforced").length || 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Endpoints List */}
      {!filteredEndpoints.length ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Monitor className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="font-medium text-foreground mb-1">No Endpoints Found</h3>
            <p className="text-sm text-muted-foreground">
              Endpoints will appear here once agents are registered
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredEndpoints.map((endpoint) => {
            const apps = appsByEndpoint.get(endpoint.id) || [];
            const isExpanded = expandedEndpoint === endpoint.id;

            return (
              <Card key={endpoint.id}>
                <Collapsible open={isExpanded} onOpenChange={() => setExpandedEndpoint(isExpanded ? null : endpoint.id)}>
                  <div className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-4">
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </Button>
                      </CollapsibleTrigger>
                      
                      <div className="flex items-center gap-3">
                        {getModeIcon(endpoint)}
                        <div>
                          <div className="font-medium flex items-center gap-2">
                            {endpoint.hostname}
                            <Badge variant={endpoint.is_online ? "default" : "secondary"} className="text-xs">
                              {endpoint.is_online ? "Online" : "Offline"}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {endpoint.os_version || "Unknown OS"} • Last seen {endpoint.last_seen_at 
                              ? formatDistanceToNow(new Date(endpoint.last_seen_at), { addSuffix: true })
                              : "never"
                            }
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <Package className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">{apps.length} apps</span>
                      </div>
                      
                      {getModeBadge(endpoint)}
                      
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => openAssignDialog(endpoint)}
                      >
                        <Settings className="h-4 w-4 mr-2" />
                        Configure
                      </Button>
                    </div>
                  </div>

                  <CollapsibleContent>
                    <div className="border-t px-4 py-4">
                      {apps.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">No applications discovered on this endpoint yet</p>
                        </div>
                      ) : (
                        <ScrollArea className="h-[300px]">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Application</TableHead>
                                <TableHead>Publisher</TableHead>
                                <TableHead>Source</TableHead>
                                <TableHead>Last Seen</TableHead>
                                <TableHead className="text-right">Executions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {apps.map((app) => (
                                <TableRow key={app.id}>
                                  <TableCell>
                                    <div className="space-y-1">
                                      <div className="font-medium text-sm">{app.file_name}</div>
                                      <div className="text-xs text-muted-foreground truncate max-w-[250px]">
                                        {app.file_path}
                                      </div>
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-sm">
                                    {app.publisher || "Unknown"}
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant="secondary" className="text-xs">
                                      {app.discovery_source === "agent_inventory" && "Agent"}
                                      {app.discovery_source === "event_log" && "Event Log"}
                                      {app.discovery_source === "both" && "Both"}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-sm text-muted-foreground">
                                    {format(new Date(app.last_seen_at), "MMM d, HH:mm")}
                                  </TableCell>
                                  <TableCell className="text-right font-medium">
                                    {app.execution_count}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </ScrollArea>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            );
          })}
        </div>
      )}

      {/* Assign Policy Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configure WDAC for {selectedEndpoint?.hostname}</DialogTitle>
            <DialogDescription>
              Assign a WDAC policy to this endpoint. Use Audit mode to monitor applications before switching to Enforced mode.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>WDAC Policy</Label>
              <Select value={selectedPolicyId} onValueChange={setSelectedPolicyId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a policy" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    <span className="text-muted-foreground">No Policy (Disabled)</span>
                  </SelectItem>
                  {policies?.map((policy) => (
                    <SelectItem key={policy.id} value={policy.id}>
                      <div className="flex items-center gap-2">
                        {policy.mode === "enforced" ? (
                          <ShieldCheck className="h-4 w-4 text-green-500" />
                        ) : (
                          <ShieldAlert className="h-4 w-4 text-amber-500" />
                        )}
                        <span>{policy.name}</span>
                        <Badge variant="secondary" className="text-xs ml-2">
                          {policy.mode === "enforced" ? "Enforced" : "Audit"}
                        </Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                <strong>Audit:</strong> Monitor and log application usage without blocking. <br />
                <strong>Enforced:</strong> Block unauthorized applications from running.
              </p>
            </div>

            {selectedPolicyId && selectedPolicyId !== "none" && (
              <Card className="bg-muted/50">
                <CardContent className="pt-4">
                  {(() => {
                    const policy = policies?.find(p => p.id === selectedPolicyId);
                    if (!policy) return null;
                    return (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          {policy.mode === "enforced" ? (
                            <ShieldCheck className="h-5 w-5 text-green-500" />
                          ) : (
                            <ShieldAlert className="h-5 w-5 text-amber-500" />
                          )}
                          <span className="font-medium">{policy.name}</span>
                        </div>
                        {policy.description && (
                          <p className="text-sm text-muted-foreground">{policy.description}</p>
                        )}
                        <Badge className={policy.mode === "enforced" 
                          ? "bg-green-500/10 text-green-600 border-green-500/20"
                          : "bg-amber-500/10 text-amber-600 border-amber-500/20"
                        }>
                          {policy.mode === "enforced" ? "Enforcement Mode" : "Audit Mode"}
                        </Badge>
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAssign} disabled={assignPolicy.isPending}>
              {assignPolicy.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {selectedPolicyId === "none" ? "Remove Policy" : "Assign Policy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
