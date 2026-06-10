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
import { PortalEmptyState } from "@/components/portal/PortalEmptyState";
import { useTenant } from "@/contexts/TenantContext";
import { useAdminHomeUsers } from "@/hooks/useAdminHomeUsers";
import {
  Home, ShieldAlert, Users, Monitor, Wifi, Receipt, AlertCircle, Mail,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

function fmtMoney(cents: number, currency = "AUD") {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(cents / 100);
}

export default function AdminHomeUsers() {
  const { isSuperAdmin, isLoading: tenantLoading } = useTenant();
  const { data, isLoading, error } = useAdminHomeUsers();

  if (tenantLoading) return <MainLayout><div className="p-6"><Skeleton className="h-32 w-full" /></div></MainLayout>;
  if (!isSuperAdmin) {
    return (
      <MainLayout>
        <div className="p-6 max-w-2xl mx-auto">
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Super-admin only</AlertTitle>
            <AlertDescription>Home-user accounts are managed by Peritus operators.</AlertDescription>
          </Alert>
        </div>
      </MainLayout>
    );
  }

  const t = data?.totals;
  const rows = data?.rows ?? [];

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-7xl mx-auto">
        <PortalHero
          eyebrow="Platform admin"
          eyebrowIcon={<Home className="h-3.5 w-3.5" />}
          title="Home users"
          subtitle="Direct-to-consumer subscriptions sold at /personal. No portal access — managed entirely from this screen. Billing happens automatically via Stripe."
          accent="emerald"
        />

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Couldn't load home-user data</AlertTitle>
            <AlertDescription>{(error as any)?.message ?? "Unknown error"}</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <PortalStatCard label="Subscribers"    value={t?.total_home_users ?? 0}     icon={<Users className="h-4 w-4" />}    loading={isLoading} hint="Across all statuses" />
          <PortalStatCard label="Active"         value={t?.active_subscriptions ?? 0} icon={<Home className="h-4 w-4" />}     loading={isLoading} hint="Currently paying" />
          <PortalStatCard label="Past due"       value={t?.past_due ?? 0}             icon={<AlertCircle className="h-4 w-4" />} loading={isLoading} hint="Stripe flagged" positiveIsBad />
          <PortalStatCard label="Endpoints"      value={t?.endpoints_total ?? 0}      icon={<Monitor className="h-4 w-4" />}  loading={isLoading} hint="Total active agents" />
          <PortalStatCard label="Online (24h)"   value={t?.endpoints_online ?? 0}     icon={<Wifi className="h-4 w-4" />}     loading={isLoading} hint="Reported in last 24h" />
          <PortalStatCard label="Direct MRR"     value={fmtMoney(t?.estimated_mrr_cents ?? 0)} icon={<Receipt className="h-4 w-4" />} loading={isLoading} hint="$6/sub × active subs" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">All home users</CardTitle>
            <CardDescription>Click on a row to see endpoint + Stripe details. Email actions available from the subscription record in Stripe directly.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : rows.length === 0 ? (
              <PortalEmptyState
                icon={<Home className="h-7 w-7" />}
                title="No home-user subscribers yet"
                description={<p>Once Stripe is wired up and someone subscribes at <code className="text-xs">/personal</code>, they'll appear here. Each subscription auto-creates an org with a default Defender policy applied.</p>}
                accent="emerald"
                className="border-0 shadow-none rounded-none"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead>Stripe status</TableHead>
                    <TableHead className="text-right">Endpoints</TableHead>
                    <TableHead>Last seen</TableHead>
                    <TableHead>Period ends</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(r => (
                    <TableRow key={r.org_id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="font-medium">{r.contact_email ?? "—"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</TableCell>
                      <TableCell><StripeStatusBadge status={r.stripe_status} /></TableCell>
                      <TableCell className="text-right tabular-nums">{r.endpoint_count}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.last_seen_at ? formatDistanceToNow(new Date(r.last_seen_at), { addSuffix: true }) : "Never"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground tabular-nums">
                        {r.stripe_current_period_end ? new Date(r.stripe_current_period_end).toLocaleDateString() : "—"}
                      </TableCell>
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

function StripeStatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="outline">Unknown</Badge>;
  const tone = status === "active" || status === "trialing" ? "ok"
             : status === "past_due" ? "warn"
             : status === "canceled" || status === "unpaid" ? "bad" : "muted";
  const cls = tone === "ok"   ? "border-emerald-500/60 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
            : tone === "warn" ? "border-amber-500/60 text-amber-600 dark:text-amber-400 bg-amber-500/10"
            : tone === "bad"  ? "border-rose-500/60 text-rose-600 dark:text-rose-400 bg-rose-500/10"
            : "border-muted-foreground/40 text-muted-foreground";
  return <Badge variant="outline" className={cls}>{status}</Badge>;
}
