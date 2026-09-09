import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  useCreateWindowsUpdatePolicy,
  useUpdateWindowsUpdatePolicy,
  WindowsUpdatePolicy,
  WindowsUpdatePolicyFormData,
  AUTO_UPDATE_MODES,
} from "@/hooks/useWindowsUpdatePolicies";

const formSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(500).optional(),
  auto_update_mode: z.number().min(0).max(4),
  active_hours_start: z.number().min(0).max(23),
  active_hours_end: z.number().min(0).max(23),
  feature_update_deferral: z.number().min(0).max(365),
  quality_update_deferral: z.number().min(0).max(30),
  pause_feature_updates: z.boolean(),
  pause_quality_updates: z.boolean(),
});

interface WindowsUpdatePolicyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policy?: WindowsUpdatePolicy | null;
}

export function WindowsUpdatePolicyDialog({
  open,
  onOpenChange,
  policy,
}: WindowsUpdatePolicyDialogProps) {
  const createPolicy = useCreateWindowsUpdatePolicy();
  const updatePolicy = useUpdateWindowsUpdatePolicy();
  const isEditing = !!policy;

  const form = useForm<WindowsUpdatePolicyFormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      auto_update_mode: 4,
      active_hours_start: 8,
      active_hours_end: 17,
      feature_update_deferral: 0,
      quality_update_deferral: 0,
      pause_feature_updates: false,
      pause_quality_updates: false,
    },
  });

  useEffect(() => {
    if (policy) {
      form.reset({
        name: policy.name,
        description: policy.description || "",
        auto_update_mode: policy.auto_update_mode,
        active_hours_start: policy.active_hours_start,
        active_hours_end: policy.active_hours_end,
        feature_update_deferral: policy.feature_update_deferral,
        quality_update_deferral: policy.quality_update_deferral,
        pause_feature_updates: policy.pause_feature_updates,
        pause_quality_updates: policy.pause_quality_updates,
      });
    } else {
      form.reset({
        name: "",
        description: "",
        auto_update_mode: 4,
        active_hours_start: 8,
        active_hours_end: 17,
        feature_update_deferral: 0,
        quality_update_deferral: 0,
        pause_feature_updates: false,
        pause_quality_updates: false,
      });
    }
  }, [policy, form, open]);

  const onSubmit = async (data: WindowsUpdatePolicyFormData) => {
    try {
      if (isEditing) {
        await updatePolicy.mutateAsync({ id: policy.id, data });
      } else {
        await createPolicy.mutateAsync(data);
      }
      onOpenChange(false);
    } catch {
      // Error handled by mutation
    }
  };

  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit" : "Create"} Windows Update Policy</DialogTitle>
          <DialogDescription>
            Configure Windows Update settings to enforce on endpoints
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Basic Info */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Policy Name</Label>
              <Input id="name" {...form.register("name")} placeholder="e.g., Production Servers" />
              {form.formState.errors.name && (
                <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                {...form.register("description")}
                placeholder="Optional description"
                rows={2}
              />
            </div>
          </div>

          <Separator />

          {/* Update Mode */}
          <div className="space-y-4">
            <Label>Auto Update Mode</Label>
            <Select
              value={form.watch("auto_update_mode").toString()}
              onValueChange={(value) => form.setValue("auto_update_mode", parseInt(value))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(AUTO_UPDATE_MODES).map(([value, { label, description }]) => (
                  <SelectItem key={value} value={value}>
                    <div>
                      <div className="font-medium">{label}</div>
                      <div className="text-xs text-muted-foreground">{description}</div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Active Hours */}
          <div className="space-y-4">
            <Label>Active Hours (no auto-restart)</Label>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">Start</Label>
                <Select
                  value={form.watch("active_hours_start").toString()}
                  onValueChange={(value) => form.setValue("active_hours_start", parseInt(value))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {hours.map((hour) => (
                      <SelectItem key={hour} value={hour.toString()}>
                        {hour.toString().padStart(2, "0")}:00
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">End</Label>
                <Select
                  value={form.watch("active_hours_end").toString()}
                  onValueChange={(value) => form.setValue("active_hours_end", parseInt(value))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {hours.map((hour) => (
                      <SelectItem key={hour} value={hour.toString()}>
                        {hour.toString().padStart(2, "0")}:00
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <Separator />

          {/* Deferrals */}
          <div className="space-y-4">
            <Label>Update Deferrals</Label>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">Feature Updates (days)</Label>
                <Input
                  type="number"
                  min={0}
                  max={365}
                  {...form.register("feature_update_deferral", { valueAsNumber: true })}
                />
                <p className="text-xs text-muted-foreground">0-365 days</p>
              </div>
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">Quality Updates (days)</Label>
                <Input
                  type="number"
                  min={0}
                  max={30}
                  {...form.register("quality_update_deferral", { valueAsNumber: true })}
                />
                <p className="text-xs text-muted-foreground">0-30 days</p>
              </div>
            </div>
          </div>

          {/* Pause Updates */}
          <div className="space-y-4">
            <Label>Pause Updates</Label>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">Pause Feature Updates</p>
                  <p className="text-xs text-muted-foreground">
                    Temporarily stop feature updates (major versions)
                  </p>
                </div>
                <Switch
                  checked={form.watch("pause_feature_updates")}
                  onCheckedChange={(checked) => form.setValue("pause_feature_updates", checked)}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">Pause Quality Updates</p>
                  <p className="text-xs text-muted-foreground">
                    Temporarily stop quality updates (security patches)
                  </p>
                </div>
                <Switch
                  checked={form.watch("pause_quality_updates")}
                  onCheckedChange={(checked) => form.setValue("pause_quality_updates", checked)}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createPolicy.isPending || updatePolicy.isPending}>
              {isEditing ? "Update" : "Create"} Policy
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
