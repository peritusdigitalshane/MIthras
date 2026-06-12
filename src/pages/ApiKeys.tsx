import { useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  KeyRound, Plus, Copy, AlertCircle, CheckCircle2, Loader2, BookOpen,
  ShieldAlert, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { useTenant } from "@/contexts/TenantContext";
import {
  useApiKeys, useCreateApiKey, useRevokeApiKey, AVAILABLE_SCOPES, type CreatedApiKey,
} from "@/hooks/useApiKeys";

const EXPIRY_OPTIONS = [
  { label: "Never",    value: "" },
  { label: "30 days",  value: "30" },
  { label: "90 days",  value: "90" },
  { label: "365 days", value: "365" },
];

export default function ApiKeys() {
  const { currentOrganization, isLoading: tenantLoading } = useTenant();
  const orgId = currentOrganization?.id ?? null;

  const { data: keys, isLoading, error } = useApiKeys(orgId);
  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newScopes, setNewScopes] = useState<string[]>(["endpoints:read"]);
  const [newExpiry, setNewExpiry] = useState("");
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null);

  const active = useMemo(() => (keys ?? []).filter((k) => !k.revoked_at), [keys]);
  const revoked = useMemo(() => (keys ?? []).filter((k) => k.revoked_at), [keys]);

  function resetForm() {
    setNewName("");
    setNewScopes(["endpoints:read"]);
    setNewExpiry("");
  }

  async function copyToken() {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey.rawToken);
      toast.success("Token copied to clipboard");
    } catch {
      toast.error("Could not copy — select and copy the token manually");
    }
  }

  function handleCreate() {
    if (!orgId) return;
    const name = newName.trim();
    if (name.length < 3) {
      toast.error("Name must be at least 3 characters");
      return;
    }
    if (newScopes.length === 0) {
      toast.error("Choose at least one scope");
      return;
    }
    createKey.mutate(
      {
        organization_id: orgId,
        name,
        scopes: newScopes,
        expires_in_days: newExpiry ? parseInt(newExpiry, 10) : null,
      },
      {
        onSuccess: (result) => {
          setCreateOpen(false);
          setCreatedKey(result);
          resetForm();
        },
        onError: (e: any) => toast.error(`Could not create key: ${e?.message ?? "unknown"}`),
      },
    );
  }

  if (tenantLoading) {
    return <MainLayout><div className="p-6"><Skeleton className="h-32 w-full" /></div></MainLayout>;
  }
  if (!orgId) {
    return (
      <MainLayout>
        <div className="p-6 max-w-2xl mx-auto">
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>No organisation selected</AlertTitle>
            <AlertDescription>Select an organisation before managing API keys.</AlertDescription>
          </Alert>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <KeyRound className="h-6 w-6 text-primary" />
              API keys
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Bearer tokens that authorise programmatic access to the Mithras REST API. Treat them as credentials — they grant the scopes you select for the lifetime of the key.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link to="/api-docs"><BookOpen className="h-4 w-4 mr-1" />API documentation</Link>
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />Create API key
            </Button>
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Could not load API keys</AlertTitle>
            <AlertDescription>{(error as Error).message}</AlertDescription>
          </Alert>
        )}

        {/* Active keys */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Active keys</CardTitle>
            <CardDescription>
              Tokens currently authorised to call the API. Revoke immediately if a token is compromised.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
            ) : active.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-6">
                No active API keys. Create one to get started.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Prefix</TableHead>
                    <TableHead>Scopes</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Last used</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {active.map((k) => (
                    <TableRow key={k.id}>
                      <TableCell className="font-medium">{k.name}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{k.key_prefix}…</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {k.scopes.map((s) => (
                            <Badge key={s} variant="outline" className="text-[10px] font-mono">{s}</Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(k.created_at), { addSuffix: true })}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {k.last_used_at
                          ? formatDistanceToNow(new Date(k.last_used_at), { addSuffix: true })
                          : <span className="italic">never</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {k.expires_at
                          ? formatDistanceToNow(new Date(k.expires_at), { addSuffix: true })
                          : <span className="italic">no expiry</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost" size="sm"
                          onClick={() => {
                            if (confirm(`Revoke key "${k.name}"? Any active integration will stop working immediately.`)) {
                              revokeKey.mutate(k.id, {
                                onSuccess: () => toast.success("Key revoked"),
                                onError: (e: any) => toast.error(e?.message ?? "Revoke failed"),
                              });
                            }
                          }}
                          disabled={revokeKey.isPending}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {revoked.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base text-muted-foreground">Revoked</CardTitle>
              <CardDescription>Keys that can no longer authenticate. Retained for audit.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Prefix</TableHead>
                    <TableHead>Revoked</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {revoked.slice(0, 20).map((k) => (
                    <TableRow key={k.id} className="opacity-60">
                      <TableCell>{k.name}</TableCell>
                      <TableCell className="font-mono text-xs">{k.key_prefix}…</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {k.revoked_at && formatDistanceToNow(new Date(k.revoked_at), { addSuffix: true })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) { resetForm(); setCreateOpen(false); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />Create API key
            </DialogTitle>
            <DialogDescription>
              The raw token is shown once after creation. Store it in your secret manager — it cannot be retrieved later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="key-name">Name</Label>
              <Input
                id="key-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. CI deploy token, onboarding-bot"
                maxLength={80}
              />
            </div>
            <div>
              <Label>Scopes</Label>
              <div className="space-y-2 mt-1 max-h-56 overflow-y-auto pr-1 border border-border/40 rounded-md p-3">
                {AVAILABLE_SCOPES.map((s) => (
                  <label key={s.value} className="flex items-start gap-2 cursor-pointer">
                    <Checkbox
                      checked={newScopes.includes(s.value)}
                      onCheckedChange={(checked) =>
                        setNewScopes((prev) => checked ? [...prev, s.value] : prev.filter((x) => x !== s.value))
                      }
                    />
                    <div className="flex-1">
                      <div className="font-mono text-xs">{s.label}</div>
                      <div className="text-xs text-muted-foreground">{s.description}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label>Expiry</Label>
              <Select value={newExpiry} onValueChange={setNewExpiry}>
                <SelectTrigger><SelectValue placeholder="Select expiry" /></SelectTrigger>
                <SelectContent>
                  {EXPIRY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createKey.isPending}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createKey.isPending}>
              {createKey.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Create key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Once-only token display */}
      <Dialog open={!!createdKey} onOpenChange={(o) => { if (!o) setCreatedKey(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />API key created
            </DialogTitle>
            <DialogDescription>
              This is the only time the raw token will be displayed. Copy it now and store it in your secret manager.
            </DialogDescription>
          </DialogHeader>
          {createdKey && (
            <div className="space-y-4">
              <Alert className="border-amber-500/40 bg-amber-500/5">
                <AlertCircle className="h-4 w-4 text-amber-500" />
                <AlertTitle>Save this token now</AlertTitle>
                <AlertDescription className="text-xs">
                  Mithras stores only the hash of the token. There is no way to recover the raw value after you close this dialog.
                </AlertDescription>
              </Alert>
              <div>
                <Label>Token</Label>
                <div className="flex items-center gap-2 mt-1">
                  <code className="flex-1 font-mono text-xs bg-muted/40 border border-border/40 rounded p-3 break-all">
                    {createdKey.rawToken}
                  </code>
                  <Button onClick={copyToken}><Copy className="h-4 w-4 mr-1" />Copy</Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <Label className="text-muted-foreground">Name</Label>
                  <div className="font-medium">{createdKey.row.name}</div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Scopes</Label>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {createdKey.row.scopes.map((s) => (
                      <Badge key={s} variant="outline" className="text-[10px] font-mono">{s}</Badge>
                    ))}
                  </div>
                </div>
              </div>
              <div className="rounded-md border border-border/40 p-3 text-xs space-y-2">
                <div className="font-semibold uppercase tracking-wider text-muted-foreground">Quick start</div>
                <code className="block font-mono break-all">
                  curl -H "Authorization: Bearer {createdKey.rawToken.slice(0, 20)}…" \\
                  <br />
                  &nbsp;&nbsp;https://api.mithras.com.au/functions/v1/api-v1/me
                </code>
                <p className="text-muted-foreground">
                  Full reference at <Link to="/api-docs" className="text-primary hover:underline">/api-docs</Link>.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setCreatedKey(null)}>I&apos;ve saved the token</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
