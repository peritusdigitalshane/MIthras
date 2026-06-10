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
import { useTenant } from "@/contexts/TenantContext";
import { useAdminDealOverview, useAdminPartnerDealPerformance } from "@/hooks/useDealRegistrations";
import {
  Target, Briefcase, Trophy, XCircle, Clock, ShieldAlert, AlertTriangle, Warehouse,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function AdminDeals() {
  const { isSuperAdmin, isLoading: tenantLoading } = useTenant();
  const { data, isLoading } = useAdminDealOverview();
  const { data: perf, isLoading: perfLoading } = useAdminPartnerDealPerformance();

  if (tenantLoading) return <MainLayout><div className="p-6"><Skeleton className="h-32 w-full" /></div></MainLayout>;
  if (!isSuperAdmin) {
    return (
      <MainLayout>
        <div className="p-6 max-w-2xl mx-auto">
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Super-admin only</AlertTitle>
            <AlertDescription>Platform-wide deal pipeline view.</AlertDescription>
          </Alert>
        </div>
      </MainLayout>
    );
  }

  const t = data?.totals;
  const conflicts = data?.conflicts ?? [];

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-7xl mx-auto">
        <PortalHero
          eyebrow="Platform admin"
          eyebrowIcon={<Target className="h-3.5 w-3.5" />}
          title="Channel pipeline"
          subtitle="Every deal registered across every reseller, every distributor. Use this to forecast credit demand, mediate conflicts that crossed channels, and reward distys driving pipeline."
        />

        {conflicts.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{conflicts.length} channel conflict{conflicts.length === 1 ? "" : "s"} need mediation</AlertTitle>
            <AlertDescription>
              Multiple active deals registered with the same prospect name under the same distributor. The DB blocks new conflicts at registration, but historic seeds may slip through — confirm with the disty and clean up.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <PortalStatCard label="Active" value={t?.active ?? 0} icon={<Briefcase className="h-4 w-4" />} loading={isLoading} hint="In protected windows" />
          <PortalStatCard label="Pipeline EPs" value={t?.pipeline_endpoints ?? 0} icon={<Target className="h-4 w-4" />} loading={isLoading} hint="Sum of estimated endpoints" />
          <PortalStatCard label="Won" value={t?.won_total ?? 0} icon={<Trophy className="h-4 w-4" />} loading={isLoading} hint="All-time conversions" />
          <PortalStatCard label="Lost" value={t?.lost_total ?? 0} icon={<XCircle className="h-4 w-4" />} loading={isLoading} hint="All-time losses" />
          <PortalStatCard label="Expired" value={t?.expired_total ?? 0} icon={<Clock className="h-4 w-4" />} loading={isLoading} hint="Not progressed in time" />
          <PortalStatCard label="Conflicts" value={t?.conflicts_count ?? 0} icon={<AlertTriangle className="h-4 w-4" />} loading={isLoading} positiveIsBad hint="Needing mediation" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pipeline by distributor</CardTitle>
            <CardDescription>Sorted by active pipeline endpoint count — the ones driving real demand.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : (data?.by_distributor ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No distributors yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Distributor</TableHead>
                    <TableHead className="text-right">Resellers</TableHead>
                    <TableHead className="text-right">Active deals</TableHead>
                    <TableHead className="text-right">Pipeline EPs</TableHead>
                    <TableHead className="text-right">Won</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.by_distributor ?? []).map(d => (
                    <TableRow key={d.distributor_id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Warehouse className="h-4 w-4 text-primary" />
                          <span className="font-medium">{d.distributor_name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{d.reseller_count}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.active_count}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{d.active_pipeline}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.won_count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Per-partner performance</CardTitle>
            <CardDescription>
              Every reseller with at least one deal — sorted by estimated active MRR (active pipeline endpoints × locked retail). Use this
              to spot top performers and laggards across the channel.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {perfLoading ? (
              <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : (perf ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No partner deal activity yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reseller</TableHead>
                    <TableHead>Distributor</TableHead>
                    <TableHead className="text-right">Active</TableHead>
                    <TableHead className="text-right">Won</TableHead>
                    <TableHead className="text-right">Lost</TableHead>
                    <TableHead className="text-right">Win rate</TableHead>
                    <TableHead className="text-right">Pipeline EPs</TableHead>
                    <TableHead className="text-right">Active MRR (est)</TableHead>
                    <TableHead>Last deal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(perf ?? []).map(p => (
                    <TableRow key={p.reseller_id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Briefcase className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">{p.reseller_name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{p.distributor_name ?? "Direct"}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.active_count}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.won_count}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.lost_count + p.expired_count}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.win_rate_pct == null
                          ? <span className="text-muted-foreground">—</span>
                          : `${Number(p.win_rate_pct).toFixed(0)}%`}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{p.active_pipeline_eps}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        ${(p.estimated_mrr_cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground tabular-nums">
                        {p.last_deal_at ? formatDistanceToNow(new Date(p.last_deal_at), { addSuffix: true }) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recently registered</CardTitle>
            <CardDescription>Last 30 days across all channels.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : (data?.recent ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No new deals registered in the last 30 days.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Prospect</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Reseller</TableHead>
                    <TableHead>Distributor</TableHead>
                    <TableHead className="text-right">EPs</TableHead>
                    <TableHead>Registered</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.recent ?? []).map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.prospect_name}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{r.stage}</Badge></TableCell>
                      <TableCell className="text-sm">{r.reseller_name ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.distributor_name ?? "Direct"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.estimated_endpoints}</TableCell>
                      <TableCell className="text-sm text-muted-foreground tabular-nums">{formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
