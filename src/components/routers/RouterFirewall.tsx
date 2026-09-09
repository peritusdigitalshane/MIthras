import { useState } from "react";
import { useRouters, useRouterFirewallRules, useCreateRouterFirewallRule, useDeleteRouterFirewallRule } from "@/hooks/useRouters";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Loader2, ShieldCheck, ShieldX } from "lucide-react";

export function RouterFirewall() {
  const { data: routers } = useRouters();
  const [selectedRouter, setSelectedRouter] = useState<string>("");
  const { data: rules, isLoading } = useRouterFirewallRules(selectedRouter || undefined);
  const createRule = useCreateRouterFirewallRule();
  const deleteRule = useDeleteRouterFirewallRule();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    router_id: "", name: "", direction: "inbound", action: "deny", protocol: "tcp",
    source_address: "any", source_port: "", destination_address: "any", destination_port: "",
    interface: "", order_priority: 100, log_enabled: false,
  });

  const handleCreate = async () => {
    const routerId = form.router_id || selectedRouter;
    if (!routerId || !form.name) return;
    await createRule.mutateAsync({
      router_id: routerId,
      name: form.name,
      direction: form.direction,
      action: form.action,
      protocol: form.protocol,
      source_address: form.source_address || "any",
      source_port: form.source_port || null,
      destination_address: form.destination_address || "any",
      destination_port: form.destination_port || null,
      interface: form.interface || null,
      order_priority: form.order_priority,
      log_enabled: form.log_enabled,
    } as any);
    setOpen(false);
    setForm({ router_id: "", name: "", direction: "inbound", action: "deny", protocol: "tcp", source_address: "any", source_port: "", destination_address: "any", destination_port: "", interface: "", order_priority: 100, log_enabled: false });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
           <Select value={selectedRouter || "all"} onValueChange={v => setSelectedRouter(v === "all" ? "" : v)}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="All routers" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Routers</SelectItem>
              {routers?.map(r => <SelectItem key={r.id} value={r.id}>{r.hostname}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">{rules?.length || 0} rules</span>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Add Rule</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Add Firewall Rule</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Block SSH from WAN" /></div>
                <div className="space-y-2">
                  <Label>Router *</Label>
                  <Select value={form.router_id || selectedRouter} onValueChange={v => setForm(f => ({ ...f, router_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{routers?.map(r => <SelectItem key={r.id} value={r.id}>{r.hostname}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Direction</Label>
                  <Select value={form.direction} onValueChange={v => setForm(f => ({ ...f, direction: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inbound">Inbound</SelectItem>
                      <SelectItem value="outbound">Outbound</SelectItem>
                      <SelectItem value="forward">Forward</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Action</Label>
                  <Select value={form.action} onValueChange={v => setForm(f => ({ ...f, action: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="allow">Allow</SelectItem>
                      <SelectItem value="deny">Deny</SelectItem>
                      <SelectItem value="reject">Reject</SelectItem>
                      <SelectItem value="log">Log Only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Protocol</Label>
                  <Select value={form.protocol} onValueChange={v => setForm(f => ({ ...f, protocol: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any</SelectItem>
                      <SelectItem value="tcp">TCP</SelectItem>
                      <SelectItem value="udp">UDP</SelectItem>
                      <SelectItem value="icmp">ICMP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Source Address</Label><Input value={form.source_address} onChange={e => setForm(f => ({ ...f, source_address: e.target.value }))} placeholder="any" /></div>
                <div className="space-y-2"><Label>Source Port</Label><Input value={form.source_port} onChange={e => setForm(f => ({ ...f, source_port: e.target.value }))} placeholder="any" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Dest Address</Label><Input value={form.destination_address} onChange={e => setForm(f => ({ ...f, destination_address: e.target.value }))} placeholder="any" /></div>
                <div className="space-y-2"><Label>Dest Port</Label><Input value={form.destination_port} onChange={e => setForm(f => ({ ...f, destination_port: e.target.value }))} placeholder="22" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Interface</Label><Input value={form.interface} onChange={e => setForm(f => ({ ...f, interface: e.target.value }))} placeholder="wan" /></div>
                <div className="space-y-2"><Label>Priority</Label><Input type="number" value={form.order_priority} onChange={e => setForm(f => ({ ...f, order_priority: parseInt(e.target.value) || 100 }))} /></div>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.log_enabled} onCheckedChange={v => setForm(f => ({ ...f, log_enabled: v }))} />
                <Label>Enable logging</Label>
              </div>
              <Button onClick={handleCreate} disabled={createRule.isPending || !form.name} className="w-full">Add Rule</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        {isLoading ? <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Direction</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Protocol</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Router</TableHead>
                <TableHead className="w-[60px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules?.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="text-muted-foreground">{r.order_priority}</TableCell>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell><Badge variant="outline">{r.direction}</Badge></TableCell>
                  <TableCell>
                    {r.action === "allow"
                      ? <Badge className="bg-green-600"><ShieldCheck className="h-3 w-3 mr-1" />Allow</Badge>
                      : <Badge variant="destructive"><ShieldX className="h-3 w-3 mr-1" />{r.action}</Badge>}
                  </TableCell>
                  <TableCell className="uppercase text-xs">{r.protocol}</TableCell>
                  <TableCell className="font-mono text-xs">{r.source_address}{r.source_port ? `:${r.source_port}` : ""}</TableCell>
                  <TableCell className="font-mono text-xs">{r.destination_address}{r.destination_port ? `:${r.destination_port}` : ""}</TableCell>
                  <TableCell className="text-sm">{routers?.find(rt => rt.id === r.router_id)?.hostname || "—"}</TableCell>
                  <TableCell><Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteRule.mutate(r.id)}><Trash2 className="h-3.5 w-3.5" /></Button></TableCell>
                </TableRow>
              ))}
              {!rules?.length && <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No firewall rules configured</TableCell></TableRow>}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
