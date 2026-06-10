import { MainLayout } from "@/components/layout/MainLayout";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/help/EmptyState";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bug,
  ShieldAlert,
  AlertTriangle,
  Monitor,
  Search,
  ExternalLink,
  MoreHorizontal,
  CheckCircle,
  ShieldOff,
  Package,
  Loader2,
  Play,
  Sparkles,
  Download,
  FileDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Layers,
} from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { VulnerabilityImportDialog } from "@/components/vulnerabilities/VulnerabilityImportDialog";
import { CveMitigationSheet } from "@/components/vulnerabilities/CveMitigationSheet";
import { VulnerabilityTrendChart } from "@/components/vulnerabilities/VulnerabilityTrendChart";
import {
  useVulnerabilityFindings,
  useVulnerabilityStats,
  useSoftwareInventory,
  useUpdateFindingStatus,
  usePatchDevice,
  useBulkPatchDevices,
  useBulkUpdateFindingStatus,
} from "@/hooks/useVulnerabilities";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow, differenceInDays } from "date-fns";

const severityConfig: Record<string, { color: string; label: string }> = {
  critical: { color: "bg-red-500/10 text-red-500 border-red-500/20", label: "Critical" },
  high: { color: "bg-orange-500/10 text-orange-500 border-orange-500/20", label: "High" },
  medium: { color: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20", label: "Medium" },
  low: { color: "bg-blue-500/10 text-blue-500 border-blue-500/20", label: "Low" },
};

const statusConfig: Record<string, { color: string; label: string }> = {
  open: { color: "bg-red-500/10 text-red-500 border-red-500/20", label: "Open" },
  mitigated: { color: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20", label: "Mitigated" },
  accepted: { color: "bg-blue-500/10 text-blue-500 border-blue-500/20", label: "Accepted" },
  resolved: { color: "bg-green-500/10 text-green-500 border-green-500/20", label: "Resolved" },
};

const ITEMS_PER_PAGE = 25;

function getAgingBadge(createdAt: string, status: string) {
  if (status !== "open") return null;
  const days = differenceInDays(new Date(), new Date(createdAt));
  if (days >= 30) return <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20 text-xs ml-1">{days}d</Badge>;
  if (days >= 14) return <Badge variant="outline" className="bg-orange-500/10 text-orange-500 border-orange-500/20 text-xs ml-1">{days}d</Badge>;
  if (days >= 7) return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20 text-xs ml-1">{days}d</Badge>;
  return null;
}

function exportFindingsCSV(findings: any[]) {
  const headers = ["CVE ID", "Severity", "CVSS", "Affected Software", "Version", "Fixed Version", "Endpoint", "Status", "Found", "Days Open"];
  const rows = findings.map((f) => [
    f.cve_id,
    f.severity,
    f.cvss_score ?? "",
    f.affected_software,
    f.affected_version || "",
    f.fixed_version || "",
    (f.endpoints as any)?.hostname || "Unknown",
    f.status,
    f.created_at,
    f.status === "open" ? differenceInDays(new Date(), new Date(f.created_at)) : "",
  ]);

  const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vulnerability-findings-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const Vulnerabilities = () => {
  const { data: findings, isLoading } = useVulnerabilityFindings();
  const { stats } = useVulnerabilityStats();
  const { data: software } = useSoftwareInventory();
  const updateStatus = useUpdateFindingStatus();
  const patchDevice = usePatchDevice();
  const bulkPatch = useBulkPatchDevices();
  const bulkStatus = useBulkUpdateFindingStatus();
  const { currentOrganization } = useTenant();
  const { toast } = useToast();
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null);

  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [mitigationFinding, setMitigationFinding] = useState<any>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState<"findings" | "grouped">("findings");
  const [softwareFilter, setSoftwareFilter] = useState<string | null>(null);

  const queryClient = useQueryClient();

  const handleRunScan = async () => {
    if (!currentOrganization) return;
    setIsScanning(true);
    setScanProgress(null);
    let totalUpserted = 0;
    let totalApps = 0;
    try {
      // cve-auto-scan processes one BATCH per invocation to fit in the edge
      // runtime CPU limit. Call it in a loop until remaining_stale_apps hits 0,
      // showing progress so the user sees something happen.
      let safety = 50; // hard ceiling: never more than 50 chained calls per scan
      while (safety-- > 0) {
        const { data, error } = await supabase.functions.invoke("cve-auto-scan", {
          body: { organization_id: currentOrganization.id, batch_size: 30 },
        });
        if (error) throw error;
        totalUpserted += data.findings_upserted ?? 0;
        totalApps = data.total_unique_apps ?? totalApps;
        const remaining: number = data.remaining_stale_apps ?? 0;
        setScanProgress({ done: totalApps - remaining, total: totalApps });
        if (remaining <= 0) break;
        // small breather between batches so the UI can re-render
        await new Promise((r) => setTimeout(r, 50));
      }
      toast({
        title: "Scan complete",
        description: `Reviewed ${totalApps} unique apps. ${totalUpserted} CVE findings recorded.`,
      });
      queryClient.invalidateQueries({ queryKey: ["vulnerability-findings"] });
      queryClient.invalidateQueries({ queryKey: ["software-inventory"] });
    } catch (err: any) {
      toast({
        title: "Scan failed",
        description: err.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsScanning(false);
      setScanProgress(null);
    }
  };

  const filteredFindings = useMemo(() => {
    return (findings || []).filter((f) => {
      const matchesSearch =
        !search ||
        f.cve_id.toLowerCase().includes(search.toLowerCase()) ||
        f.affected_software.toLowerCase().includes(search.toLowerCase()) ||
        (f.endpoints as any)?.hostname?.toLowerCase().includes(search.toLowerCase());
      const matchesSeverity = severityFilter === "all" || f.severity === severityFilter;
      const matchesStatus = statusFilter === "all" || f.status === statusFilter;
      const matchesSoftware = !softwareFilter || f.affected_software.toLowerCase() === softwareFilter.toLowerCase();
      return matchesSearch && matchesSeverity && matchesStatus && matchesSoftware;
    });
  }, [findings, search, severityFilter, statusFilter, softwareFilter]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredFindings.length / ITEMS_PER_PAGE));
  const paginatedFindings = filteredFindings.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  // Reset page when filters change
  useEffect(() => { setCurrentPage(1); }, [search, severityFilter, statusFilter, softwareFilter]);

  // Grouped CVE view
  const groupedCves = useMemo(() => {
    if (!findings) return [];
    const groups = new Map<string, {
      cve_id: string;
      severity: string;
      cvss_score: number | null;
      affected_software: string;
      affected_version: string | null;
      fixed_version: string | null;
      device_count: number;
      open_count: number;
      endpoints: string[];
      oldest_created: string;
      finding_ids: string[];
    }>();

    for (const f of filteredFindings) {
      const key = f.cve_id;
      if (!groups.has(key)) {
        groups.set(key, {
          cve_id: f.cve_id,
          severity: f.severity,
          cvss_score: f.cvss_score,
          affected_software: f.affected_software,
          affected_version: f.affected_version,
          fixed_version: f.fixed_version,
          device_count: 0,
          open_count: 0,
          endpoints: [],
          oldest_created: f.created_at,
          finding_ids: [],
        });
      }
      const g = groups.get(key)!;
      g.device_count++;
      g.finding_ids.push(f.id);
      if (f.status === "open") g.open_count++;
      const hostname = (f.endpoints as any)?.hostname;
      if (hostname && !g.endpoints.includes(hostname)) g.endpoints.push(hostname);
      if (f.created_at < g.oldest_created) g.oldest_created = f.created_at;
    }

    return Array.from(groups.values()).sort((a, b) => (b.cvss_score ?? 0) - (a.cvss_score ?? 0));
  }, [filteredFindings, findings]);

  // Selection handlers
  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === paginatedFindings.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(paginatedFindings.map((f) => f.id)));
    }
  };

  const handleBulkPatch = () => {
    const selected = (findings || []).filter((f) => selectedIds.has(f.id) && f.status === "open");
    if (selected.length === 0) return;
    bulkPatch.mutate(
      selected.map((f) => ({
        endpointId: f.endpoint_id,
        organizationId: f.organization_id,
        cveId: f.cve_id,
      })),
      { onSuccess: () => setSelectedIds(new Set()) }
    );
  };

  const handleBulkStatus = (status: string) => {
    if (selectedIds.size === 0) return;
    bulkStatus.mutate(
      { ids: Array.from(selectedIds), status },
      { onSuccess: () => setSelectedIds(new Set()) }
    );
  };

  // Software inventory grouped
  const softwareGrouped = (software || []).reduce((acc, item) => {
    const key = `${item.software_name}|${item.software_version}`;
    if (!acc[key]) {
      acc[key] = { ...item, count: 0 };
    }
    acc[key].count++;
    return acc;
  }, {} as Record<string, any>);

  // Count CVEs per software name
  const cvesPerSoftware = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of (findings || [])) {
      const sw = f.affected_software.toLowerCase();
      map.set(sw, (map.get(sw) || 0) + 1);
    }
    return map;
  }, [findings]);

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Vulnerability Scanner</h1>
            <p className="text-muted-foreground">
              CVE findings across your endpoints from scans, KB gap analysis, and imports
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => exportFindingsCSV(filteredFindings)} disabled={filteredFindings.length === 0}>
              <FileDown className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
            <VulnerabilityImportDialog />
            <Button onClick={handleRunScan} disabled={isScanning}>
              {isScanning ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              {isScanning && scanProgress
                ? `Scanning ${scanProgress.done}/${scanProgress.total}`
                : "Run Scan"}
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard title="Total CVEs" value={isLoading ? "-" : stats.total.toString()} icon={Bug} />
          <StatCard title="Critical" value={isLoading ? "-" : stats.critical.toString()} icon={ShieldAlert} />
          <StatCard title="High" value={isLoading ? "-" : stats.high.toString()} icon={AlertTriangle} />
          <StatCard title="Open" value={isLoading ? "-" : stats.open.toString()} icon={ShieldOff} />
          <StatCard title="Affected Endpoints" value={isLoading ? "-" : stats.affectedEndpoints.toString()} icon={Monitor} />
        </div>

        {/* Trend Chart */}
        <VulnerabilityTrendChart findings={findings || []} />

        {/* Software Filter Banner */}
        {softwareFilter && (
          <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/50">
            <span className="text-sm">Filtered to software: <strong>{softwareFilter}</strong></span>
            <Button variant="ghost" size="sm" onClick={() => setSoftwareFilter(null)}>Clear</Button>
          </div>
        )}

        <Tabs defaultValue="findings">
          <TabsList>
            <TabsTrigger value="findings">CVE Findings</TabsTrigger>
            <TabsTrigger value="inventory">Software Inventory</TabsTrigger>
          </TabsList>

          <TabsContent value="findings" className="space-y-4">
            {/* Filters */}
            <Card>
              <CardContent className="pt-4">
                <div className="flex flex-wrap gap-3 items-center">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search CVE ID, software, or hostname..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <Select value={severityFilter} onValueChange={setSeverityFilter}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="Severity" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Severity</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="mitigated">Mitigated</SelectItem>
                      <SelectItem value="accepted">Accepted</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex border rounded-md">
                    <Button
                      variant={viewMode === "findings" ? "default" : "ghost"}
                      size="sm"
                      className="rounded-r-none"
                      onClick={() => setViewMode("findings")}
                    >
                      Per Device
                    </Button>
                    <Button
                      variant={viewMode === "grouped" ? "default" : "ghost"}
                      size="sm"
                      className="rounded-l-none"
                      onClick={() => setViewMode("grouped")}
                    >
                      <Layers className="mr-1 h-3.5 w-3.5" />
                      By CVE
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Bulk Actions Toolbar */}
            {selectedIds.size > 0 && viewMode === "findings" && (
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-primary/5 border-primary/20">
                <span className="text-sm font-medium">{selectedIds.size} selected</span>
                <Button size="sm" onClick={handleBulkPatch} disabled={bulkPatch.isPending}>
                  {bulkPatch.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}
                  Patch All
                </Button>
                <Button size="sm" variant="outline" disabled={bulkStatus.isPending} onClick={() => handleBulkStatus("mitigated")}>
                  Mark Mitigated
                </Button>
                <Button size="sm" variant="outline" disabled={bulkStatus.isPending} onClick={() => handleBulkStatus("resolved")}>
                  Mark Resolved
                </Button>
                <Button size="sm" variant="outline" disabled={bulkStatus.isPending} onClick={() => handleBulkStatus("accepted")}>
                  Accept Risk
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                  Clear
                </Button>
              </div>
            )}

            {/* Grouped CVE View */}
            {viewMode === "grouped" ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">
                    Grouped by CVE
                    <span className="ml-2 text-sm font-normal text-muted-foreground">({groupedCves.length} unique CVEs)</span>
                  </CardTitle>
                  <CardDescription>Each CVE shown once with affected device count</CardDescription>
                </CardHeader>
                <CardContent>
                  {groupedCves.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <CheckCircle className="h-12 w-12 text-green-500 mb-3" />
                      <h3 className="text-lg font-semibold">No vulnerabilities found</h3>
                    </div>
                  ) : (
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>CVE ID</TableHead>
                            <TableHead>Severity</TableHead>
                            <TableHead>CVSS</TableHead>
                            <TableHead>Software</TableHead>
                            <TableHead>Devices</TableHead>
                            <TableHead>Open</TableHead>
                            <TableHead>Age</TableHead>
                            <TableHead>Hosts</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {groupedCves.map((g) => {
                            const sev = severityConfig[g.severity] || severityConfig.medium;
                            return (
                              <TableRow key={g.cve_id}>
                                <TableCell>
                                  <a
                                    href={`https://nvd.nist.gov/vuln/detail/${g.cve_id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1 font-mono text-sm text-primary hover:underline"
                                  >
                                    {g.cve_id}
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline" className={sev.color}>{sev.label}</Badge>
                                </TableCell>
                                <TableCell className="font-mono text-sm">{g.cvss_score ?? "-"}</TableCell>
                                <TableCell>
                                  <p className="text-sm font-medium">{g.affected_software}</p>
                                  {g.affected_version && (
                                    <p className="text-xs text-muted-foreground">
                                      v{g.affected_version}
                                      {g.fixed_version && <span className="ml-1">→ fix: v{g.fixed_version}</span>}
                                    </p>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <Badge variant="secondary">{g.device_count}</Badge>
                                </TableCell>
                                <TableCell>
                                  {g.open_count > 0 ? (
                                    <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20">{g.open_count}</Badge>
                                  ) : (
                                    <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">0</Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                  <div className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    {differenceInDays(new Date(), new Date(g.oldest_created))}d
                                  </div>
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate">
                                  {g.endpoints.slice(0, 3).join(", ")}
                                  {g.endpoints.length > 3 && ` +${g.endpoints.length - 3}`}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              /* Per-Device Findings Table */
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">
                    CVE Findings
                    {filteredFindings.length > 0 && (
                      <span className="ml-2 text-sm font-normal text-muted-foreground">
                        ({filteredFindings.length})
                      </span>
                    )}
                  </CardTitle>
                  <CardDescription>Vulnerabilities detected across your fleet</CardDescription>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : filteredFindings.length === 0 ? (
                    stats.total === 0 ? (
                      <div className="py-6">
                        <EmptyState
                          icon={<CheckCircle className="h-7 w-7" />}
                          title="No CVE findings yet"
                          tone="default"
                          description={<p>Vulnerability findings appear here once the agent reports software inventory and a scan runs. Scans use AI to map installed apps to known CVEs.</p>}
                          steps={[
                            { done: (software?.length ?? 0) > 0, label: `Agent reports software inventory (${software?.length ?? 0} packages so far)`, detail: "Hourly cadence by default." },
                            { done: false, label: "Run the auto-scan", detail: "Nightly cron + on-demand from this page. First scan can take a few minutes if cache is cold." },
                            { done: false, label: "Triage findings", detail: "Mark mitigated, suppress false positives, or queue a patch command." },
                          ]}
                          secondaryAction={{ label: "How scanning works →", href: "/glossary" }}
                        />
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-12 text-center">
                        <CheckCircle className="h-12 w-12 text-green-500 mb-3" />
                        <h3 className="text-lg font-semibold">No vulnerabilities match your filters</h3>
                        <p className="text-sm text-muted-foreground mt-1 max-w-md">
                          Try clearing the search or relaxing the severity/status filter.
                        </p>
                      </div>
                    )
                  ) : (
                    <>
                      <div className="rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-10">
                                <Checkbox
                                  checked={paginatedFindings.length > 0 && selectedIds.size === paginatedFindings.length}
                                  onCheckedChange={toggleSelectAll}
                                />
                              </TableHead>
                              <TableHead>CVE ID</TableHead>
                              <TableHead>Severity</TableHead>
                              <TableHead>CVSS</TableHead>
                              <TableHead>Affected Software</TableHead>
                              <TableHead>Endpoint</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Age</TableHead>
                              <TableHead className="w-10" />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {paginatedFindings.map((finding) => {
                              const sev = severityConfig[finding.severity] || severityConfig.medium;
                              const stat = statusConfig[finding.status] || statusConfig.open;
                              return (
                                <TableRow key={finding.id} className={selectedIds.has(finding.id) ? "bg-primary/5" : ""}>
                                  <TableCell>
                                    <Checkbox
                                      checked={selectedIds.has(finding.id)}
                                      onCheckedChange={() => toggleSelect(finding.id)}
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <a
                                      href={`https://nvd.nist.gov/vuln/detail/${finding.cve_id}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center gap-1 font-mono text-sm text-primary hover:underline"
                                    >
                                      {finding.cve_id}
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant="outline" className={sev.color}>{sev.label}</Badge>
                                  </TableCell>
                                  <TableCell className="font-mono text-sm">{finding.cvss_score ?? "-"}</TableCell>
                                  <TableCell>
                                    <div>
                                      <button
                                        className="text-sm font-medium text-primary hover:underline text-left"
                                        onClick={() => setSoftwareFilter(finding.affected_software)}
                                      >
                                        {finding.affected_software}
                                      </button>
                                      {finding.affected_version && (
                                        <p className="text-xs text-muted-foreground">
                                          v{finding.affected_version}
                                          {finding.fixed_version && (
                                            <span className="ml-1">→ fix: v{finding.fixed_version}</span>
                                          )}
                                        </p>
                                      )}
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-sm">
                                    {(finding.endpoints as any)?.hostname || "Unknown"}
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant="outline" className={stat.color}>{stat.label}</Badge>
                                  </TableCell>
                                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                    <div className="flex items-center">
                                      {formatDistanceToNow(new Date(finding.created_at), { addSuffix: true })}
                                      {getAgingBadge(finding.created_at, finding.status)}
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Finding options">
                                          <MoreHorizontal className="h-4 w-4" />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        {finding.status === "open" && (
                                          <>
                                            <DropdownMenuItem
                                              onClick={() =>
                                                patchDevice.mutate({
                                                  endpointId: finding.endpoint_id,
                                                  organizationId: finding.organization_id,
                                                  cveId: finding.cve_id,
                                                })
                                              }
                                            >
                                              <Download className="mr-2 h-4 w-4" />
                                              Patch Device
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => updateStatus.mutate({ id: finding.id, status: "mitigated" })}>
                                              Mark Mitigated
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => updateStatus.mutate({ id: finding.id, status: "accepted" })}>
                                              Accept Risk
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => updateStatus.mutate({ id: finding.id, status: "resolved" })}>
                                              Mark Resolved
                                            </DropdownMenuItem>
                                          </>
                                        )}
                                        {finding.status !== "open" && (
                                          <DropdownMenuItem onClick={() => updateStatus.mutate({ id: finding.id, status: "open" })}>
                                            Reopen
                                          </DropdownMenuItem>
                                        )}
                                        <DropdownMenuItem onClick={() => setMitigationFinding(finding)}>
                                          <Sparkles className="mr-2 h-4 w-4" />
                                          AI Mitigation Advice
                                        </DropdownMenuItem>
                                        <DropdownMenuItem asChild>
                                          <a href={`https://nvd.nist.gov/vuln/detail/${finding.cve_id}`} target="_blank" rel="noopener noreferrer">
                                            View on NVD
                                          </a>
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>

                      {/* Pagination */}
                      {totalPages > 1 && (
                        <div className="flex items-center justify-between pt-4">
                          <p className="text-sm text-muted-foreground">
                            Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, filteredFindings.length)} of {filteredFindings.length}
                          </p>
                          <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage((p) => p - 1)}>
                              <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <span className="text-sm">
                              Page {currentPage} of {totalPages}
                            </span>
                            <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage((p) => p + 1)}>
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="inventory" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  Software Inventory
                </CardTitle>
                <CardDescription>Installed software collected from your endpoints — click a name to filter CVE findings</CardDescription>
              </CardHeader>
              <CardContent>
                {Object.keys(softwareGrouped).length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Package className="h-12 w-12 text-muted-foreground mb-3" />
                    <h3 className="text-lg font-semibold">No software inventory yet</h3>
                    <p className="text-sm text-muted-foreground mt-1 max-w-md">
                      Software inventory will appear here once endpoints report their installed applications.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Software</TableHead>
                          <TableHead>Version</TableHead>
                          <TableHead>Publisher</TableHead>
                          <TableHead>Endpoints</TableHead>
                          <TableHead>CVEs</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.values(softwareGrouped).map((sw: any) => {
                          const cveCount = cvesPerSoftware.get(sw.software_name.toLowerCase()) || 0;
                          return (
                            <TableRow key={`${sw.software_name}-${sw.software_version}`}>
                              <TableCell>
                                <button
                                  className="font-medium text-primary hover:underline text-left"
                                  onClick={() => {
                                    setSoftwareFilter(sw.software_name);
                                    const findingsTab = document.querySelector('[value="findings"]') as HTMLElement;
                                    if (findingsTab) findingsTab.click();
                                  }}
                                >
                                  {sw.software_name}
                                </button>
                              </TableCell>
                              <TableCell className="font-mono text-sm">{sw.software_version || "-"}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">{sw.publisher || "-"}</TableCell>
                              <TableCell>
                                <Badge variant="secondary">{sw.count}</Badge>
                              </TableCell>
                              <TableCell>
                                {cveCount > 0 ? (
                                  <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20">{cveCount}</Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <CveMitigationSheet
        finding={mitigationFinding}
        open={!!mitigationFinding}
        onOpenChange={(open) => {
          if (!open) setMitigationFinding(null);
        }}
        organizationId={currentOrganization?.id}
      />
    </MainLayout>
  );
};

export default Vulnerabilities;
