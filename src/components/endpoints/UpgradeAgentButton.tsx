import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowUpCircle, BadgeCheck, Loader2, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useEnqueueAgentCommand, useAgentCommands } from "@/hooks/useAgentCommands";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

interface Props {
  endpointId: string;
  hostname: string;
  currentVersion: string | null | undefined;
}

/**
 * Manual upgrade — queues an `upgrade_agent` command directly on click.
 * The agent picks it up on its next heartbeat (≤30s) and runs
 * `Invoke-UpgradeAgent` → `Invoke-AgentSelfUpdate`. The agent no longer
 * auto-polls /agent-version-check (v0.6.6+); this button is the only path.
 *
 * No confirmation dialog — single click queues, the toast confirms. The
 * button transitions to "Upgrade queued (…)" while the command is
 * in-flight so a second click can't double-queue.
 */
export function UpgradeAgentButton({ endpointId, hostname, currentVersion }: Props) {
  const { toast } = useToast();
  const enqueue = useEnqueueAgentCommand();
  const { data: commands } = useAgentCommands(endpointId);

  const { data: latest, isLoading } = useQuery({
    queryKey: ["agent-version-latest"],
    queryFn: async () => {
      const { data } = await supabase
        .from("agent_versions")
        .select("version, download_url, sha256, ed25519_sig")
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

  const pendingUpgrade = (commands ?? []).find(
    (c) => c.command_type === "upgrade_agent" && (c.status === "queued" || c.status === "dispatched"),
  );

  if (isLoading) {
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  }
  if (!latest) {
    return null;
  }

  const isOutdated = currentVersion ? compareSemver(currentVersion, latest.version) < 0 : true;
  if (!isOutdated && !pendingUpgrade) {
    return (
      <Badge variant="outline" className="gap-1 bg-status-healthy/10 text-status-healthy border-status-healthy/40">
        <BadgeCheck className="h-3 w-3" />
        Up to date (v{latest.version})
      </Badge>
    );
  }

  // v0.7.21: agents refuse unsigned bundles, so surface that here rather than
  // queuing a command every endpoint will reject. The remedy is a release-side
  // one (re-run build-release.sh with SIGNING_KEY), so name it in the tooltip.
  if (!latest.ed25519_sig) {
    return (
      <Badge
        variant="outline"
        className="gap-1 bg-status-warning/10 text-status-warning border-status-warning/40"
        title={`v${latest.version} was published without an Ed25519 signature. Agents on v0.7.21+ will refuse it. Re-publish with scripts/phase2a/build-release.sh and SIGNING_KEY set.`}
      >
        <ShieldAlert className="h-3 w-3" />
        v{latest.version} unsigned
      </Badge>
    );
  }

  if (pendingUpgrade) {
    return (
      <Badge variant="outline" className="gap-1 bg-blue-500/10 text-blue-600 border-blue-500/40" title={`Queued ${formatDistanceToNow(new Date(pendingUpgrade.issued_at), { addSuffix: true })}`}>
        <Loader2 className="h-3 w-3 animate-spin" />
        Upgrade queued ({pendingUpgrade.status})
      </Badge>
    );
  }

  const handleClick = async () => {
    try {
      await enqueue.mutateAsync({
        endpointId,
        commandType: "upgrade_agent",
        params: {
          target_version: latest.version,
          download_url: latest.download_url,
          sha256: latest.sha256,
          ed25519_sig: latest.ed25519_sig,
        },
      });
      toast({
        title: `Upgrading ${hostname} to v${latest.version}`,
        description: "The agent will pick this up on its next heartbeat (within ~30s) and report success when it's done.",
      });
    } catch (e) {
      toast({
        title: "Failed to queue upgrade",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <Button
      size="sm"
      variant="outline"
      className="gap-1.5"
      disabled={enqueue.isPending}
      onClick={handleClick}
      title={`Queue an upgrade to v${latest.version} for ${hostname}`}
    >
      {enqueue.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpCircle className="h-4 w-4" />}
      Upgrade to v{latest.version}
    </Button>
  );
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}
