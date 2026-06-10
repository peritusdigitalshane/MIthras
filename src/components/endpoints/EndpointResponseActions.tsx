import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useEnqueueAgentCommand, useAgentCommands, CommandType, AgentCommand } from "@/hooks/useAgentCommands";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, BadgeCheck, KeyRound, Loader2, RefreshCw, Shield, ShieldOff, Wifi, WifiOff, Zap } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Props {
  endpointId: string;
  hostname: string;
}

const ACTIONS: Array<{ type: CommandType; label: string; icon: typeof Zap; danger?: boolean; description: string }> = [
  { type: "isolate_network",   label: "Isolate from network",  icon: WifiOff, danger: true,  description: "Cut endpoint off from all network traffic except the Mithras API. Use to contain an active threat." },
  { type: "release_isolation", label: "Release isolation",     icon: Wifi,                  description: "Re-enable normal network access. Run after the threat is contained." },
  { type: "run_quick_scan",    label: "Run Defender quick scan", icon: Shield,              description: "Trigger a Defender quick scan (~5 min)." },
  { type: "run_full_scan",     label: "Run Defender full scan",  icon: Shield,              description: "Trigger a Defender full scan (~30-60 min). Heavier I/O." },
  { type: "collect_persistence", label: "Collect persistence snapshot", icon: RefreshCw,    description: "Force-collect registry Run keys, services, and scheduled tasks now." },
  { type: "restart_agent",     label: "Restart agent",         icon: RefreshCw,             description: "Bounce the Mithras agent service. Useful after policy changes." },
  { type: "emergency_unlock",  label: "Emergency unlock",      icon: KeyRound, danger: true, description: "Recover a Defender-locked-down endpoint. Clears active Defender threats and adds Mithras agent paths to Defender exclusions so the same script doesn't get blocked again. Use only when you can't access an endpoint because of Defender process-creation blocks." },
];

function statusBadge(s: AgentCommand["status"]) {
  switch (s) {
    case "succeeded":  return <Badge variant="outline" className="bg-status-healthy/10 text-status-healthy border-status-healthy/40 gap-1"><BadgeCheck className="h-3 w-3" />Succeeded</Badge>;
    case "failed":     return <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />Failed</Badge>;
    case "dispatched": return <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />Executing</Badge>;
    case "queued":     return <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3" />Queued</Badge>;
    case "expired":    return <Badge variant="outline">Expired</Badge>;
    case "cancelled":  return <Badge variant="outline">Cancelled</Badge>;
  }
}

