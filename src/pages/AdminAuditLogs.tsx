import { useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ShieldAlert, Search, FileText, Building2, User as UserIcon, Loader2 } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useTenant } from "@/contexts/TenantContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface AuditRow {
  id: string;
  organization_id: string;
  user_id: string | null;
  endpoint_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
  organization_name?: string | null;
  user_email?: string | null;
}

const PAGE_SIZE = 100;
const SCOPE_OPTIONS = [
  { value: "all",  label: "All organisations" },
  { value: "auth", label: "Authentication only" },
  { value: "ai",   label: "AI SOC actions only" },
  { value: "lic",  label: "Credit / licence transactions" },
  { value: "endpoint", label: "Endpoint actions only" },
];

function scopeFilter(scope: string): { pattern?: string; resourceType?: string } {
  switch (scope) {
    case "auth":     return { pattern: "login|password|mfa|invite|signup" };
    case "ai":       return { pattern: "ai_|force_rollback|confirm_action|action_dispatched" };
    case "lic":      return { pattern: "licence|credit|invoice" };
    case "endpoint": return { resourceType: "endpoint" };
    default:         return {};
  }
}

export default function AdminAuditLogs() {
  const { isSuperAdmin, isLoading: tenantLoading } = useTenant();
  const [scope, setScope] = useState<string>("all");
  const [query, setQuery] = useState<string>("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-audit-logs", scope, query],
    queryFn: async (): Promise<AuditRow[]> => {
      let q = supabase
        .from("activity_logs")
        .select(`
          id, organization_id, user_id, endpoint_id, action, resource_type, resource_id,
          details, ip_address, created_at,
          organizations(name),
          profiles(email)
        `)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);

      const sf = scopeFilter(scope);
      if (sf.pattern)      q = q.or(sf.pattern.split("|").map((p) => `action.ilike.%${p}%`).join(","));
      if (sf.resourceType) q = q.eq("resource_type", sf.resourceType);
      if (query.trim()) {
        const term = query.trim();
        q = q.or(`action.ilike.%${term}%,resource_id.ilike.%${term}%,ip_address.ilike.%${term}%`);
      }
      const { data: rows, error: e } = await q;
      if (e) throw e;
      return (rows ?? []).map((r: any) => ({
        ...r,
        organization_name: r.organizations?.name ?? null,
        user_email:        r.profiles?.email      ?? null,
      })) as AuditRow[];
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
    enabled: isSuperAdmin,
  });

  const rows = data ?? [];
  const byOrg = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.organization_name ?? r.organization_id, (m.get(r.organization_name ?? r.organization_id) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [rows]);

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
            <AlertDescription>
              Cross-tenant audit logs are restricted to Mithras platform operators. Org-scoped audit history is available at <code className="text-xs">/activity</code>.
            </AlertDescription>
          </Alert>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" />
            Cross-tenant audit log
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Activity ledger across every customer organisation. Records are retained for 12 months on a rolling window; a nightly job purges anything older.
          </p>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4 flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by action, resource id, or IP address"
                className="pl-9"
              />
            </div>
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger className="sm:w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SCOPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Top organisations summary */}
        {rows.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">
                Top organisations in this view
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {byOrg.map(([name, count]) => (
                <Badge key={name} variant="outline" className="gap-1.5 px-2.5 py-1">
                  <Building2 className="h-3 w-3" />
                  {name}
                  <span className="text-muted-foreground tabular-nums">· {count}</span>
                </Badge>
              ))}
            </CardContent>
          </Card>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Couldn&apos;t load audit logs</AlertTitle>
            <AlertDescription>{(error as Error).message}</AlertDescription>
          </Alert>
        )}

        {/* Logs table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {isLoading
                ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Loading</span>
                : `${rows.length} row${rows.length === 1 ? "" : "s"}`}
            </CardTitle>
            <CardDescription>Most recent first. Showing up to {PAGE_SIZE} rows; refine filters to narrow the view.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No audit rows match the current filter.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-40">When</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Organisation</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Resource</TableHead>
                      <TableHead>IP</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs whitespace-nowrap">
                          <div>{formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</div>
                          <div className="text-muted-foreground font-mono text-[10px]">
                            {format(new Date(r.created_at), "yyyy-MM-dd HH:mm:ss")}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-[10px]">{r.action}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.organization_name ? (
                            <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3 text-muted-foreground" />{r.organization_name}</span>
                          ) : (
                            <span className="text-muted-foreground font-mono">{r.organization_id.slice(0, 8)}…</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.user_email ? (
                            <span className="inline-flex items-center gap-1"><UserIcon className="h-3 w-3 text-muted-foreground" />{r.user_email}</span>
                          ) : (
                            <span className="text-muted-foreground italic">system</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          <span className="font-mono text-muted-foreground">{r.resource_type}</span>
                          {r.resource_id && <span className="text-muted-foreground/60"> · {r.resource_id.slice(0, 12)}</span>}
                        </TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground">
                          {r.ip_address ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
