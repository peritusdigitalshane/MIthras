import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Circle, X, Sparkles, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useTenant } from "@/contexts/TenantContext";
import { useEndpoints } from "@/hooks/useDashboardData";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

interface ChecklistStep {
  id: string;
  label: string;
  detail: string;
  done: boolean;
  href: string;
}

/**
 * Onboarding checklist card -- shows on the dashboard for orgs that haven't
 * completed the basics. Live status driven by the same hooks the rest of the
 * dashboard uses; dismissible via localStorage; auto-hides when 100% complete.
 *
 * Each step is a click-through to the relevant page; clicking the X dismisses
 * the card for this org until the user clears localStorage.
 */
export function OnboardingChecklist() {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;
  const { data: endpoints } = useEndpoints();

  // Org policy + group counts -- read directly, cheap.
  const { data: counts } = useQuery({
    queryKey: ["onboarding-counts", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const [defenderPol, fwPol, microsegLearning, appwlAuditing] = await Promise.all([
        supabase.from("defender_policies").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
        supabase.from("firewall_policies").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
        supabase.from("endpoint_microseg_state").select("endpoint_id", { count: "exact", head: true }).eq("organization_id", orgId).eq("state", "learning"),
        supabase.from("app_whitelist_state").select("endpoint_id", { count: "exact", head: true }).eq("organization_id", orgId).eq("mode", "auditing"),
      ]);
      return {
        defenderPolicyCount: defenderPol.count ?? 0,
        firewallPolicyCount: fwPol.count ?? 0,
        microsegLearningCount: microsegLearning.count ?? 0,
        appwlAuditingCount: appwlAuditing.count ?? 0,
      };
    },
    staleTime: 60_000,
  });

  // Per-org dismiss state. Reappears for new orgs.
  const storageKey = `mithras:onboarding-dismissed:${orgId ?? "none"}`;
  const [dismissed, setDismissed] = useState<boolean>(false);
  useEffect(() => {
    setDismissed(localStorage.getItem(storageKey) === "1");
  }, [storageKey]);

  if (!orgId) return null;

  const endpointCount     = endpoints?.length ?? 0;
  const onlineCount       = endpoints?.filter((e: any) => e.is_online).length ?? 0;
  const withPolicyCount   = endpoints?.filter((e: any) => e.policy_id).length ?? 0;

  const steps: ChecklistStep[] = [
    {
      id: "deploy-agent",
      label: "Deploy your first agent",
      detail: "Install the Mithras agent on a Windows endpoint to start collecting telemetry.",
      done:  endpointCount > 0,
      href:  "/deploy",
    },
    {
      id: "first-heartbeat",
      label: "See your first heartbeat",
      detail: "Agent reports every 60s once installed. No action needed -- this happens automatically.",
      done:  onlineCount > 0,
      href:  "/endpoints",
    },
    {
      id: "defender-policy",
      label: "Configure a Defender policy",
      detail: "Set ASR rules, real-time protection, scan cadence. Auto-applies to new endpoints.",
      done:  (counts?.defenderPolicyCount ?? 0) > 0,
      href:  "/policies",
    },
    {
      id: "policy-assigned",
      label: "Assign Defender policy to an endpoint",
      detail: "Endpoints without a policy are unmanaged. The default policy auto-applies on enrolment.",
      done:  withPolicyCount > 0,
      href:  "/endpoints",
    },
    {
      id: "microseg-learn",
      label: "Start a microsegmentation audit",
      detail: "Watch an endpoint's network traffic for ~7 days, then Enforce to lock down anything unobserved.",
      done:  (counts?.microsegLearningCount ?? 0) > 0,
      href:  "/microsegmentation",
    },
    {
      id: "appwl-audit",
      label: "Start an application-whitelist audit",
      detail: "Watch process launches, then Enforce to block any binary that isn't whitelisted.",
      done:  (counts?.appwlAuditingCount ?? 0) > 0,
      href:  "/app-whitelisting",
    },
  ];

  const doneCount  = steps.filter((s) => s.done).length;
  const totalSteps = steps.length;
  const pct        = Math.round((doneCount / totalSteps) * 100);

  // Auto-hide when 100% OR when user dismissed.
  if (dismissed || doneCount === totalSteps) return null;

  const dismiss = () => {
    localStorage.setItem(storageKey, "1");
    setDismissed(true);
  };

  // Surface the next undone step as the call-to-action.
  const nextStep = steps.find((s) => !s.done);

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0 space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" />
              Get started with Mithras
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {doneCount} of {totalSteps} steps complete. Most orgs are protected within a day.
            </p>
            <Progress value={pct} className="h-1.5 mt-2" />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={dismiss}
            className="h-7 w-7 p-0 shrink-0"
            aria-label="Dismiss onboarding checklist"
            title="Dismiss for now"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {steps.map((s) => (
          <Link
            key={s.id}
            to={s.href}
            className={`group flex items-start gap-2.5 rounded-md p-2 transition-colors hover:bg-background/60 ${
              s.done ? "opacity-60" : ""
            }`}
          >
            {s.done ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
            ) : (
              <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50 group-hover:text-foreground" />
            )}
            <div className="flex-1 min-w-0">
              <p className={`text-sm ${s.done ? "line-through text-muted-foreground" : "text-foreground"}`}>
                {s.label}
              </p>
              <p className="text-xs text-muted-foreground">{s.detail}</p>
            </div>
            {!s.done && nextStep?.id === s.id && (
              <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                Next <ArrowRight className="h-3 w-3" />
              </span>
            )}
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
