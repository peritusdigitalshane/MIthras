import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
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
  useEndpointHardeningStatuses,
  useHardeningProfiles,
  useAssignHardeningProfile,
} from "@/hooks/useHardening";
import { Monitor, Search, Shield, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const OS_LABELS: Record<string, string> = {
  legacy_win10: "Windows 10",
  legacy_server2012r2: "Server 2012 R2",
  legacy_server2012: "Server 2012",
  legacy_win7: "Windows 7",
  legacy_win81: "Windows 8.1",
  supported: "Supported",
  unknown: "Unknown",
};

function getScoreBadge(score: number) {
  if (score >= 80) return <Badge className="bg-emerald-500/10 text-emerald-600">{score}%</Badge>;
  if (score >= 50) return <Badge className="bg-amber-500/10 text-amber-600">{score}%</Badge>;
  return <Badge variant="destructive">{score}%</Badge>;
}

export function HardeningEndpoints() {
  const { data: statuses, isLoading } = useEndpointHardeningStatuses();
  const { data: profiles } = useHardeningProfiles();
  const assignProfile = useAssignHardeningProfile();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("legacy");

  const filtered = statuses?.filter((s) => {
    const matchesSearch =
      search === "" ||
      s.endpoints?.hostname.toLowerCase().includes(search.toLowerCase()) ||
      s.os_category?.toLowerCase().includes(search.toLowerCase());

    const matchesFilter =
      filterType === "all" ||
      (filterType === "legacy" && s.is_legacy) ||
      (filterType === "unassigned" && s.is_legacy && !s.hardening_profile_id) ||
      (filterType === "critical" && s.compliance_score < 50);

    return matchesSearch && matchesFilter;
  });

  const handleAssignProfile = async (endpointId: string, profileId: string) => {
    try {
      await assignProfile.mutateAsync({
        endpointId,
        profileId: profileId === "none" ? null : profileId,
      });
      toast({ title: "Hardening profile assigned" });
    } catch (e: any) {
      toast({ title: "Failed to assign profile", description: e.message, variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search endpoints..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Endpoints</SelectItem>
                <SelectItem value="legacy">Legacy Only</SelectItem>
                <SelectItem value="unassigned">Unassigned Profile</SelectItem>
                <SelectItem value="critical">Critical (&lt;50%)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {filtered?.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Monitor className="h-12 w-12 mb-4 opacity-50" />
              <p>No endpoints match the current filter</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>OS Category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Hardening Score</TableHead>
                  <TableHead>Checks</TableHead>
                  <TableHead>ESU Cost</TableHead>
                  <TableHead>Profile</TableHead>
                  <TableHead>Last Assessed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered?.map((status) => (
                  <TableRow key={status.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className={`h-2 w-2 rounded-full ${status.endpoints?.is_online ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
                        <span className="font-medium font-mono text-sm">
                          {status.endpoints?.hostname}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={status.is_legacy ? "destructive" : "secondary"} className="text-xs">
                        {OS_LABELS[status.os_category || ""] || status.os_category}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {status.is_legacy ? (
                        <Badge variant="outline" className="text-amber-600 border-amber-500/30">
                          End of Life
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-emerald-600">
                          Supported
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 min-w-[120px]">
                        <Progress value={status.compliance_score} className="flex-1 h-2" />
                        {getScoreBadge(status.compliance_score)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {status.passed_checks}/{status.total_checks}
                      </span>
                    </TableCell>
                    <TableCell>
                      {status.is_legacy && status.esu_estimated_annual_cost > 0 ? (
                        <span className="text-sm font-medium text-emerald-600">
                          ${status.esu_estimated_annual_cost}/yr
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={status.hardening_profile_id || "none"}
                        onValueChange={(val) => handleAssignProfile(status.endpoint_id, val)}
                      >
                        <SelectTrigger className="w-[180px] h-8 text-xs">
                          <SelectValue placeholder="Assign profile..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No profile</SelectItem>
                          {profiles?.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              <div className="flex items-center gap-1">
                                <Shield className="h-3 w-3" />
                                {p.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {status.last_assessed_at
                          ? format(new Date(status.last_assessed_at), "MMM d, HH:mm")
                          : "Never"}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
