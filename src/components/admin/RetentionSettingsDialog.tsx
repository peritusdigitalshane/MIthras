import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";

interface RetentionSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationName: string;
  currentRetentionDays: number;
  onSave: (days: number) => Promise<void>;
  isPending: boolean;
}

export function RetentionSettingsDialog({
  open,
  onOpenChange,
  organizationName,
  currentRetentionDays,
  onSave,
  isPending,
}: RetentionSettingsDialogProps) {
  const [retentionDays, setRetentionDays] = useState(currentRetentionDays);

  const handleSave = async () => {
    await onSave(retentionDays);
  };

  const presets = [
    { label: "30 days", value: 30 },
    { label: "60 days", value: 60 },
    { label: "90 days", value: 90 },
    { label: "180 days", value: 180 },
    { label: "1 year", value: 365 },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Event Log Retention</DialogTitle>
          <DialogDescription>
            Configure how long event logs are retained for {organizationName}.
            Logs older than this will be automatically purged.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="retention-days">Retention Period (days)</Label>
            <Input
              id="retention-days"
              type="number"
              min={1}
              max={3650}
              value={retentionDays}
              onChange={(e) => setRetentionDays(parseInt(e.target.value) || 30)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <Button
                key={preset.value}
                variant={retentionDays === preset.value ? "default" : "outline"}
                size="sm"
                onClick={() => setRetentionDays(preset.value)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
