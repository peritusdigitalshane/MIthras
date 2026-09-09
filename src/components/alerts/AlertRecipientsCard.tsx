import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  useAlertRecipients, useAddAlertRecipient, useUpdateAlertRecipient,
  useDeleteAlertRecipient, AlertRecipient, Severity,
} from "@/hooks/useAlertRecipients";
import { Bell, Trash2, Plus, Loader2, UserPlus } from "lucide-react";

const SEVERITY_OPTIONS: { value: Severity; label: string }[] = [
  { value: "severe", label: "Severe only" },
  { value: "high", label: "High & Severe" },
  { value: "moderate", label: "Moderate & up" },
  { value: "low", label: "Everything (Low+)" },
];

export function AlertRecipientsCard() {
  const { data: recipients, isLoading } = useAlertRecipients();
  const add = useAddAlertRecipient();
  const update = useUpdateAlertRecipient();
  const del = useDeleteAlertRecipient();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ email: string; name: string; role_label: string; min_severity: Severity }>({
    email: "", name: "", role_label: "", min_severity: "high",
  });
  const [confirmDel, setConfirmDel] = useState<AlertRecipient | null>(null);

  const reset = () =>
    setForm({ email: "", name: "", role_label: "", min_severity: "high" });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" /> Alert recipients
          </CardTitle>
          <CardDescription>
            Email addresses that receive a notification when a new alert is raised. Per-recipient
            severity threshold means execs only get the loud ones.
          </CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2">
              <UserPlus className="h-4 w-4" /> Add recipient
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add alert recipient</DialogTitle>
              <DialogDescription>
                They'll receive an email any time an alert at or above this severity fires.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="ar-email">Email</Label>
                <Input id="ar-email" type="email" value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="ar-name">Name (optional)</Label>
                  <Input id="ar-name" value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                  <Label htmlFor="ar-role">Role (optional)</Label>
                  <Input id="ar-role" placeholder="SOC analyst" value={form.role_label}
                    onChange={(e) => setForm((f) => ({ ...f, role_label: e.target.value }))} />
                </div>
              </div>
              <div>
                <Label htmlFor="ar-sev">Minimum severity</Label>
                <Select value={form.min_severity}
                  onValueChange={(v) => setForm((f) => ({ ...f, min_severity: v as Severity }))}>
                  <SelectTrigger id="ar-sev">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEVERITY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => { reset(); setOpen(false); }}>Cancel</Button>
              <Button onClick={() => add.mutate(form, { onSuccess: () => { reset(); setOpen(false); } })}
                disabled={add.isPending || !form.email}>
                {add.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                Add
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">{[1, 2].map((i) => (<Skeleton key={i} className="h-14 w-full" />))}</div>
        ) : !recipients?.length ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No recipients yet. Alerts will still be created but no one will be emailed about them.
          </div>
        ) : (
          <div className="space-y-2">
            {recipients.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 p-3 border rounded-lg hover:bg-muted/30">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{r.email}</span>
                    {r.name && <span className="text-sm text-muted-foreground">· {r.name}</span>}
                    {r.role_label && (
                      <Badge variant="secondary" className="text-xs">{r.role_label}</Badge>
                    )}
                    {!r.enabled && <Badge variant="outline" className="text-xs">Disabled</Badge>}
                  </div>
                  <div className="flex gap-2 mt-1.5 items-center">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Notifies on:
                    </span>
                    <Select value={r.min_severity}
                      onValueChange={(v) => update.mutate({ id: r.id, min_severity: v as Severity })}>
                      <SelectTrigger className="h-7 text-xs w-[180px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SEVERITY_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button variant="ghost" size="icon"
                  onClick={() => setConfirmDel(r)}
                  className="shrink-0 text-destructive hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <AlertDialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {confirmDel?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              They will stop receiving alert notifications. You can add them back at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={del.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={del.isPending}
              onClick={() => confirmDel && del.mutate(confirmDel.id, { onSuccess: () => setConfirmDel(null) })}
            >
              {del.isPending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