export function EndpointResponseActions({ endpointId, hostname }: Props) {
  const { toast } = useToast();
  const { isSuperAdmin, isOrgAdmin, currentOrganization } = useTenant();
  const enqueue = useEnqueueAgentCommand();
  const { data: commands } = useAgentCommands(endpointId);
  const [confirming, setConfirming] = useState<CommandType | null>(null);
  // Track which action is mid-mutation. Was previously inferred from
  // `confirming === a.type`, but non-danger actions never set `confirming`,
  // so their spinner never showed AND every button stayed clickable
  // mid-flight - two rapid clicks queued two duplicate commands.
  const [pendingType, setPendingType] = useState<CommandType | null>(null);

  // Members can SEE the response actions but only org admins (or super
  // admins) can actually queue commands. RPC enforces this server-side;
  // we mirror it here so members get a disabled button + tooltip rather
  // than an opaque "42501 invalid claim" error after clicking.
  const canAct = isSuperAdmin || (isOrgAdmin && !!currentOrganization);

  const handleAction = async (type: CommandType, danger: boolean) => {
    if (danger && confirming !== type) {
      setConfirming(type);
      return;
    }
    setConfirming(null);
    setPendingType(type);
    try {
      let params: Record<string, unknown> | undefined;

      // v0.7.2: isolate_network honours per-endpoint isolation_mode.
      // Look it up at click time and inject as a command param so the agent
      // sees a consistent value regardless of when it processes the command.
      if (type === "isolate_network") {
        const { data: ep } = await supabase
          .from("endpoints")
          .select("isolation_mode")
          .eq("id", endpointId)
          .single();
        params = { mode: (ep?.isolation_mode as string) ?? "notify_only" };
      }

      await enqueue.mutateAsync({ endpointId, commandType: type, params });

      if (type === "isolate_network" && params?.mode === "notify_only") {
        toast({
          title: "Simulated isolation queued",
          description: `${hostname} is in NOTIFY-ONLY mode. The agent will log + alert what would have been blocked, but will NOT change the firewall. Flip to "enforce" first if you want a real isolation.`,
        });
      } else {
        toast({ title: "Command queued", description: `${type.replace(/_/g, " ")} queued for ${hostname}. Will execute on next heartbeat.` });
      }
    } catch (e) {
      toast({ title: "Failed to queue command", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
    } finally {
      setPendingType(null);
    }
  };

  // An isolate_network command in notify_only mode logs + alerts but does NOT
  // change the firewall. The red "Endpoint is currently isolated — All network
  // traffic blocked" banner is FALSE for those clicks. Track the two cases
  // separately so the banner reflects reality.
  const isIsolatedReal = (commands ?? []).find(c =>
    c.command_type === "isolate_network" && c.status === "succeeded" &&
    (c.params as Record<string, unknown> | null)?.mode !== "notify_only" &&
    !(commands ?? []).find(c2 => c2.command_type === "release_isolation" && c2.status === "succeeded" && new Date(c2.completed_at ?? "").getTime() > new Date(c.completed_at ?? "").getTime()));
  const isIsolatedSimulated = (commands ?? []).find(c =>
    c.command_type === "isolate_network" && c.status === "succeeded" &&
    (c.params as Record<string, unknown> | null)?.mode === "notify_only" &&
    !(commands ?? []).find(c2 => c2.command_type === "release_isolation" && c2.status === "succeeded" && new Date(c2.completed_at ?? "").getTime() > new Date(c.completed_at ?? "").getTime()));

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2"><Zap className="h-5 w-5 text-primary" /> Live response</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isIsolatedReal && (
          <Alert variant="destructive" className="border-status-critical/50">
            <ShieldOff className="h-4 w-4" />
            <AlertTitle>Endpoint is currently isolated</AlertTitle>
            <AlertDescription>All network traffic blocked except the Mithras API. Click "Release isolation" once you've cleaned up.</AlertDescription>
          </Alert>
        )}
        {isIsolatedSimulated && !isIsolatedReal && (
          <Alert>
            <ShieldOff className="h-4 w-4" />
            <AlertTitle>Simulated isolation (notify-only mode)</AlertTitle>
            <AlertDescription>The agent logged what would have been blocked but the firewall was NOT changed. Switch to enforce mode in the Isolation Mode card below to apply real isolation.</AlertDescription>
          </Alert>
        )}

        {!canAct && (
          <Alert>
            <AlertTitle className="text-sm">Read-only access</AlertTitle>
            <AlertDescription className="text-xs">
              You're signed in as a member of this organisation. Response actions (isolate, run scan, restart agent) can only be queued by an owner or admin. Ask your admin to upgrade your role from the Users page.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {ACTIONS.map((a) => {
            const Icon = a.icon;
            // Spinner only on the action currently being queued; ALL buttons
            // get globally-disabled while ANY mutation is in flight to stop
            // double-clicks queuing duplicates.
            const isPending = enqueue.isPending && pendingType === a.type;
            const anyMutationInFlight = enqueue.isPending;
            const confirmThis = confirming === a.type;
            return (
              <div key={a.type} className="border rounded-md p-3 space-y-1.5">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Icon className={`h-4 w-4 ${a.danger ? "text-status-critical" : "text-primary"}`} />
                  {a.label}
                </div>
                <p className="text-xs text-muted-foreground">{a.description}</p>
                <Button
                  size="sm"
                  variant={a.danger ? "destructive" : "outline"}
                  disabled={!canAct || anyMutationInFlight}
                  onClick={() => handleAction(a.type, !!a.danger)}
                  className="w-full"
                >
                  {isPending ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Queuing…</> :
                   confirmThis ? "Click again to confirm" :
                   "Run"}
                </Button>
              </div>
            );
          })}
        </div>

        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1.5">Recent commands</div>
          {(commands ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No commands issued yet.</p>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-auto">
              {(commands ?? []).slice(0, 10).map((c) => (
                <div key={c.id} className="flex items-center justify-between text-xs border rounded px-2 py-1.5">
                  <span className="font-mono">{c.command_type}</span>
                  <span className="text-muted-foreground">{formatDistanceToNow(new Date(c.issued_at), { addSuffix: true })}</span>
                  {statusBadge(c.status)}
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
