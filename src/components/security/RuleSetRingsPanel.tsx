import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Shield,
  Plus,
  Trash2,
  Loader2,
} from "lucide-react";

import {
  useRuleSetRings,
  useRingMutations,
  useOrgEndpointGroups,
} from "@/hooks/useRuleSets";
import type { RuleSetRing } from "@/hooks/useRuleSets";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RuleSetRingsPanelProps {
  ruleSetId: string;
}

// ─── Mode badge ─────────────────────────────────────────────────────────────

function ModeBadge({ mode }: { mode: RuleSetRing["mode"] }) {
  if (mode === "enforce") {
    return (
      <Badge className="bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400">
        Enforce
      </Badge>
    );
  }
  if (mode === "audit") {
    return (
      <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-400">
        Audit
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">Off</Badge>
  );
}

// ─── Ring row ────────────────────────────────────────────────────────────────

interface RingRowProps {
  ring: RuleSetRing;
  ruleSetId: string;
  onRemove: () => void;
  onPromote: () => void;
  isRemoving: boolean;
  isPromoting: boolean;
}

function RingRow({
  ring,
  onRemove,
  onPromote,
  isRemoving,
  isPromoting,
}: RingRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
      {/* Left: group info */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="truncate font-medium">{ring.group_name}</span>
        <Badge variant="outline" className="shrink-0 tabular-nums">
          {ring.endpoint_count} {ring.endpoint_count === 1 ? "endpoint" : "endpoints"}
        </Badge>
        <ModeBadge mode={ring.mode} />
        <span className="shrink-0 text-xs text-muted-foreground">
          Ring {ring.ring_order}
        </span>
      </div>

      {/* Right: actions */}
      <div className="flex shrink-0 items-center gap-2">
        {ring.mode === "audit" && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={isPromoting}>
                {isPromoting ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : null}
                Promote to Enforce
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Promote ring to enforce mode?</AlertDialogTitle>
                <AlertDialogDescription>
                  Move <strong>{ring.group_name}</strong> ({ring.endpoint_count}{" "}
                  {ring.endpoint_count === 1 ? "endpoint" : "endpoints"}) to
                  enforce mode? Endpoints will switch on their next heartbeat.
                  This action cannot be undone from this panel.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onPromote}>
                  Promote
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              disabled={isRemoving}
            >
              {isRemoving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              <span className="sr-only">Remove ring</span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove ring?</AlertDialogTitle>
              <AlertDialogDescription>
                Remove <strong>{ring.group_name}</strong> from this rule set?
                The group's endpoints will no longer be governed by this ring.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={onRemove}
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

// ─── Main panel ──────────────────────────────────────────────────────────────

export function RuleSetRingsPanel({ ruleSetId }: RuleSetRingsPanelProps) {
  const [open, setOpen] = useState(true);
  const [addPopoverOpen, setAddPopoverOpen] = useState(false);

  const { data: rings = [], isLoading: ringsLoading } = useRuleSetRings(ruleSetId);
  const { data: allGroups = [], isLoading: groupsLoading } = useOrgEndpointGroups();
  const { addRing, removeRing, promoteRing } = useRingMutations();

  const availableGroups = allGroups.filter(
    (g) => !rings.some((r) => r.group_id === g.id)
  );

  function handleGroupSelect(groupId: string) {
    addRing.mutate({ ruleSetId, groupId, mode: "audit", ringOrder: 0 });
    setAddPopoverOpen(false);
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      {/* ── Header ── */}
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between rounded-md px-1 py-2 text-sm font-semibold hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-muted-foreground" />
            Rings
            {rings.length > 0 && (
              <Badge variant="secondary" className="tabular-nums">
                {rings.length}
              </Badge>
            )}
          </span>
          {open ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
      </CollapsibleTrigger>

      {/* ── Body ── */}
      <CollapsibleContent className="pt-2">
        {ringsLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading rings…
          </div>
        ) : rings.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            No rings assigned. Add a ring to enable pilot promotion.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {rings.map((ring) => (
              <RingRow
                key={ring.id}
                ring={ring}
                ruleSetId={ruleSetId}
                onRemove={() => removeRing.mutate({ ringId: ring.id, ruleSetId })}
                onPromote={() => promoteRing.mutate({ ringId: ring.id, ruleSetId })}
                isRemoving={
                  removeRing.isPending &&
                  (removeRing.variables as { ringId: string } | undefined)
                    ?.ringId === ring.id
                }
                isPromoting={
                  promoteRing.isPending &&
                  (promoteRing.variables as { ringId: string } | undefined)
                    ?.ringId === ring.id
                }
              />
            ))}
          </div>
        )}

        {/* ── Add ring button ── */}
        <div className="mt-3">
          <Popover open={addPopoverOpen} onOpenChange={setAddPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={groupsLoading || availableGroups.length === 0}
              >
                <Plus className="mr-1 h-4 w-4" />
                Add Ring
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-3" align="start">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Select an endpoint group
              </p>
              <Select onValueChange={handleGroupSelect}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose group…" />
                </SelectTrigger>
                <SelectContent>
                  {availableGroups.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PopoverContent>
          </Popover>

          {!groupsLoading && availableGroups.length === 0 && rings.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              All endpoint groups are already assigned to rings.
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
