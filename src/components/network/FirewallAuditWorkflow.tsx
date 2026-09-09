import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  useFirewallAuditSessions,
  useStartFirewallAudit,
  useCompleteAuditSession,
  useFirewallPolicies,
  FirewallAuditSession,
} from "@/hooks/useFirewall";
import { EndpointAuditMatrix } from "./EndpointAuditMatrix";
import { useGeneratePerEndpointRules } from "@/hooks/useFirewallAudit";
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
  Play,
  Clock,
  CheckCircle2,
  Sparkles,
  Loader2,
  Radio,
} from "lucide-react";
import { differenceInDays, differenceInHours, format } from "date-fns";

export function FirewallAuditWorkflow() {
  const { data: sessions, isLoading: sessionsLoading } = useFirewallAuditSessions();
  const { data: policies } = useFirewallPolicies();
  const startAudit = useStartFirewallAudit();
  const generateRules = useGeneratePerEndpointRules();
  const completeAudit = useCompleteAuditSession();
  const [showStartDialog, setShowStartDialog] = useState(false);

  const activeSession = sessions?.find((s) => s.status === "auditing");
  const completedSession = sessions?.find((s) => s.status === "completed");
  const latestGenerated = sessions?.find((s) => s.status === "template_generated");

  useEffect(() => {
    if (activeSession) {
      const endsAt = new Date(activeSession.ends_at);
      if (new Date() >= endsAt) {
        completeAudit.mutate(activeSession.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession?.id, activeSession?.ends_at]);

  const defaultPolicy = policies?.[0];

  const handleStartAudit = () => {
    if (defaultPolicy) {
      startAudit.mutate(defaultPolicy.id);
      setShowStartDialog(false);
    }
  };

  const handleGenerateRules = () => {
    if (completedSession && defaultPolicy) {
      generateRules.mutate({
        sessionId: completedSession.id,
        policyId: defaultPolicy.id,
      });
    }
  };

  if (sessionsLoading) return null;

  // Active audit in progress
  if (activeSession) {
    return (
      <>
        <AuditProgressBanner session={activeSession} />
        <EndpointAuditMatrix session={activeSession} />
      </>
    );
  }

  // Audit completed, ready to generate
  if (completedSession) {
    return (
      <>
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                  <Sparkles className="h-5 w-5 text-amber-500" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Audit Complete — Generate Per-Endpoint Rules</p>
                  <p className="text-xs text-muted-foreground">
                    Review observed traffic below then generate firewall rules scoped to each endpoint. 
                    Rules start in Audit mode for safe review.
                  </p>
                </div>
              </div>
              <Button 
                onClick={handleGenerateRules} 
                disabled={generateRules.isPending}
                className="gap-2"
              >
                {generateRules.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Generate Rules
              </Button>
            </div>
          </CardContent>
        </Card>
        <EndpointAuditMatrix session={completedSession} />
      </>
    );
  }

  // Template was generated
  if (latestGenerated) {
    return (
      <Card className="border-green-500/50 bg-green-500/5">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-green-500/20 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="font-semibold text-sm">Per-Endpoint Rules Generated</p>
                <p className="text-xs text-muted-foreground">
                  Rules created on {format(new Date(latestGenerated.updated_at), "MMM d, yyyy")} in Audit mode. 
                  Review in the Firewall Matrix and switch to Enforce when ready.
                </p>
              </div>
            </div>
            <Button 
              variant="outline" 
              onClick={() => setShowStartDialog(true)}
              className="gap-2"
            >
              <Play className="h-4 w-4" />
              Start New Audit
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // No audit yet
  return (
    <>
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
                <Radio className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-sm">Start a 30-Day Network Audit</p>
                <p className="text-xs text-muted-foreground">
                  Monitor all inbound traffic for 30 days. After the audit, per-endpoint firewall rules 
                  will be generated so each device only allows the traffic it actually needs.
                </p>
              </div>
            </div>
            <Button onClick={() => setShowStartDialog(true)} className="gap-2">
              <Play className="h-4 w-4" />
              Start Audit
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={showStartDialog} onOpenChange={setShowStartDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start 30-Day Network Audit?</AlertDialogTitle>
            <AlertDialogDescription>
              This will begin monitoring all inbound network traffic across your endpoints for 30 days. 
              No traffic will be blocked during the audit period — everything is logged only.
              <br /><br />
              After the audit, firewall rules will be generated <strong>per endpoint</strong> — each device 
              will only allow the specific services and sources it was observed using. Rules start in Audit 
              mode so you can review before enforcing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleStartAudit} disabled={startAudit.isPending}>
              {startAudit.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Start 30-Day Audit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function AuditProgressBanner({ session }: { session: FirewallAuditSession }) {
  const startDate = new Date(session.started_at);
  const endDate = new Date(session.ends_at);
  const now = new Date();

  const totalDays = differenceInDays(endDate, startDate);
  const elapsedDays = differenceInDays(now, startDate);
  const remainingDays = Math.max(0, differenceInDays(endDate, now));
  const remainingHours = Math.max(0, differenceInHours(endDate, now) % 24);
  const progress = Math.min(100, (elapsedDays / totalDays) * 100);

  return (
    <Card className="border-blue-500/50 bg-blue-500/5">
      <CardContent className="py-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-blue-500/20 flex items-center justify-center">
              <Clock className="h-5 w-5 text-blue-500 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-semibold text-sm">Network Audit in Progress</p>
                <Badge variant="outline" className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30 text-[10px]">
                  Day {elapsedDays + 1} of {totalDays}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {remainingDays > 0 
                  ? `${remainingDays} days ${remainingHours}h remaining`
                  : "Completing soon..."
                } — Started {format(startDate, "MMM d, yyyy")}
              </p>
            </div>
          </div>
        </div>
        <Progress value={progress} className="h-2" />
      </CardContent>
    </Card>
  );
}
