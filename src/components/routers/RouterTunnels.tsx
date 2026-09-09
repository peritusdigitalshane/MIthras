import { useState } from "react";
import { useRouters, useTunnels, useCreateTunnel, useDeleteTunnel } from "@/hooks/useRouters";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Loader2, ArrowLeftRight, Lock } from "lucide-react";

const TUNNEL_TYPES = [
  { value: "ipsec", label: "IPsec" },
  { value: "wireguard", label: "WireGuard" },
  { value: "gre", label: "GRE" },
  { value: "vxlan", label: "VXLAN" },
  { value: "openvpn", label: "OpenVPN" },
];

const STATUS_COLORS: Record<string, string> = {
  up: "bg-green-600",
  configured: "bg-blue-600",
  down: "bg-destructive",
  error: "bg-orange-600",
};

export function RouterTunnels() {
  const { data: routers } = useRouters();
  const { data: tunnels, isLoading } = useTunnels();
  const createTunnel = useCreateTunnel();
  const deleteTunnel = useDeleteTunnel();
  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState({
    name: "", tunnel_type: "ipsec", router_a_id: "", router_b_id: "",
    router_a_endpoint: "", router_b_endpoint: "", router_a_subnet: "", router_b_subnet: "",
    encryption: "aes-256-gcm", psk_hint: "",
  });

  const handleCreate = async () => {
    if (!form.name || !form.router_a_id) return;
    await createTunnel.mutateAsync({
      name: form.name,
      tunnel_type: form.tunnel_type,
      router_a_id: form.router_a_id,
      router_b_id: form.router_b_id || null,
      router_a_endpoint: form.router_a_endpoint || null,
      router_b_endpoint: form.router_b_endpoint || null,
      router_a_subnet: form.router_a_subnet || null,
      router_b_subnet: form.router_b_subnet || null,
      encryption: form.encryption,
      psk_hint: form.psk_hint || null,
    } as any);
    setOpen(false);
    setForm({ name: "", tunnel_type: "ipsec", router_a_id: "", router_b_id: "", router_a_endpoint: "", router_b_endpoint: "", router_a_subnet: "", router_b_subnet: "", encryption: "aes-256-gcm", psk_hint: "" });
  };

  const getRouterName = (id: string | null) => routers?.find(r => r.id === id)?.hostname || "External";

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{tunnels?.length || 0} tunnels configured</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Create Tunnel</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Create Tunnel</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="HQ-to-Branch1" /></div>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={form.tunnel_type} onValueChange={v => setForm(f => ({ ...f, tunnel_type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{TUNNEL_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Router A *</Label>
                  <Select value={form.router_a_id} onValueChange={v => setForm(f => ({ ...f, router_a_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{routers?.map(r => <SelectItem key={r.id} value={r.id}>{r.hostname}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Router B</Label>
                  <Select value={form.router_b_id || "external"} onValueChange={v => setForm(f => ({ ...f, router_b_id: v === "external" ? "" : v }))}>
                    <SelectTrigger><SelectValue placeholder="External peer" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="external">External Peer</SelectItem>
                      {routers?.filter(r => r.id !== form.router_a_id).map(r => <SelectItem key={r.id} value={r.id}>{r.hostname}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>A Endpoint</Label><Input value={form.router_a_endpoint} onChange={e => setForm(f => ({ ...f, router_a_endpoint: e.target.value }))} placeholder="203.0.113.1" /></div>
                <div className="space-y-2"><Label>B Endpoint</Label><Input value={form.router_b_endpoint} onChange={e => setForm(f => ({ ...f, router_b_endpoint: e.target.value }))} placeholder="198.51.100.1" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>A Subnet</Label><Input value={form.router_a_subnet} onChange={e => setForm(f => ({ ...f, router_a_subnet: e.target.value }))} placeholder="10.0.1.0/24" /></div>
                <div className="space-y-2"><Label>B Subnet</Label><Input value={form.router_b_subnet} onChange={e => setForm(f => ({ ...f, router_b_subnet: e.target.value }))} placeholder="10.0.2.0/24" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Encryption</Label><Input value={form.encryption} onChange={e => setForm(f => ({ ...f, encryption: e.target.value }))} /></div>
                <div className="space-y-2"><Label>PSK Hint</Label><Input value={form.psk_hint} onChange={e => setForm(f => ({ ...f, psk_hint: e.target.value }))} placeholder="vault:tunnel-key-1" /></div>
              </div>
              <Button onClick={handleCreate} disabled={createTunnel.isPending || !form.name || !form.router_a_id} className="w-full">Create Tunnel</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Route</TableHead>
              <TableHead>Encryption</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tunnels?.map(t => (
              <TableRow key={t.id}>
                <TableCell><Badge className={STATUS_COLORS[t.status] || "bg-muted"}>{t.status}</Badge></TableCell>
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell><Badge variant="outline">{TUNNEL_TYPES.find(tt => tt.value === t.tunnel_type)?.label || t.tunnel_type}</Badge></TableCell>
                <TableCell>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-mono">{getRouterName(t.router_a_id)}</span>
                    <ArrowLeftRight className="h-3 w-3 text-muted-foreground" />
                    <span className="font-mono">{getRouterName(t.router_b_id)}</span>
                  </div>
                </TableCell>
                <TableCell><div className="flex items-center gap-1 text-sm text-muted-foreground"><Lock className="h-3 w-3" />{t.encryption}</div></TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteTarget({ id: t.id, name: t.name })}><Trash2 className="h-3.5 w-3.5" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {!tunnels?.length && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No tunnels configured</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <AlertDialog open={!!deleteTarget} onOpenChange={o => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete tunnel "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>This will remove the tunnel configuration.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => { if (deleteTarget) { deleteTunnel.mutate(deleteTarget.id); setDeleteTarget(null); } }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
