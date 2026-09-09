import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PortalHero } from "@/components/portal/PortalHero";
import { PortalEmptyState } from "@/components/portal/PortalEmptyState";
import {
  useUpdateRings, useSeedDefaultRings, useUpsertUpdateRing, useDeleteUpdateRing,
  type UpdateRing, type UpdateRingInput,
} from "@/hooks/useUpdateRings";
import { Layers, Plus, Pencil, Trash2, Zap, Shield, Clock } from "lucide-react";

const EMPTY_RING: UpdateRingInput = {
  name: "",
  description: "",
  quality_update_defer_days: 7,
  feature_update_defer_days: 30,
  install_window_start_local: 2,
  install_window_end_local: 5,
  critical_only: false,
  max_concurrent_installs: 25,
  is_default: false,
};

function fmtHour(h: number) {
  return String(h).padStart(2, "0") + ":00";
}

export default function UpdateRings() {
  const { data: rings, isLoading } = useUpdateRings();
  const seed   = useSeedDefaultRings();
  const upsert = useUpsertUpdateRing();
  const del    = useDeleteUpdateRing();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorId, setEditorId] = useState<string | null>(null);
  const [draft, setDraft] = useState<UpdateRingInput>(EMPTY_RING);
  const [deleteTarget, setDeleteTarget] = useState<UpdateRing | null>(null);

  const openCreate = () => {
    setEditorId(null);
    setDraft(EMPTY_RING);
    setEditorOpen(true);
  };

  const openEdit = (r: UpdateRing) => {
    setEditorId(r.id);
    setDraft({
      name: r.name,
      description: r.description ?? "",
      quality_update_defer_days: r.quality_update_defer_days,
      feature_update_defer_days: r.feature_update_defer_days,
      install_window_start_local: r.install_window_start_local,
      install_window_end_local: r.install_window_end_local,
      critical_only: r.critical_only,
      max_concurrent_installs: r.max_concurrent_installs,
      is_default: r.is_default,
    });
    setEditorOpen(true);
  };

  const save = async () => {
    if (!draft.name.trim()) return;
    try {
      await upsert.mutateAsync({ id: editorId ?? undefined, values: { ...draft, name: draft.name.trim() } });
      setEditorOpen(false);
    } catch { /* toasted */ }
  };

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-6xl mx-auto">
        <PortalHero
          eyebrow="Patch management"
          eyebrowIcon={<Layers className="h-3.5 w-3.5" />}
          title="Update rings"
          subtitle="Group your fleet into tiers that get patches at different speeds. Pilot first, Production later, Critical-only for the machines that must never get the monthly cumulative."
          accent="indigo"
          actions={
            <div className="flex gap-2">
              {(rings ?? []).length === 0 && (
                <Button variant="outline" onClick={() => seed.mutate()} disabled={seed.isPending}>
                  {seed.isPending ? "Seeding…" : "Seed default rings"}
                </Button>
              )}
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4 mr-1" /> New ring
              </Button>
            </div>
          }
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" /> Rings
            </CardTitle>
            <CardDescription>
              Each ring sets defer-days for quality (monthly) and feature updates, an install window in endpoint-local time, and a concurrency cap. Link a ring to one or more endpoint groups to roll it out.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
            ) : (rings ?? []).length === 0 ? (
              <PortalEmptyState
                icon={<Layers className="h-6 w-6 text-muted-foreground" />}
                title="No rings yet"
                description={
                  <p className="text-sm text-muted-foreground">
                    Start with the standard three — Pilot, Production, and Critical-only — and tune them later. Or define your own from scratch.
                  </p>
                }
                primaryAction={{ label: "Seed the standard 3 rings", onClick: () => seed.mutate() }}
                secondaryAction={{ label: "Build my own first", onClick: openCreate }}
              />
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {(rings ?? []).map(r => (
                  <Card key={r.id} className={r.is_default ? "border-primary/40" : undefined}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        {r.critical_only ? <Shield className="h-3.5 w-3.5 text-amber-500" /> : <Zap className="h-3.5 w-3.5 text-primary" />}
                        {r.name}
                        {r.is_default && <Badge variant="secondary" className="text-[10px]">Default</Badge>}
                        {r.critical_only && <Badge variant="outline" className="text-[10px]">Critical-only</Badge>}
                      </CardTitle>
                      {r.description && <CardDescription className="text-xs">{r.description}</CardDescription>}
                    </CardHeader>
                    <CardContent className="pt-0 space-y-2">
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <div className="text-muted-foreground">Quality defer</div>
                          <div className="font-mono">{r.quality_update_defer_days} day{r.quality_update_defer_days === 1 ? "" : "s"}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Feature defer</div>
                          <div className="font-mono">{r.feature_update_defer_days} day{r.feature_update_defer_days === 1 ? "" : "s"}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Window</div>
                          <div className="font-mono">{fmtHour(r.install_window_start_local)} – {fmtHour(r.install_window_end_local)}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Max concurrent</div>
                          <div className="font-mono">{r.max_concurrent_installs}</div>
                        </div>
                      </div>
                      <div className="flex gap-2 pt-2">
                        <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
                          <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                        </Button>
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(r)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ──────── Editor dialog ──────── */}
        <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editorId ? "Edit ring" : "New ring"}</DialogTitle>
              <DialogDescription>
                Defer-days delay Microsoft's release; the install window is when WUfB is allowed to actually install. Both are enforced via Windows Update for Business policies the agent pushes.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Name</Label>
                <Input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Front-of-house POS" />
              </div>
              <div>
                <Label className="text-xs">Description</Label>
                <Textarea value={draft.description ?? ""} rows={2}
                  onChange={e => setDraft({ ...draft, description: e.target.value })}
                  placeholder="When you'd assign machines to this ring" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Quality defer (days, 0–30)</Label>
                  <Input type="number" min={0} max={30} value={draft.quality_update_defer_days}
                    onChange={e => setDraft({ ...draft, quality_update_defer_days: Math.max(0, Math.min(30, parseInt(e.target.value || "0", 10))) })} />
                </div>
                <div>
                  <Label className="text-xs">Feature defer (days, 0–365)</Label>
                  <Input type="number" min={0} max={365} value={draft.feature_update_defer_days}
                    onChange={e => setDraft({ ...draft, feature_update_defer_days: Math.max(0, Math.min(365, parseInt(e.target.value || "0", 10))) })} />
                </div>
                <div>
                  <Label className="text-xs">Install window start (local hour 0–23)</Label>
                  <Input type="number" min={0} max={23} value={draft.install_window_start_local}
                    onChange={e => setDraft({ ...draft, install_window_start_local: Math.max(0, Math.min(23, parseInt(e.target.value || "0", 10))) })} />
                </div>
                <div>
                  <Label className="text-xs">Install window end (local hour 0–23)</Label>
                  <Input type="number" min={0} max={23} value={draft.install_window_end_local}
                    onChange={e => setDraft({ ...draft, install_window_end_local: Math.max(0, Math.min(23, parseInt(e.target.value || "0", 10))) })} />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Max concurrent installs (1–1000)</Label>
                  <Input type="number" min={1} max={1000} value={draft.max_concurrent_installs}
                    onChange={e => setDraft({ ...draft, max_concurrent_installs: Math.max(1, Math.min(1000, parseInt(e.target.value || "1", 10))) })} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm pt-1">
                <Checkbox checked={draft.critical_only} onCheckedChange={(v) => setDraft({ ...draft, critical_only: !!v })} />
                Critical-only — skip the monthly cumulative; only push Microsoft-flagged critical fixes
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={!!draft.is_default} onCheckedChange={(v) => setDraft({ ...draft, is_default: !!v })} />
                Make this the default ring for this organisation
              </label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditorOpen(false)}>Cancel</Button>
              <Button onClick={save} disabled={!draft.name.trim() || upsert.isPending}>
                {upsert.isPending ? "Saving…" : (editorId ? "Save changes" : "Create ring")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ──────── Delete confirmation ──────── */}
        <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this ring?</AlertDialogTitle>
              <AlertDialogDescription>
                Removes <span className="font-medium text-foreground">{deleteTarget?.name}</span>. Endpoint groups currently using this ring will fall back to the organisation's default until you assign them to a new ring.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  if (deleteTarget) await del.mutateAsync(deleteTarget.id);
                  setDeleteTarget(null);
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete ring
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </MainLayout>
  );
}
