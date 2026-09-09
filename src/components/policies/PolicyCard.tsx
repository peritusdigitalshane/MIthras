import { Shield, MoreVertical, CheckCircle, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { DefenderPolicy, ASR_RULES, BASIC_PROTECTION_SETTINGS, ADVANCED_SETTINGS } from "@/lib/defender-settings";

interface PolicyCardProps {
  policy: DefenderPolicy;
  onEdit: (policy: DefenderPolicy) => void;
}

export function PolicyCard({ policy, onEdit }: PolicyCardProps) {
  // Count enabled settings
  const basicEnabled = BASIC_PROTECTION_SETTINGS.filter(
    (s) => policy[s.id as keyof DefenderPolicy] === true
  ).length;
  
  const advancedEnabled = ADVANCED_SETTINGS.filter(
    (s) => policy[s.id as keyof DefenderPolicy] === true
  ).length;
  
  const asrEnabled = ASR_RULES.filter(
    (r) => policy[r.id as keyof DefenderPolicy] === "enabled"
  ).length;
  
  const asrAudit = ASR_RULES.filter(
    (r) => policy[r.id as keyof DefenderPolicy] === "audit"
  ).length;

  const totalSettings = BASIC_PROTECTION_SETTINGS.length + ADVANCED_SETTINGS.length;
  const enabledSettings = basicEnabled + advancedEnabled;
  const protectionScore = Math.round((enabledSettings / totalSettings) * 100);

  return (
    <Card 
      className="border-border/40 hover:border-primary/40 transition-colors cursor-pointer"
      onClick={() => onEdit(policy)}
    >
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-base font-semibold">{policy.name}</CardTitle>
            {policy.description && (
              <p className="text-xs text-muted-foreground mt-0.5">{policy.description}</p>
            )}
          </div>
        </div>
        {policy.is_default && (
          <StatusBadge status="info" label="Default" />
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Protection Score */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Protection Score</span>
          <span className={`text-sm font-semibold ${
            protectionScore >= 80 ? "text-status-healthy" : 
            protectionScore >= 60 ? "text-status-warning" : "text-status-critical"
          }`}>
            {protectionScore}%
          </span>
        </div>

        {/* Settings Summary */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-status-healthy" />
            <span className="text-muted-foreground">
              {basicEnabled}/{BASIC_PROTECTION_SETTINGS.length} Basic
            </span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-status-healthy" />
            <span className="text-muted-foreground">
              {advancedEnabled}/{ADVANCED_SETTINGS.length} Advanced
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <span className="text-muted-foreground">
              {asrEnabled} ASR Enabled
            </span>
          </div>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-status-warning" />
            <span className="text-muted-foreground">
              {asrAudit} ASR Audit
            </span>
          </div>
        </div>

        {/* Cloud Settings */}
        <div className="pt-3 border-t border-border/40">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Cloud Block Level</span>
            <span className="font-medium">{policy.cloud_block_level}</span>
          </div>
          <div className="flex items-center justify-between text-xs mt-1">
            <span className="text-muted-foreground">MAPS Reporting</span>
            <span className="font-medium">{policy.maps_reporting}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
