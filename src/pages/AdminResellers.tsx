import { useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PortalHero } from "@/components/portal/PortalHero";
import { PortalStatCard } from "@/components/portal/PortalStatCard";
import { useTenant } from "@/contexts/TenantContext";
import { useAdminResellerHealthOverview, AdminResellerHealthRow } from "@/hooks/useCredits";
import { Briefcase, ShieldAlert, Warehouse, AlertTriangle, Search, Activity } from "lucide-react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";

type StatusFilter = "all" | "needs_attention" | "overdrawn" | "low_runway" | "stalled" | "dormant" | "healthy";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all",             label: "All resellers" },
  { value: "needs_attention", label: "Needs attention (any flag)" },
  { value: "overdrawn",       label: "Overdrawn" },
  { value: "low_runway",      label: "Low runway" },
  { value: "stalled",         label: "Stalled (no customers)" },
  { value: "dormant",         label: "Dormant (no recent txn)" },
  { value: "healthy",         label: "Healthy" },
];

function HealthBadges({ row }: { row: AdminResellerHealthRow }) {
  return (
    <div className="flex flex-wrap gap-1">
      {row.is_overdrawn  && <Badge variant="destructive">overdrawn</Badge>}
      {row.is_low_runway && <Badge variant="outline" className="border-amber-500 text-amber-600">low runway</Badge>}
      {row.is_stalled    && <Badge variant="outline" className="border-orange-500 text-orange-600">stalled</Badge>}
      {row.is_dormant    && <Badge variant="outline" className="border-slate-500 text-slate-600">dormant</Badge>}
      {row.is_healthy    && <Badge variant="outline" className="border-emerald-500 text-emerald-600">healthy</Badge>}
    </div>
  );
}

export default function AdminResellers() {
  const { isSuperAdmin, isLoading: tenantLoading } = useTenant();
  const { data: rows, isLoading, error: rowsError } = useAdminResellerHealthOverview();

  const [search, setSearch]   = useState("");
  const [status, setStatus]   = useState<StatusFilter>("all");
  const [distyId, setDistyId] = useState<string>("all");

  const distys = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows ?? []) {
      if (r.distributor_id && r.distributor_name) seen.set(r.distributor_id, r.distributor_name);
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter(r => {
      if (distyId !== "all" && r.distributor_id !== distyId) return false;
      if (q && !(r.reseller_name.toLowerCase().includes(q) || (r.distributor_name ?? "").toLowerCase().includes(q))) return false;
      switch (status) {
        case "needs_attention": return !r.is_healthy;
        case "overdrawn":  return r.is_overdrawn;
        case "low_runway": return r.is_low_runway;
        case "stalled":    return r.is_stalled;
        case "dormant":    return r.is_dormant;
        case "healthy":    return r.is_healthy;
        default: return true;
      }
    });
  }, [rows, search, status, distyId]);

  const totals = useMemo(() => {
    const all       = rows ?? [];
    const needsAtt  = all.filter(r => !r.is_healthy).length;
    const overdrawn = all.filter(r => r.is_overdrawn).length;
    const endpoints = all.reduce((s, r) => s + Number(r.active_endpoints ?? 0), 0);
    return { count: all.length, needsAtt, overdrawn, endpoints };
  }, [rows]);

  if (tenantLoading) return <MainLayout><div className="p-6"><Skeleton className="h-32 w-full" /></div></MainLayout>;
  if (rowsError) {
    return (
      <MainLayout>
        <div className="p-6 max-w-2xl mx-auto">
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Couldn't load reseller overview</AlertTitle>
            <AlertDescription>{(rowsError as Error).message ?? "An unexpected error occurred."}</AlertDescription>
          </Alert>
        </div>
      </MainLayout>
    );
  }
  if (!isSuperAdmin) {
    return (
      <MainLayout>
        <div className="p-6 max-w-2xl mx-auto">
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Super-admin only</AlertTitle>
            <AlertDescription>Cross-distributor reseller visibility is a Peritus operation.</AlertDescription>
          </Alert>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-7xl mx-auto">
        <PortalHero
          eyebrow="Platform admin"
          eyebrowIcon={<Briefcase className="h-3.5 w-3.5" />}
          title="All resellers"
          subtitle="Every reseller across every distributor — health, balance, endpoints, and last activity in one place. Use the filters to focus on who needs intervention."
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <PortalStatCard label="Total resellers"      value={totals.count}     icon={<Briefcase className="h-4 w-4" />} loading={isLoading} hint="Active across all distys" />
          <PortalStatCard label="Need attention"       value={totals.needsAtt}  icon={<AlertTriangle className="h-4 w-4" />} loading={isLoading} hint="Any warning flag" />
          <PortalStatCard label="Overdrawn"            value={totals.overdrawn} icon={<AlertTriangle className="h-4 w-4" />} loading={isLoading} hint="Negative credit balance" />
          <PortalStatCard label="Active endpoints"     value={totals.endpoints} icon={<Activity className="h-4 w-4" />} loading={isLoading} hint="Sum across all reseller customers" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Reseller health</CardTitle>
            <CardDescription>Sorted by attention score by default — the most-urgent appears first.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <div className="relative flex-1">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by reseller or distributor name"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={distyId} onValueChange={setDistyId}>
                <SelectTrigger className="sm:w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All distributors</SelectItem>
                  {distys.map(d => (<SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>))}
                </SelectContent>
              </Select>
              <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
                <SelectTrigger className="sm:w-60"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(o => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>

            {isLoading ? (
              <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No resellers match these filters.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reseller</TableHead>
                    <TableHead>Distributor</TableHead>
                    <TableHead className="text-right">Customers</TableHead>
                    <TableHead className="text-right">Endpoints</TableHead>
                    <TableHead className="text-right">Credit balance</TableHead>
                    <TableHead className="text-right">Runway</TableHead>
                    <TableHead>Last txn</TableHead>
                    <TableHead>Flags</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(r => (
                    <TableRow key={r.reseller_id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Briefcase className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <div className="font-medium">{r.reseller_name}</div>
                            <div className="text-xs text-muted-foreground">since {new Date(r.created_at).toLocaleDateString()}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {r.distributor_id
                          ? <Link to={`/admin/credits`} className="text-sm hover:underline inline-flex items-center gap-1">
                              <Warehouse className="h-3.5 w-3.5 text-primary" /> {r.distributor_name ?? "—"}
                            </Link>
                          : <span className="text-sm text-muted-foreground">Direct</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{Number(r.customer_count ?? 0)}</TableCell>
                      <TableCell className="text-right tabular-nums">{Number(r.active_endpoints ?? 0)}</TableCell>
                      <TableCell className={`text-right tabular-nums font-medium ${r.credit_balance < 0 ? "text-destructive" : ""}`}>
                        {r.credit_balance}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                        {r.runway_months == null
                          ? "—"
                          : r.runway_months < 0
                            ? <span className="text-destructive">overdrawn</span>
                            : `${r.runway_months.toFixed(1)} mo`}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.last_transaction ? formatDistanceToNow(new Date(r.last_transaction), { addSuffix: true }) : "never"}
                      </TableCell>
                      <TableCell><HealthBadges row={r} /></TableCell>
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
