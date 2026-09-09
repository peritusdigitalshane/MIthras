import { cn } from "@/lib/utils";
import { SecurityRecommendation } from "@/hooks/useDashboardData";
import {
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
  ChevronRight,
  TrendingUp,
  AlertCircle,
  Info,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface SecurityScoreProps {
  score: number;
  endpointCount: number;
  recommendations?: SecurityRecommendation[];
  className?: string;
}

export function SecurityScore({ score, endpointCount, recommendations = [], className }: SecurityScoreProps) {
  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-status-healthy";
    if (score >= 60) return "text-status-warning";
    return "text-status-critical";
  };

  const getSeverityIcon = (severity: SecurityRecommendation["severity"]) => {
    switch (severity) {
      case "critical":
        return <ShieldAlert className="h-4 w-4 text-status-critical" />;
      case "high":
        return <AlertTriangle className="h-4 w-4 text-status-warning" />;
      case "medium":
        return <AlertCircle className="h-4 w-4 text-amber-500" />;
      case "low":
        return <Info className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getSeverityBadgeVariant = (severity: SecurityRecommendation["severity"]) => {
    switch (severity) {
      case "critical":
        return "destructive";
      case "high":
        return "default";
      case "medium":
        return "secondary";
      case "low":
        return "outline";
    }
  };

  const circumference = 2 * Math.PI * 45;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  const potentialScore = score + recommendations.reduce((acc, r) => acc + r.impact, 0);
  const maxPotentialScore = Math.min(potentialScore, 100);

  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border border-border bg-card shadow-card",
        className
      )}
    >
      {/* Score Section */}
      <div className="flex items-center gap-6 border-b border-border p-6">
        <div className="relative flex-shrink-0">
          <svg className="h-28 w-28 -rotate-90 transform">
            {/* Background circle */}
            <circle
              cx="56"
              cy="56"
              r="45"
              stroke="currentColor"
              strokeWidth="8"
              fill="none"
              className="text-secondary"
            />
            {/* Progress circle */}
            <circle
              cx="56"
              cy="56"
              r="45"
              stroke="url(#scoreGradient)"
              strokeWidth="8"
              fill="none"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className="transition-all duration-1000 ease-out"
            />
            <defs>
              <linearGradient id="scoreGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop
                  offset="0%"
                  className={cn("stop-color-current", getScoreColor(score))}
                  style={{ stopColor: "currentColor" }}
                />
                <stop
                  offset="100%"
                  className={cn("stop-color-current", getScoreColor(score))}
                  style={{ stopColor: "currentColor", opacity: 0.6 }}
                />
              </linearGradient>
            </defs>
          </svg>
          
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={cn("text-3xl font-bold", getScoreColor(score))}>
              {score}
            </span>
            <span className="text-xs text-muted-foreground">/ 100</span>
          </div>
        </div>

        <div className="flex-1">
          <h3 className="text-lg font-semibold text-foreground">Security Score</h3>
          <p className={cn("text-sm font-medium", getScoreColor(score))}>
            {score >= 80 ? "Excellent" : score >= 60 ? "Good" : "Needs Attention"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {endpointCount === 0 
              ? "No endpoints enrolled" 
              : `Based on ${endpointCount} endpoint${endpointCount !== 1 ? 's' : ''}`
            }
          </p>
          
          {recommendations.length > 0 && score < 100 && (
            <div className="mt-2 flex items-center gap-2 text-xs">
              <TrendingUp className="h-3.5 w-3.5 text-status-healthy" />
              <span className="text-muted-foreground">
                Potential: <span className="font-medium text-status-healthy">{maxPotentialScore}</span> with fixes
              </span>
            </div>
          )}
        </div>

        {score === 100 && (
          <ShieldCheck className="h-10 w-10 text-status-healthy" />
        )}
      </div>

      {/* Recommendations Section */}
      <div className="flex-1 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-medium text-foreground">
            Recommendations
          </h4>
          {recommendations.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {recommendations.length} action{recommendations.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>

        {recommendations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <ShieldCheck className="mb-2 h-8 w-8 text-status-healthy" />
            <p className="text-sm font-medium text-foreground">All clear!</p>
            <p className="text-xs text-muted-foreground">
              Your security posture is excellent
            </p>
          </div>
        ) : (
          <ScrollArea className="h-[280px] pr-3">
            <div className="space-y-3">
              {recommendations.map((rec) => (
                <div
                  key={rec.id}
                  className="group rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/50 hover:bg-accent/50"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">{getSeverityIcon(rec.severity)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {rec.title}
                        </span>
                        <Badge
                          variant={getSeverityBadgeVariant(rec.severity)}
                          className="text-[10px] px-1.5 py-0"
                        >
                          {rec.severity}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {rec.description}
                      </p>
                      <div className="mt-2 flex items-center justify-between">
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-muted-foreground">
                            <span className="font-medium text-foreground">{rec.affectedCount}</span> affected
                          </span>
                          <span className="text-status-healthy">
                            +{rec.impact} pts
                          </span>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </div>
                      <p className="mt-1.5 text-[11px] text-primary">
                        → {rec.action}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
