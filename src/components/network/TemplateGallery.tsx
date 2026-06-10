import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useFirewallTemplates, FirewallTemplate, useFirewallPolicies, useCreateFirewallPolicy } from "@/hooks/useFirewall";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useQueryClient } from "@tanstack/react-query";
import { useEndpointGroups } from "@/hooks/useEndpointGroups";
import { useState } from "react";
import { 
  Shield, 
  Lock, 
  FileCheck, 
  ArrowRight, 
  Search, 
  ShieldAlert,
  CheckCircle,
  Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface TemplateGalleryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const categoryIcons = {
  "lateral-movement": Shield,
  lockdown: Lock,
  compliance: FileCheck,
  security: Shield,
};

const categoryColors = {
  "lateral-movement": "text-red-500 bg-red-500/10",
  lockdown: "text-amber-500 bg-amber-500/10",
  compliance: "text-blue-500 bg-blue-500/10",
  security: "text-green-500 bg-green-500/10",
};

export function TemplateGallery({ open, onOpenChange }: TemplateGalleryProps) {
  const { data: templates, isLoading } = useFirewallTemplates();
  const { data: groups } = useEndpointGroups();
  const { data: policies } = useFirewallPolicies();
  const createPolicy = useCreateFirewallPolicy();
  const { currentOrganization } = useTenant();
  const { toast } = useToast();
  const qc = useQueryClient();
  
  const [selectedTemplate, setSelectedTemplate] = useState<FirewallTemplate | null>(null);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [deployMode, setDeployMode] = useState<"audit" | "enforce">("audit");
  const [isDeploying, setIsDeploying] = useState(false);

  const handleSelectTemplate = (template: FirewallTemplate) => {
    setSelectedTemplate(template);
    setSelectedGroups(groups?.map((g) => g.id) || []);
    setDeployMode(template.default_mode);
  };

  const toggleGroup = (groupId: string) => {
    setSelectedGroups((prev) =>
      prev.includes(groupId)
        ? prev.filter((id) => id !== groupId)
        : [...prev, groupId]
    );
  };

  const handleDeploy = async () => {
    if (!selectedTemplate || selectedGroups.length === 0 || !currentOrganization?.id) return;

    setIsDeploying(true);
    try {
      // Find the org's default firewall policy; if there's none, create one.
      // The template's rules attach to this policy via policy_id.
      let policyId: string | undefined = policies?.find((p) => p.is_default)?.id ?? policies?.[0]?.id;
      if (!policyId) {
        const newPolicy = await createPolicy.mutateAsync({
          name: "Default",
          description: "Auto-created when deploying first firewall template.",
        });
        policyId = newPolicy.id;
      }

      // Fan out: one row per (group × template_rule). Skip the (group, service,
      // port, protocol) pairs that already exist so re-deploys are idempotent.
      const { data: existing } = await supabase
        .from("firewall_service_rules")
        .select("endpoint_group_id, service_name, port, protocol")
        .in("endpoint_group_id", selectedGroups);
      const dupKey = (gid: string, svc: string, port: string, proto: string) =>
        `${gid}|${svc}|${port}|${proto}`;
      const existingSet = new Set(
        (existing ?? []).map((r) =>
          dupKey(String(r.endpoint_group_id), String(r.service_name), String(r.port), String(r.protocol)),
        ),
      );

      const rows: Array<Record<string, unknown>> = [];
      for (const groupId of selectedGroups) {
        for (const tr of selectedTemplate.rules_json ?? []) {
          if (existingSet.has(dupKey(groupId, String(tr.service_name), String(tr.port), String(tr.protocol)))) continue;
          rows.push({
            policy_id: policyId,
            endpoint_group_id: groupId,
            service_name: tr.service_name,
            port: String(tr.port),
            protocol: tr.protocol,
            action: tr.action ?? "block",
            mode: deployMode,
            enabled: true,
            order_priority: 100,
          });
        }
      }

      if (rows.length === 0) {
        toast({
          title: "Nothing to deploy",
          description: "Every rule in this template is already present on the selected groups.",
        });
        return;
      }

      const { error } = await supabase.from("firewall_service_rules").insert(rows);
      if (error) throw new Error(error.message);

      qc.invalidateQueries({ queryKey: ["firewall-service-rules"] });
      qc.invalidateQueries({ queryKey: ["microseg-rules"] });

      toast({
        title: "Template Applied",
        description: `Created ${rows.length} rule${rows.length === 1 ? "" : "s"} across ${selectedGroups.length} group${selectedGroups.length === 1 ? "" : "s"} in ${deployMode} mode.`,
      });

      onOpenChange(false);
      setSelectedTemplate(null);
    } catch (e) {
      toast({
        title: "Deploy failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsDeploying(false);
    }
  };

  const handleBack = () => {
    setSelectedTemplate(null);
    setSelectedGroups([]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {selectedTemplate ? selectedTemplate.name : "Apply Firewall Template"}
          </DialogTitle>
          <DialogDescription>
            {selectedTemplate
              ? "Configure and deploy this template to your endpoint groups"
              : "Choose a pre-built template to quickly configure firewall rules"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4">
          {isLoading ? (
            <div className="grid grid-cols-1 gap-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-32 w-full" />
              ))}
            </div>
          ) : selectedTemplate ? (
            // Template Configuration View
            <div className="space-y-6">
              {/* Template Summary */}
              <div className="p-4 rounded-lg bg-muted/50 border">
                <p className="text-sm text-muted-foreground mb-3">
                  {selectedTemplate.description}
                </p>
                <div className="flex flex-wrap gap-2">
                  {selectedTemplate.rules_json.map((rule, i) => (
                    <Badge key={i} variant="outline" className="text-xs">
                      {rule.service_name}: {rule.action}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Group Selection */}
              <div className="space-y-3">
                <Label>Apply to Groups</Label>
                <div className="grid grid-cols-2 gap-2 max-h-[200px] overflow-y-auto">
                  {groups?.map((group) => (
                    <div
                      key={group.id}
                      className={cn(
                        "flex items-center space-x-3 p-3 rounded-lg border cursor-pointer transition-all",
                        selectedGroups.includes(group.id)
                          ? "border-primary bg-primary/10"
                          : "border-border hover:border-muted-foreground/50"
                      )}
                      onClick={() => toggleGroup(group.id)}
                    >
                      <Checkbox
                        checked={selectedGroups.includes(group.id)}
                        onCheckedChange={() => toggleGroup(group.id)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{group.name}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedGroups(groups?.map((g) => g.id) || [])}
                  >
                    Select All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedGroups([])}
                  >
                    Clear All
                  </Button>
                </div>
              </div>

              {/* Mode Selection */}
              <div className="space-y-3">
                <Label>Deployment Mode</Label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    className={cn(
                      "p-4 rounded-lg border text-left transition-all",
                      deployMode === "audit"
                        ? "border-amber-500/50 bg-amber-500/10"
                        : "border-border hover:border-muted-foreground/50"
                    )}
                    onClick={() => setDeployMode("audit")}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Search className="h-4 w-4 text-amber-500" />
                      <span className="font-medium">Audit Mode</span>
                      <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-600 border-green-500/30">
                        Recommended
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Log matching traffic without blocking. Learn patterns first.
                    </p>
                  </button>

                  <button
                    className={cn(
                      "p-4 rounded-lg border text-left transition-all",
                      deployMode === "enforce"
                        ? "border-green-500/50 bg-green-500/10"
                        : "border-border hover:border-muted-foreground/50"
                    )}
                    onClick={() => setDeployMode("enforce")}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <ShieldAlert className="h-4 w-4 text-green-500" />
                      <span className="font-medium">Enforce Mode</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Actively block non-allowed traffic immediately.
                    </p>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            // Template List View
            <div className="grid grid-cols-1 gap-4">
              {templates?.map((template) => {
                const Icon = categoryIcons[template.category] || Shield;
                const colorClass = categoryColors[template.category] || categoryColors.security;

                return (
                  <Card
                    key={template.id}
                    className="cursor-pointer hover:border-primary transition-all"
                    onClick={() => handleSelectTemplate(template)}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className={cn("p-2 rounded-lg", colorClass)}>
                            <Icon className="h-5 w-5" />
                          </div>
                          <div>
                            <CardTitle className="text-base">{template.name}</CardTitle>
                            <Badge variant="outline" className="text-[10px] mt-1">
                              {template.category}
                            </Badge>
                          </div>
                        </div>
                        <ArrowRight className="h-5 w-5 text-muted-foreground" />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <CardDescription className="mb-3">
                        {template.description}
                      </CardDescription>
                      <div className="flex flex-wrap gap-1.5">
                        {template.rules_json.slice(0, 4).map((rule, i) => (
                          <Badge key={i} variant="secondary" className="text-xs">
                            {rule.service_name}
                          </Badge>
                        ))}
                        {template.rules_json.length > 4 && (
                          <Badge variant="secondary" className="text-xs">
                            +{template.rules_json.length - 4} more
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        {selectedTemplate && (
          <div className="flex justify-between pt-4 border-t">
            <Button variant="outline" onClick={handleBack}>
              Back
            </Button>
            <Button
              onClick={handleDeploy}
              disabled={isDeploying || selectedGroups.length === 0}
            >
              {isDeploying ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deploying...
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Deploy to {selectedGroups.length} Group(s)
                </>
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
