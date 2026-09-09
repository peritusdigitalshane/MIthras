import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useHardeningStats, useEndpointHardeningStatuses } from "@/hooks/useHardening";
import {
  ShieldAlert,
  ShieldCheck,
  Monitor,
  DollarSign,
  AlertTriangle,
  TrendingUp,
  Loader2,
} from "lucide-react";

const OS_LABELS: Record<string, string> = {
  legacy_win10: "Windows 10 (EOL)",
  legacy_server2012r2: "Server 2012 R2 (EOL)",
  legacy_server2012: "Server 2012 (EOL)",
  legacy_win7: "Windows 7 (EOL)",
  legacy_win81: "Windows 8.1 (EOL)",
  supported: "Supported OS",
  unknown: "Unknown",
};

export function HardeningDashboard() {
  const stats = useHardeningStats();
  const { data: statuses, isLoading } = useEndpointHardeningStatuses();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!stats || stats.totalEndpoints === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <ShieldAlert className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground font-medium">No hardening data available yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Legacy OS detection runs automatically during agent heartbeats. Deploy agents to get started.
          </p>
        </CardContent>
      </Card>
    );
  }

  const legacyEndpoints = statuses?.filter(s => s.is_legacy) || [];

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Legacy Endpoints</CardTitle>
            <Monitor className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalLegacy}</div>
            <p className="text-xs text-muted-foreground">
              of {stats.totalEndpoints} total endpoints
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Average Hardening Score</CardTitle>
            <TrendingUp className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.avgScore}%</div>
            <Progress value={stats.avgScore} className="mt-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Critical Risk</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{stats.criticalCount}</div>
            <p className="text-xs text-muted-foreground">
              endpoints below 50% hardening
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Estimated ESU Savings</CardTitle>
            <DollarSign className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">
              ${stats.totalEsuSavings.toLocaleString()}<span className="text-sm font-normal text-muted-foreground">/yr</span>
            </div>
            <p className="text-xs text-muted-foreground">
              by hardening instead of ESU
            </p>
          </CardContent>
        </Card>
      </div>

      {/* OS Breakdown + Hardening Status */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Legacy OS Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {Object.entries(stats.osCategoryBreakdown).map(([cat, count]) => (
              <div key={cat} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-amber-500" />
                  <span className="text-sm">{OS_LABELS[cat] || cat}</span>
                </div>
                <Badge variant="secondary">{count}</Badge>
              </div>
            ))}
            {Object.keys(stats.osCategoryBreakdown).length === 0 && (
              <p className="text-sm text-muted-foreground">No legacy endpoints detected</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Hardening Coverage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                <span className="text-sm">Fully hardened (80%+)</span>
              </div>
              <Badge className="bg-emerald-500/10 text-emerald-600">{stats.hardenedCount}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-amber-500" />
                <span className="text-sm">Profile assigned</span>
              </div>
              <Badge variant="secondary">{stats.profileAssigned}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <span className="text-sm">No profile assigned</span>
              </div>
              <Badge variant="destructive">
                {stats.totalLegacy - stats.profileAssigned}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent assessments */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Lowest Hardening Scores</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {legacyEndpoints
              .sort((a, b) => (a.compliance_score || 0) - (b.compliance_score || 0))
              .slice(0, 5)
              .map((ep) => (
                <div key={ep.id} className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">
                        {ep.endpoints?.hostname || "Unknown"}
                      </span>
                      <Badge variant="outline" className="text-[10px] px-1.5">
                        {OS_LABELS[ep.os_category || ""] || ep.os_category}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <Progress value={ep.compliance_score} className="flex-1 h-1.5" />
                      <span className="text-xs text-muted-foreground w-8 text-right">
                        {ep.compliance_score}%
                      </span>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {ep.failed_checks} failed / {ep.total_checks} checks
                  </span>
                </div>
              ))}
            {legacyEndpoints.length === 0 && (
              <p className="text-sm text-muted-foreground">No legacy endpoints detected yet</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
