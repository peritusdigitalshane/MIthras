import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEnqueueAgentCommand } from "@/hooks/useAgentCommands";
import { useToast } from "@/hooks/use-toast";
import { Monitor, Loader2, ShieldCheck, ShieldOff, AlertTriangle, Trash2, Download } from "lucide-react";

interface Props {
  endpointId: string;
  hostname: string;
}

type MeshState = "not_installed" | "installing" | "installed" | "failed" | "uninstalling";

/**
 * Per-endpoint Remote Access (MeshAgent) install controls. Opt-in: the
 * Mithras installer no longer drops MeshAgent on every endpoint, the
 * operator clicks Install here when they want remote-desktop access on a
 * specific box. The next agent heartbeat picks up the install_mesh_agent
 * command and runs it; the heartbeat handler flips mesh_agent_state when
 * the result comes back.
 */
export function RemoteAccessCard({ endpointId, hostname }: Props) {
  const { toast } = useToast();
  const enqueue = useEnqueueAgentCommand();
  const qc = useQueryClient();
  const [confirmingUninstall, setConfirmingUninstall] = useState(false);

  const { data: endpoint, isLoading } = useQuery({
    queryKey: ["endpoint-mesh-state", endpointId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("endpoints")
        .select("mesh_agent_state, mesh_agent_error, mesh_agent_installed_at, mesh_node_id, agent_version")
        .eq("id", endpointId)
        .single();
      if (error) throw error;
      return data as {
        mesh_agent_state: MeshState;
        mesh_agent_error: string | null;
        mesh_agent_installed_at: string | null;
        mesh_node_id: string | null;
        agent_version: string | null;
      };
    },
    refetchInterval: 5_000, // poll while install is in flight
  });

  const state: MeshState = endpoint?.mesh_agent_state ?? "not_installed";

  const agentSupports = agentVersionAtLeast(endpoint?.agent_version ?? null, "0.7.4");

  // Pending install/uninstall commands - drives the "Installing…" UI without
  // optimistically writing mesh_agent_state. The agent heartbeat handler is
  // the authoritative writer; if a command expires or the endpoint is offline,
  // the row stays at its real state and the operator gets a Cancel path.
  const { data: pendingMeshCmd } = useQuery({
    queryKey: ["endpoint-mesh-pending-cmd", endpointId],
    refetchInterval: 5_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("agent_commands")
        .select("id, command_type, status, issued_at")
        .eq("endpoint_id", endpointId)
        .in("command_type", ["install_mesh_agent", "uninstall_mesh_agent"])
        .in("status", ["queued", "dispatched"])
        .order("issued_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as { id: string; command_type: string; status: string; issued_at: string } | null;
    },
  });

  const handleInstall = async () => {
    try {
      await enqueue.mutateAsync({ endpointId, commandType: "install_mesh_agent" });
      qc.invalidateQueries({ queryKey: ["endpoint-mesh-pending-cmd", endpointId] });
      toast({
        title: "Install queued",
        description: `MeshAgent will install on ${hostname} on the next heartbeat. Allow up to a minute.`,
      });
    } catch (e) {
      toast({
        title: "Failed to queue install",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleUninstall = async () => {
    if (!confirmingUninstall) { setConfirmingUninstall(true); return; }
    setConfirmingUninstall(false);
    try {
      await enqueue.mutateAsync({ endpointId, commandType: "uninstall_mesh_agent" });
      qc.invalidateQueries({ queryKey: ["endpoint-mesh-pending-cmd", endpointId] });
      toast({
        title: "Uninstall queued",
        description: `MeshAgent will be removed from ${hostname} on the next heartbeat.`,
      });
    } catch (e) {
      toast({
        title: "Failed to queue uninstall",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleCancelPending = async () => {
    if (!pendingMeshCmd) return;
    try {
      // Use the SECURITY DEFINER RPC - a direct .update() on agent_commands
      // is silently denied by RLS (no UPDATE policy for non-service-role
      // callers). The RPC returns true only when a queued/dispatched row
      // was actually transitioned to 'cancelled'.
      const { data: cancelled, error } = await supabase.rpc("cancel_agent_command", {
        p_command_id: pendingMeshCmd.id,
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["endpoint-mesh-pending-cmd", endpointId] });
      if (cancelled) {
        toast({ title: "Cancelled", description: `${pendingMeshCmd.command_type} cancelled for ${hostname}.` });
      } else {
        toast({
          title: "Already running",
          description: "The agent picked this command up before we could cancel it. Wait for it to complete.",
        });
      }
    } catch (e) {
      toast({
        title: "Failed to cancel",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const elapsedLabel = (iso: string) => {
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  };

  const inFlightLabel = pendingMeshCmd?.command_type === "install_mesh_agent" ? "Installing" : "Uninstalling";
  // The mesh-state and pending-cmd queries each poll every 5s on their
  // own schedule. After an install succeeds, mesh_agent_state flips to
  // 'installed' on heartbeat ingest but pendingMeshCmd may still hold the
  // just-succeeded row for up to 5s until its query refetches and the
  // status filter drops the row. Without the predicate below, the UI
  // would show "Installed" badge + spinning "Installing..." body + Cancel
  // button simultaneously. Hide the in-flight block once the state has
  // already caught up to what the command was driving toward.
  const showInFlight = !!pendingMeshCmd && !(
    (pendingMeshCmd.command_type === "install_mesh_agent" && state === "installed") ||
    (pendingMeshCmd.command_type === "uninstall_mesh_agent" && state === "not_installed")
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          <Monitor className="h-4 w-4" />
          Remote Access (MeshAgent)
          <StateBadge state={state} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {isLoading ? (
          <div className="text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : (
          <>
            <p className="text-muted-foreground">
              Installs the MeshAgent transport on this endpoint so a SOC operator can launch
              a Remote Desktop session from the console. Opt-in per endpoint &mdash; nothing
              is installed by default.
            </p>

            {!agentSupports && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  This endpoint runs agent <code>{endpoint?.agent_version ?? "unknown"}</code>.
                  The install / uninstall commands require <b>agent v0.7.4+</b>. Upgrade the
                  agent first, then come back to this card.
                </AlertDescription>
              </Alert>
            )}

            {state === "failed" && endpoint?.mesh_agent_error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <b>Last install failed:</b> {endpoint.mesh_agent_error}
                </AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap gap-2">
              {!showInFlight && (state === "not_installed" || state === "failed") ? (
                <Button onClick={handleInstall} disabled={!agentSupports || enqueue.isPending} className="gap-1.5">
                  {enqueue.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {state === "failed" ? "Retry install" : "Install Remote Access"}
                </Button>
              ) : null}

              {showInFlight && pendingMeshCmd ? (
                <>
                  <Button disabled variant="outline" className="gap-1.5">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {inFlightLabel} ({elapsedLabel(pendingMeshCmd.issued_at)})
                  </Button>
                  <Button onClick={handleCancelPending} variant="ghost" size="sm">
                    Cancel
                  </Button>
                </>
              ) : null}

              {!showInFlight && state === "installed" ? (
                <Button onClick={handleUninstall} disabled={!agentSupports || enqueue.isPending} variant="outline" className="gap-1.5">
                  <Trash2 className="h-4 w-4" />
                  {confirmingUninstall ? "Click again to confirm" : "Uninstall Remote Access"}
                </Button>
              ) : null}
            </div>

            {state === "installed" && endpoint?.mesh_agent_installed_at && (
              <p className="text-xs text-muted-foreground">
                Installed {new Date(endpoint.mesh_agent_installed_at).toLocaleString()}.
                {!endpoint.mesh_node_id && " Waiting on first MeshCentral check-in to populate node id."}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StateBadge({ state }: { state: MeshState }) {
  if (state === "installed")    return <Badge variant="outline" className="bg-status-healthy/10 text-status-healthy border-status-healthy/40 gap-1"><ShieldCheck className="h-3 w-3" /> Installed</Badge>;
  if (state === "installing")   return <Badge variant="outline" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Installing</Badge>;
  if (state === "uninstalling") return <Badge variant="outline" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Uninstalling</Badge>;
  if (state === "failed")       return <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" /> Failed</Badge>;
  return <Badge variant="outline" className="gap-1"><ShieldOff className="h-3 w-3" /> Not installed</Badge>;
}

function agentVersionAtLeast(actual: string | null, required: string): boolean {
  if (!actual) return false;
  const pa = actual.split(".").map(n => parseInt(n, 10) || 0);
  const pr = required.split(".").map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const a = pa[i] || 0; const r = pr[i] || 0;
    if (a > r) return true;
    if (a < r) return false;
  }
  return true;
}
