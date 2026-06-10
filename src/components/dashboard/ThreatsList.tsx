import { AlertTriangle, Clock, Monitor, Loader2, ShieldCheck } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useEndpointThreats, useEndpoints } from "@/hooks/useDashboardData";
import { EmptyState } from "@/components/help/EmptyState";
import { formatDistanceToNow } from "date-fns";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

const severityStyles: Record<string, string> = {
  severe: "border-l-status-critical",
  high: "border-l-status-critical",
  moderate: "border-l-status-warning",
  low: "border-l-status-info",
  unknown: "border-l-muted-foreground",
};

const getSeverityStyle = (severity: string) => {
  const normalized = severity.toLowerCase();
  return severityStyles[normalized] || severityStyles.unknown;
};

const statusMap: Record<string, "healthy" | "warning" | "critical" | "info"> = {
  blocked: "healthy",
  removed: "healthy",
  resolved: "healthy",
  quarantined: "warning",
  allowed: "critical",
  active: "critical",
  unknown: "warning",
  notexecuting: "healthy",
  executing: "critical",
};

const getStatusDisplay = (status: string): { variant: "healthy" | "warning" | "critical" | "info"; label: string } => {
  const normalized = status.toLowerCase();
  return {
    variant: statusMap[normalized] || "warning",
    label: status.charAt(0).toUpperCase() + status.slice(1).toLowerCase(),
  };
};

export function ThreatsList({
  limit = 5,
  showHeaderLink = true,
  enableResolveActions = false,
}: {
  limit?: number;
  showHeaderLink?: boolean;
  enableResolveActions?: boolean;
}) {
  const { data: threats, isLoading, error } = useEndpointThreats();
  const { data: endpoints } = useEndpoints();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const resolveThreat = async (threatId: string) => {
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes.user?.id ?? null;
      const now = new Date().toISOString();

      const { error: updateError } = await supabase
        .from("endpoint_threats")
        .update({
          status: "Resolved",
          manual_resolution_active: true,
          manual_resolved_at: now,
          manual_resolved_by: userId,
        } as any)
        .eq("id", threatId);

      if (updateError) throw updateError;

      // Refresh list immediately so the status flips without waiting for the 30s poll.
      await queryClient.invalidateQueries({ queryKey: ["endpoint_threats"] });

      toast({
        title: "Threat resolved",
        description: "Marked as Resolved. If the threat reappears, it will automatically become active again.",
      });
    } catch (e: any) {
      toast({
        title: "Couldn't resolve threat",
        description: e?.message ?? "Update failed",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card shadow-card">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-status-warning" />
            <h3 className="font-semibold text-foreground">Recent Threats</h3>
          </div>
        </div>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card shadow-card">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-status-warning" />
            <h3 className="font-semibold text-foreground">Recent Threats</h3>
          </div>
        </div>
        <div className="p-8 text-center text-muted-foreground">
          Failed to load threats
        </div>
      </div>
    );
  }

  const displayThreats = threats?.slice(0, limit) || [];

  return (
    <div className="rounded-xl border border-border bg-card shadow-card">
      <div className="flex items-center justify-between border-b border-border p-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-status-warning" />
          <h3 className="font-semibold text-foreground">Recent Threats</h3>
        </div>
        {showHeaderLink ? (
          <Link to="/threats" className="text-sm text-primary hover:underline">
            View All
          </Link>
        ) : null}
      </div>
      
      {displayThreats.length === 0 ? (
        <div className="p-6">
          <EmptyState
            icon={<ShieldCheck className="h-7 w-7" />}
            title="No threats detected — that's a good thing"
            tone="positive"
            description={
              <>
                <p>Defender detections appear here within ~60s of an event. To prove the pipeline works, drop an EICAR test file on any agent endpoint.</p>
              </>
            }
            steps={[
              { done: (endpoints?.length ?? 0) > 0, label: `Deploy the Mithras agent (${endpoints?.length ?? 0} so far)`, href: "/deploy" },
              { done: (endpoints?.some((e: any) => e.policy_id)) ?? false, label: "Assign a Defender policy", href: "/policies" },
              { done: false, label: "Test ingestion with EICAR", detail: "Save the EICAR test string to a .txt file on the endpoint -- Defender catches it instantly." },
            ]}
            secondaryAction={{ label: "What is EICAR? →", href: "/glossary#severity" }}
          />
        </div>
      ) : (
        <div className="divide-y divide-border">
          {displayThreats.map((threat) => {
            const statusDisplay = getStatusDisplay(threat.status);
            const timestamp = threat.initial_detection_time || threat.created_at;
            const timeAgo = formatDistanceToNow(new Date(timestamp), { addSuffix: true });

            return (
              <div
                key={threat.id}
                className={cn(
                  "flex items-center gap-4 border-l-2 p-4 transition-colors hover:bg-secondary/50",
                  getSeverityStyle(threat.severity)
                )}
              >
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium text-foreground">{threat.threat_name}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Monitor className="h-3 w-3" />
                      {threat.endpoints?.hostname || "Unknown"}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {timeAgo}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {enableResolveActions && !["Resolved", "Blocked", "Removed"].includes(statusDisplay.label) ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => resolveThreat(threat.id)}
                    >
                      Resolve
                    </Button>
                  ) : null}
                  <StatusBadge
                    status={statusDisplay.variant}
                    label={statusDisplay.label}
                    pulse={statusDisplay.variant === "critical"}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
