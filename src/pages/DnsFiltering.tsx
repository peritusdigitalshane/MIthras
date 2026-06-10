import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useDnsPolicies, useDnsInternalScopes, useDnsInsights,
  useCreateDnsPolicy, useUpdateDnsPolicy, useDeleteDnsPolicy,
  useUpsertInternalScope, useDeleteInternalScope,
  DnsPolicy, DnsInternalScope,
} from "@/hooks/useDnsFiltering";
import {
  Globe, Plus, Trash2, ShieldCheck, ShieldOff, Eye, Network, Search,
  AlertCircle, Loader2, ServerCog,
} from "lucide-react";

const PROVIDERS = [
  { value: "cloudflare_family", label: "Cloudflare for Families (1.1.1.3)" },
  { value: "cloudflare", label: "Cloudflare (1.1.1.1)" },
  { value: "quad9", label: "Quad9 (9.9.9.9)" },
  { value: "opendns_family", label: "OpenDNS Family Shield" },
  { value: "google", label: "Google (8.8.8.8)" },
  { value: "custom", label: "Custom DoH URI…" },
];

const DnsFiltering = () => {
  const { data: policies, isLoading } = useDnsPolicies();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const create = useCreateDnsPolicy();
  const [newName, setNewName] = useState("Default");

  const selected = policies?.find((p) => p.id === selectedId) ?? policies?.[0] ?? null;

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Globe className="h-7 w-7 text-primary" />
              DNS Filtering
            </h1>
            <p className="text-muted-foreground mt-1 max-w-2xl">
              Endpoints route DNS via <code className="font-mono text-xs">dns.mithras.com.au</code>,
              policy decisions happen here, internal suffixes resolve via your customer's own DNS
              forwarders.
            </p>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> New policy
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create DNS policy</DialogTitle>
                <DialogDescription>
                  Each customer can have multiple policies, but only one can be the default.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="name">Policy name</Label>
                  <Input id="name" value={newName} onChange={(e) => setNewName(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button
                  onClick={() =>
                    create.mutate(
                      { name: newName, is_default: !policies?.length },
                      { onSuccess: () => { setCreateOpen(false); setNewName("Default"); } },
                    )
                  }
                  disabled={create.isPending || !newName.trim()}
                >
                  {create.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : !policies?.length ? (
          <EmptyState />
        ) : (
          <div className="grid lg:grid-cols-[260px_1fr] gap-6">
            <PolicyList
              policies={policies}
              selectedId={selected?.id ?? null}
              onSelect={(id) => setSelectedId(id)}
            />
            {selected && <PolicyDetail policy={selected} />}
          </div>
        )}
      </div>
    </MainLayout>
  );
};

function EmptyState() {
  return (
    <Card>
      <CardContent className="py-12 text-center text-muted-foreground">
        <Globe className="h-12 w-12 mx-auto mb-4 opacity-40" />
        <h3 className="text-base font-medium text-foreground">No DNS policies yet</h3>
        <p className="text-sm mt-1 max-w-md mx-auto">
          Create a default policy to start filtering DNS for this customer. The platform
          uses Cloudflare for Families by default — override in the policy if you need a
          different upstream.
        </p>
      </CardContent>
    </Card>
  );
}

function PolicyList({
  policies, selectedId, onSelect,
}: {
  policies: DnsPolicy[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">Policies</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 p-3">
        {policies.map((p) => (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors flex items-center justify-between gap-2 ${
              selectedId === p.id ? "bg-primary/10 border border-primary/40" : "hover:bg-muted/40 border border-transparent"
            }`}
          >
            <div className="min-w-0">
              <div className="font-medium text-sm truncate">{p.name}</div>
              <div className="text-xs text-muted-foreground truncate">
                {p.upstream_provider ?? "Platform default upstream"}
              </div>
            </div>
            {p.is_default && (
              <Badge variant="secondary" className="text-[10px]">Default</Badge>
            )}
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

function PolicyDetail({ policy }: { policy: DnsPolicy }) {
  return (
    <Tabs defaultValue="filtering" className="space-y-4">
      <TabsList>
        <TabsTrigger value="filtering" className="gap-2"><ShieldCheck className="h-4 w-4" />Filtering</TabsTrigger>
        <TabsTrigger value="scopes" className="gap-2"><Network className="h-4 w-4" />Internal scopes</TabsTrigger>
        <TabsTrigger value="insights" className="gap-2"><Eye className="h-4 w-4" />Insights</TabsTrigger>
      </TabsList>
      <TabsContent value="filtering">
        <FilteringTab policy={policy} />
      </TabsContent>
      <TabsContent value="scopes">
        <InternalScopesTab policy={policy} />
      </TabsContent>
      <TabsContent value="insights">
        <InsightsTab />
      </TabsContent>
    </Tabs>
  );
}

function FilteringTab({ policy }: { policy: DnsPolicy }) {
  const update = useUpdateDnsPolicy();
  const del = useDeleteDnsPolicy();
  const [confirmDel, setConfirmDel] = useState(false);
  const [name, setName] = useState(policy.name);
  const [provider, setProvider] = useState(policy.upstream_provider ?? "");
  const [customUri, setCustomUri] = useState(policy.upstream_doh_uri ?? "");
  const [blockMalware, setBlockMalware] = useState(policy.block_malware);
  const [blockPhishing, setBlockPhishing] = useState(policy.block_phishing);
  const [blockAdult, setBlockAdult] = useState(policy.block_adult);
  const [blockGambling, setBlockGambling] = useState(policy.block_gambling);
  const [blockSocial, setBlockSocial] = useState(policy.block_social);
  const [disableBrowserDoh, setDisableBrowserDoh] = useState(policy.disable_browser_doh);
  const [allow, setAllow] = useState((policy.custom_allowlist ?? []).join("\n"));
  const [block, setBlock] = useState((policy.custom_blocklist ?? []).join("\n"));

  const save = () => {
    update.mutate({
      id: policy.id,
      name,
      upstream_provider: provider || null,
      upstream_doh_uri: provider === "custom" ? customUri || null : null,
      block_malware: blockMalware,
      block_phishing: blockPhishing,
      block_adult: blockAdult,
      block_gambling: blockGambling,
      block_social: blockSocial,
      disable_browser_doh: disableBrowserDoh,
      custom_allowlist: parseList(allow),
      custom_blocklist: parseList(block),
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>Policy settings</CardTitle>
            <CardDescription>
              Upstream provider, category blocking, custom allow / block lists.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmDel(true)}
            disabled={policy.is_default}
            className="text-destructive hover:text-destructive gap-2"
          >
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="pname">Name</Label>
            <Input id="pname" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="provider">Upstream provider</Label>
            <Select value={provider || "__platform_default__"} onValueChange={(v) => setProvider(v === "__platform_default__" ? "" : v)}>
              <SelectTrigger id="provider">
                <SelectValue placeholder="Platform default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__platform_default__">Platform default</SelectItem>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {provider === "custom" && (
            <div className="md:col-span-2">
              <Label htmlFor="custom-uri">Custom DoH URI</Label>
              <Input
                id="custom-uri"
                placeholder="https://your-resolver.example/dns-query"
                value={customUri}
                onChange={(e) => setCustomUri(e.target.value)}
              />
            </div>
          )}
        </div>

        <div>
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Category blocking</Label>
          <div className="grid md:grid-cols-2 gap-3 mt-2">
            <CategoryRow label="Malware" desc="Known malware C2 / payload hosts" v={blockMalware} setV={setBlockMalware} />
            <CategoryRow label="Phishing" desc="Credential-theft &amp; impersonation sites" v={blockPhishing} setV={setBlockPhishing} />
            <CategoryRow label="Adult content" desc="Adult / NSFW domains" v={blockAdult} setV={setBlockAdult} />
            <CategoryRow label="Gambling" desc="Casino &amp; betting sites" v={blockGambling} setV={setBlockGambling} />
            <CategoryRow label="Social media" desc="Major social networks" v={blockSocial} setV={setBlockSocial} />
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="allow">Custom allowlist <span className="text-muted-foreground text-xs">(one per line)</span></Label>
            <Textarea
              id="allow"
              rows={5}
              placeholder={"partner.example.com\nlegit-corp.example.com"}
              value={allow}
              onChange={(e) => setAllow(e.target.value)}
              className="font-mono text-xs"
            />
          </div>
          <div>
            <Label htmlFor="block">Custom blocklist <span className="text-muted-foreground text-xs">(one per line)</span></Label>
            <Textarea
              id="block"
              rows={5}
              placeholder={"badactor.example\ntiktok.com"}
              value={block}
              onChange={(e) => setBlock(e.target.value)}
              className="font-mono text-xs"
            />
          </div>
        </div>

        <CategoryRow
          label="Disable browser-level DoH"
          desc="Force Chrome / Edge / Firefox through the OS resolver via GPO so they can't bypass our policy."
          v={disableBrowserDoh}
          setV={setDisableBrowserDoh}
        />

        <div className="flex justify-end">
          <Button onClick={save} disabled={update.isPending} className="gap-2">
            {update.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={confirmDel} onOpenChange={setConfirmDel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &quot;{policy.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              Any endpoints assigned to this policy will fall back to the org default on next agent pass.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => del.mutate(policy.id, { onSuccess: () => setConfirmDel(false) })}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function CategoryRow({ label, desc, v, setV }: { label: string; desc: string; v: boolean; setV: (x: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3 p-3 rounded-lg border">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
      <Switch checked={v} onCheckedChange={setV} />
    </div>
  );
}

function InternalScopesTab({ policy }: { policy: DnsPolicy }) {
  const { data: scopes, isLoading } = useDnsInternalScopes(policy.id);
  const upsert = useUpsertInternalScope();
  const del = useDeleteInternalScope();
  const [editing, setEditing] = useState<Partial<DnsInternalScope> | null>(null);
  const [confirmDel, setConfirmDel] = useState<DnsInternalScope | null>(null);

  const save = () => {
    if (!editing?.suffix?.trim()) return;
    const forwarders = (editing.forwarders ?? []).map(String).map((s) => s.trim()).filter(Boolean);
    if (forwarders.length === 0) return;
    upsert.mutate(
      {
        id: editing.id,
        policy_id: policy.id,
        suffix: editing.suffix!.trim().toLowerCase(),
        forwarders,
        description: editing.description ?? null,
        display_order: editing.display_order ?? 100,
      },
      { onSuccess: () => setEditing(null) },
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Internal scopes</CardTitle>
            <CardDescription>
              Suffixes that resolve via the customer's internal DNS forwarders rather than our resolver.
              Everything else routes through Mithras.
            </CardDescription>
          </div>
          <Button onClick={() => setEditing({ display_order: 100, forwarders: [] })} className="gap-2">
            <Plus className="h-4 w-4" /> Add scope
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !scopes?.length ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No internal scopes yet. Add one for each internal suffix (e.g. <code>corp.local</code>) and
            point it at the customer's internal DNS forwarder IPs.
          </div>
        ) : (
          <div className="space-y-2">
            {scopes.map((s) => (
              <div key={s.id} className="flex items-start justify-between gap-3 p-3 border rounded-lg hover:bg-muted/40">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-medium">{s.suffix}</span>
                    {s.description && (
                      <span className="text-xs text-muted-foreground">· {s.description}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {s.forwarders.map((f) => (
                      <Badge key={f} variant="secondary" className="font-mono text-xs">{f}</Badge>
                    ))}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setConfirmDel(s)} className="text-destructive hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit" : "Add"} internal scope</DialogTitle>
            <DialogDescription>
              Suffix matching is hierarchical — <code>corp.local</code> matches <code>foo.corp.local</code>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="suffix">Suffix</Label>
              <Input
                id="suffix"
                placeholder="corp.local"
                value={editing?.suffix ?? ""}
                onChange={(e) => setEditing({ ...editing!, suffix: e.target.value })}
                className="font-mono"
              />
            </div>
            <div>
              <Label htmlFor="fwd">Forwarders <span className="text-muted-foreground text-xs">(one per line, IPs)</span></Label>
              <Textarea
                id="fwd"
                rows={3}
                placeholder={"192.168.1.10\n192.168.1.11"}
                value={(editing?.forwarders ?? []).join("\n")}
                onChange={(e) => setEditing({ ...editing!, forwarders: e.target.value.split(/\s+/).filter(Boolean) })}
                className="font-mono text-xs"
              />
            </div>
            <div>
              <Label htmlFor="desc">Description (optional)</Label>
              <Input
                id="desc"
                placeholder="AD primary + secondary"
                value={editing?.description ?? ""}
                onChange={(e) => setEditing({ ...editing!, description: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={upsert.isPending}>
              {upsert.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this scope?</AlertDialogTitle>
            <AlertDialogDescription>
              Queries for <code>{confirmDel?.suffix}</code> will go through Mithras instead. Internal-only
              hostnames may stop resolving until the scope is re-added.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDel && del.mutate(confirmDel.id, { onSuccess: () => setConfirmDel(null) })}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function InsightsTab() {
  const { data, isLoading } = useDnsInsights();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard icon={<Search className="h-5 w-5" />} label="Queries (24h)" value={(data?.total ?? 0).toLocaleString()} />
        <SummaryCard icon={<ShieldOff className="h-5 w-5" />} label="Blocked" value={(data?.blocked ?? 0).toLocaleString()} accent="red" />
        <SummaryCard icon={<ServerCog className="h-5 w-5" />} label="Forwarded" value={(data?.forwarded ?? 0).toLocaleString()} accent="green" />
        <SummaryCard icon={<Globe className="h-5 w-5" />} label="Unique domains" value={(data?.unique_domains ?? 0).toLocaleString()} />
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldOff className="h-4 w-4 text-destructive" /> Top blocked
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DomainList rows={data?.top_blocked ?? []} loading={isLoading} emptyText="No blocked queries yet." />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" /> Top queried
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DomainList rows={data?.top_queried ?? []} loading={isLoading} emptyText="No queries yet — agent may not have rolled over to the new resolver." />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardContent className="py-4 flex items-start gap-2 text-xs text-muted-foreground">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>
            Insights are populated from the Mithras DNS resolver's own logs. If an endpoint can't reach
            <code className="mx-1 font-mono">dns.mithras.com.au</code>, its queries won't appear here. Internal-suffix
            queries also do not appear by design — those resolve directly via the customer's internal DNS.
          </span>
        </CardContent>
      </Card>
    </div>
  );
}

function DomainList({ rows, loading, emptyText }: { rows: { name: string; count: number }[]; loading: boolean; emptyText: string }) {
  if (loading) return <Skeleton className="h-32 w-full" />;
  if (!rows.length) return <div className="py-8 text-center text-sm text-muted-foreground">{emptyText}</div>;
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.name} className="flex items-center justify-between gap-2 text-sm py-1.5 border-b last:border-b-0 border-border/40">
          <span className="font-mono text-xs truncate">{r.name}</span>
          <span className="text-muted-foreground tabular-nums">{r.count.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

function SummaryCard({
  icon, label, value, accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: "red" | "green";
}) {
  const tone = accent === "red" ? "text-destructive bg-destructive/10" : accent === "green" ? "text-green-600 bg-green-500/10" : "text-primary bg-primary/10";
  return (
    <Card>
      <CardContent className="pt-6 flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
        </div>
        <div className={`p-2 rounded-lg ${tone}`}>{icon}</div>
      </CardContent>
    </Card>
  );
}

function parseList(s: string): string[] {
  return s
    .split(/\s+|,/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

export default DnsFiltering;
