import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Link } from "react-router-dom";
import { PortalHero } from "@/components/portal/PortalHero";
import { PortalStatCard } from "@/components/portal/PortalStatCard";
import { useTenant } from "@/contexts/TenantContext";
import { useAdminOverview, useAdminChannelVelocity, useAdminEndpointHealthByDisty, type AtRiskRow } from "@/hooks/useAdminOverview";
import {
  Building2, Warehouse, Briefcase, Users, Monitor, Receipt, ShieldAlert,
  AlertCircle, Mail, Sparkles, Wifi, ArrowUpRight, KeyRound, Plus, Activity, TrendingUp, ShieldOff,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

function fmtMoney(cents: number, currency = "AUD") {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(cents / 100);
}

export default function AdminOverview() {
  const { isSuperAdmin, isLoading: tenantLoading } = useTenant();
  const { data, isLoading, error } = useAdminOverview();
  const { data: velocity, isLoading: velLoading } = useAdminChannelVelocity();
  const { data: distyHealth, isLoading: dhLoading } = useAdminEndpointHealthByDisty();

  if (tenantLoading) {
    return <MainLayout><div className="p-6"><Skeleton className="h-32 w-full" /></div></MainLayout>;
  }
  if (!isSuperAdmin) {
    return (
      <MainLayout>
        <div className="p-6 max-w-2xl mx-auto">
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Super-admin only</AlertTitle>
            <AlertDescription>The channel command centre is for Peritus operators.</AlertDescription>
          </Alert>
        </div>
      </MainLayout>
    );
  }

  const t = data?.totals;
  const currency = t?.currency_code ?? "AUD";

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-7xl mx-auto">
        <PortalHero
          eyebrow="Platform admin"
          eyebrowIcon={<Sparkles className="h-3.5 w-3.5" />}
          title="Channel command centre"
          subtitle="Everything across every distributor, reseller, customer, and endpoint — in one screen. Refreshes every minute."
          actions={
            <Button asChild size="sm" className="shadow-sm">
              <Link to="/admin/channel"><Plus className="h-4 w-4 mr-1" /> Add channel partner</Link>
            </Button>
          }
        />

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Couldn't load overview</AlertTitle>
            <AlertDescription>{(error as any)?.message ?? "Unknown error"}</AlertDescription>
          </Alert>
        )}

        {/* Top-line KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <PortalStatCard label="Distributors" value={t?.distributors ?? 0} icon={<Warehouse className="h-4 w-4" />} loading={isLoading} hint="Active in your channel" />
          <PortalStatCard label="Resellers"    value={t?.resellers ?? 0}    icon={<Briefcase className="h-4 w-4" />} loading={isLoading} hint="Across all distributors + direct" />
          <PortalStatCard label="Customers"    value={t?.customers ?? 0}    icon={<Users className="h-4 w-4" />}    loading={isLoading} hint="End-customer organisations" />
          <PortalStatCard label="Endpoints"    value={t?.endpoints_active ?? 0} icon={<Monitor className="h-4 w-4" />} loading={isLoading} hint="Active seats deployed" />
          <PortalStatCard label="Online now"   value={t?.endpoints_online ?? 0} icon={<Wifi className="h-4 w-4" />} loading={isLoading} hint="Reporting in last 10 min" />
          <PortalStatCard label="Estimated MRR" value={fmtMoney(t?.estimated_mrr_cents ?? 0, currency)} icon={<Receipt className="h-4 w-4" />} loading={isLoading} hint="Customer-tier rate × endpoints" />
        </div>

        {/* Channel velocity — 7d / 30d cohort metrics */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4 text-emerald-500" /> Channel velocity</CardTitle>
            <CardDescription>Rolling 7-day and 30-day signals of channel motion.</CardDescription>
          </CardHeader>
          <CardContent>
            {velLoading || !velocity ? (
              <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <VelocityTile label="New customers"    v7={velocity.last_7_days.new_customers}    v30={velocity.last_30_days.new_customers}    />
                <VelocityTile label="New endpoints"    v7={velocity.last_7_days.new_endpoints}    v30={velocity.last_30_days.new_endpoints}    />
                <VelocityTile label="Deals registered" v7={velocity.last_7_days.deals_registered} v30={velocity.last_30_days.deals_registered} />
                <VelocityTile label="Deals won"        v7={velocity.last_7_days.deals_won}        v30={velocity.last_30_days.deals_won}        />
                <VelocityTile label="Credits issued"   v7={velocity.last_7_days.credits_issued}   v30={velocity.last_30_days.credits_issued}   />
                <VelocityTile label="Credits consumed" v7={velocity.last_7_days.credits_consumed} v30={velocity.last_30_days.credits_consumed} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Per-distributor endpoint health */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><ShieldOff className="h-4 w-4 text-rose-500" /> Endpoint health by distributor</CardTitle>
            <CardDescription>Online vs total, plus open threat count per disty's customer fleet.</CardDescription>
          </CardHeader>
          <CardContent>
            {dhLoading ? (
              <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : (distyHealth ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No distributors yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Distributor</TableHead>
                    <TableHead className="text-right">Resellers</TableHead>
                    <TableHead className="text-right">Customers</TableHead>
                    <TableHead className="text-right">Endpoints</TableHead>
                    <TableHead className="text-right">Online (24h)</TableHead>
                    <TableHead className="text-right">Open threats</TableHead>
                    <TableHead className="text-right">EPs with threat</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(distyHealth ?? []).map(d => {
                    const offline = Number(d.total_endpoints) - Number(d.online_24h);
                    return (
                      <TableRow key={d.distributor_id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Warehouse className="h-4 w-4 text-primary" />
                            <span className="font-medium">{d.distributor_name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{Number(d.reseller_count)}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(d.customer_count)}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{Number(d.total_endpoints)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {Number(d.online_24h)}{offline > 0 && <span className="text-xs text-muted-foreground"> / {offline} off</span>}
                        </TableCell>
                        <TableCell className={`text-right tabular-nums ${Number(d.open_threats) > 0 ? "text-rose-600 font-medium" : ""}`}>{Number(d.open_threats)}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(d.endpoints_with_threat)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* At-risk + Pending invites — two columns */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-rose-500" /> At risk
                {(data?.at_risk?.length ?? 0) > 0 && (
                  <Badge variant="outline" className="border-rose-500/60 text-rose-600 dark:text-rose-400 ml-1">
                    {data?.at_risk.length}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>Overdue invoices, suspended orgs, expiring subscriptions. Action these first.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-4 space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : (data?.at_risk ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground p-6 text-center">Nothing at risk right now. Nice.</p>
              ) : (
                <div className="divide-y divide-border max-h-80 overflow-y-auto">
                  {(data?.at_risk ?? []).map((r, i) => <AtRiskItem key={`${r.org_id}-${r.reason}-${i}`} row={r} />)}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-amber-500" /> Pending enrolment URLs
                {(data?.pending_invites?.length ?? 0) > 0 && (
                  <Badge variant="outline" className="border-amber-500/60 text-amber-600 dark:text-amber-400 ml-1">
                    {data?.pending_invites.length}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>URLs issued but never redeemed — chase these up if a deal's stalling.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-4 space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : (data?.pending_invites ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground p-6 text-center">All issued enrolment URLs have been claimed.</p>
              ) : (
                <div className="divide-y divide-border max-h-80 overflow-y-auto">
                  {(data?.pending_invites ?? []).map(p => (
                    <div key={p.id} className="p-3 hover:bg-muted/30 transition-colors">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate">{p.org_name}</div>
                          <div className="text-xs text-muted-foreground">{p.org_type} · issued {formatDistanceToNow(new Date(p.created_at), { addSuffix: true })}</div>
                        </div>
                        <Badge variant="outline" className="font-mono text-[10px]">{p.code}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Channel breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Channel by distributor</CardTitle>
            <CardDescription>
              Per-distributor rollup of resellers, customers, endpoints, and what Peritus invoices the distributor each cycle.
              The "Direct" row covers resellers signed up without a distributor.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : (data?.channel ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No channel partners yet. <Link to="/admin/channel" className="text-primary underline">Add your first one →</Link></p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Distributor</TableHead>
                    <TableHead className="text-right">Resellers</TableHead>
                    <TableHead className="text-right">Customers</TableHead>
                    <TableHead className="text-right">Endpoints</TableHead>
                    <TableHead className="text-right">Peritus MRR</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.channel ?? []).map((c, i) => (
                    <TableRow key={`${c.distributor_id ?? "direct"}-${i}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {c.distributor_id
                            ? <Warehouse className="h-4 w-4 text-primary" />
                            : <Building2 className="h-4 w-4 text-muted-foreground" />}
                          <div className="font-medium">{c.distributor_name}</div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{c.reseller_count}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.customer_count}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.endpoint_count}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{fmtMoney(c.distributor_mrr_to_peritus_cents, currency)}</TableCell>
                      <TableCell>
                        {c.is_active === false
                          ? <Badge variant="destructive">Suspended</Badge>
                          : <Badge variant="outline" className="border-emerald-500/60 text-emerald-600 dark:text-emerald-400">Active</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Recent activity */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" /> Recent activity
            </CardTitle>
            <CardDescription>Channel partners and customers created in the last 30 days.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : (data?.recent_activity ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground p-6 text-center">No new orgs in the last 30 days.</p>
            ) : (
              <div className="divide-y divide-border">
                {(data?.recent_activity ?? []).map(r => (
                  <div key={r.org_id} className="flex items-center justify-between gap-3 p-3 hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        {r.org_type === "distributor" ? <Warehouse className="h-4 w-4 text-primary" />
                          : r.org_type === "partner" ? <Briefcase className="h-4 w-4 text-primary" />
                          : <Users className="h-4 w-4 text-primary" />}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{r.org_name}</div>
                        <div className="text-xs text-muted-foreground capitalize">{r.org_type === "partner" ? "Reseller" : r.org_type}</div>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground shrink-0">{formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-muted/30 to-transparent">
          <CardContent className="p-5 grid grid-cols-1 sm:grid-cols-4 gap-3">
            <Quick to="/admin/channel" icon={<Warehouse className="h-4 w-4" />} label="Channel partners" />
            <Quick to="/admin/pricing" icon={<Receipt className="h-4 w-4" />}   label="Pricing"          />
            <Quick to="/admin/invoices" icon={<Mail className="h-4 w-4" />}     label="Invoices"         />
            <Quick to="/admin/health"  icon={<Activity className="h-4 w-4" />}  label="System health"    />
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}

function Quick({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Button asChild variant="outline" className="justify-start">
      <Link to={to}><span className="mr-2 text-primary">{icon}</span>{label} <ArrowUpRight className="h-3.5 w-3.5 ml-auto opacity-60" /></Link>
    </Button>
  );
}

function VelocityTile({ label, v7, v30 }: { label: string; v7: number; v30: number }) {
  return (
    <div className="border rounded-lg p-3 bg-card">
      <div className="text-[11px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="flex items-baseline gap-2 mt-1">
        <span className="text-xl font-bold tabular-nums">{v7}</span>
        <span className="text-[10px] text-muted-foreground">last 7d</span>
      </div>
      <div className="text-[11px] text-muted-foreground tabular-nums mt-0.5">{v30} in 30d</div>
    </div>
  );
}

function AtRiskItem({ row }: { row: AtRiskRow }) {
  const tone = row.reason === "expired" || row.reason === "suspended" ? "bad"
             : row.reason === "expiring" ? "warn"
             : (row.days_overdue ?? 0) > 60 ? "bad" : "warn";
  const Icon = tone === "bad" ? AlertCircle : Sparkles;
  const cls  = tone === "bad" ? "text-rose-500" : "text-amber-500";
  const reasonLabel = {
    suspended:       "Suspended",
    expired:         "Subscription expired",
    expiring:        "Subscription expiring",
    invoice_overdue: "Invoice overdue",
  }[row.reason];
  return (
    <div className="flex items-start gap-3 p-3 hover:bg-muted/30 transition-colors">
      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${cls}`} />
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          <div className="font-medium text-sm truncate">{row.org_name}</div>
          <Badge variant="outline" className="text-[10px] capitalize">{row.org_type === "partner" ? "Reseller" : row.org_type}</Badge>
        </div>
        <div className="text-xs text-muted-foreground">{reasonLabel} · {row.detail}</div>
      </div>
    </div>
  );
}
