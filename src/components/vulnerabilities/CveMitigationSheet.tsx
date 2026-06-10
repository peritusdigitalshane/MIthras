import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, ExternalLink, ShieldCheck, CheckCircle, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";

interface Finding {
  id: string;
  cve_id: string;
  severity: string;
  cvss_score: number | null;
  affected_software: string;
  affected_version: string | null;
  description: string | null;
  endpoint_id?: string | null;
  endpoints?: { hostname: string } | null;
}

interface ProtectionAction {
  action_type: string;
  description: string;
  setting_key: string;
  setting_value: any;
  applied: boolean;
}

interface CveMitigationSheetProps {
  finding: Finding | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId?: string;
}

export function CveMitigationSheet({
  finding,
  open,
  onOpenChange,
  organizationId,
}: CveMitigationSheetProps) {
  const [advice, setAdvice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isProtecting, setIsProtecting] = useState(false);
  const [protectionResult, setProtectionResult] = useState<{
    actions: ProtectionAction[];
    summary: string;
    errors?: string[];
  } | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const fetchAdvice = async () => {
    if (!finding) return;
    setIsLoading(true);
    setAdvice(null);

    try {
      const { data, error } = await supabase.functions.invoke(
        "cve-mitigation-advisor",
        {
          body: {
            cve_id: finding.cve_id,
            severity: finding.severity,
            cvss_score: finding.cvss_score,
            affected_software: finding.affected_software,
            affected_version: finding.affected_version,
            description: finding.description,
            hostname: (finding.endpoints as any)?.hostname || "Unknown",
            organization_id: finding.organization_id,
          },
        }
      );

      if (error) throw error;

      if (data?.error) {
        toast({
          title: "AI Advisor Error",
          description: data.error,
          variant: "destructive",
        });
        return;
      }

      setAdvice(data.advice);
    } catch (err: any) {
      toast({
        title: "Failed to get advice",
        description: err.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAutoProtect = async () => {
    if (!finding || !organizationId) return;
    setIsProtecting(true);
    setProtectionResult(null);

    try {
      const { data, error } = await supabase.functions.invoke(
        "cve-auto-protect",
        {
          body: {
            cve_id: finding.cve_id,
            severity: finding.severity,
            cvss_score: finding.cvss_score,
            affected_software: finding.affected_software,
            affected_version: finding.affected_version,
            description: finding.description,
            endpoint_id: finding.endpoint_id,
            organization_id: organizationId,
            finding_id: finding.id,
          },
        }
      );

      if (error) throw error;

      if (data?.error) {
        toast({
          title: "Auto-Protect Error",
          description: data.error,
          variant: "destructive",
        });
        return;
      }

      setProtectionResult({
        actions: data.actions,
        summary: data.summary,
        errors: data.errors,
      });

      toast({
        title: "Protection Applied",
        description: data.summary,
      });

      // Refresh policies and findings
      queryClient.invalidateQueries({ queryKey: ["policies"] });
      queryClient.invalidateQueries({ queryKey: ["vulnerability-findings"] });
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
    } catch (err: any) {
      toast({
        title: "Auto-protect failed",
        description: err.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsProtecting(false);
    }
  };

  const handleOpenChange = (value: boolean) => {
    onOpenChange(value);
    if (value && !advice && !isLoading) {
      fetchAdvice();
    }
    if (!value) {
      setAdvice(null);
      setProtectionResult(null);
    }
  };

  const severityColors: Record<string, string> = {
    critical: "bg-red-500/10 text-red-500 border-red-500/20",
    high: "bg-orange-500/10 text-orange-500 border-orange-500/20",
    medium: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    low: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        {finding && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                AI Mitigation Advice
              </SheetTitle>
              <SheetDescription className="space-y-2">
                <div className="flex items-center gap-2 mt-2">
                  <a
                    href={`https://nvd.nist.gov/vuln/detail/${finding.cve_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-sm text-primary hover:underline flex items-center gap-1"
                  >
                    {finding.cve_id}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  <Badge
                    variant="outline"
                    className={severityColors[finding.severity] || ""}
                  >
                    {finding.severity}
                  </Badge>
                  {finding.cvss_score !== null && (
                    <span className="font-mono text-xs text-muted-foreground">
                      CVSS {finding.cvss_score}
                    </span>
                  )}
                </div>
                <p className="text-sm">
                  {finding.affected_software}
                  {finding.affected_version
                    ? ` v${finding.affected_version}`
                    : ""}
                </p>
              </SheetDescription>
            </SheetHeader>

            {/* Auto-Protect Button */}
            {!protectionResult && (
              <div className="mt-4 p-4 rounded-lg border border-primary/20 bg-primary/5">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="h-5 w-5 text-primary mt-0.5" />
                  <div className="flex-1">
                    <h4 className="text-sm font-semibold">One-Click Protection</h4>
                    <p className="text-xs text-muted-foreground mt-1">
                      Automatically configure Defender policies, ASR rules, and update settings across all your policies to protect against this CVE.
                    </p>
                    <Button
                      className="mt-3"
                      size="sm"
                      onClick={handleAutoProtect}
                      disabled={isProtecting || !organizationId}
                    >
                      {isProtecting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <ShieldCheck className="mr-2 h-4 w-4" />
                      )}
                      {isProtecting ? "Applying Protections…" : "Protect Against This"}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Protection Result */}
            {protectionResult && (
              <div className="mt-4 space-y-3">
                <div className="p-3 rounded-lg border border-green-500/20 bg-green-500/5">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span className="text-sm font-semibold text-green-600 dark:text-green-400">
                      {protectionResult.summary}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="text-sm font-semibold">Actions Applied:</h4>
                  {protectionResult.actions.map((action, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 p-2 rounded border text-sm"
                    >
                      {action.applied ? (
                        <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                      )}
                      <div>
                        <p className="font-medium">{action.description}</p>
                        <p className="text-xs text-muted-foreground">
                          {action.action_type}: {action.setting_key} = {String(action.setting_value)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {protectionResult.errors && protectionResult.errors.length > 0 && (
                  <div className="p-3 rounded-lg border border-red-500/20 bg-red-500/5">
                    <p className="text-xs font-semibold text-red-500 mb-1">Errors:</p>
                    {protectionResult.errors.map((err, i) => (
                      <p key={i} className="text-xs text-red-400">{err}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="mt-6">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">
                    Analyzing CVE and generating platform-specific advice…
                  </p>
                </div>
              ) : advice ? (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{advice}</ReactMarkdown>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <p className="text-sm text-muted-foreground">
                    No advice loaded.
                  </p>
                  <Button onClick={fetchAdvice}>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Get AI Advice
                  </Button>
                </div>
              )}

              {advice && (
                <div className="mt-4 pt-4 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchAdvice}
                    disabled={isLoading}
                  >
                    <Sparkles className="mr-2 h-4 w-4" />
                    Regenerate
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
