import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, ShieldCheck, ShieldAlert } from "lucide-react";
import { PortalHero } from "@/components/portal/PortalHero";
import { PortalEmptyState } from "@/components/portal/PortalEmptyState";
import { QueryError } from "@/components/ui/query-error";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCustomerOrgId, useCustomerReseller } from "@/hooks/useCustomerScope";
import { formatDistanceToNow } from "date-fns";

const ACTIVE_STATUSES = ["Active","Cleaning","Quarantined","Allowed","Executing"];

export default function CustomerThreats() {
  const orgId = useCustomerOrgId();
  const { data: reseller } = useCustomerReseller();

  const { data: threats, isLoading, error } = useQuery({
    queryKey: ["customer-threats", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      if (!orgId) return [];
      // Walk via endpoints join to scope by org. RLS already enforces this.
      const { data, error } = await supabase
        .from("endpoint_threats")
        .select(`
          id, threat_id, threat_name, severity, category, status,
          initial_detection_time, last_threat_status_change_time, created_at,
          endpoints!inner(hostname, organization_id)
        ` as any)
        .eq("endpoints.organization_id", orgId)
        // F1 fix: sort by detection time so re-detected threats float to
        // the top. Sorting by created_at hid re-detections under months-old
        // first-insert timestamps.
        .order("initial_detection_time", { ascending: false, nullsFirst: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const activeCount = (threats ?? []).filter(t => ACTIVE_STATUSES.includes(t.status)).length;
  const resolvedCount = (threats ?? []).length - activeCount;

  if (error) {
    return <QueryError error={error} title="Couldn't load threats" />;
  }

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-7xl mx-auto">
        <PortalHero
          eyebrow="Customer portal"
          eyebrowIcon={<ShieldCheck className="h-3.5 w-3.5" />}
          title="My threats"
          subtitle="Every detection Mithras has seen across your endpoints. Active threats are handled automatically — your reseller will reach out if anything needs your attention."
          accent="emerald"
        />

        {activeCount > 0 && reseller ? (
          <Alert className="border-amber-500/40 bg-amber-500/5">
            <ShieldAlert className="h-4 w-4 text-amber-500" />
            <AlertTitle>{reseller.name} is on it — you don't need to do anything</AlertTitle>
            <AlertDescription>
              {activeCount} threat{activeCount === 1 ? "" : "s"} {activeCount === 1 ? "is" : "are"} being investigated. Most threats are blocked instantly by Windows Defender; the ones listed below are the small fraction that need a human to look at them.
              {reseller.name} will only email you if they need something. If you haven't heard from them, there's nothing for you to do.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            <AlertTitle>You're all clear</AlertTitle>
            <AlertDescription>
              No threats need attention right now. The history below shows past detections — all already blocked or resolved.
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-primary" /> Detection history
            </CardTitle>
            <CardDescription>
              Most recent first. We retain the last 200 detections — older ones are in your monthly reports.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : (threats ?? []).length === 0 ? (
              <PortalEmptyState
                icon={<ShieldCheck className="h-7 w-7" />}
                title="No threats detected — that's a good thing"
                description={<p>Mithras checks every endpoint continuously and reports detections within ~60 seconds of them occurring.</p>}
                accent="emerald"
                className="border-0 shadow-none"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Threat</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Machine</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Detected</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(threats ?? []).map(t => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.threat_name ?? `Detection #${t.threat_id}`}</TableCell>
                      <TableCell>
                        {!t.severity || t.severity === "Unknown" ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className="cursor-help border-dashed text-muted-foreground">Historic</Badge>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs text-xs">
                                This is an older detection from before our system tracked severity properly. It's already been handled — nothing for you to do.
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <Badge variant={
                            t.severity === "Severe" || t.severity === "High" ? "destructive" :
                            t.severity === "Moderate" ? "secondary" : "outline"
                          }>{t.severity}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{t.endpoints?.hostname ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={
                          ["Resolved","Removed","Blocked"].includes(t.status) ? "outline" : "destructive"
                        }>{t.status}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {t.initial_detection_time
                          ? formatDistanceToNow(new Date(t.initial_detection_time), { addSuffix: true })
                          : "Unknown"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-4 space-y-1">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Active</div>
              <div className="text-2xl font-bold tabular-nums">{activeCount}</div>
              <div className="text-[11px] text-muted-foreground">Being actioned by your reseller</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 space-y-1">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Resolved</div>
              <div className="text-2xl font-bold tabular-nums">{resolvedCount}</div>
              <div className="text-[11px] text-muted-foreground">Across all time</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 space-y-1">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Total seen</div>
              <div className="text-2xl font-bold tabular-nums">{threats?.length ?? 0}</div>
              <div className="text-[11px] text-muted-foreground">Recent — full history in reports</div>
            </CardContent>
          </Card>
        </div>
      </div>
    </MainLayout>
  );
}
