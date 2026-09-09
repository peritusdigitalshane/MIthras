import { useState } from "react";
import { useRouters, useCreateRouter, useDeleteRouter, useDnsZones, VENDOR_OPTIONS } from "@/hooks/useRouters";
import { useRouterUptimeBatch, RouterUptimeStats } from "@/hooks/useRouterUptime";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Trash2, Wifi, WifiOff, Loader2, Clock, ArrowUpCircle, Globe } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

function formatDowntime(minutes: number | null): string {
  if (minutes === null || minutes <= 0) return "None";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  const days = Math.floor(minutes / 1440);
  const hrs = Math.floor((minutes % 1440) / 60);
  return `${days}d ${hrs}h`;
}

function UptimeCell({ stats }: { stats: RouterUptimeStats | undefined }) {
  if (!stats) return <span className="text-muted-foreground text-xs">—</span>;
  const pct = stats.uptime_percent ?? 0;
  const color = pct >= 99.5 ? "text-green-500" : pct >= 95 ? "text-yellow-500" : "text-destructive";
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1.5">
            <ArrowUpCircle className={`h-3.5 w-3.5 ${color}`} />
            <span className={`font-semibold text-sm ${color}`}>{pct}%</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs space-y-1">
          <p>30-day uptime: <strong>{pct}%</strong></p>
          <p>Total downtime: {formatDowntime(stats.total_downtime_minutes)}</p>
          {stats.last_offline_at && (
            <p>Last offline: {formatDistanceToNow(new Date(stats.last_offline_at), { addSuffix: true })}</p>
          )}
          {stats.current_session_start && (
            <p>Current session: {formatDistanceToNow(new Date(stats.current_session_start), { addSuffix: false })} ago</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function LastSeenCell({ lastSeen, isOnline, sessionStart }: { lastSeen: string | null; isOnline: boolean; sessionStart: string | null }) {
  if (isOnline && sessionStart) {
    return (
      <span className="text-xs text-muted-foreground flex items-center gap-1">
        <Clock className="h-3 w-3" />
        Up {formatDistanceToNow(new Date(sessionStart))}
      </span>
    );
  }
  if (lastSeen) {
    return (
      <span className="text-xs text-muted-foreground flex items-center gap-1">
        <Clock className="h-3 w-3" />
        {formatDistanceToNow(new Date(lastSeen), { addSuffix: true })}
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">Never</span>;
}

interface DnsInfo {
  zones: string[];
  forwarders: string[];
}

function DnsCell({ info }: { info: DnsInfo | undefined }) {
  if (!info || (info.zones.length === 0 && info.forwarders.length === 0)) {
    return <span className="text-xs text-muted-foreground">None</span>;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1.5 max-w-[180px]">
            <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs truncate">
              {info.forwarders.length > 0
                ? info.forwarders.slice(0, 2).join(", ") + (info.forwarders.length > 2 ? ` +${info.forwarders.length - 2}` : "")
                : `${info.zones.length} zone${info.zones.length !== 1 ? "s" : ""}`}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs space-y-2 max-w-[280px]">
          {info.zones.length > 0 && (
            <div>
              <p className="font-semibold mb-1">DNS Zones ({info.zones.length})</p>
              {info.zones.map(z => <p key={z} className="font-mono">{z}</p>)}
            </div>
          )}
          {info.forwarders.length > 0 && (
            <div>
              <p className="font-semibold mb-1">Forwarders</p>
              {info.forwarders.map(f => <p key={f} className="font-mono">{f}</p>)}
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function RouterInventory() {
  const { data: routers, isLoading } = useRouters();
  const { data: dnsZones } = useDnsZones();
  const createRouter = useCreateRouter();
  const deleteRouter = useDeleteRouter();
  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState({ hostname: "", vendor: "cisco", model: "", management_ip: "", wan_ip: "", site_name: "", location: "" });

  const routerIds = routers?.map(r => r.id) ?? [];
  const { data: uptimeMap } = useRouterUptimeBatch(routerIds);

  // Build DNS info map per router
  const dnsMap: Record<string, DnsInfo> = {};
  if (dnsZones) {
    for (const zone of dnsZones) {
      if (!dnsMap[zone.router_id]) {
        dnsMap[zone.router_id] = { zones: [], forwarders: [] };
      }
      dnsMap[zone.router_id].zones.push(zone.zone_name);
      if (zone.upstream_servers) {
        for (const srv of zone.upstream_servers) {
          if (!dnsMap[zone.router_id].forwarders.includes(srv)) {
            dnsMap[zone.router_id].forwarders.push(srv);
          }
        }
      }
    }
  }

  const handleCreate = async () => {
    if (!form.hostname || !form.vendor) return;
    await createRouter.mutateAsync({
      hostname: form.hostname,
      vendor: form.vendor,
      model: form.model || null,
      management_ip: form.management_ip || null,
      wan_ip: form.wan_ip || null,
      site_name: form.site_name || null,
      location: form.location || null,
    } as any);
    setOpen(false);
    setForm({ hostname: "", vendor: "cisco", model: "", management_ip: "", wan_ip: "", site_name: "", location: "" });
  };

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{routers?.length || 0} routers registered</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />Add Router</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Router</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Hostname *</Label>
                <Input value={form.hostname} onChange={e => setForm(f => ({ ...f, hostname: e.target.value }))} placeholder="router-hq-01" />
              </div>
              <div className="space-y-2">
                <Label>Vendor *</Label>
                <Select value={form.vendor} onValueChange={v => setForm(f => ({ ...f, vendor: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VENDOR_OPTIONS.map(v => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Model</Label><Input value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} placeholder="ISR 4331" /></div>
                <div className="space-y-2"><Label>Site Name</Label><Input value={form.site_name} onChange={e => setForm(f => ({ ...f, site_name: e.target.value }))} placeholder="HQ" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Management IP</Label><Input value={form.management_ip} onChange={e => setForm(f => ({ ...f, management_ip: e.target.value }))} placeholder="10.0.0.1" /></div>
                <div className="space-y-2"><Label>WAN IP</Label><Input value={form.wan_ip} onChange={e => setForm(f => ({ ...f, wan_ip: e.target.value }))} placeholder="203.0.113.1" /></div>
              </div>
              <div className="space-y-2"><Label>Location</Label><Input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="London, UK" /></div>
              <Button onClick={handleCreate} disabled={createRouter.isPending || !form.hostname} className="w-full">
                {createRouter.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Add Router
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Hostname</TableHead>
              <TableHead>Uptime (30d)</TableHead>
              <TableHead>Last Seen</TableHead>
              <TableHead>DNS / Forwarders</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>WAN IP</TableHead>
              <TableHead>Site</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {routers?.map(r => {
              const stats = uptimeMap?.[r.id];
              return (
                <TableRow key={r.id}>
                  <TableCell>
                    {r.is_online
                      ? <Badge variant="default" className="bg-green-600"><Wifi className="h-3 w-3 mr-1" />Online</Badge>
                      : <Badge variant="secondary"><WifiOff className="h-3 w-3 mr-1" />Offline</Badge>}
                  </TableCell>
                  <TableCell className="font-medium">{r.hostname}</TableCell>
                  <TableCell><UptimeCell stats={stats} /></TableCell>
                  <TableCell>
                    <LastSeenCell lastSeen={r.last_seen_at} isOnline={r.is_online} sessionStart={stats?.current_session_start ?? null} />
                  </TableCell>
                  <TableCell><DnsCell info={dnsMap[r.id]} /></TableCell>
                  <TableCell><Badge variant="outline">{VENDOR_OPTIONS.find(v => v.value === r.vendor)?.label || r.vendor}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{r.model || "—"}</TableCell>
                  <TableCell className="font-mono text-sm">{r.wan_ip || "—"}</TableCell>
                  <TableCell>{r.site_name || "—"}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget({ id: r.id, name: r.hostname })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {!routers?.length && (
              <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No routers registered yet</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <AlertDialog open={!!deleteTarget} onOpenChange={o => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>This will remove the router and all associated DNS zones, tunnels, and firewall rules.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteRouter.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteRouter.isPending}
              onClick={() => { if (deleteTarget) { deleteRouter.mutate(deleteTarget.id); setDeleteTarget(null); } }}
            >
              {deleteRouter.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
