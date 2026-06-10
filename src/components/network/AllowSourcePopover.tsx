import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAllowSource } from "@/hooks/useMicrosegmentation";
import { ShieldCheck, Plus, Loader2 } from "lucide-react";

interface AllowSourcePopoverProps {
  ruleId: string;
  ruleName: string;
  ip: string;
  count: number;
  alreadyAllowed: boolean;
}

export function AllowSourcePopover({
  ruleId,
  ruleName,
  ip,
  count,
  alreadyAllowed,
}: AllowSourcePopoverProps) {
  const [open, setOpen] = useState(false);
  const allow = useAllowSource();

  const badge = (
    <Badge
      variant="outline"
      className={`font-mono text-xs cursor-pointer transition-colors ${
        alreadyAllowed
          ? "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30 hover:bg-green-500/20"
          : "hover:border-primary hover:text-primary"
      }`}
    >
      {alreadyAllowed && <ShieldCheck className="h-3 w-3 mr-1" />}
      {ip}
      <span className="ml-1.5 text-muted-foreground">× {count}</span>
    </Badge>
  );

  if (alreadyAllowed) {
    // already on the whitelist — show as a tooltip-like static badge
    return badge;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button">{badge}</button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="start">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">Allow this source?</p>
            <p className="text-xs text-muted-foreground mt-1">
              Add <span className="font-mono">{ip}</span> to the whitelist for{" "}
              <strong>{ruleName}</strong>. When this rule is in enforce mode, traffic from this
              source will be permitted while everything else is blocked.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={allow.isPending}
              onClick={() =>
                allow.mutate(
                  { ruleId, ip },
                  { onSuccess: () => setOpen(false) }
                )
              }
            >
              {allow.isPending ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Plus className="h-3 w-3 mr-1" />
              )}
              Add to allowed
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
