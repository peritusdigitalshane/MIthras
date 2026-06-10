import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Mail, Copy, RefreshCw, X, Send, Inbox } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { useCreateEnrollmentCode, useDeactivateEnrollmentCode, type PendingEnrolmentInvite } from "@/hooks/useEnrollmentCodes";

interface Props {
  invites: PendingEnrolmentInvite[];
  childLabel: string;       // e.g. "reseller" | "customer"
  childLabelPlural: string; // e.g. "resellers" | "customers"
}

// Shared "Pending invites" card used by /distributor/resellers and /my-customers.
// Surfaces orgs the parent created where the enrolment code hasn't been used yet,
// so the parent can re-fetch the URL, copy it again, regenerate (revoke + reissue),
// or email it.
export function PendingInvitesCard({ invites, childLabel, childLabelPlural }: Props) {
  const createCode = useCreateEnrollmentCode();
  const deactivateCode = useDeactivateEnrollmentCode();

  if (!invites.length) return null;

  const urlFor = (code: string) => `${window.location.origin}/signup?code=${encodeURIComponent(code)}`;
  const copy = async (txt: string, label = "URL") => {
    try { await navigator.clipboard.writeText(txt); toast.success(`${label} copied`); }
    catch { toast.error("Couldn't copy — select manually"); }
  };

  const regen = async (inv: PendingEnrolmentInvite) => {
    try {
      await deactivateCode.mutateAsync({ codeId: inv.code_id });
      await createCode.mutateAsync({
        organizationId: inv.org_id,
        role:           inv.code_role,
        isSingleUse:    inv.code_max_uses === 1,
        maxUses:        inv.code_max_uses,
        expiresAt:      null,
      });
      toast.success(`Fresh code issued — the old URL no longer works`);
    } catch (e: any) {
      toast.error(e.message ?? "Couldn't regenerate code");
    }
  };

  const revoke = async (inv: PendingEnrolmentInvite) => {
    if (!confirm(`Cancel the pending invite for ${inv.org_name}? They won't be able to sign up with the URL anymore.`)) return;
    try {
      await deactivateCode.mutateAsync({ codeId: inv.code_id });
      toast.success("Invite cancelled");
    } catch (e: any) {
      toast.error(e.message ?? "Couldn't cancel");
    }
  };

  return (
    <Card className="border-indigo-500/30 bg-indigo-500/5">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Inbox className="h-4 w-4 text-indigo-500" />
          {invites.length} pending {invites.length === 1 ? childLabel : childLabelPlural} invite{invites.length === 1 ? "" : "s"}
        </CardTitle>
        <CardDescription>
          {childLabelPlural.charAt(0).toUpperCase() + childLabelPlural.slice(1)} you've created who haven't accepted their signup link yet.
          Copy + resend the URL, regenerate it if it leaked, or cancel.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {invites.map(inv => {
          const url = urlFor(inv.code);
          return (
            <div key={inv.code_id} className="border rounded-lg p-3 bg-card">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <div className="font-medium">{inv.org_name}</div>
                  <div className="text-xs text-muted-foreground">
                    Created {formatDistanceToNow(new Date(inv.org_created_at), { addSuffix: true })}
                    {" · "}
                    <Badge variant="outline" className="text-[10px]">{inv.code_role}</Badge>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => regen(inv)} title="Issue a fresh code (revokes this one)">
                    <RefreshCw className="h-3.5 w-3.5 mr-1" /> Regenerate
                  </Button>
                  <Button size="sm" variant="ghost" className="text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950" onClick={() => revoke(inv)} title="Cancel this invite">
                    <X className="h-3.5 w-3.5 mr-1" /> Cancel
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Input value={url} readOnly className="font-mono text-[11px] h-8" onFocus={(e) => e.currentTarget.select()} />
                <Button size="sm" variant="outline" onClick={() => copy(url, "URL")} title="Copy URL">
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="outline" asChild title="Email this URL to your contact">
                  <a href={`mailto:?subject=${encodeURIComponent(`Join ${inv.org_name} on Mithras`)}&body=${encodeURIComponent(`Hi,\n\nUse this link to set up your Mithras account:\n\n${url}\n\nThe link is one-time use. The first person to sign up becomes admin of your organisation.\n\nThanks.`)}`}>
                    <Mail className="h-3.5 w-3.5" />
                  </a>
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
