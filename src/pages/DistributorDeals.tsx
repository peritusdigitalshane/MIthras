import { useMemo } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { PortalHero } from "@/components/portal/PortalHero";
import { PortalStatCard } from "@/components/portal/PortalStatCard";
import {
  Warehouse, Briefcase, Target, Trophy, AlertCircle, Clock, AlertTriangle, XCircle,
} from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { useDistributorOrgId } from "@/hooks/useDistributor";
import { useDistributorDeals, type DealStage } from "@/hooks/useDealRegistrations";
import { formatDistanceToNow, differenceInDays } from "date-fns";

const STAGE_LABEL: Record<DealStage, string> = {
  qualified: "Qualified",
  demo:      "Demo",
  poc:       "POC",
  quote:     "Quote",
  won:       "Won",
  lost:      "Lost",
  expired:   "Expired",
};

export default function DistributorDeals() {
  const distId = useDistributorOrgId();
  const { isSuperAdmin } = useTenant();
  const { data: deals, isLoading } = useDistributorDeals(distId);

  const stats = useMemo(() => {
    const all = deals ?? [];
    const active = all.filter(d => d.status === "active");
    return {
      active:   active.length,
      pipeline: active.reduce((s, d) => s + Number(d.estimated_endpoints), 0),
      resellers: new Set(active.map(d => d.reseller_org_id)).size,
      won:      all.filter(d => d.status === "won").length,
    };
  }, [deals]);

  // Detect conflicts: two or more active deals with the same lower(prospect_name)
  // across DIFFERENT resellers in the same disty pool. The DB blocks this at
  // registration time, but if a conflict somehow exists (e.g. seeded data,
  // direct super-admin insert), surface it loudly.
  const conflicts = useMemo(() => {
    const byProspect = new Map<string, typeof deals>();
    for (const d of (deals ?? [])) {
      if (d.status !== "active") continue;
      const k = d.prospect_name.toLowerCase();
      const arr = byProspect.get(k) ?? [];
      arr.push(d as any);
      byProspect.set(k, arr as any);
    }
    return [...byProspect.entries()].filter(([_, arr]) => (arr?.length ?? 0) > 1);
  }, [deals]);

  if (!distId) {
    return (
      <MainLayout>
        <div className="p-6 max-w-2xl mx-auto">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>No distributor selected</AlertTitle>
            <AlertDescription>
              {isSuperAdmin
                ? "Pivot into a distributor org from Admin → Channel partners."
                : "Your account isn't linked to a distributor organisation."}
            </AlertDescription>
          </Alert>
        </div>
      </MainLayout>
    );
  }

  const active   = (deals ?? []).filter(d => d.status === "active");
  const closed   = (deals ?? []).filter(d => d.status !== "active");

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-7xl mx-auto">
        <PortalHero
          eyebrow="Distributor portal"
          eyebrowIcon={<Warehouse className="h-3.5 w-3.5" />}
          title="Channel pipeline"
          subtitle="Every deal your resellers are working on. Use this to mediate intra-channel conflict before it festers, and to see what's coming so you can have credits ready."
        />

        {conflicts.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{conflicts.length} potential conflict{conflicts.length === 1 ? "" : "s"}</AlertTitle>
            <AlertDescription>
              Multiple resellers have registered the same prospect name. These rows are flagged in the table below — talk to both parties before either commits more pursuit time.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <PortalStatCard label="Active deals"        value={stats.active}    icon={<Briefcase className="h-4 w-4" />} loading={isLoading} hint="Currently protected" />
          <PortalStatCard label="Pipeline endpoints"  value={stats.pipeline}  icon={<Target className="h-4 w-4" />}    loading={isLoading} hint="Total seats in play" />
          <PortalStatCard label="Active resellers"    value={stats.resellers} icon={<Briefcase className="h-4 w-4" />} loading={isLoading} hint="With at least 1 active deal" />
          <PortalStatCard label="Won (all-time)"      value={stats.won}       icon={<Trophy className="h-4 w-4" />}    loading={isLoading} hint="Converted to customers" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-primary" /> Active pipeline
            </CardTitle>
            <CardDescription>Read-only — resellers manage their own deals. You're seeing this for coordination + capacity planning.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : active.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No active deals from any of your resellers right now.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Prospect</TableHead>
                    <TableHead>Reseller</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead className="text-right">Est. endpoints</TableHead>
                    <TableHead>Protection</TableHead>
                    <TableHead>Registered</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {active.map(d => {
                    const days = differenceInDays(new Date(d.protection_expires_at), new Date());
                    const conflict = conflicts.some(([k, arr]) => k === d.prospect_name.toLowerCase() && (arr?.length ?? 0) > 1);
                    return (
                      <TableRow key={d.id} className={conflict ? "bg-rose-500/5" : ""}>
                        <TableCell>
                          <div className="font-medium">{d.prospect_name}</div>
                          {d.prospect_region && <div className="text-xs text-muted-foreground">{d.prospect_region}</div>}
                          {conflict && <Badge variant="outline" className="mt-1 border-rose-500/60 text-rose-600 text-[10px]">Conflict</Badge>}
                        </TableCell>
                        <TableCell className="text-sm">{(d as any).reseller?.name ?? "—"}</TableCell>
                        <TableCell><StageBadge stage={d.stage} /></TableCell>
                        <TableCell className="text-right tabular-nums">{Number(d.estimated_endpoints)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={days <= 14 ? "border-amber-500/60 text-amber-600" : ""}>
                            <Clock className="h-3 w-3 mr-1" />
                            {days <= 0 ? "Expiring" : `${days}d`}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDistanceToNow(new Date(d.created_at), { addSuffix: true })}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {closed.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Closed deals</CardTitle>
              <CardDescription>Historical pipeline across your resellers.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Prospect</TableHead>
                    <TableHead>Reseller</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead className="text-right">Endpoints</TableHead>
                    <TableHead>Closed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {closed.map(d => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">{d.prospect_name}</TableCell>
                      <TableCell className="text-sm">{(d as any).reseller?.name ?? "—"}</TableCell>
                      <TableCell><OutcomeBadge status={d.status} /></TableCell>
                      <TableCell className="text-right tabular-nums">{Number(d.estimated_endpoints)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {d.won_at ? formatDistanceToNow(new Date(d.won_at), { addSuffix: true })
                         : d.lost_at ? formatDistanceToNow(new Date(d.lost_at), { addSuffix: true })
                         : formatDistanceToNow(new Date(d.updated_at), { addSuffix: true })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </MainLayout>
  );
}

function StageBadge({ stage }: { stage: DealStage }) {
  const cls = stage === "qualified" ? "border-muted-foreground/40"
            : stage === "demo"      ? "border-blue-500/60 text-blue-600 dark:text-blue-400 bg-blue-500/10"
            : stage === "poc"       ? "border-indigo-500/60 text-indigo-600 dark:text-indigo-400 bg-indigo-500/10"
            : stage === "quote"     ? "border-violet-500/60 text-violet-600 dark:text-violet-400 bg-violet-500/10"
            :                         "";
  return <Badge variant="outline" className={cls}>{STAGE_LABEL[stage]}</Badge>;
}

function OutcomeBadge({ status }: { status: "won" | "lost" | "expired" | "active" }) {
  if (status === "won")     return <Badge variant="outline" className="border-emerald-500/60 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"><Trophy className="h-3 w-3 mr-1" />Won</Badge>;
  if (status === "lost")    return <Badge variant="outline" className="border-rose-500/60 text-rose-600 dark:text-rose-400 bg-rose-500/10"><XCircle className="h-3 w-3 mr-1" />Lost</Badge>;
  if (status === "expired") return <Badge variant="outline" className="border-amber-500/60 text-amber-600 dark:text-amber-400 bg-amber-500/10"><Clock className="h-3 w-3 mr-1" />Expired</Badge>;
  return <Badge variant="outline">Active</Badge>;
}
