import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { useSites, useSiteEnrolmentTokens, useCreateSiteEnrolmentToken, useDeleteSite, safeSiteUrl, siteDisplayHost } from "@/hooks/useSites";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Globe, Plus, Copy, Trash2, ExternalLink, Download, Loader2, Info, ShieldAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { useTenant } from "@/contexts/TenantContext";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const Sites = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { currentOrganization, isSuperAdmin, isPartnerAdmin } = useTenant();
  const { data: sites, isLoading } = useSites();
  const { data: tokens } = useSiteEnrolmentTokens();
  const createToken = useCreateSiteEnrolmentToken();
  const deleteSite = useDeleteSite();

  const [tokenOpen, setTokenOpen] = useState(false);
  const [maxUses, setMaxUses] = useState(1);
  const [expiresInDays, setExpiresInDays] = useState(14);
  const [note, setNote] = useState("");
  const [mintedToken, setMintedToken] = useState<string | null>(null);
  // MAJOR fix: replace browser window.confirm() with a styled AlertDialog —
  // confirm() looks like a phishing prompt and gets dismissed reflexively.
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const handleCreateToken = async () => {
    if (!currentOrganization?.id) {
      toast({ title: "No organisation selected", description: "Pick an organisation from the tenant switcher first.", variant: "destructive" });
      return;
    }
    try {
      const t = await createToken.mutateAsync({ maxUses, expiresInDays, note: note.trim() || undefined });
      setMintedToken(t.token);
      toast({ title: "Enrolment token created", description: "Copy it now — it won't be shown in full again." });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown";
      const rlsHint = /row-level security|permission denied|policy/i.test(msg)
        ? ` (your account isn't an admin/owner of "${currentOrganization.name}" — sign in as a super-admin or have an admin grant you access)`
        : "";
      toast({ title: "Failed to mint token", description: msg + rlsHint, variant: "destructive" });
    }
  };

  const handleCopy = (s: string) => {
    navigator.clipboard.writeText(s).then(() => toast({ title: "Copied to clipboard" }));
  };

  const handleDelete = (siteId: string, name: string) => {
    setDeleteTarget({ id: siteId, name });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteSite.mutateAsync(deleteTarget.id);
      toast({ title: "Site removed" });
    } catch (e) {
      toast({ title: "Failed to delete", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
    } finally {
      setDeleteTarget(null);
    }
  };

  const activeTokens = (tokens ?? []).filter(t => new Date(t.expires_at).getTime() > Date.now() && t.use_count < t.max_uses);
  const canMint = !!currentOrganization?.id && (isSuperAdmin || isPartnerAdmin);

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <Globe className="h-6 w-6 text-primary" /> Monitored sites
            </h1>
            <p className="text-sm text-muted-foreground">WordPress sites streaming SIEM events to Mithras. Add the plugin, enrol with a token, and you're live.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => window.open("https://api.mithras.com.au/agent/mithras-soc.zip", "_blank")}>
              <Download className="h-4 w-4 mr-2" /> Download plugin
            </Button>
            <Dialog open={tokenOpen} onOpenChange={(o) => { setTokenOpen(o); if (!o) { setMintedToken(null); setNote(""); } }}>
              <DialogTrigger asChild>
                <Button disabled={!canMint} title={!canMint ? "You need to be a super-admin or partner-admin to mint tokens" : ""}>
                  <Plus className="h-4 w-4 mr-2" /> New enrolment token
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Mint enrolment token</DialogTitle>
                  <DialogDescription>One-time code the WP plugin uses to enrol. Tokens expire and can be limited to N uses.</DialogDescription>
                </DialogHeader>

                {!mintedToken ? (
                  <div className="space-y-4 py-2">
                    <div className="grid gap-2">
                      <Label htmlFor="max-uses">Max sites</Label>
                      <Input id="max-uses" type="number" min={1} max={50} value={maxUses} onChange={(e) => setMaxUses(parseInt(e.target.value || "1"))} />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="expires">Expires in (days)</Label>
                      <Input id="expires" type="number" min={1} max={90} value={expiresInDays} onChange={(e) => setExpiresInDays(parseInt(e.target.value || "14"))} />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="note">Note (optional)</Label>
                      <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. ABC Co rollout" />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 py-2">
                    <div className="text-sm">Hand this to whoever installs the plugin. It will not be shown in full again.</div>
                    <div className="flex items-center gap-2 p-3 rounded-md bg-muted font-mono text-xs break-all">
                      <span className="flex-1">{mintedToken}</span>
                      <Button size="sm" variant="ghost" onClick={() => handleCopy(mintedToken)}><Copy className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                )}

                <DialogFooter>
                  {!mintedToken ? (
                    <>
                      <Button variant="outline" onClick={() => setTokenOpen(false)}>Cancel</Button>
                      <Button onClick={handleCreateToken} disabled={createToken.isPending}>
                        {createToken.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Generate token
                      </Button>
                    </>
                  ) : (
                    <Button onClick={() => setTokenOpen(false)}>Done</Button>
                  )}
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>You're working in: <strong>{currentOrganization?.name ?? "(no org selected)"}</strong></AlertTitle>
          <AlertDescription className="text-xs space-y-1 mt-1">
            <div>Permissions: {isSuperAdmin ? "super-admin" : isPartnerAdmin ? "partner-admin" : "org member"}. Tokens you mint here belong to this organisation.</div>
            <div>To onboard a WordPress site: <strong>(1)</strong> Click "New enrolment token" → copy the token. <strong>(2)</strong> Install the Mithras WP plugin (Download button) on the customer site. <strong>(3)</strong> In WP admin, the plugin shows a "Mithras SOC is installed but not yet connected" banner — click "Open settings" or go to <em>Settings → Mithras SOC</em>. <strong>(4)</strong> Paste the token and click Connect.</div>
          </AlertDescription>
        </Alert>

        {!canMint && (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>You can't mint enrolment tokens here</AlertTitle>
            <AlertDescription className="text-xs">
              Token minting requires super-admin or partner-admin role. Your current role on <strong>{currentOrganization?.name}</strong> is "org member". Ask a super-admin to either mint a token for this org and share it with you, or grant you admin/owner on the org.
            </AlertDescription>
          </Alert>
        )}

        {activeTokens.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Active enrolment tokens ({activeTokens.length})</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-1">
              {activeTokens.map(t => (
                <div key={t.token} className="flex items-center gap-3 py-1">
                  <code className="text-xs">{t.token}</code>
                  <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => handleCopy(t.token)}><Copy className="h-3 w-3" /></Button>
                  <span>· {t.use_count}/{t.max_uses} used</span>
                  <span>· expires {formatDistanceToNow(new Date(t.expires_at), { addSuffix: true })}</span>
                  {t.note && <span>· {t.note}</span>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sites ({sites?.length ?? 0})</CardTitle>
            <CardDescription>Click a site to see its SIEM event stream.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : (sites?.length ?? 0) === 0 ? (
              <div className="text-center py-12 text-muted-foreground space-y-3">
                <Globe className="h-10 w-10 mx-auto opacity-50" />
                <p>No sites enrolled yet.</p>
                <p className="text-xs max-w-md mx-auto">
                  Install the <code>mithras-soc</code> plugin on the WordPress site, generate an enrolment token above, paste it into the plugin's Settings → Mithras SOC page.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Site</TableHead>
                    <TableHead>WP / PHP</TableHead>
                    <TableHead>Plugins</TableHead>
                    <TableHead>Last seen</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sites?.map((s) => {
                    const online = s.last_seen_at ? (Date.now() - new Date(s.last_seen_at).getTime()) < 15 * 60 * 1000 : false;
                    return (
                      <TableRow key={s.id} className="cursor-pointer" onClick={() => navigate(`/sites/${s.id}`)}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Globe className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <div className="font-medium">{s.name ?? siteDisplayHost(s.site_url)}</div>
                              <div className="text-xs text-muted-foreground">{s.site_url}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {s.wp_version ?? "?"} / PHP {s.php_version ?? "?"}
                        </TableCell>
                        <TableCell><Badge variant="secondary">{s.plugin_count ?? 0}</Badge></TableCell>
                        <TableCell>
                          {s.last_seen_at ? (
                            <span className={`text-xs ${online ? "text-status-healthy" : "text-muted-foreground"}`}>
                              {formatDistanceToNow(new Date(s.last_seen_at), { addSuffix: true })}
                            </span>
                          ) : <span className="text-xs text-muted-foreground">never</span>}
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          {(() => {
                            const safe = safeSiteUrl(s.site_url);
                            return (
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title={safe ? "Open site URL" : "Invalid URL"} onClick={() => safe && window.open(safe, "_blank", "noopener,noreferrer")} disabled={!safe}>
                                <ExternalLink className="h-3.5 w-3.5" />
                              </Button>
                            );
                          })()}
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" title="Delete" onClick={() => handleDelete(s.id, s.name ?? s.site_url)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this site?</AlertDialogTitle>
              <AlertDialogDescription>
                {deleteTarget && (
                  <>
                    This removes <span className="font-medium text-foreground">{deleteTarget.name}</span> and every event recorded against it. Endpoints stop reporting site activity until you re-enrol. This cannot be undone.
                  </>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDelete}
                disabled={deleteSite.isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleteSite.isPending ? "Deleting…" : "Delete site"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </MainLayout>
  );
};

export default Sites;
