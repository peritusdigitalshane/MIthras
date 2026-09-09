import { Edit, Trash2, Copy, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { GpoPolicy } from "@/lib/gpo-settings";

interface GpoPolicyCardProps {
  policy: GpoPolicy;
  onEdit: (policy: GpoPolicy) => void;
  onDelete: (policy: GpoPolicy) => void;
  onDuplicate: (policy: GpoPolicy) => void;
}

export function GpoPolicyCard({ policy, onEdit, onDelete, onDuplicate }: GpoPolicyCardProps) {
  const highlights = [
    { label: "Password Length", value: `${policy.password_min_length} chars` },
    { label: "Lockout", value: policy.lockout_threshold > 0 ? `${policy.lockout_threshold} attempts` : "Disabled" },
    { label: "Password Age", value: `${policy.password_max_age_days}d` },
    { label: "Remote Desktop", value: policy.remote_desktop_enabled ? "On" : "Off" },
  ];

  const restrictionCount = [
    policy.disable_registry_tools,
    policy.disable_task_manager,
    policy.disable_cmd_prompt,
    policy.disable_run_command,
    policy.disable_control_panel,
    policy.disable_store_apps,
    policy.disable_onedrive,
  ].filter(Boolean).length;

  return (
    <Card className="group hover:border-primary/30 transition-colors">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">{policy.name}</CardTitle>
              {policy.description && (
                <p className="text-xs text-muted-foreground mt-0.5">{policy.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onDuplicate(policy)}>
              <Copy className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(policy)}>
              <Edit className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => onDelete(policy)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex gap-2 mt-2">
          {policy.is_default && <Badge variant="secondary">Default</Badge>}
          {policy.password_complexity_enabled && <Badge variant="outline">Complexity</Badge>}
          {restrictionCount > 0 && <Badge variant="outline">{restrictionCount} Restrictions</Badge>}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          {highlights.map((h) => (
            <div key={h.label} className="text-sm">
              <span className="text-muted-foreground">{h.label}:</span>{" "}
              <span className="font-medium text-foreground">{h.value}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
