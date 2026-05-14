import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Shield, AlertCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useRuleSetAuditSummary } from "@/hooks/useWdac";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

interface RuleSetAuditCountdownProps {
  ruleSetId: string;
  ruleSetName: string;
  auditWindowDays: number;
  autoPromote: boolean;
}

export function RuleSetAuditCountdown({
  ruleSetId,
  ruleSetName,
  auditWindowDays,
  autoPromote,
}: RuleSetAuditCountdownProps) {
  const { data, isLoading } = useRuleSetAuditSummary(ruleSetId);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const daysRemaining = useMemo(() => {
    if (!data?.earliest_audit_until) return null;
    const ms = new Date(data.earliest_audit_until).getTime() - Date.now();
    return Math.max(0, Math.round(ms / 86400000));
  }, [data?.earliest_audit_until]);

  const progress = useMemo(() => {
    if (daysRemaining === null) return 0;
    return Math.min(100, Math.max(0, ((auditWindowDays - daysRemaining) / auditWindowDays) * 100));
  }, [daysRemaining, auditWindowDays]);

  const promoteNow = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("endpoint_app_control_state")
        .update({ current_mode: "enforce" })
        .eq("rule_set_id", ruleSetId)
        .eq("current_mode", "audit");
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: `Promoted "${ruleSetName}" to enforce`, description: "All audit-mode devices on this rule set are now enforced." });
      queryClient.invalidateQueries({ queryKey: ["wdac-rule-set-audit-summary", ruleSetId] });
    },
    onError: (e: Error) => {
      toast({ title: "Promote failed", description: e.message, variant: "destructive" });
    },
  });

  const extendAudit = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("extend_app_control_audit", {
        p_rule_set_id: ruleSetId,
        p_extra_days: 7,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Audit extended", description: `Added 7 days to all devices in "${ruleSetName}".` });
      queryClient.invalidateQueries({ queryKey: ["wdac-rule-set-audit-summary", ruleSetId] });
    },
    onError: (e: Error) => {
      toast({ title: "Extend failed", description: e.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading audit state...
      </div>
    );
  }

  if (!data || data.devices_in_audit + data.devices_in_enforce === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No devices assigned to this rule set yet.
      </div>
    );
  }

  const inEnforce = data.devices_in_audit === 0 && data.devices_in_enforce > 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm">
        {inEnforce ? (
          <Badge variant="default" className="gap-1.5">
            <Shield className="h-3.5 w-3.5" /> Enforced
          </Badge>
        ) : (
          <Badge variant="secondary" className="gap-1.5">
            <AlertCircle className="h-3.5 w-3.5" /> Audit
          </Badge>
        )}
        <span className="text-muted-foreground">
          {data.devices_in_audit + data.devices_in_enforce} devices ·{" "}
          {data.unique_apps_observed} unique apps observed
        </span>
      </div>

      {!inEnforce && daysRemaining !== null && (
        <>
          <Progress value={progress} className="h-2" />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {daysRemaining} day{daysRemaining === 1 ? "" : "s"} remaining ·{" "}
              {autoPromote ? "auto-promotes when complete" : "manual promote required"}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => extendAudit.mutate()}
                disabled={extendAudit.isPending}
              >
                Extend audit
              </Button>
              <Button
                size="sm"
                onClick={() => promoteNow.mutate()}
                disabled={promoteNow.isPending}
              >
                Promote now
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
