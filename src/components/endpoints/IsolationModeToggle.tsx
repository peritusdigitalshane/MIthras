import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface Props {
  endpointId: string;
  hostname: string;
}

/**
 * Per-endpoint isolation mode. Default `notify_only` (safe) — flipping to
 * `enforce` makes the next Isolate Network click actually cut the box off.
 *
 * Honoured by agent v0.7.2+. Older agents always enforce regardless.
 */
export function IsolationModeToggle({ endpointId, hostname }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pendingValue, setPendingValue] = useState<string | null>(null);

  const { data: endpoint, isLoading } = useQuery({
    queryKey: ["endpoint-isolation-mode", endpointId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("endpoints")
        .select("isolation_mode, agent_version")
        .eq("id", endpointId)
        .single();
      if (error) throw error;
      return data as { isolation_mode: string; agent_version: string | null };
    },
  });

  const mutation = useMutation({
    mutationFn: async (mode: "notify_only" | "enforce") => {
      const { error } = await supabase
        .from("endpoints")
        .update({ isolation_mode: mode })
        .eq("id", endpointId);
      if (error) throw error;
    },
    onSuccess: (_, mode) => {
      queryClient.invalidateQueries({ queryKey: ["endpoint-isolation-mode", endpointId] });
      toast({
        title: "Isolation mode updated",
        description: `${hostname} is now in ${mode === "enforce" ? "ENFORCE" : "notify-only"} mode.`,
      });
      setPendingValue(null);
    },
    onError: (e) => {
      toast({
        title: "Failed to update isolation mode",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
      setPendingValue(null);
    },
  });

  const currentMode = endpoint?.isolation_mode ?? "notify_only";
  const agentSupportsMode = agentVersionAtLeast(endpoint?.agent_version ?? null, "0.7.2");

  const handleChange = (value: string) => {
    if (value !== "notify_only" && value !== "enforce") return;
    if (value === currentMode) return;
    setPendingValue(value);
    mutation.mutate(value);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          {currentMode === "enforce" ? <ShieldAlert className="h-4 w-4 text-destructive" /> : <ShieldCheck className="h-4 w-4 text-status-healthy" />}
          Isolation mode
          {currentMode === "enforce" ? (
            <Badge variant="outline" className="ml-2 bg-destructive/10 text-destructive border-destructive/40">ENFORCE</Badge>
          ) : (
            <Badge variant="outline" className="ml-2 bg-status-healthy/10 text-status-healthy border-status-healthy/40">notify only</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {isLoading ? (
          <div className="text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : (
          <>
            <p className="text-muted-foreground">
              Controls what happens when an operator clicks <b>Isolate from network</b> on this endpoint.
            </p>
            <RadioGroup
              value={pendingValue ?? currentMode}
              onValueChange={handleChange}
              disabled={mutation.isPending}
              className="space-y-2"
            >
              <label htmlFor={`iso-${endpointId}-notify`} className="flex items-start gap-3 cursor-pointer rounded-md border p-3 hover:bg-muted/30">
                <RadioGroupItem value="notify_only" id={`iso-${endpointId}-notify`} className="mt-0.5" />
                <div className="space-y-1">
                  <div className="font-medium">Notify only <span className="text-xs text-muted-foreground">(default, safe)</span></div>
                  <div className="text-xs text-muted-foreground">
                    Agent goes through the motions — resolves API allow-list, logs the action, ships a simulated-isolation alert —
                    but <b>does not change the firewall</b>. Use for testing the response flow without risking a real outage.
                  </div>
                </div>
              </label>
              <label htmlFor={`iso-${endpointId}-enforce`} className="flex items-start gap-3 cursor-pointer rounded-md border p-3 hover:bg-muted/30">
                <RadioGroupItem value="enforce" id={`iso-${endpointId}-enforce`} className="mt-0.5" />
                <div className="space-y-1">
                  <div className="font-medium text-destructive">Enforce <span className="text-xs text-destructive/70">(real isolation — cuts the box off)</span></div>
                  <div className="text-xs text-muted-foreground">
                    Agent applies a default-block firewall profile + an allow-list for the Mithras API only.
                    Endpoint goes dark to everything else. Use when responding to an actual confirmed threat.
                  </div>
                </div>
              </label>
            </RadioGroup>
            {!agentSupportsMode && (
              <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-2 text-xs">
                <b>Note:</b> this endpoint is on agent <code>{endpoint?.agent_version ?? "unknown"}</code>.
                Mode is honoured by <b>agent v0.7.2+</b>; older agents always enforce regardless of this setting.
                Upgrade this endpoint to v0.7.2 for the toggle to take effect.
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
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
