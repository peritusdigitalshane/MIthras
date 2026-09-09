import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles, RefreshCw, AlertTriangle, ShieldCheck, ShieldAlert, Info, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";

interface AIRecommendation {
  title: string;
  description: string;
  priority: "critical" | "high" | "medium" | "low";
  action: string;
  impact: string;
}

interface AIResponse {
  overall_assessment: string;
  risk_level: "critical" | "high" | "medium" | "low";
  recommendations: AIRecommendation[];
  positive_findings: string[];
}

const Recommendations = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [aiData, setAiData] = useState<AIResponse | null>(null);
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { currentOrganization, isSuperAdmin } = useTenant();
  const { toast } = useToast();

  const generateRecommendations = async () => {
    if (!currentOrganization?.id) {
      toast({
        title: "Error",
        description: "No organization selected",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-security-advisor`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ organization_id: currentOrganization.id }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to generate recommendations");
      }

      setAiData(result.data);
      setModelUsed(result.model_used);
      
      toast({
        title: "Recommendations Generated",
        description: isSuperAdmin
          ? `Analysis complete using ${result.model_used}`
          : `Analysis complete`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate recommendations";
      setError(message);
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case "critical":
        return <ShieldAlert className="h-4 w-4 text-status-critical" />;
      case "high":
        return <AlertTriangle className="h-4 w-4 text-status-warning" />;
      case "medium":
        return <Info className="h-4 w-4 text-amber-500" />;
      default:
        return <Info className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getPriorityBadgeVariant = (priority: string) => {
    switch (priority) {
      case "critical":
        return "destructive" as const;
      case "high":
        return "default" as const;
      case "medium":
        return "secondary" as const;
      default:
        return "outline" as const;
    }
  };

  const getRiskLevelColor = (level: string) => {
    switch (level) {
      case "critical":
        return "text-status-critical";
      case "high":
        return "text-status-warning";
      case "medium":
        return "text-amber-500";
      default:
        return "text-status-healthy";
    }
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">AI Security Advisor</h1>
            <p className="text-muted-foreground">
              AI-powered recommendations to improve your security posture
            </p>
          </div>
          <Button onClick={generateRecommendations} disabled={isLoading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            {isLoading ? "Analyzing..." : "Generate Recommendations"}
          </Button>
        </div>

        {error && (
          <Card className="border-destructive">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                <p>{error}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {!aiData && !error && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                AI Recommendations
              </CardTitle>
              <CardDescription>
                Click "Generate Recommendations" to analyze your security posture
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Sparkles className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">
                  Ready to Analyze
                </h3>
                <p className="text-sm text-muted-foreground max-w-md">
                  The AI Security Advisor will analyze your endpoint security data, 
                  threat patterns, and compliance status to provide actionable recommendations.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {aiData && (
          <div className="space-y-6">
            {/* Overall Assessment */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-primary" />
                    Security Assessment
                  </CardTitle>
                  <Badge variant={getPriorityBadgeVariant(aiData.risk_level)}>
                    {aiData.risk_level.toUpperCase()} RISK
                  </Badge>
                </div>
                {modelUsed && isSuperAdmin && (
                  <CardDescription>Analyzed using {modelUsed}</CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <p className={`text-lg font-medium ${getRiskLevelColor(aiData.risk_level)}`}>
                  {aiData.overall_assessment}
                </p>
              </CardContent>
            </Card>

            {/* Recommendations */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-status-warning" />
                  Recommendations
                </CardTitle>
                <CardDescription>
                  {aiData.recommendations.length} actionable items to improve security
                </CardDescription>
              </CardHeader>
              <CardContent>
                {aiData.recommendations.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <ShieldCheck className="h-10 w-10 text-status-healthy mb-3" />
                    <p className="text-foreground font-medium">No issues found!</p>
                    <p className="text-sm text-muted-foreground">
                      Your security posture looks good.
                    </p>
                  </div>
                ) : (
                  <ScrollArea className="h-[400px] pr-4">
                    <div className="space-y-4">
                      {aiData.recommendations.map((rec, index) => (
                        <div
                          key={index}
                          className="rounded-lg border border-border bg-background p-4 space-y-3"
                        >
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5">{getPriorityIcon(rec.priority)}</div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-foreground">
                                  {rec.title}
                                </span>
                                <Badge variant={getPriorityBadgeVariant(rec.priority)}>
                                  {rec.priority}
                                </Badge>
                              </div>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {rec.description}
                              </p>
                            </div>
                          </div>
                          
                          <div className="ml-7 space-y-2">
                            <div className="rounded-md bg-primary/5 p-3">
                              <p className="text-xs font-medium text-primary mb-1">Action:</p>
                              <p className="text-sm text-foreground">{rec.action}</p>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              <span className="font-medium">Impact:</span> {rec.impact}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>

            {/* Positive Findings */}
            {aiData.positive_findings.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-status-healthy" />
                    What's Working Well
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {aiData.positive_findings.map((finding, index) => (
                      <li key={index} className="flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 text-status-healthy mt-0.5 flex-shrink-0" />
                        <span className="text-sm text-foreground">{finding}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </MainLayout>
  );
};

export default Recommendations;
