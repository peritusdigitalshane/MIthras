import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useReportRecipients,
  useAddReportRecipient,
  useUpdateReportRecipient,
  useDeleteReportRecipient,
  ReportRecipient,
} from "@/hooks/useCustomerReports";
import { Mail, Plus, Trash2, UserPlus, Loader2 } from "lucide-react";

export function ReportRecipientsCard() {
  const { data: recipients, isLoading } = useReportRecipients();
  const add = useAddReportRecipient();
  const update = useUpdateReportRecipient();
  const del = useDeleteReportRecipient();

  const [open, setOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState<ReportRecipient | null>(null);
  const [form, setForm] = useState({
    email: "",
    name: "",
    role_label: "",
    monthly: true,
    weekly: false,
    quarterly: false,
  });

  const resetForm = () =>
    setForm({ email: "", name: "", role_label: "", monthly: true, weekly: false, quarterly: false });

  const submit = () => {
    if (!form.email.trim()) return;
    add.mutate(form, {
      onSuccess: () => {
        resetForm();
        setOpen(false);
      },
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" /> Report recipients
          </CardTitle>
          <CardDescription>
            The customer-facing email addresses that receive the periodic PDF report. These are
            separate from operator users — typically the customer's owner, IT manager, or
            compliance lead.
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
              <DialogTitle>Add report recipient</DialogTitle>
              <DialogDescription>
                They'll receive the PDF report by email when the selected report kinds finish
                generating.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  placeholder="owner@customer.com"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="name">Name (optional)</Label>
                  <Input
                    id="name"
                    placeholder="Jane Smith"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="role">Role (optional)</Label>
                  <Input
                    id="role"
                    placeholder="IT manager"
                    value={form.role_label}
                    onChange={(e) => setForm((f) => ({ ...f, role_label: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Send for
                </Label>
                <div className="flex gap-4 mt-2">
                  {(["monthly", "weekly", "quarterly"] as const).map((k) => (
                    <label key={k} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={form[k]}
                        onCheckedChange={(v) =>
                          setForm((f) => ({ ...f, [k]: Boolean(v) }))
                        }
                      />
                      <span className="capitalize">{k}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => { resetForm(); setOpen(false); }}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={add.isPending || !form.email}>
                {add.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                Add
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : !recipients?.length ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No recipients configured. Reports will still generate, but no one will be emailed.
            Click "Add recipient" to start.
          </div>
        ) : (
          <div className="space-y-2">
            {recipients.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 p-3 border rounded-lg hover:bg-muted/30"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{r.email}</span>
                    {r.name && (
                      <span className="text-sm text-muted-foreground">· {r.name}</span>
                    )}
                    {r.role_label && (
                      <Badge variant="secondary" className="text-xs">
                        {r.role_label}
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-1.5 mt-1.5">
                    {(["monthly", "weekly", "quarterly"] as const).map((k) => (
                      <Badge
                        key={k}
                        variant={r[k] ? "default" : "outline"}
                        className={`text-[10px] cursor-pointer ${r[k] ? "" : "text-muted-foreground"}`}
                        onClick={() => update.mutate({ id: r.id, [k]: !r[k] })}
                      >
                        {k}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setConfirmDel(r)}
                  className="shrink-0 text-destructive hover:text-destructive"
                >
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
              They will no longer receive monthly or weekly reports for this customer. You can
              add them back at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!confirmDel) return;
                del.mutate(confirmDel.id, { onSuccess: () => setConfirmDel(null) });
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
