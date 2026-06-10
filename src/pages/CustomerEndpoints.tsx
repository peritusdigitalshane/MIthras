import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Monitor, ShieldCheck, Wifi, WifiOff } from "lucide-react";
import { PortalHero } from "@/components/portal/PortalHero";
import { PortalEmptyState } from "@/components/portal/PortalEmptyState";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCustomerOrgId } from "@/hooks/useCustomerScope";
import { formatDistanceToNow } from "date-fns";

export default function CustomerEndpoints() {
  const orgId = useCustomerOrgId();
  const { data: endpoints, isLoading } = useQuery({
    queryKey: ["customer-endpoints", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("endpoints")
        .select("id, hostname, os_version, agent_version, last_seen_at, is_active, deleted_at, enrolled_at")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("last_seen_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; hostname: string | null; os_version: string | null; agent_version: string | null;
        last_seen_at: string | null; is_active: boolean | null; deleted_at: string | null; enrolled_at: string | null;
      }>;
    },
  });

  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-7xl mx-auto">
        <PortalHero
          eyebrow="Customer portal"
          eyebrowIcon={<ShieldCheck className="h-3.5 w-3.5" />}
          title="My endpoints"
          subtitle="Every Windows machine protected by Mithras in your organisation. Read-only — your reseller manages policies, deployment, and incident response."
          accent="emerald"
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Monitor className="h-4 w-4 text-primary" /> Protected machines
            </CardTitle>
            <CardDescription>
              An endpoint is "online" if it's reported telemetry in the last 10 minutes.
              "Offline" usually means the machine is powered off — your reseller is notified if it stays offline for too long.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : (endpoints ?? []).length === 0 ? (
              <PortalEmptyState
                icon={<Monitor className="h-7 w-7" />}
                title="No endpoints enrolled yet"
                description={<p>Once your reseller installs the Mithras agent on your Windows machines, they'll appear here within 60 seconds.</p>}
                accent="emerald"
                className="border-0 shadow-none"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Machine</TableHead>
                    <TableHead>OS</TableHead>
                    <TableHead>Agent version</TableHead>
                    <TableHead>Last seen</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(endpoints ?? []).map(e => {
                    const online = e.last_seen_at && e.last_seen_at > tenMinAgo;
                    return (
                      <TableRow key={e.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                              <Monitor className="h-4 w-4 text-primary" />
                            </div>
                            <div className="font-medium">{e.hostname ?? "(unnamed)"}</div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{e.os_version ?? "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground font-mono">{e.agent_version ?? "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {e.last_seen_at ? formatDistanceToNow(new Date(e.last_seen_at), { addSuffix: true }) : "Never"}
                        </TableCell>
                        <TableCell>
                          {online ? (
                            <Badge variant="outline" className="border-emerald-500/60 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10">
                              <Wifi className="h-3 w-3 mr-1" /> Online
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-muted-foreground/40 text-muted-foreground">
                              <WifiOff className="h-3 w-3 mr-1" /> Offline
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
