import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUpCircle, BadgeCheck, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";

/**
 * Push the latest stable PowerShell agent version to every endpoint in scope
 * that's currently behind. Wraps the bulk_queue_agent_upgrade() RPC.
 *
 * Permission scope follows the same rule as the RPC: super-admin pushes
 * across all orgs (or the selected org if useTenant has one scoped), org
 * admins push only within their own org. Anyone else: button is hidden.
 *
 * Confirmation dialog shows the count of out-of-date endpoints + a
 * preview of the first 10 hostnames so the operator knows what's about to
 * be upgraded before they commit.
 */
export function BulkUpgradeButton() {
  const { toast } = useToast();
  const { currentOrganization, isSuperAdmin } = useTenant();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const scopedOrgId = currentOrganization?.id ?? null;
  const orgFilter = isSuperAdmin && !scopedOrgId ? null : scopedOrgId;

  // Latest stable PS agent — same query as the single-endpoint button.
  const { data: latest } = useQuery({
    queryKey: ["agent-version-latest"],
    queryFn: async () => {
      const { data } = await supabase
        .from("agent_versions")
        .select("version, download_url, sha256")
        .eq("runtime", "powershell")
        .eq("channel", "stable")
        .eq("is_active", true)
        .order("published_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Endpoints in scope that are behind the latest version.
  const { data: outdated, isLoading } = useQuery({
    queryKey: ["bulk-upgrade-eligible", orgFilter, latest?.version],
    queryFn: async () => {
      if (!latest?.version) return [];
      let q = supabase
        .from("endpoints")
        .select("id, hostname, agent_version, organization_id, runtime")
        .neq("agent_version", latest.version)
        .not("agent_version", "is", null)
        // Match the RPC's filter — never offer to push a Windows agent ZIP
        // to a Linux box. NULL runtime is treated as PowerShell (legacy).
        .or("runtime.is.null,runtime.eq.powershell")
        .order("hostname");
      if (orgFilter) q = q.eq("organization_id", orgFilter);
      const { data } = await q;
      return data ?? [];
    },
    enabled: !!latest?.version,
    staleTime: 30 * 1000,
  });

  const enqueue = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("bulk_queue_agent_upgrade", {
        p_org_id: orgFilter,
      });
      if (error) throw error;
      return data as { queued: number; already_queued: number; target_version: string; error?: string };
    },
    onSuccess: (res) => {
      if (res.error) {
        toast({ title: "Couldn't queue upgrade", description: res.error, variant: "destructive" });
        return;
      }
      toast({
        title: `Queued ${res.queued} upgrade${res.queued === 1 ? "" : "s"} to v${res.target_version}`,
        description: res.already_queued > 0
          ? `${res.already_queued} endpoint(s) already had an upgrade in flight — skipped.`
          : "Agents will pick up the command on their next heartbeat (~60s) and report back.",
      });
      queryClient.invalidateQueries({ queryKey: ["bulk-upgrade-eligible"] });
      queryClient.invalidateQueries({ queryKey: ["endpoints"] });
      setOpen(false);
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast({ title: "Couldn't queue upgrade", description: msg, variant: "destructive" });
    },
  });

  // Permission gate — the RPC enforces this too but we hide the button up-front.
  if (!isSuperAdmin && !scopedOrgId) return null;

  if (isLoading || !latest) {
    return (
      <Button size="sm" variant="outline" disabled className="gap-1.5">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking versions…
      </Button>
    );
  }

  const count = outdated?.length ?? 0;
  if (count === 0) {
    return (
      <Badge variant="outline" className="gap-1 bg-status-healthy/10 text-status-healthy border-status-healthy/40">
        <BadgeCheck className="h-3 w-3" />
        All up to date (v{latest.version})
      </Badge>
    );
  }

  const preview = (outdated ?? []).slice(0, 10);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <ArrowUpCircle className="h-4 w-4" />
          Upgrade {count} to v{latest.version}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ArrowUpCircle className="h-5 w-5 text-primary" />
            Push v{latest.version} to {count} endpoint{count === 1 ? "" : "s"}?
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            <span className="block">
              The agent on each endpoint picks up its command on the next
              heartbeat (within ~60 seconds) and self-updates. Endpoints with
              an upgrade already in flight are skipped automatically.
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              Expect a few endpoints to briefly go offline mid-upgrade.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="rounded-md border border-border/40 bg-muted/30 max-h-56 overflow-y-auto text-xs font-mono">
          <table className="w-full">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/40 sticky top-0">
              <tr>
                <th className="text-left p-2 font-medium">Hostname</th>
                <th className="text-right p-2 font-medium">Current</th>
                <th className="text-right p-2 font-medium">→</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((e) => (
                <tr key={e.id} className="border-t border-border/30">
                  <td className="p-2 truncate max-w-[220px]">{e.hostname}</td>
                  <td className="p-2 text-right text-muted-foreground">v{e.agent_version}</td>
                  <td className="p-2 text-right text-emerald-500">v{latest.version}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {count > preview.length && (
            <div className="p-2 text-[11px] text-center text-muted-foreground border-t border-border/30">
              … and {count - preview.length} more
            </div>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={enqueue.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); enqueue.mutate(); }}
            disabled={enqueue.isPending}
            className="gap-1.5"
          >
            {enqueue.isPending
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Queueing…</>
              : <><ArrowUpCircle className="h-4 w-4" /> Push to {count}</>}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
