import { useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PortalHero } from "@/components/portal/PortalHero";
import { PortalEmptyState } from "@/components/portal/PortalEmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, FileText, Trash2, ChevronRight, Building2, Sparkles, ShieldCheck } from "lucide-react";
import {
  usePartnerTemplates, useCreateTemplateFromGroup, useApplyTemplateToCustomers, useDeletePartnerTemplate,
  type PartnerPolicyTemplate,
} from "@/hooks/usePartnerTemplates";
import { useResellerCustomers } from "@/hooks/useReseller";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

// Pulls every endpoint_group the partner can see across their customers, so
// the "Save current policy as a template" picker has something to choose
// from. RLS already scopes this to the partner's customers.
function usePartnerGroups(customerIds: string[]) {
  return useQuery({
    queryKey: ["partner-groups", customerIds.sort().join(",")],
    enabled: customerIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("endpoint_groups")
        .select("id, name, organization_id, defender_policy_id, windows_update_policy_id")
        .in("organization_id", customerIds)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export default function PartnerTemplates() {
  const { data: templates, isLoading } = usePartnerTemplates();
  const { data: customers } = useResellerCustomers();
  const customerIds = useMemo(() => (customers ?? []).map(c => c.id), [customers]);
  const { data: groups } = usePartnerGroups(customerIds);
  const create = useCreateTemplateFromGroup();
  const apply  = useApplyTemplateToCustomers();
  const del    = useDeletePartnerTemplate();

  const [createOpen, setCreateOpen] = useState(false);
  const [groupId, setGroupId] = useState<string>("");
  const [templateName, setTemplateName] = useState("");
  const [templateDesc, setTemplateDesc] = useState("");

  const [applyTarget, setApplyTarget] = useState<PartnerPolicyTemplate | null>(null);
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  const [makeDefault, setMakeDefault] = useState(true);

  const [deleteTarget, setDeleteTarget] = useState<PartnerPolicyTemplate | null>(null);

  const customerNameById = useMemo(() => {
    const m: Record<string, string> = {};
    (customers ?? []).forEach(c => { m[c.id] = c.name; });
    return m;
  }, [customers]);

  const handleCreate = async () => {
    if (!groupId || !templateName.trim()) return;
    try {
      await create.mutateAsync({ groupId, name: templateName.trim(), description: templateDesc.trim() || undefined });
      setCreateOpen(false);
      setGroupId(""); setTemplateName(""); setTemplateDesc("");
    } catch { /* toasted in hook */ }
  };

  const handleApply = async () => {
    if (!applyTarget || selectedCustomerIds.length === 0) return;
    try {
      await apply.mutateAsync({
        templateId: applyTarget.id,
        customerOrgIds: selectedCustomerIds,
        makeDefault,
      });
      setApplyTarget(null);
      setSelectedCustomerIds([]);
    } catch { /* toasted */ }
  };

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-6xl mx-auto">
        <PortalHero
          eyebrow="Partner portal"
          eyebrowIcon={<Sparkles className="h-3.5 w-3.5" />}
          title="Policy templates"
          subtitle="Build a hardened baseline once, then apply it across your customer fleet in a single click. Templates snapshot Defender, Windows Update, and your patch ring of choice."
          accent="emerald"
          actions={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> New template
            </Button>
          }
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" /> Your templates
            </CardTitle>
            <CardDescription>
              Each template stores a Defender posture plus a Windows Update profile. Apply it to one customer or fan it out to many.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-12" /><Skeleton className="h-12" />
              </div>
            ) : (templates ?? []).length === 0 ? (
              <PortalEmptyState
                icon={<FileText className="h-6 w-6 text-muted-foreground" />}
                title="No templates yet"
                description={
                  <p className="text-sm text-muted-foreground">
                    Start by picking one of your customers' existing endpoint groups whose policies you'd like to standardise on, then promote it to a partner-wide template.
                  </p>
                }
                primaryAction={{ label: "Create your first template", onClick: () => setCreateOpen(true) }}
              />
            ) : (
              <div className="divide-y -mx-2">
                {(templates ?? []).map(t => (
                  <div key={t.id} className="flex items-center justify-between gap-4 px-2 py-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate flex items-center gap-2">
                        {t.name}
                        {t.defender_policy && <Badge variant="secondary" className="text-[10px]">Defender</Badge>}
                        {t.windows_update_policy && <Badge variant="secondary" className="text-[10px]">Updates</Badge>}
                        {t.update_ring && <Badge variant="secondary" className="text-[10px]">Ring</Badge>}
                      </div>
                      {t.description && (
                        <div className="text-xs text-muted-foreground truncate mt-0.5">{t.description}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button size="sm" variant="outline" onClick={() => { setApplyTarget(t); setMakeDefault(true); setSelectedCustomerIds([]); }}>
                        Apply to customers <ChevronRight className="h-3.5 w-3.5 ml-1" />
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(t)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ──────── Create template dialog ──────── */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create a policy template</DialogTitle>
              <DialogDescription>
                Pick an existing customer endpoint group. Its Defender + Windows Update policies will be snapshotted into a portable template you can re-apply anywhere.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Source endpoint group</Label>
                <Select value={groupId} onValueChange={setGroupId}>
                  <SelectTrigger><SelectValue placeholder="Choose a group…" /></SelectTrigger>
                  <SelectContent>
                    {(groups ?? []).map((g: any) => (
                      <SelectItem key={g.id} value={g.id}>
                        {customerNameById[g.organization_id] ?? "—"}: {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Template name</Label>
                <Input value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="e.g. Tight retail baseline" />
              </div>
              <div>
                <Label className="text-xs">Description (optional)</Label>
                <Textarea value={templateDesc} onChange={e => setTemplateDesc(e.target.value)}
                  rows={2} placeholder="Where you'd typically use this template…" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={!groupId || !templateName.trim() || create.isPending}>
                {create.isPending ? "Saving…" : "Save template"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ──────── Apply template dialog ──────── */}
        <Dialog open={!!applyTarget} onOpenChange={(o) => !o && setApplyTarget(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Apply "{applyTarget?.name}"</DialogTitle>
              <DialogDescription>
                Pick which of your customers should receive this template. New policy rows are created in each customer's tenant; the originals are left untouched.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 max-h-96 overflow-y-auto border rounded-md p-2">
              {(customers ?? []).map(c => (
                <label key={c.id} className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer">
                  <Checkbox
                    checked={selectedCustomerIds.includes(c.id)}
                    onCheckedChange={(v) => {
                      setSelectedCustomerIds(prev =>
                        v ? [...prev, c.id] : prev.filter(x => x !== c.id)
                      );
                    }}
                  />
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{c.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {c.active_endpoint_count} endpoint{c.active_endpoint_count === 1 ? "" : "s"}
                    </div>
                  </div>
                </label>
              ))}
              {(customers ?? []).length === 0 && (
                <div className="text-sm text-muted-foreground text-center py-6">You have no customers yet.</div>
              )}
            </div>
            <div className="flex items-center justify-between pt-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={makeDefault} onCheckedChange={(v) => setMakeDefault(!!v)} />
                Promote the new policies to the customer's defaults
              </label>
              <Button variant="outline" size="sm" onClick={() => setSelectedCustomerIds(customerIds)}>
                Select all
              </Button>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setApplyTarget(null)}>Cancel</Button>
              <Button onClick={handleApply} disabled={selectedCustomerIds.length === 0 || apply.isPending}>
                {apply.isPending
                  ? "Applying…"
                  : `Apply to ${selectedCustomerIds.length || 0} customer${selectedCustomerIds.length === 1 ? "" : "s"}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ──────── Delete confirmation ──────── */}
        <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this template?</AlertDialogTitle>
              <AlertDialogDescription>
                Removes <span className="font-medium text-foreground">{deleteTarget?.name}</span>. Policies you've already applied to customers stay in place — only the master template goes away.
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
                Delete template
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="text-xs text-muted-foreground flex items-center gap-1.5 pt-2">
          <ShieldCheck className="h-3.5 w-3.5" />
          Templates are scoped to your partner organisation. Other partners cannot see or apply them.
        </div>
      </div>
    </MainLayout>
  );
}
