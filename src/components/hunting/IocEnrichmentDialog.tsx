import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Shield, FileType, Calendar, Hash, AlertTriangle, CheckCircle } from "lucide-react";
import { format } from "date-fns";

interface VTEnrichmentData {
  detection_ratio: string;
  malicious_count: number;
  total_engines: number;
  threat_names: string[];
  file_type: string | null;
  file_size: number | null;
  meaningful_name: string | null;
  first_submission_date: string | null;
  last_analysis_date: string | null;
  sha256: string | null;
  sha1: string | null;
  md5: string | null;
  raw_stats: {
    malicious: number;
    suspicious: number;
    harmless: number;
    undetected: number;
    timeout: number;
  };
}

interface IocEnrichmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  iocValue: string;
  enrichment: VTEnrichmentData | null;
  enrichedAt: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function getDetectionBadgeStyle(maliciousCount: number, totalEngines: number) {
  const ratio = maliciousCount / totalEngines;
  if (maliciousCount === 0) {
    return "bg-green-500/10 text-green-500 border-green-500/20";
  }
  if (ratio < 0.1) {
    return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
  }
  return "bg-red-500/10 text-red-500 border-red-500/20";
}

export function IocEnrichmentDialog({
  open,
  onOpenChange,
  iocValue,
  enrichment,
  enrichedAt,
}: IocEnrichmentDialogProps) {
  if (!enrichment) return null;

  const { malicious_count, total_engines, raw_stats } = enrichment;
  const isClean = malicious_count === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            VirusTotal Analysis
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh]">
          <div className="space-y-6 pr-4">
            {/* Detection Summary */}
            <div className="rounded-lg border p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {isClean ? (
                    <CheckCircle className="h-8 w-8 text-green-500" />
                  ) : (
                    <AlertTriangle className="h-8 w-8 text-red-500" />
                  )}
                  <div>
                    <p className="font-semibold text-lg">
                      {isClean ? "No threats detected" : `${malicious_count} security vendors flagged this file`}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {enrichment.detection_ratio} engines detected this file
                    </p>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={getDetectionBadgeStyle(malicious_count, total_engines)}
                >
                  {enrichment.detection_ratio}
                </Badge>
              </div>

              {/* Stats breakdown */}
              <div className="grid grid-cols-5 gap-2 text-center text-sm">
                <div className="rounded bg-red-500/10 p-2">
                  <p className="font-semibold text-red-500">{raw_stats.malicious}</p>
                  <p className="text-xs text-muted-foreground">Malicious</p>
                </div>
                <div className="rounded bg-orange-500/10 p-2">
                  <p className="font-semibold text-orange-500">{raw_stats.suspicious}</p>
                  <p className="text-xs text-muted-foreground">Suspicious</p>
                </div>
                <div className="rounded bg-green-500/10 p-2">
                  <p className="font-semibold text-green-500">{raw_stats.harmless}</p>
                  <p className="text-xs text-muted-foreground">Harmless</p>
                </div>
                <div className="rounded bg-muted p-2">
                  <p className="font-semibold">{raw_stats.undetected}</p>
                  <p className="text-xs text-muted-foreground">Undetected</p>
                </div>
                <div className="rounded bg-muted p-2">
                  <p className="font-semibold">{raw_stats.timeout}</p>
                  <p className="text-xs text-muted-foreground">Timeout</p>
                </div>
              </div>
            </div>

            {/* Threat Names */}
            {enrichment.threat_names.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-medium text-sm">Detected Threat Names</h4>
                <div className="flex flex-wrap gap-2">
                  {enrichment.threat_names.map((name, i) => (
                    <Badge key={i} variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20">
                      {name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <Separator />

            {/* File Information */}
            <div className="space-y-3">
              <h4 className="font-medium text-sm">File Information</h4>
              <div className="grid gap-3 text-sm">
                {enrichment.meaningful_name && (
                  <div className="flex items-center gap-2">
                    <FileType className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Name:</span>
                    <span className="font-mono">{enrichment.meaningful_name}</span>
                  </div>
                )}
                {enrichment.file_type && (
                  <div className="flex items-center gap-2">
                    <FileType className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Type:</span>
                    <span>{enrichment.file_type}</span>
                  </div>
                )}
                {enrichment.file_size && (
                  <div className="flex items-center gap-2">
                    <FileType className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Size:</span>
                    <span>{formatBytes(enrichment.file_size)}</span>
                  </div>
                )}
              </div>
            </div>

            <Separator />

            {/* Hashes */}
            <div className="space-y-3">
              <h4 className="font-medium text-sm">File Hashes</h4>
              <div className="space-y-2 text-sm">
                {enrichment.sha256 && (
                  <div className="flex items-start gap-2">
                    <Hash className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div>
                      <span className="text-muted-foreground">SHA256:</span>
                      <p className="font-mono text-xs break-all">{enrichment.sha256}</p>
                    </div>
                  </div>
                )}
                {enrichment.sha1 && (
                  <div className="flex items-start gap-2">
                    <Hash className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div>
                      <span className="text-muted-foreground">SHA1:</span>
                      <p className="font-mono text-xs break-all">{enrichment.sha1}</p>
                    </div>
                  </div>
                )}
                {enrichment.md5 && (
                  <div className="flex items-start gap-2">
                    <Hash className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div>
                      <span className="text-muted-foreground">MD5:</span>
                      <p className="font-mono text-xs break-all">{enrichment.md5}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <Separator />

            {/* Dates */}
            <div className="space-y-3">
              <h4 className="font-medium text-sm">Analysis Dates</h4>
              <div className="grid gap-2 text-sm">
                {enrichment.first_submission_date && (
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">First seen:</span>
                    <span>{format(new Date(enrichment.first_submission_date), "PPP")}</span>
                  </div>
                )}
                {enrichment.last_analysis_date && (
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Last analyzed:</span>
                    <span>{format(new Date(enrichment.last_analysis_date), "PPP")}</span>
                  </div>
                )}
                {enrichedAt && (
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Enriched:</span>
                    <span>{format(new Date(enrichedAt), "PPP p")}</span>
                  </div>
                )}
              </div>
            </div>

            {/* IOC Value */}
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground mb-1">Queried Hash</p>
              <p className="font-mono text-xs break-all">{iocValue}</p>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
