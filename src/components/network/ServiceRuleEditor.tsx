import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useEndpointGroups } from "@/hooks/useEndpointGroups";
import {
  FirewallServiceRule,
  useCreateServiceRule,
  useUpdateServiceRule,
  useDeleteServiceRule,
  useFirewallPolicies,
  useCreateFirewallPolicy,
} from "@/hooks/useFirewall";
import { AlertTriangle, Search, ShieldAlert, Trash2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface ServiceRuleEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  groupName: string;
  service: {
    name: string;
    port: string;
    protocol: "tcp" | "udp" | "both";
    description: string;
  };
  existingRule?: FirewallServiceRule;
}

export function ServiceRuleEditor({
  open,
  onOpenChange,
  groupId,
  groupName,
  service,
  existingRule,
}: ServiceRuleEditorProps) {
  const { data: groups } = useEndpointGroups();
  const { data: policies } = useFirewallPolicies();
  const createPolicy = useCreateFirewallPolicy();
  const createRule = useCreateServiceRule();
  const updateRule = useUpdateServiceRule();
  const deleteRule = useDeleteServiceRule();

  const [action, setAction] = useState<"block" | "allow" | "allow_from_groups">(
    existingRule?.action || "block"
  );
  const [mode, setMode] = useState<"audit" | "enforce">(
    existingRule?.mode || "audit"
  );
  const [selectedGroups, setSelectedGroups] = useState<string[]>(
    existingRule?.allowed_source_groups || []
  );
  const [allowedIps, setAllowedIps] = useState<string>(
    existingRule?.allowed_source_ips?.join(", ") || ""
  );
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (existingRule) {
      setAction(existingRule.action);
      setMode(existingRule.mode);
      setSelectedGroups(existingRule.allowed_source_groups || []);
      setAllowedIps(existingRule.allowed_source_ips?.join(", ") || "");
    } else {
      setAction("block");
      setMode("audit");
      setSelectedGroups([]);
      setAllowedIps("");
    }
  }, [existingRule, open]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Get or create default policy
      let policyId = policies?.[0]?.id;
      if (!policyId) {
        const newPolicy = await createPolicy.mutateAsync({
          name: "Default Firewall Policy",
          description: "Auto-created default policy",
        });
        policyId = newPolicy.id;
      }

      const ruleData = {
        policy_id: policyId,
        endpoint_group_id: groupId,
        service_name: service.name,
        port: service.port,
        protocol: service.protocol,
        action,
        mode,
        allowed_source_groups: action === "allow_from_groups" ? selectedGroups : [],
        allowed_source_ips: allowedIps
          .split(",")
          .map((ip) => ip.trim())
          .filter(Boolean),
        enabled: true,
        order_priority: 0,
      };

      if (existingRule) {
        await updateRule.mutateAsync({ id: existingRule.id, ...ruleData });
      } else {
        await createRule.mutateAsync(ruleData);
      }

      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!existingRule) return;
    setIsSaving(true);
    try {
      await deleteRule.mutateAsync(existingRule.id);
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleGroup = (groupId: string) => {
    setSelectedGroups((prev) =>
      prev.includes(groupId)
        ? prev.filter((id) => id !== groupId)
        : [...prev, groupId]
    );
  };

  const otherGroups = groups?.filter((g) => g.id !== groupId) || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {service.name} Access for {groupName}
          </DialogTitle>
          <DialogDescription>
            Configure who can connect to {service.name} ({service.port}) on
            endpoints in the {groupName} group
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Access Type */}
          <div className="space-y-3">
            <Label>Access Policy</Label>
            <RadioGroup
              value={action}
              onValueChange={(v) => setAction(v as typeof action)}
              className="space-y-2"
            >
              <div
                className={cn(
                  "flex items-center space-x-3 p-3 rounded-lg border cursor-pointer transition-all",
                  action === "block"
                    ? "border-destructive/50 bg-destructive/10"
                    : "border-border hover:border-muted-foreground/50"
                )}
                onClick={() => setAction("block")}
              >
                <RadioGroupItem value="block" id="block" />
                <Label htmlFor="block" className="flex-1 cursor-pointer">
                  <div className="font-medium">Block All</div>
                  <div className="text-xs text-muted-foreground">
                    No connections allowed to this service
                  </div>
                </Label>
              </div>

              <div
                className={cn(
                  "flex items-center space-x-3 p-3 rounded-lg border cursor-pointer transition-all",
                  action === "allow_from_groups"
                    ? "border-blue-500/50 bg-blue-500/10"
                    : "border-border hover:border-muted-foreground/50"
                )}
                onClick={() => setAction("allow_from_groups")}
              >
                <RadioGroupItem value="allow_from_groups" id="allow_from_groups" />
                <Label htmlFor="allow_from_groups" className="flex-1 cursor-pointer">
                  <div className="font-medium">Allow from Specific Groups</div>
                  <div className="text-xs text-muted-foreground">
                    Only selected groups can connect
                  </div>
                </Label>
              </div>

              <div
                className={cn(
                  "flex items-center space-x-3 p-3 rounded-lg border cursor-pointer transition-all",
                  action === "allow"
                    ? "border-green-500/50 bg-green-500/10"
                    : "border-border hover:border-muted-foreground/50"
                )}
                onClick={() => setAction("allow")}
              >
                <RadioGroupItem value="allow" id="allow" />
                <Label htmlFor="allow" className="flex-1 cursor-pointer">
                  <div className="font-medium">Allow All</div>
                  <div className="text-xs text-muted-foreground">
                    Anyone can connect to this service
                  </div>
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Group Selector (if allow_from_groups) */}
          {action === "allow_from_groups" && (
            <div className="space-y-3">
              <Label>Allowed Source Groups</Label>
              {otherGroups.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No other groups available. Create more groups to use this option.
                </p>
              ) : (
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {otherGroups.map((group) => (
                    <div
                      key={group.id}
                      className={cn(
                        "flex items-center space-x-3 p-2 rounded-lg border cursor-pointer transition-all",
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
                      <div className="flex-1">
                        <div className="text-sm font-medium">{group.name}</div>
                        {group.description && (
                          <div className="text-xs text-muted-foreground">
                            {group.description}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* IP Allowlist */}
          {action !== "allow" && (
            <div className="space-y-2">
              <Label>Additional Allowed IPs (optional)</Label>
              <Input
                placeholder="e.g., 10.0.1.50, 192.168.1.0/24"
                value={allowedIps}
                onChange={(e) => setAllowedIps(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated IPs or CIDR ranges that can always connect
              </p>
            </div>
          )}

          {/* Mode Toggle */}
          {action !== "allow" && (
            <div className="space-y-3">
              <Label>Enforcement Mode</Label>
              <div
                className={cn(
                  "flex items-center justify-between p-4 rounded-lg border transition-all",
                  mode === "audit"
                    ? "border-amber-500/50 bg-amber-500/10"
                    : "border-green-500/50 bg-green-500/10"
                )}
              >
                <div className="flex items-center gap-3">
                  {mode === "audit" ? (
                    <Search className="h-5 w-5 text-amber-500" />
                  ) : (
                    <ShieldAlert className="h-5 w-5 text-green-500" />
                  )}
                  <div>
                    <div className="font-medium">
                      {mode === "audit" ? "Audit Mode" : "Enforce Mode"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {mode === "audit"
                        ? "Log connections but don't block them"
                        : "Actively block non-allowed connections"}
                    </div>
                  </div>
                </div>
                <Switch
                  checked={mode === "enforce"}
                  onCheckedChange={(checked) =>
                    setMode(checked ? "enforce" : "audit")
                  }
                />
              </div>

              {mode === "enforce" && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                  <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Enforce mode will actively block traffic. Consider using
                    Audit mode first to learn normal traffic patterns.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex justify-between sm:justify-between">
          <div>
            {existingRule && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={isSaving}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Delete Rule
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving..." : existingRule ? "Update Rule" : "Create Rule"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
