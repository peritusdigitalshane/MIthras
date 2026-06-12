import { MainLayout } from "@/components/layout/MainLayout";
import { EndpointsTable } from "@/components/dashboard/EndpointsTable";
import { Button } from "@/components/ui/button";
import { Plus, Download, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { useEndpoints } from "@/hooks/useDashboardData";
import { useToast } from "@/hooks/use-toast";
import { BulkUpgradeButton } from "@/components/endpoints/BulkUpgradeButton";

const Endpoints = () => {
  const { data: endpoints, refetch, isRefetching } = useEndpoints();
  const { toast } = useToast();

  const handleSync = async () => {
    await refetch();
    toast({ title: "Synced", description: "Endpoint data refreshed." });
  };

  const handleExport = () => {
    if (!endpoints || endpoints.length === 0) {
      toast({ title: "Nothing to export", description: "No endpoints found.", variant: "destructive" });
      return;
    }
    const headers = ["Hostname", "OS", "Agent Version", "Defender Version", "Online", "Last Seen", "Policy ID"];
    const rows = endpoints.map(e => [
      e.hostname,
      e.os_version || "",
      e.agent_version || "",
      e.defender_version || "",
      e.is_online ? "Yes" : "No",
      e.last_seen_at || "",
      e.policy_id || "",
    ]);
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `endpoints-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Exported", description: `${endpoints.length} endpoints exported to CSV.` });
  };

  return (
    <MainLayout>
      <div className="animate-fade-in space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Endpoints</h1>
            <p className="text-sm text-muted-foreground">
              Manage and monitor all registered endpoints
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <BulkUpgradeButton />
            <Button variant="outline" size="sm" onClick={handleSync} disabled={isRefetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
              Sync All
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/policies">Policies</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
            <Button size="sm" className="bg-gradient-primary hover:opacity-90" asChild>
              <Link to="/deploy">
                <Plus className="mr-2 h-4 w-4" />
                Add Endpoint
              </Link>
            </Button>
          </div>
        </div>

        <EndpointsTable showHeader={false} />
      </div>
    </MainLayout>
  );
};

export default Endpoints;
