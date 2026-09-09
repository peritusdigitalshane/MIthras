import { CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLatestEndpointStatuses, useEndpoints } from "@/hooks/useDashboardData";
import { Skeleton } from "@/components/ui/skeleton";

interface ComplianceItem {
  name: string;
  status: "compliant" | "non-compliant" | "partial";
  percentage: number;
  description: string;
}

const statusIcons = {
  compliant: CheckCircle,
  "non-compliant": XCircle,
  partial: AlertCircle,
};

const statusColors = {
  compliant: "text-status-healthy",
  "non-compliant": "text-status-critical",
  partial: "text-status-warning",
};

const barColors = {
  compliant: "bg-status-healthy",
  "non-compliant": "bg-status-critical",
  partial: "bg-status-warning",
};

function getStatus(percentage: number): "compliant" | "non-compliant" | "partial" {
  if (percentage >= 100) return "compliant";
  if (percentage >= 70) return "partial";
  return "non-compliant";
}

export function ComplianceChart() {
  const { data: statuses, isLoading: statusesLoading } = useLatestEndpointStatuses();
  const { data: endpoints, isLoading: endpointsLoading } = useEndpoints();

  const isLoading = statusesLoading || endpointsLoading;
  const totalStatuses = statuses?.length || 0;
  const totalEndpoints = endpoints?.length || 0;

  // Calculate compliance percentages from real endpoint status data
  const calculatePercentage = (field: keyof typeof statuses[0], target: boolean = true) => {
    if (!statuses || statuses.length === 0) return 0;
    const compliant = statuses.filter(s => s[field] === target).length;
    return Math.round((compliant / statuses.length) * 100);
  };

  // Calculate signature compliance (age <= 1 day is compliant)
  const signatureCompliance = () => {
    if (!statuses || statuses.length === 0) return 0;
    const compliant = statuses.filter(s => 
      s.antivirus_signature_age !== null && s.antivirus_signature_age <= 1
    ).length;
    return Math.round((compliant / statuses.length) * 100);
  };

  // Calculate policy assignment compliance
  const policyCompliance = () => {
    if (!endpoints || endpoints.length === 0) return 0;
    const withPolicy = endpoints.filter(e => e.policy_id !== null).length;
    return Math.round((withPolicy / endpoints.length) * 100);
  };

  const complianceItems: ComplianceItem[] = totalStatuses === 0 ? [] : [
    { 
      name: "Real-time Protection", 
      percentage: calculatePercentage("realtime_protection_enabled"),
      status: getStatus(calculatePercentage("realtime_protection_enabled")),
      description: "Active malware scanning"
    },
    { 
      name: "Antivirus Enabled", 
      percentage: calculatePercentage("antivirus_enabled"),
      status: getStatus(calculatePercentage("antivirus_enabled")),
      description: "Core antivirus engine"
    },
    { 
      name: "Signature Updates", 
      percentage: signatureCompliance(),
      status: getStatus(signatureCompliance()),
      description: "Definitions updated within 24h"
    },
    { 
      name: "Behavior Monitoring", 
      percentage: calculatePercentage("behavior_monitor_enabled"),
      status: getStatus(calculatePercentage("behavior_monitor_enabled")),
      description: "Suspicious activity detection"
    },
    { 
      name: "Download Protection", 
      percentage: calculatePercentage("ioav_protection_enabled"),
      status: getStatus(calculatePercentage("ioav_protection_enabled")),
      description: "Internet download scanning"
    },
    { 
      name: "Policy Assigned", 
      percentage: policyCompliance(),
      status: getStatus(policyCompliance()),
      description: "Managed by security policy"
    },
  ];

  const overallCompliance = complianceItems.length > 0
    ? Math.round(complianceItems.reduce((acc, item) => acc + item.percentage, 0) / complianceItems.length)
    : 0;

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card shadow-card">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div>
            <h3 className="font-semibold text-foreground">Policy Compliance</h3>
            <p className="text-xs text-muted-foreground">
              Defender configuration status across endpoints
            </p>
          </div>
          <Skeleton className="h-8 w-16" />
        </div>
        <div className="space-y-4 p-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-2 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-card">
      <div className="flex items-center justify-between border-b border-border p-4">
        <div>
          <h3 className="font-semibold text-foreground">Policy Compliance</h3>
          <p className="text-xs text-muted-foreground">
            {totalStatuses === 0 
              ? "No endpoint status data available" 
              : `Defender configuration status across ${totalStatuses} endpoint${totalStatuses !== 1 ? 's' : ''}`
            }
          </p>
        </div>
        <div className="text-right">
          <span className={cn(
            "text-2xl font-bold",
            overallCompliance >= 80 ? "text-status-healthy" :
            overallCompliance >= 60 ? "text-status-warning" : "text-status-critical"
          )}>
            {overallCompliance}%
          </span>
          <p className="text-xs text-muted-foreground">Overall</p>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {complianceItems.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <p className="text-sm">No compliance data available</p>
            <p className="text-xs">Deploy agents to start monitoring</p>
          </div>
        ) : (
          complianceItems.map((item) => {
            const Icon = statusIcons[item.status];
            return (
              <div key={item.name} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className={cn("h-4 w-4", statusColors[item.status])} />
                    <div>
                      <span className="text-sm font-medium text-foreground">
                        {item.name}
                      </span>
                      <span className="ml-2 text-xs text-muted-foreground hidden sm:inline">
                        {item.description}
                      </span>
                    </div>
                  </div>
                  <span className={cn(
                    "text-sm font-medium",
                    statusColors[item.status]
                  )}>
                    {item.percentage}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-secondary">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-500",
                      barColors[item.status]
                    )}
                    style={{ width: `${item.percentage}%` }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
