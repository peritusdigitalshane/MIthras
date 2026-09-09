import { useState } from "react";
import { Crosshair, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useIocLibrary, useHuntJobs, useExecuteHunt, type Ioc } from "@/hooks/useThreatHunting";
import { IocTypeIcon, getIocTypeLabel } from "./IocTypeIcon";

interface CreateHuntDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const severityColors: Record<string, string> = {
  low: "bg-blue-500/10 text-blue-500",
  medium: "bg-yellow-500/10 text-yellow-500",
  high: "bg-orange-500/10 text-orange-500",
  critical: "bg-red-500/10 text-red-500",
};

export function CreateHuntDialog({ open, onOpenChange }: CreateHuntDialogProps) {
  const { iocs } = useIocLibrary();
  const { createHuntJob } = useHuntJobs();
  const executeHunt = useExecuteHunt();
  
  const [huntName, setHuntName] = useState("");
  const [selectedIocIds, setSelectedIocIds] = useState<Set<string>>(new Set());
  const [isExecuting, setIsExecuting] = useState(false);

  const activeIocs = iocs.filter(ioc => ioc.is_active);

  const toggleIoc = (iocId: string) => {
    const newSet = new Set(selectedIocIds);
    if (newSet.has(iocId)) {
      newSet.delete(iocId);
    } else {
      newSet.add(iocId);
    }
    setSelectedIocIds(newSet);
  };

  const selectAll = () => {
    if (selectedIocIds.size === activeIocs.length) {
      setSelectedIocIds(new Set());
    } else {
      setSelectedIocIds(new Set(activeIocs.map(ioc => ioc.id)));
    }
  };

  const handleCreateAndRun = async () => {
    if (!huntName.trim() || selectedIocIds.size === 0) return;

    setIsExecuting(true);
    try {
      // Create the hunt job
      const job = await createHuntJob.mutateAsync({
        name: huntName,
        description: `Hunting for ${selectedIocIds.size} IOCs`,
        hunt_type: "ioc_sweep",
        parameters: { ioc_ids: Array.from(selectedIocIds) },
        created_by: null,
      });

      // Execute the hunt
      await executeHunt.mutateAsync({
        jobId: job.id,
        iocIds: Array.from(selectedIocIds),
      });

      setHuntName("");
      setSelectedIocIds(new Set());
      onOpenChange(false);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crosshair className="h-5 w-5" />
            Create Threat Hunt
          </DialogTitle>
          <DialogDescription>
            Select IOCs from your library to search across all endpoints
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Hunt Name *</Label>
            <Input
              placeholder="e.g., Q4 2024 Threat Sweep"
              value={huntName}
              onChange={(e) => setHuntName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Select IOCs ({selectedIocIds.size} selected)</Label>
              <Button variant="ghost" size="sm" onClick={selectAll}>
                {selectedIocIds.size === activeIocs.length ? "Deselect All" : "Select All"}
              </Button>
            </div>
            
            {activeIocs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground border rounded-md">
                No active IOCs in your library. Add some IOCs first.
              </div>
            ) : (
              <ScrollArea className="h-[300px] border rounded-md">
                <div className="p-2 space-y-1">
                  {activeIocs.map((ioc) => (
                    <div
                      key={ioc.id}
                      className={`flex items-center gap-3 p-2 rounded-md cursor-pointer transition-colors ${
                        selectedIocIds.has(ioc.id)
                          ? "bg-primary/10 border border-primary/30"
                          : "hover:bg-muted"
                      }`}
                      onClick={() => toggleIoc(ioc.id)}
                    >
                      <Checkbox
                        checked={selectedIocIds.has(ioc.id)}
                        onCheckedChange={() => toggleIoc(ioc.id)}
                      />
                      <IocTypeIcon type={ioc.ioc_type} className="text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-sm truncate">{ioc.value}</p>
                        {ioc.threat_name && (
                          <p className="text-xs text-muted-foreground">{ioc.threat_name}</p>
                        )}
                      </div>
                      <Badge variant="outline" className={severityColors[ioc.severity]}>
                        {ioc.severity}
                      </Badge>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleCreateAndRun}
            disabled={!huntName.trim() || selectedIocIds.size === 0 || isExecuting}
          >
            {isExecuting ? "Hunting..." : "Start Hunt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
