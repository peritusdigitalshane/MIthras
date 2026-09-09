import { useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Shield, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { AsrEventData, getProcessNameFromPath } from "@/lib/event-parser";
import { useAddPolicyExclusion, usePolicies } from "@/hooks/usePolicies";
import { toast } from "sonner";

interface EventLogAddExclusionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asrData: AsrEventData;
  endpointHostname: string;
  policyId: string | null;
}

type ExclusionType = "path" | "process";

export function EventLogAddExclusionDialog({
  open,
  onOpenChange,
  asrData,
  endpointHostname,
  policyId,
}: EventLogAddExclusionDialogProps) {
  const [exclusionType, setExclusionType] = useState<ExclusionType>("path");
  const { data: policies } = usePolicies();
  const addExclusion = useAddPolicyExclusion();

  const policy = policies?.find((p) => p.id === policyId);
  const processName = getProcessNameFromPath(asrData.path);

  const exclusionValue = exclusionType === "path" ? asrData.path : processName;

  // Check if already excluded
  const isAlreadyExcluded =
    policy &&
    ((exclusionType === "path" && policy.exclusion_paths?.includes(asrData.path)) ||
      (exclusionType === "process" && policy.exclusion_processes?.includes(processName)));

  const handleAddExclusion = async () => {
    if (!policyId || !policy) {
      toast.error("No policy assigned to this endpoint");
      return;
    }

    if (isAlreadyExcluded) {
      toast.info("This exclusion already exists in the policy");
      onOpenChange(false);
      return;
    }

    try {
      await addExclusion.mutateAsync({
        policyId,
        exclusionType,
        value: exclusionValue,
        policyName: policy.name,
      });
      toast.success(`Exclusion added to "${policy.name}"`);
      onOpenChange(false);
    } catch (error) {
      toast.error("Failed to add exclusion");
      console.error(error);
    }
  };

  if (!policyId) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-yellow-500" />
              No Policy Assigned
            </DialogTitle>
            <DialogDescription>
              This endpoint ({endpointHostname}) doesn't have a Defender policy assigned.
              Please assign a policy first before adding exclusions.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Add to Exclusions
          </DialogTitle>
          <DialogDescription>
            Add this process to policy exclusions to prevent future ASR alerts.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* ASR Rule Info */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">ASR Rule</Label>
            <p className="text-sm font-medium">{asrData.asrRuleName}</p>
          </div>

          {/* Policy Info */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Target Policy</Label>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{policy?.name ?? "Loading..."}</Badge>
              <span className="text-xs text-muted-foreground">
                (used by {endpointHostname})
              </span>
            </div>
          </div>

          {/* Exclusion Type Selection */}
          <div className="space-y-3">
            <Label className="text-xs text-muted-foreground">Exclusion Type</Label>
            <RadioGroup
              value={exclusionType}
              onValueChange={(v) => setExclusionType(v as ExclusionType)}
              className="space-y-2"
            >
              <div className="flex items-start space-x-3 rounded-md border p-3">
                <RadioGroupItem value="path" id="path" className="mt-0.5" />
                <div className="flex-1 space-y-1">
                  <Label htmlFor="path" className="font-medium cursor-pointer">
                    Full Path
                  </Label>
                  <p className="text-xs text-muted-foreground break-all">
                    {asrData.path}
                  </p>
                </div>
              </div>
              <div className="flex items-start space-x-3 rounded-md border p-3">
                <RadioGroupItem value="process" id="process" className="mt-0.5" />
                <div className="flex-1 space-y-1">
                  <Label htmlFor="process" className="font-medium cursor-pointer">
                    Process Name Only
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {processName}
                    <span className="ml-2 text-yellow-600">(broader exclusion)</span>
                  </p>
                </div>
              </div>
            </RadioGroup>
          </div>

          {/* Already Excluded Warning */}
          {isAlreadyExcluded && (
            <div className="flex items-center gap-2 rounded-md bg-green-500/10 border border-green-500/20 p-3">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <p className="text-sm text-green-600">
                This {exclusionType} is already in the policy exclusions.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleAddExclusion}
            disabled={addExclusion.isPending || isAlreadyExcluded}
          >
            {addExclusion.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Adding...
              </>
            ) : (
              "Add Exclusion"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
