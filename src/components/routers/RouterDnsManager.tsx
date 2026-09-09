import { useState } from "react";
import { useRouters, useDnsZones, useDnsRecords, useCreateDnsZone, useDeleteDnsZone, useCreateDnsRecord, useDeleteDnsRecord } from "@/hooks/useRouters";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Plus, Trash2, ChevronDown, Globe, Loader2 } from "lucide-react";

function ZoneRecords({ zoneId }: { zoneId: string }) {
  const { data: records, isLoading } = useDnsRecords(zoneId);
  const createRecord = useCreateDnsRecord();
  const deleteRecord = useDeleteDnsRecord();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ record_name: "", record_type: "A", record_value: "", ttl: 3600 });

  const handleAdd = async () => {
    if (!form.record_name || !form.record_value) return;
    await createRecord.mutateAsync({ zone_id: zoneId, ...form } as any);
    setOpen(false);
    setForm({ record_name: "", record_type: "A", record_value: "", ttl: 3600 });
  };

  return (
    <div className="pl-6 pb-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">Records</span>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button variant="outline" size="sm"><Plus className="h-3 w-3 mr-1" />Add Record</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add DNS Record</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Name *</Label><Input value={form.record_name} onChange={e => setForm(f => ({ ...f, record_name: e.target.value }))} placeholder="www" /></div>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={form.record_type} onValueChange={v => setForm(f => ({ ...f, record_type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["A", "AAAA", "CNAME", "MX", "TXT", "PTR", "SRV"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2"><Label>Value *</Label><Input value={form.record_value} onChange={e => setForm(f => ({ ...f, record_value: e.target.value }))} placeholder="192.168.1.1" /></div>
              <div className="space-y-2"><Label>TTL</Label><Input type="number" value={form.ttl} onChange={e => setForm(f => ({ ...f, ttl: parseInt(e.target.value) || 3600 }))} /></div>
              <Button onClick={handleAdd} disabled={createRecord.isPending} className="w-full">Add Record</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
        <Table>
          <TableHeader><TableRow>
            <TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Value</TableHead><TableHead>TTL</TableHead><TableHead className="w-[40px]" />
          </TableRow></TableHeader>
          <TableBody>
            {records?.map(r => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-sm">{r.record_name}</TableCell>
                <TableCell><Badge variant="outline">{r.record_type}</Badge></TableCell>
                <TableCell className="font-mono text-sm">{r.record_value}</TableCell>
                <TableCell className="text-muted-foreground">{r.ttl}s</TableCell>
                <TableCell><Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteRecord.mutate(r.id)}><Trash2 className="h-3 w-3" /></Button></TableCell>
              </TableRow>
            ))}
            {!records?.length && <TableRow><TableCell colSpan={5} className="text-center py-4 text-muted-foreground">No records</TableCell></TableRow>}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

export function RouterDnsManager() {
  const { data: routers } = useRouters();
  const { data: zones, isLoading } = useDnsZones();
  const createZone = useCreateDnsZone();
  const deleteZone = useDeleteDnsZone();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ router_id: "", zone_name: "", zone_type: "forward", upstream_servers: "" });

  const handleCreate = async () => {
    if (!form.router_id || !form.zone_name) return;
    await createZone.mutateAsync({
      router_id: form.router_id,
      zone_name: form.zone_name,
      zone_type: form.zone_type,
      upstream_servers: form.upstream_servers ? form.upstream_servers.split(",").map(s => s.trim()) : null,
    } as any);
    setOpen(false);
    setForm({ router_id: "", zone_name: "", zone_type: "forward", upstream_servers: "" });
  };

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{zones?.length || 0} DNS zones configured</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Add Zone</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add DNS Zone</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Router *</Label>
                <Select value={form.router_id} onValueChange={v => setForm(f => ({ ...f, router_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select router" /></SelectTrigger>
                  <SelectContent>{routers?.map(r => <SelectItem key={r.id} value={r.id}>{r.hostname}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Zone Name *</Label><Input value={form.zone_name} onChange={e => setForm(f => ({ ...f, zone_name: e.target.value }))} placeholder="example.com" /></div>
              <div className="space-y-2">
                <Label>Zone Type</Label>
                <Select value={form.zone_type} onValueChange={v => setForm(f => ({ ...f, zone_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="forward">Forward</SelectItem>
                    <SelectItem value="reverse">Reverse</SelectItem>
                    <SelectItem value="stub">Stub</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Upstream Servers</Label><Input value={form.upstream_servers} onChange={e => setForm(f => ({ ...f, upstream_servers: e.target.value }))} placeholder="8.8.8.8, 1.1.1.1" /></div>
              <Button onClick={handleCreate} disabled={createZone.isPending} className="w-full">Create Zone</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-2">
        {zones?.map(zone => {
          const router = routers?.find(r => r.id === zone.router_id);
          return (
            <Card key={zone.id}>
              <Collapsible>
                <div className="flex items-center justify-between p-4">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="flex items-center gap-3 p-0 h-auto hover:bg-transparent">
                      <Globe className="h-4 w-4 text-primary" />
                      <div className="text-left">
                        <div className="font-medium">{zone.zone_name}</div>
                        <div className="text-xs text-muted-foreground">{router?.hostname || "Unknown"} · {zone.zone_type}</div>
                      </div>
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </CollapsibleTrigger>
                  <div className="flex items-center gap-2">
                    <Badge variant={zone.enabled ? "default" : "secondary"}>{zone.enabled ? "Active" : "Disabled"}</Badge>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteZone.mutate(zone.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
                <CollapsibleContent>
                  <ZoneRecords zoneId={zone.id} />
                </CollapsibleContent>
              </Collapsible>
            </Card>
          );
        })}
        {!zones?.length && (
          <Card className="p-8 text-center text-muted-foreground">No DNS zones configured. Add a router first, then create DNS zones.</Card>
        )}
      </div>
    </div>
  );
}
