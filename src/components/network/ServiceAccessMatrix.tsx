import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEndpointGroups } from "@/hooks/useEndpointGroups";
import { useFirewallServiceRules, COMMON_SERVICES, FirewallServiceRule } from "@/hooks/useFirewall";
import { cn } from "@/lib/utils";
import { Plus, LayoutTemplate, Search, ShieldAlert } from "lucide-react";
import { ServiceRuleEditor } from "./ServiceRuleEditor";
import { TemplateGallery } from "./TemplateGallery";
import { Skeleton } from "@/components/ui/skeleton";

type CellData = {
  groupId: string;
  groupName: string;
  service: typeof COMMON_SERVICES[number];
  rule?: FirewallServiceRule;
};

export function ServiceAccessMatrix() {
  const { data: groups, isLoading: groupsLoading } = useEndpointGroups();
  const { data: rules, isLoading: rulesLoading } = useFirewallServiceRules();
  const [selectedCell, setSelectedCell] = useState<CellData | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);

  const isLoading = groupsLoading || rulesLoading;

  // Find rule for a specific group and service
  const findRule = (groupId: string, serviceName: string) => {
    return rules?.find(
      (r) => r.endpoint_group_id === groupId && r.service_name === serviceName
    );
  };

  // Get cell styling based on rule
  const getCellStyle = (rule?: FirewallServiceRule) => {
    if (!rule) {
      return "bg-muted/30 text-muted-foreground hover:bg-muted/50";
    }

    switch (rule.action) {
      case "block":
        return "bg-destructive/20 text-destructive hover:bg-destructive/30 border-destructive/30";
      case "allow":
        return "bg-green-500/20 text-green-600 dark:text-green-400 hover:bg-green-500/30 border-green-500/30";
      case "allow_from_groups":
        return "bg-blue-500/20 text-blue-600 dark:text-blue-400 hover:bg-blue-500/30 border-blue-500/30";
      default:
        return "bg-muted/30 text-muted-foreground hover:bg-muted/50";
    }
  };

  // Get action label
  const getActionLabel = (rule?: FirewallServiceRule) => {
    if (!rule) return "No Rule";

    switch (rule.action) {
      case "block":
        return "Block All";
      case "allow":
        return "Allow All";
      case "allow_from_groups":
        return `${rule.allowed_source_groups?.length || 0} Groups`;
      default:
        return "No Rule";
    }
  };

  // Get mode badge
  const getModeBadge = (rule?: FirewallServiceRule) => {
    if (!rule || rule.action === "allow") return null;

    return rule.mode === "audit" ? (
      <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30">
        <Search className="h-2.5 w-2.5 mr-0.5" />
        Audit
      </Badge>
    ) : (
      <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30">
        <ShieldAlert className="h-2.5 w-2.5 mr-0.5" />
        Enforce
      </Badge>
    );
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-96 mt-2" />
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!groups?.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Service Access Matrix</CardTitle>
          <CardDescription>
            Create endpoint groups first to configure firewall policies
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <ShieldAlert className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">
              No endpoint groups found. Create groups to start configuring firewall rules.
            </p>
            <Button variant="outline" asChild>
              <a href="/groups">Go to Groups</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              Service Access Matrix
            </CardTitle>
            <CardDescription>
              Click any cell to configure which sources can access that service on endpoints in the group
            </CardDescription>
          </div>
          <Button onClick={() => setShowTemplates(true)} variant="outline" className="gap-2">
            <LayoutTemplate className="h-4 w-4" />
            Apply Template
          </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="p-2 text-left text-sm font-medium text-muted-foreground border-b border-border min-w-[160px]">
                    Endpoint Group
                  </th>
                  {COMMON_SERVICES.map((service) => (
                    <th
                      key={service.name}
                      className="p-2 text-center text-sm font-medium text-muted-foreground border-b border-border min-w-[120px]"
                    >
                      <div>{service.name}</div>
                      <div className="text-xs font-normal text-muted-foreground/70">
                        {service.port}
                      </div>
                    </th>
                  ))}
                  <th className="p-2 text-center text-sm font-medium text-muted-foreground border-b border-border min-w-[80px]">
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
                      <Plus className="h-3 w-3 mr-1" />
                      Custom
                    </Button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <tr key={group.id} className="hover:bg-muted/20">
                    <td className="p-2 border-b border-border">
                      <div className="font-medium text-sm">{group.name}</div>
                      {group.description && (
                        <div className="text-xs text-muted-foreground truncate max-w-[150px]">
                          {group.description}
                        </div>
                      )}
                    </td>
                    {COMMON_SERVICES.map((service) => {
                      const rule = findRule(group.id, service.name);
                      return (
                        <td key={service.name} className="p-1 border-b border-border">
                          <button
                            onClick={() =>
                              setSelectedCell({
                                groupId: group.id,
                                groupName: group.name,
                                service,
                                rule,
                              })
                            }
                            className={cn(
                              "w-full p-2 rounded-lg border transition-all cursor-pointer",
                              "flex flex-col items-center justify-center gap-1 min-h-[60px]",
                              getCellStyle(rule)
                            )}
                          >
                            <span className="text-xs font-medium">
                              {getActionLabel(rule)}
                            </span>
                            {getModeBadge(rule)}
                          </button>
                        </td>
                      );
                    })}
                    <td className="p-1 border-b border-border">
                      <button
                        className="w-full p-2 rounded-lg border border-dashed border-muted-foreground/30 
                          text-muted-foreground hover:border-primary hover:text-primary
                          flex items-center justify-center min-h-[60px] transition-all"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div className="mt-6 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-destructive/20 border border-destructive/30" />
              <span>Block All</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-blue-500/20 border border-blue-500/30" />
              <span>Allow from Groups</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-green-500/20 border border-green-500/30" />
              <span>Allow All</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-muted/30 border border-muted" />
              <span>No Rule</span>
            </div>
            <div className="border-l border-border pl-4 flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 bg-amber-500/10 text-amber-600 border-amber-500/30">
                <Search className="h-2.5 w-2.5 mr-0.5" />
                Audit
              </Badge>
              <span>Logging only</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 bg-green-500/10 text-green-600 border-green-500/30">
                <ShieldAlert className="h-2.5 w-2.5 mr-0.5" />
                Enforce
              </Badge>
              <span>Actively blocking</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Rule Editor Dialog */}
      {selectedCell && (
        <ServiceRuleEditor
          open={!!selectedCell}
          onOpenChange={(open) => !open && setSelectedCell(null)}
          groupId={selectedCell.groupId}
          groupName={selectedCell.groupName}
          service={selectedCell.service}
          existingRule={selectedCell.rule}
        />
      )}

      {/* Template Gallery Dialog */}
      <TemplateGallery
        open={showTemplates}
        onOpenChange={setShowTemplates}
      />
    </>
  );
}
