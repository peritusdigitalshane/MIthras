import { useParams, Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { QueryError } from "@/components/ui/query-error";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { EndpointResponseActions } from "@/components/endpoints/EndpointResponseActions";
import { DefenderStateCard } from "@/components/endpoints/DefenderStateCard";
import { UpgradeAgentButton } from "@/components/endpoints/UpgradeAgentButton";
import { RemoteDesktopButton } from "@/components/endpoints/RemoteDesktopButton";
import { DecommissionButton } from "@/components/endpoints/DecommissionButton";
import { RemoteAccessCard } from "@/components/endpoints/RemoteAccessCard";
import { IsolationModeToggle } from "@/components/endpoints/IsolationModeToggle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, Monitor, Shield, AlertTriangle, ScrollText,
  Activity, HardDrive, CheckCircle2, XCircle, FileText, ArrowUpCircle,
  Network, ShieldCheck, Bug, Package, History
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { useLatestAgentVersion, isAgentOutdated } from "@/hooks/useDashboardData";
import { useEndpointMicroseg } from "@/hooks/useMicrosegmentation";
import { useEndpointAppWhitelist } from "@/hooks/useAppWhitelisting";
import { useAgentUpdateLog } from "@/hooks/useAgentUpdateLog";
import { PageHelp } from "@/components/help/PageHelp";
import { HelpHint } from "@/components/help/HelpHint";
import { EmptyState } from "@/components/help/EmptyState";

const getEndpointStatus = (isOnline: boolean, lastSeenAt: string | null): "healthy" | "warning" | "critical" => {
  if (!lastSeenAt) return "critical";
  const diffMinutes = (Date.now() - new Date(lastSeenAt).getTime()) / (1000 * 60);
  if (diffMinutes <= 10) return "healthy";
  if (diffMinutes <= 60) return "warning";
  return "critical";
};

const BooleanIndicator = ({ value, label }: { value: boolean | null; label: string }) => (
  <div className="flex items-center justify-between py-2">
    <span className="text-sm text-muted-foreground">{label}</span>
  {value === null ? (
      <span className="text-xs text-muted-foreground">N/A</span>
    ) : value ? (
      <CheckCircle2 className="h-4 w-4 text-status-healthy" />
    ) : (
      <XCircle className="h-4 w-4 text-destructive" />
    )}
  </div>
);

const EndpointDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { currentOrganization, isSuperAdmin } = useTenant();
  // Belt-and-braces tenant scoping: only run queries once we know the tenant.
  // Super-admins bypass the org filter so the admin tenant switcher still works.
  const orgId = currentOrganization?.id ?? null;
  const queriesEnabled = !!id && (isSuperAdmin || !!orgId);

  const { data: endpoint, isLoading: endpointLoading, error: endpointError } = useQuery({
    queryKey: ["endpoint-detail", id, orgId, isSuperAdmin],
    enabled: queriesEnabled,
    queryFn: async () => {
      let q = supabase
        .from("endpoints")
        .select("*, defender_policies(id, name)")
        .eq("id", id!)
        .is("deleted_at", null);                     // hide soft-deleted endpoints from detail view
      if (!isSuperAdmin && orgId) q = q.eq("organization_id", orgId);
      const { data, error } = await q.maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Endpoint not found in your organization");
      return data;
    },
  });

  // All child queries inherit org-safety by gating on the parent endpoint row
  // having loaded under the org check above.
  const endpointOrgId: string | null = endpoint?.organization_id ?? null;

  const { data: latestStatus } = useQuery({
    queryKey: ["endpoint-status", id, endpointOrgId],
    enabled: queriesEnabled && !!endpointOrgId,
    queryFn: async () => {
      // endpoint_status has no organization_id column — RLS via the endpoint
      // FK enforces tenant isolation. The previous .eq("organization_id", …)
      // returned 400 "column does not exist" for non-super-admin users.
      const { data, error } = await supabase
        .from("endpoint_status")
        .select("*")
        .eq("endpoint_id", id!)
        .order("collected_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: threats } = useQuery({
    queryKey: ["endpoint-threats", id, endpointOrgId],
    enabled: queriesEnabled && !!endpointOrgId,
    queryFn: async () => {
      // endpoint_threats has no organization_id column — RLS via the endpoint FK.
      const { data, error } = await supabase
        .from("endpoint_threats")
        .select("*")
        .eq("endpoint_id", id!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: recentLogs } = useQuery({
    queryKey: ["endpoint-recent-logs", id, endpointOrgId],
    enabled: queriesEnabled && !!endpointOrgId,
    queryFn: async () => {
      // endpoint_event_logs has no organization_id column — RLS via the endpoint FK.
      const { data, error } = await supabase
        .from("endpoint_event_logs")
        .select("*")
        .eq("endpoint_id", id!)
        .order("event_time", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: groups, isLoading: groupsIsLoading } = useQuery({
    queryKey: ["endpoint-groups", id, endpointOrgId],
    enabled: queriesEnabled && !!endpointOrgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("endpoint_group_memberships")
        .select("group_id, endpoint_groups(id, name, defender_policy_id, gpo_policy_id, uac_policy_id, windows_update_policy_id, organization_id)")
        .eq("endpoint_id", id!);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: latestAgentVersion } = useLatestAgentVersion();
  const { data: microsegSnap } = useEndpointMicroseg(id || null, "inbound");
  const { data: updateLog } = useAgentUpdateLog(id || null);
  const { data: appWhitelistSnap } = useEndpointAppWhitelist(id || null);

  // Endpoint-scoped queries. The old pattern (fetch org-wide then client-filter)
  // hit PostgREST's default 1000-row cap on large MSP orgs — per-endpoint
  // tabs would silently show (0) for endpoints whose findings fell outside
  // the truncation window. Also slow on first paint.
  const { data: endpointFindings = [] } = useQuery({
    queryKey: ["endpoint-vuln-findings", id, endpointOrgId],
    enabled: queriesEnabled && !!endpointOrgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vulnerability_findings")
        .select("*")
        .eq("endpoint_id", id!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Array<Record<string, unknown>>;
    },
  });
  const { data: endpointSoftware = [] } = useQuery({
    queryKey: ["endpoint-software-inventory", id, endpointOrgId],
    enabled: queriesEnabled && !!endpointOrgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("endpoint_software_inventory")
        .select("*")
        .eq("endpoint_id", id!)
        .order("software_name", { ascending: true });
      if (error) throw error;
      return data as Array<Record<string, unknown>>;
    },
  });
  const openFindings = endpointFindings.filter((f) => f.status === "open");
  const sevCount = (sev: string) => openFindings.filter((f) => f.severity === sev).length;

  if (endpointLoading) {
    return (
      <MainLayout>
        <div className="space-y-6">
          <Skeleton className="h-8 w-64" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
        </div>
      </MainLayout>
    );
  }

  if (endpointError) {
    return <QueryError error={endpointError} title="Couldn't load endpoint" />;
  }

  if (!endpoint) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Monitor className="h-12 w-12 mb-4" />
          <p>Endpoint not found</p>
          <Button asChild variant="link" className="mt-2">
            <Link to="/endpoints">Back to Endpoints</Link>
          </Button>
        </div>
      </MainLayout>
    );
  }

  const status = getEndpointStatus(endpoint.is_online, endpoint.last_seen_at);
  const statusLabel = status === "healthy" ? "Online" : status === "warning" ? "Idle" : "Offline";
  const activeThreats = threats?.filter(t => !["Resolved", "Removed", "Blocked"].includes(t.status)) || [];
  const defenderPolicy = endpoint.defender_policies as { id: string; name: string } | null;
  const agentOutdated = isAgentOutdated(endpoint.agent_version, latestAgentVersion);

  return (
    <MainLayout>
      <div className="animate-fade-in space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button asChild variant="ghost" size="icon">
            <Link to="/endpoints">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <Monitor className="h-6 w-6 text-primary" />
              <h1 className="text-2xl font-bold text-foreground">{endpoint.hostname}</h1>
              <PageHelp
                title={`Endpoint: ${endpoint.hostname}`}
                glossaryAnchor="/glossary"
                whatIsThis={
                  <>
                    <p>
                      Single-pane view of one endpoint. Each tab shows a slice of telemetry:
                      threats, event logs, vulnerabilities, microseg traffic, app launches,
                      software inventory.
                    </p>
                    <p>
                      Header badges flag known gaps: <i>No Defender policy</i>, <i>Not in a
                      group</i>, <i>Agent outdated</i>. Clear those to make the endpoint
                      fully managed.
                    </p>
                  </>
                }
                tasks={[
                  { label: "Check header badges — clear any 'No Defender policy' / 'Not in a group' first" },
                  { label: "Review Threats tab — anything still Active needs triage" },
                  { label: "Vulnerabilities tab — sort by CVSS, patch the criticals" },
                  { label: "Microsegmentation tab — if state is idle, start a learning window", href: "/microsegmentation" },
                  { label: "App Whitelisting tab — see what's running, whitelist what you trust", href: "/app-whitelisting" },
                ]}
                faq={[
                  {
                    q: "What is the status badge (Online/Idle/Offline)?",
                    a: <p>Online = heartbeat in last 10 min. Idle = 10-60 min. Offline = &gt;60 min. Heartbeats fire every ~30s.</p>,
                  },
                  {
                    q: "Why is the agent showing 'Outdated'?",
                    a: <p>The version on the endpoint is behind the latest stable in <code>agent_versions</code>. v0.5.0+ self-update within an hour. Pre-0.5.0 needs reinstall via /deploy.</p>,
                  },
                  {
                    q: "What does 'Not in a group' mean?",
                    a: <p>The endpoint isn't in any endpoint group. Microsegmentation Enforce and group-scoped policies won't apply. Add the endpoint to a group (or click Enforce — Mithras lazy-creates a per-endpoint group).</p>,
                  },
                ]}
              />
              <StatusBadge status={status} label={statusLabel} />
              {activeThreats.length > 0 && (
                <span className="ml-2 inline-flex items-center gap-1">
                  <Badge variant="destructive">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    {activeThreats.length} Active Threat{activeThreats.length > 1 ? "s" : ""}
                  </Badge>
                  <HelpHint title="Active threats on this endpoint" learnMore="/glossary#severity">
                    <p>Defender threats currently in <code>Active</code>, <code>Cleaning</code>, <code>Allowed</code>, or <code>Executing</code> state.</p>
                    <p>Severe/High threats <b>auto-open incidents</b> with SLA timers — check the Threats tab below.</p>
                  </HelpHint>
                </span>
              )}
              {!endpoint.policy_id && (
                <Badge variant="destructive" className="gap-1" title="No Defender policy assigned — agent applies no settings on next pass">
                  <AlertTriangle className="h-3 w-3" />
                  No Defender policy
                </Badge>
              )}
              {/* Gate on !groupsIsLoading so endpoints that ARE in a group
                  don't flash a red 'Not in a group' badge during the two
                  sequential async fetches (endpoint then groups). */}
              {!groupsIsLoading && (!groups || groups.length === 0) && (
                <Badge variant="destructive" className="gap-1" title="Endpoint is not in any group — microsegmentation and firewall policy cannot target it">
                  <AlertTriangle className="h-3 w-3" />
                  Not in a group
                </Badge>
              )}
              {agentOutdated && (
                <span className="inline-flex items-center gap-1.5">
                  <Badge
                    variant="outline"
                    className="gap-1 border-amber-500 text-amber-600 dark:text-amber-400"
                    title={`Latest stable is v${latestAgentVersion}`}
                  >
                    <ArrowUpCircle className="h-3 w-3" />
                    Agent outdated (v{endpoint.agent_version} → v{latestAgentVersion})
                  </Badge>
                  <UpgradeAgentButton
                    endpointId={endpoint.id}
                    hostname={endpoint.hostname}
                    currentVersion={endpoint.agent_version}
                  />
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {endpoint.last_seen_at
                ? `Last seen ${formatDistanceToNow(new Date(endpoint.last_seen_at), { addSuffix: true })}`
                : "Never seen"}
              {" · "}Registered {format(new Date(endpoint.created_at), "MMM d, yyyy")}
            </p>
          </div>
        </div>

        {/* Remote Desktop quick-launch — only enabled once Remote Access is installed */}
        <div className="flex justify-end items-center gap-2 flex-wrap">
          <DecommissionButton endpointId={endpoint.id} hostname={endpoint.hostname} />
          <RemoteDesktopButton endpointId={endpoint.id} hostname={endpoint.hostname} meshAgentState={endpoint.mesh_agent_state ?? "not_installed"} />
        </div>

        {/* Live response — admin-only active response card */}
        <EndpointResponseActions endpointId={endpoint.id} hostname={endpoint.hostname} />

        {/* Remote Access (MeshAgent) opt-in install controls */}
        <RemoteAccessCard endpointId={endpoint.id} hostname={endpoint.hostname} />

        {/* Isolation mode (notify_only vs enforce) — sits next to response actions */}
        <IsolationModeToggle endpointId={endpoint.id} hostname={endpoint.hostname} />

        {/* Defender posture / lockdown triage */}
        <DefenderStateCard endpointId={endpoint.id} />

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <HardDrive className="h-4 w-4" /> System
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <p className="text-sm"><span className="text-muted-foreground">OS:</span> {endpoint.os_version || "Unknown"}</p>
              <p className="text-sm"><span className="text-muted-foreground">Build:</span> {endpoint.os_build || "Unknown"}</p>
              <p className="text-sm"><span className="text-muted-foreground">Agent:</span> {endpoint.agent_version || "Unknown"}</p>
              <p className="text-sm"><span className="text-muted-foreground">Defender:</span> {endpoint.defender_version || "Unknown"}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Shield className="h-4 w-4" /> Protection
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              <BooleanIndicator value={latestStatus?.realtime_protection_enabled ?? null} label="Real-time Protection" />
              <BooleanIndicator value={latestStatus?.antivirus_enabled ?? null} label="Antivirus" />
              <BooleanIndicator value={latestStatus?.behavior_monitor_enabled ?? null} label="Behavior Monitor" />
              <BooleanIndicator value={latestStatus?.ioav_protection_enabled ?? null} label="IOAV Protection" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <FileText className="h-4 w-4" /> Policies
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div>
                <p className="text-xs text-muted-foreground">Defender Policy</p>
                <p className="text-sm font-medium">{defenderPolicy?.name || "None"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Groups</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {groups && groups.length > 0 ? groups.map(g => {
                    const grp = g.endpoint_groups as unknown as { id: string; name: string } | null;
                    return grp ? (
                      <Badge key={grp.id} variant="secondary" className="text-xs">{grp.name}</Badge>
                    ) : null;
                  }) : <span className="text-xs text-muted-foreground">No groups</span>}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" /> Threats Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-2xl font-bold text-destructive">{activeThreats.length}</p>
                  <p className="text-xs text-muted-foreground">Active</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{threats?.length || 0}</p>
                  <p className="text-xs text-muted-foreground">Total</p>
                </div>
              </div>
              {latestStatus?.antivirus_signature_age !== null && latestStatus?.antivirus_signature_age !== undefined && (
                <p className="text-xs text-muted-foreground mt-2">
                  Signature age: {latestStatus.antivirus_signature_age} day{latestStatus.antivirus_signature_age !== 1 ? "s" : ""}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="threats" className="space-y-4">
          <TabsList>
            <TabsTrigger value="threats">
              <AlertTriangle className="h-4 w-4 mr-2" />
              Threats ({threats?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="events">
              <ScrollText className="h-4 w-4 mr-2" />
              Event Logs ({recentLogs?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="vulnerabilities">
              <Bug className="h-4 w-4 mr-2" />
              Vulnerabilities ({openFindings.length})
            </TabsTrigger>
            <TabsTrigger value="microseg">
              <Network className="h-4 w-4 mr-2" />
              Microsegmentation
            </TabsTrigger>
            <TabsTrigger value="appwhitelist">
              <ShieldCheck className="h-4 w-4 mr-2" />
              App Whitelisting
            </TabsTrigger>
            <TabsTrigger value="software">
              <Package className="h-4 w-4 mr-2" />
              Software ({endpointSoftware.length})
            </TabsTrigger>
            <TabsTrigger value="updates">
              <History className="h-4 w-4 mr-2" />
              Updates ({updateLog?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="status">
              <Activity className="h-4 w-4 mr-2" />
              Full Status
            </TabsTrigger>
          </TabsList>

          <TabsContent value="threats">
            <Card>
              <CardContent className="pt-6">
                {threats && threats.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Threat</TableHead>
                        <TableHead>Severity</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Detected</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {threats.map(threat => {
                        const sevUnknown = !threat.severity || threat.severity === "Unknown";
                        const catBlank   = !threat.category;
                        return (
                        <TableRow key={threat.id}>
                          <TableCell className="font-medium">{threat.threat_name || `Defender detection #${threat.threat_id}`}</TableCell>
                          <TableCell>
                            {sevUnknown ? (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge variant="outline" className="cursor-help border-dashed">Unknown</Badge>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs text-xs">
                                    Defender's threat catalog didn't return a severity for this detection — usually because Defender resolved it before the agent could query MAPS, or this is a historical detection from before agent v0.7.10. Newer detections show the real severity.
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : (
                              <Badge variant={
                                threat.severity === "Severe" ? "destructive" :
                                threat.severity === "High" ? "destructive" :
                                threat.severity === "Moderate" ? "secondary" : "outline"
                              }>
                                {threat.severity}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant={
                              ["Resolved", "Removed", "Blocked"].includes(threat.status) ? "outline" : "destructive"
                            }>
                              {threat.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {catBlank ? (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-4">—</span>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs text-xs">
                                    Defender didn't report a category for this detection. Pre-v0.7.10 agents shipped category as a raw integer that couldn't be mapped; v0.7.10+ resolves it to a readable name (e.g. HackTool, Trojan, PUA).
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : threat.category}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {threat.initial_detection_time
                              ? formatDistanceToNow(new Date(threat.initial_detection_time), { addSuffix: true })
                              : "Unknown"}
                          </TableCell>
                        </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <EmptyState
                    icon={<Shield className="h-6 w-6" />}
                    title="No threats detected on this endpoint"
                    tone="positive"
                    compact
                    description={<p>Defender hasn't reported anything since the agent enrolled. New detections appear here within ~60s.</p>}
                    secondaryAction={{ label: "Test ingestion with EICAR →", href: "/glossary#severity" }}
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="events">
            <Card>
              <CardContent className="pt-6">
                {recentLogs && recentLogs.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time</TableHead>
                        <TableHead>Event ID</TableHead>
                        <TableHead>Level</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead className="max-w-md">Message</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentLogs.map(log => (
                        <TableRow key={log.id}>
                          <TableCell className="whitespace-nowrap text-muted-foreground text-xs">
                            {format(new Date(log.event_time), "MMM d HH:mm:ss")}
                          </TableCell>
                          <TableCell>{log.event_id}</TableCell>
                          <TableCell>
                            <Badge variant={
                              log.level === "Error" || log.level === "Critical" ? "destructive" :
                              log.level === "Warning" ? "secondary" : "outline"
                            } className="text-xs">
                              {log.level}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{log.provider_name || log.log_source}</TableCell>
                          <TableCell className="max-w-md truncate text-xs">{log.message}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <ScrollText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No event logs found for this endpoint</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="vulnerabilities">
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="flex flex-wrap items-center gap-2 justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    {sevCount("critical") > 0 && (
                      <Badge variant="destructive">{sevCount("critical")} critical</Badge>
                    )}
                    {sevCount("high") > 0 && (
                      <Badge variant="destructive" className="bg-orange-600">{sevCount("high")} high</Badge>
                    )}
                    {sevCount("medium") > 0 && (
                      <Badge variant="secondary">{sevCount("medium")} medium</Badge>
                    )}
                    {sevCount("low") > 0 && (
                      <Badge variant="outline">{sevCount("low")} low</Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      ({endpointFindings.length - openFindings.length} resolved)
                    </span>
                  </div>
                  <Link to="/vulnerabilities" className="text-sm text-primary hover:underline">
                    Open vulnerabilities dashboard →
                  </Link>
                </div>
                {openFindings.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>CVE</TableHead>
                        <TableHead>Severity</TableHead>
                        <TableHead>CVSS</TableHead>
                        <TableHead>Software</TableHead>
                        <TableHead>First seen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {openFindings.slice(0, 20).map((f: any) => (
                        <TableRow key={f.id}>
                          <TableCell className="font-mono text-xs">{f.cve_id || "—"}</TableCell>
                          <TableCell>
                            <Badge variant={
                              f.severity === "critical" || f.severity === "high" ? "destructive" :
                              f.severity === "medium" ? "secondary" : "outline"
                            }>
                              {f.severity}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground tabular-nums">{f.cvss_score ?? "—"}</TableCell>
                          <TableCell className="text-muted-foreground">{f.affected_software || "—"}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {f.created_at ? formatDistanceToNow(new Date(f.created_at), { addSuffix: true }) : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Bug className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No open vulnerabilities on this endpoint</p>
                    {endpointSoftware.length === 0 && (
                      <p className="text-xs mt-1">Software inventory hasn't reported yet — scan can't run until then.</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="microseg">
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="flex flex-wrap items-center gap-3 justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Inbound state:</span>
                    <Badge variant={
                      microsegSnap?.state === "enforcing" ? "destructive" :
                      microsegSnap?.state === "learning" ? "secondary" : "outline"
                    }>
                      {microsegSnap?.state || "idle"}
                    </Badge>
                    {microsegSnap?.observation_started_at && (
                      <span className="text-xs text-muted-foreground">
                        since {formatDistanceToNow(new Date(microsegSnap.observation_started_at), { addSuffix: true })}
                      </span>
                    )}
                  </div>
                  <Link to="/microsegmentation" className="text-sm text-primary hover:underline">
                    Open dashboard (inbound + outbound) →
                  </Link>
                </div>
                {microsegSnap?.traffic && microsegSnap.traffic.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Service</TableHead>
                        <TableHead>Port</TableHead>
                        <TableHead>Proto</TableHead>
                        <TableHead className="text-right">Hits (7d)</TableHead>
                        <TableHead className="text-right">Sources</TableHead>
                        <TableHead>Last seen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {microsegSnap.traffic.slice(0, 15).map((t: any, idx: number) => (
                        <TableRow key={`${t.local_port}-${t.protocol}-${idx}`}>
                          <TableCell>{t.service_name || "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{t.local_port}</TableCell>
                          <TableCell className="text-muted-foreground uppercase text-xs">{t.protocol}</TableCell>
                          <TableCell className="text-right tabular-nums">{t.hits_7d.toLocaleString()}</TableCell>
                          <TableCell className="text-right tabular-nums">{t.unique_sources}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {t.last_seen ? formatDistanceToNow(new Date(t.last_seen), { addSuffix: true }) : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <EmptyState
                    icon={<Network className="h-6 w-6" />}
                    title={microsegSnap?.state === "learning" ? "Learning window active — traffic aggregating" : "No traffic observed yet"}
                    tone={microsegSnap?.state === "learning" ? "warning" : "default"}
                    compact
                    description={
                      microsegSnap?.state === "learning"
                        ? <p>The agent is observing inbound packets — they'll surface here within a few minutes of any matching activity. Run the learning window for ~7 days for a representative baseline.</p>
                        : <p>Start a learning window so the agent watches this endpoint's traffic. After ~7 days, click Enforce to lock down anything unobserved.</p>
                    }
                    primaryAction={
                      microsegSnap?.state === "learning"
                        ? undefined
                        : { label: "Open microsegmentation dashboard", href: "/microsegmentation" }
                    }
                    secondaryAction={{ label: "How microsegmentation works →", href: "/glossary#microsegmentation" }}
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="appwhitelist">
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="flex flex-wrap items-center gap-3 justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Mode:</span>
                    <Badge variant={
                      appWhitelistSnap?.mode === "enforcing" ? "destructive" :
                      appWhitelistSnap?.mode === "auditing" ? "secondary" : "outline"
                    }>
                      {appWhitelistSnap?.mode || "idle"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {appWhitelistSnap?.observed?.length || 0} observed apps · {appWhitelistSnap?.rules?.length || 0} whitelist rules
                    </span>
                  </div>
                  <Link to="/app-whitelisting" className="text-sm text-primary hover:underline">
                    Open dashboard →
                  </Link>
                </div>
                {appWhitelistSnap?.observed && appWhitelistSnap.observed.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Application</TableHead>
                        <TableHead>Publisher</TableHead>
                        <TableHead className="text-right">Launches</TableHead>
                        <TableHead className="text-right">Blocked</TableHead>
                        <TableHead>Whitelisted</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {appWhitelistSnap.observed.slice(0, 15).map((o: any) => (
                        <TableRow key={o.sha256}>
                          <TableCell className="font-medium">{o.product_name || o.file_name || o.sha256.slice(0, 12)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{o.publisher || "Unsigned"}</TableCell>
                          <TableCell className="text-right tabular-nums">{o.launches.toLocaleString()}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {o.blocked > 0 ? <span className="text-red-500 font-medium">{o.blocked}</span> : <span className="text-muted-foreground">0</span>}
                          </TableCell>
                          <TableCell>
                            {o.whitelisted ? <CheckCircle2 className="h-4 w-4 text-status-healthy" /> : <XCircle className="h-4 w-4 text-muted-foreground" />}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <EmptyState
                    icon={<ShieldCheck className="h-6 w-6" />}
                    title={appWhitelistSnap?.mode === "auditing" ? "Audit running — process launches will appear here shortly" : "No process launches observed yet"}
                    tone={appWhitelistSnap?.mode === "auditing" ? "warning" : "default"}
                    compact
                    description={
                      appWhitelistSnap?.mode === "auditing"
                        ? <p>The agent is watching every process launch and aggregating by SHA-256 hash. Aggregation may lag a few minutes behind the most recent event.</p>
                        : <p>Start an audit so the agent records every binary that runs. Curate the list, then click Enforce to block anything unfamiliar.</p>
                    }
                    primaryAction={
                      appWhitelistSnap?.mode === "auditing"
                        ? undefined
                        : { label: "Open app whitelisting dashboard", href: "/app-whitelisting" }
                    }
                    secondaryAction={{ label: "How app whitelisting works →", href: "/glossary#app-whitelisting" }}
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="software">
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {endpointSoftware.length} application{endpointSoftware.length === 1 ? "" : "s"} reported
                  </span>
                  <Link to="/vulnerabilities" className="text-sm text-primary hover:underline">
                    Run vulnerability scan →
                  </Link>
                </div>
                {endpointSoftware.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Version</TableHead>
                        <TableHead>Publisher</TableHead>
                        <TableHead>Installed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {endpointSoftware.slice(0, 50).map((s: any) => (
                        <TableRow key={s.id}>
                          <TableCell className="font-medium">{s.software_name}</TableCell>
                          <TableCell className="text-muted-foreground tabular-nums text-xs">{s.software_version || "—"}</TableCell>
                          <TableCell className="text-muted-foreground text-xs">{s.publisher || "Unknown"}</TableCell>
                          <TableCell className="text-muted-foreground text-xs">{s.install_date || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No software inventory reported</p>
                    <p className="text-xs mt-1">Agent ships installed-app inventory hourly.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="updates">
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-sm">
                      Server detects every agent version transition between heartbeats. Server-side rows land here as <code>heartbeat_detected → completed</code>.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      v0.6.3+ agents will report richer in-flight rows (<code>started → downloaded → verified → completed</code>) when they self-update.
                    </p>
                  </div>
                </div>

                {updateLog && updateLog.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>When</TableHead>
                        <TableHead>Transition</TableHead>
                        <TableHead>Trigger</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Error</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {updateLog.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatDistanceToNow(new Date(row.detected_at), { addSuffix: true })}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            <span className="text-muted-foreground">{row.from_version ?? "—"}</span>
                            <span className="mx-1.5 text-muted-foreground">→</span>
                            <span className="font-medium">{row.to_version}</span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{row.trigger}</TableCell>
                          <TableCell>
                            <Badge variant={
                              row.status === "completed" ? "outline" :
                              row.status === "failed"    ? "destructive" : "secondary"
                            }>
                              {row.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-red-500 max-w-md truncate" title={row.error_message ?? undefined}>
                            {row.error_message ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <EmptyState
                    icon={<History className="h-6 w-6" />}
                    title="No update history yet"
                    tone="default"
                    compact
                    description={
                      <p>
                        Once this endpoint's agent_version changes between heartbeats, the
                        transition lands here. Existing endpoints start being tracked from the
                        next change forward.
                      </p>
                    }
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="status">
            <Card>
              <CardContent className="pt-6">
                {latestStatus ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground mb-3">Defender Protection</h3>
                      <div className="space-y-0 divide-y divide-border">
                        <BooleanIndicator value={latestStatus.realtime_protection_enabled} label="Real-time Protection" />
                        <BooleanIndicator value={latestStatus.antivirus_enabled} label="Antivirus" />
                        <BooleanIndicator value={latestStatus.antispyware_enabled} label="Antispyware" />
                        <BooleanIndicator value={latestStatus.behavior_monitor_enabled} label="Behavior Monitor" />
                        <BooleanIndicator value={latestStatus.ioav_protection_enabled} label="IOAV Protection" />
                        <BooleanIndicator value={latestStatus.on_access_protection_enabled} label="On-Access Protection" />
                        <BooleanIndicator value={latestStatus.nis_enabled} label="Network Inspection" />
                      </div>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-foreground mb-3">Signatures & Scans</h3>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">AV Signature Age</span>
                          <span>{latestStatus.antivirus_signature_age ?? "N/A"} days</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">AV Signature Version</span>
                          <span className="text-xs">{latestStatus.antivirus_signature_version || "N/A"}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Quick Scan Age</span>
                          <span>{latestStatus.quick_scan_age ?? "N/A"} days</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Full Scan Age</span>
                          <span>{latestStatus.full_scan_age ?? "N/A"} days</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Tamper Protection</span>
                          <span>{latestStatus.tamper_protection_source || "N/A"}</span>
                        </div>
                      </div>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-foreground mb-3">UAC Settings</h3>
                      <div className="space-y-0 divide-y divide-border">
                        <BooleanIndicator value={latestStatus.uac_enabled} label="UAC Enabled" />
                        <BooleanIndicator value={latestStatus.uac_prompt_on_secure_desktop} label="Secure Desktop" />
                        <BooleanIndicator value={latestStatus.uac_detect_installations} label="Detect Installations" />
                        <BooleanIndicator value={latestStatus.uac_validate_admin_signatures} label="Validate Admin Sigs" />
                        <BooleanIndicator value={latestStatus.uac_filter_administrator_token} label="Filter Admin Token" />
                      </div>
                      <h3 className="text-sm font-semibold text-foreground mb-3 mt-6">Windows Update</h3>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Pending Updates</span>
                          <span>{latestStatus.wu_pending_updates_count ?? "N/A"}</span>
                        </div>
                        <BooleanIndicator value={latestStatus.wu_restart_pending} label="Restart Pending" />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No status data collected yet</p>
                  </div>
                )}
                {latestStatus && (
                  <p className="text-xs text-muted-foreground mt-4 pt-4 border-t border-border">
                    Last collected: {format(new Date(latestStatus.collected_at), "MMM d, yyyy HH:mm:ss")}
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
};

export default EndpointDetail;
