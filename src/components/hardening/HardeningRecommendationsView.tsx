import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { useHardeningRecommendations } from "@/hooks/useHardening";
import { Search, ShieldAlert, CheckCircle, XCircle, Loader2 } from "lucide-react";

const SEVERITY_BADGES: Record<string, string> = {
  critical: "bg-red-500/10 text-red-600",
  high: "bg-orange-500/10 text-orange-600",
  medium: "bg-amber-500/10 text-amber-600",
  low: "bg-blue-500/10 text-blue-600",
  info: "bg-muted text-muted-foreground",
};

const CATEGORY_LABELS: Record<string, string> = {
  network: "Network",
  authentication: "Authentication",
  services: "Services",
  encryption: "Encryption",
  application_control: "App Control",
  firewall: "Firewall",
  defender: "Defender",
  gpo: "Group Policy",
};

export function HardeningRecommendationsView() {
  const { data: recommendations, isLoading } = useHardeningRecommendations();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [complianceFilter, setComplianceFilter] = useState("all");

  const filtered = recommendations?.filter((r) => {
    const matchesSearch =
      search === "" ||
      r.title.toLowerCase().includes(search.toLowerCase()) ||
      r.endpoints?.hostname.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === "all" || r.category === categoryFilter;
    const matchesSeverity = severityFilter === "all" || r.severity === severityFilter;
    const matchesCompliance =
      complianceFilter === "all" ||
      (complianceFilter === "compliant" && r.is_compliant) ||
      (complianceFilter === "non_compliant" && !r.is_compliant);
    return matchesSearch && matchesCategory && matchesSeverity && matchesCompliance;
  });

  const categories = [...new Set(recommendations?.map((r) => r.category) || [])];
  const totalNonCompliant = recommendations?.filter((r) => !r.is_compliant).length || 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{recommendations?.length || 0}</div>
            <p className="text-xs text-muted-foreground">Total Recommendations</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-destructive">{totalNonCompliant}</div>
            <p className="text-xs text-muted-foreground">Non-Compliant</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-emerald-600">
              {(recommendations?.length || 0) - totalNonCompliant}
            </div>
            <p className="text-xs text-muted-foreground">Compliant</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search recommendations..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {CATEGORY_LABELS[cat] || cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
            <Select value={complianceFilter} onValueChange={setComplianceFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="non_compliant">Non-Compliant</SelectItem>
                <SelectItem value="compliant">Compliant</SelectItem>
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
              <ShieldAlert className="h-12 w-12 mb-4 opacity-50" />
              <p>No recommendations found</p>
              <p className="text-sm mt-1">
                Recommendations are generated during agent assessments of legacy endpoints
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">Status</TableHead>
                  <TableHead>Recommendation</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Current</TableHead>
                  <TableHead>Recommended</TableHead>
                  <TableHead>Policy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered?.map((rec) => (
                  <TableRow key={rec.id}>
                    <TableCell>
                      {rec.is_compliant ? (
                        <CheckCircle className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-destructive" />
                      )}
                    </TableCell>
                    <TableCell>
                      <div>
                        <span className="text-sm font-medium">{rec.title}</span>
                        {rec.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                            {rec.description}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {CATEGORY_LABELS[rec.category] || rec.category}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-xs ${SEVERITY_BADGES[rec.severity] || ""}`}>
                        {rec.severity}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-mono">
                        {rec.endpoints?.hostname || "-"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {rec.current_value || "-"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-medium">
                        {rec.recommended_value || "-"}
                      </span>
                    </TableCell>
                    <TableCell>
                      {rec.policy_reference ? (
                        <Badge variant="secondary" className="text-[10px]">
                          {rec.policy_reference}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
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
