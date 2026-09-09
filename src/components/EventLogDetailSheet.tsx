import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { AlertCircle, AlertTriangle, Info, FileText, Clock, Monitor, Hash, Tag, ShieldPlus } from "lucide-react";
import { EndpointEventLog } from "@/hooks/useEventLogs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { isAsrEvent, parseAsrEventMessage } from "@/lib/event-parser";
import { EventLogAddExclusionDialog } from "./EventLogAddExclusionDialog";

interface EventLogDetailSheetProps {
  log: EndpointEventLog | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timezone: string;
}

const getLevelIcon = (level: string) => {
  switch (level.toLowerCase()) {
    case "critical":
    case "error":
      return <AlertCircle className="h-5 w-5 text-destructive" />;
    case "warning":
      return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
    case "information":
      return <Info className="h-5 w-5 text-blue-500" />;
    default:
      return <FileText className="h-5 w-5 text-muted-foreground" />;
  }
};

const getLevelBadgeVariant = (level: string) => {
  switch (level.toLowerCase()) {
    case "critical":
    case "error":
      return "destructive";
    case "warning":
      return "outline";
    default:
      return "secondary";
  }
};

const getEventCategory = (eventId: number) => {
  if ([1005, 1006, 1007, 1008, 1009, 1010, 1011, 1015, 1016, 1117, 1118, 1119].includes(eventId)) {
    return "Threat Detection";
  }
  if ([1000, 1001, 1002].includes(eventId)) {
    return "Scan";
  }
  if ([2000, 2001, 2002, 2003, 2004, 2005, 2010, 2011, 2012].includes(eventId)) {
    return "Update";
  }
  if ([5000, 5001, 5004, 5007, 5008, 5010, 5012, 3002].includes(eventId)) {
    return "Protection Status";
  }
  if ([1121, 1122, 1125, 1126, 1127, 1128].includes(eventId)) {
    return "ASR / Exploit Guard";
  }
  return "Other";
};

const formatInTimezone = (date: string, timezone: string) => {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(date));
};

export function EventLogDetailSheet({ log, open, onOpenChange, timezone }: EventLogDetailSheetProps) {
  const [exclusionDialogOpen, setExclusionDialogOpen] = useState(false);

  if (!log) return null;

  // Parse ASR event data if applicable
  const isAsr = isAsrEvent(log.event_id);
  const asrData = isAsr ? parseAsrEventMessage(log.message) : null;
  const canAddExclusion = isAsr && asrData !== null;

  return (
    <>
      <EventLogAddExclusionDialog
        open={exclusionDialogOpen}
        onOpenChange={setExclusionDialogOpen}
        asrData={asrData ?? { asrRuleId: "", asrRuleName: "", path: "", processName: "", user: "", detectionTime: "" }}
        endpointHostname={log.endpoints?.hostname ?? "Unknown"}
        policyId={log.endpoints?.policy_id ?? null}
      />
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader className="space-y-4">
          <div className="flex items-center gap-3">
            {getLevelIcon(log.level)}
            <SheetTitle className="text-lg">Event Details</SheetTitle>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={getLevelBadgeVariant(log.level) as any}>
              {log.level}
            </Badge>
            <Badge variant="outline">{getEventCategory(log.event_id)}</Badge>
            <Badge variant="secondary">ID: {log.event_id}</Badge>
          </div>

          {/* Add to Exclusions Button for ASR events */}
          {canAddExclusion && (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setExclusionDialogOpen(true)}
            >
              <ShieldPlus className="mr-2 h-4 w-4" />
              Add to Policy Exclusions
            </Button>
          )}
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-220px)] mt-6">
          <div className="space-y-6 pr-4">
            {/* Metadata Grid */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  Event Time
                </div>
                <p className="text-sm font-medium">
                  {formatInTimezone(log.event_time, timezone)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(log.event_time), { addSuffix: true })}
                </p>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Monitor className="h-3 w-3" />
                  Endpoint
                </div>
                <p className="text-sm font-medium">
                  {log.endpoints?.hostname ?? "Unknown"}
                </p>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Hash className="h-3 w-3" />
                  Event ID
                </div>
                <p className="text-sm font-medium">{log.event_id}</p>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Tag className="h-3 w-3" />
                  Log Source
                </div>
                <p className="text-sm font-medium truncate" title={log.log_source}>
                  {log.log_source.split("/").pop()}
                </p>
              </div>

              {log.provider_name && (
                <div className="space-y-1 col-span-2">
                  <div className="text-xs text-muted-foreground">Provider</div>
                  <p className="text-sm font-medium">{log.provider_name}</p>
                </div>
              )}

              {log.task_category && (
                <div className="space-y-1 col-span-2">
                  <div className="text-xs text-muted-foreground">Task Category</div>
                  <p className="text-sm font-medium">{log.task_category}</p>
                </div>
              )}
            </div>

            {/* Full Message */}
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                Message
              </div>
              <div className="rounded-lg border border-border bg-secondary/30 p-4">
                <pre className="text-sm whitespace-pre-wrap font-mono leading-relaxed text-foreground">
                  {log.message || "No message"}
                </pre>
              </div>
            </div>

            {/* Raw Data (if available) */}
            {log.raw_data && Object.keys(log.raw_data).length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                  Raw Data
                </div>
                <div className="rounded-lg border border-border bg-secondary/30 p-4">
                  <pre className="text-xs whitespace-pre-wrap font-mono text-muted-foreground overflow-x-auto">
                    {JSON.stringify(log.raw_data, null, 2)}
                  </pre>
                </div>
              </div>
            )}

            {/* Timestamps */}
            <div className="space-y-2 pt-4 border-t border-border">
              <div className="text-xs text-muted-foreground">
                Recorded at: {formatInTimezone(log.created_at, timezone)}
              </div>
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
    </>
  );
}
