import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  Trash2, Loader2, AlertTriangle, CheckCircle2, Power,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";

/**
 * Decommission control on the endpoint detail page. Wraps the
 * authorize_endpoint_uninstall(endpoint_id, reason) RPC which:
 *   1. Verifies the caller is super-admin or org-admin of the endpoint
 *   2. Stamps endpoints.uninstall_authorized_at / _by / _reason
 *   3. Queues an `uninstall_self` agent command
 *
 * The agent picks up the command on its next heartbeat (~60s), disables
 * tamper protection on itself, registers a SYSTEM scheduled task that
 * fires Force-Remove.ps1 60 seconds later, and reports success before the
 * service is torn down.
 *
 * UI states:
 *   * Already uninstalled   → green "Uninstalled X ago" badge
 *   * Authorized, pending   → amber "Decommissioning… ~Ns ago" badge
 *   * Otherwise             → destructive "Decommission" button + dialog
 */

interface Props {
  endpointId: string;
  hostname: string;
}

interface UninstallState {
  uninstall_authorized_at: string | null;
  uninstall_authorized_by: string | null;
  uninstall_reason: string | null;
  uninstalled_at: string | null;
}

const MIN_REASON_LEN = 10;

export function DecommissionButton({ endpointId, hostname }: Props) {
  const { toast } = useToast();
  const { isSuperAdmin, isOrgAdmin, currentOrganization } = useTenant();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  const { data: state } = useQuery({
    queryKey: ["endpoint-uninstall-state", endpointId],
    queryFn: async (): Promise<UninstallState> => {
      const { data } = await supabase
        .from("endpoints")
        .select("uninstall_authorized_at, uninstall_authorized_by, uninstall_reason, uninstalled_at")
        .eq("id", endpointId)
        .maybeSingle();
      return (data ?? {
        uninstall_authorized_at: null,
        uninstall_authorized_by: null,
        uninstall_reason: null,
        uninstalled_at: null,
      }) as UninstallState;
    },
    refetchInterval: 30_000,
  });

  const decommission = useMutation({
    mutationFn: async (reasonText: string) => {
      const { data, error } = await supabase.rpc("authorize_endpoint_uninstall", {
        p_endpoint_id: endpointId,
        p_reason:      reasonText,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({
        title: `Decommission authorised for ${hostname}`,
        description: "The agent will pick up the cleanup command on its next heartbeat (~60s) and tear itself down.",
      });
      setOpen(false);
      setReason("");
      queryClient.invalidateQueries({ queryKey: ["endpoint-uninstall-state", endpointId] });
      queryClient.invalidateQueries({ queryKey: ["endpoint", endpointId] });
      queryClient.invalidateQueries({ queryKey: ["agent-commands", endpointId] });
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast({ title: "Decommission failed", description: msg, variant: "destructive" });
    },
  });

  // Only org admins / super-admins can decommission. The RPC double-checks
  // so members would get a 42501 error after clicking; we hide it instead.
  if (!isSuperAdmin && !(isOrgAdmin && currentOrganization)) {
    return null;
  }

  if (state?.uninstalled_at) {
    return (
      <Badge variant="outline" className="gap-1 text-emerald-500 border-emerald-500/40 bg-emerald-500/10">
        <CheckCircle2 className="h-3 w-3" />
        Uninstalled {formatDistanceToNow(new Date(state.uninstalled_at), { addSuffix: true })}
      </Badge>
    );
  }

  if (state?.uninstall_authorized_at) {
    const ageMs = Date.now() - new Date(state.uninstall_authorized_at).getTime();
    const stale = ageMs > 30 * 60_000; // older than 30 min — agent probably went offline mid-uninstall
    return (
      <Badge variant="outline" className={`gap-1 ${
        stale
          ? "text-red-500 border-red-500/40 bg-red-500/10"
          : "text-amber-500 border-amber-500/40 bg-amber-500/10"
      }`} title={state.uninstall_reason ?? undefined}>
        {stale ? <AlertTriangle className="h-3 w-3" /> : <Loader2 className="h-3 w-3 animate-spin" />}
        {stale ? "Decommission stuck — agent offline?" : "Decommissioning…"}
        <span className="opacity-70 ml-1">{formatDistanceToNow(new Date(state.uninstall_authorized_at), { addSuffix: true })}</span>
      </Badge>
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setReason(""); }}>
      <Button size="sm" variant="outline" className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => setOpen(true)}>
        <Power className="h-4 w-4" />
        Decommission
      </Button>
      <AlertDialogContent className="max-w-xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-destructive" />
            Decommission {hostname}?
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            <span className="block">
              This queues a tamper-protected <span className="font-mono">uninstall_self</span> command.
              The agent will disable its watchdog, reset its service DACL, and
              schedule <span className="font-mono">Force-Remove.ps1</span> to fire as SYSTEM 60 seconds later.
              The endpoint will stop reporting after that.
            </span>
            <span className="block text-xs inline-flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
              <span>
                The reason below is written to <span className="font-mono">activity_logs</span> and the
                endpoint row for audit. Make it specific — &quot;laptop returned to IT&quot;,
                &quot;replaced by NEWHOST&quot;, &quot;customer offboarded&quot;.
              </span>
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Reason ({MIN_REASON_LEN}+ chars, required)
          </label>
          <Textarea
            placeholder="Laptop returned to IT — replaced by NEW-DEV-04."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            autoFocus
          />
          <div className={`text-[11px] ${reason.length < MIN_REASON_LEN ? "text-muted-foreground" : "text-emerald-500"}`}>
            {reason.length}/{MIN_REASON_LEN}
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={decommission.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); decommission.mutate(reason.trim()); }}
            disabled={decommission.isPending || reason.trim().length < MIN_REASON_LEN}
            className="gap-1.5 bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {decommission.isPending
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Queueing…</>
              : <><Power className="h-4 w-4" /> Decommission</>}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
