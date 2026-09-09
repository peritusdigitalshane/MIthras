import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { useEventLogs, EndpointEventLog } from "@/hooks/useEventLogs";
import { formatDistanceToNow } from "date-fns";
import { 
  FileText, 
  AlertTriangle, 
  AlertCircle, 
  Info, 
  Shield,
  Loader2,
  RefreshCw,
  Filter,
  ChevronRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useQueryClient } from "@tanstack/react-query";
import { EventLogDetailSheet } from "@/components/EventLogDetailSheet";
import { useTimezone } from "@/hooks/useTimezone";
import { TimezoneSelector } from "@/components/TimezoneSelector";

const getLevelIcon = (level: string) => {
  switch (level.toLowerCase()) {
    case "critical":
    case "error":
      return <AlertCircle className="h-4 w-4 text-destructive" />;
    case "warning":
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    case "information":
      return <Info className="h-4 w-4 text-blue-500" />;
    default:
      return <FileText className="h-4 w-4 text-muted-foreground" />;
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
  // Categorize based on event ID ranges
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

const EventLogs = () => {
  const { data: logs, isLoading, error } = useEventLogs(200);
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLog, setSelectedLog] = useState<EndpointEventLog | null>(null);
  const queryClient = useQueryClient();
  const { timezone, setTimezone, formatDatetime } = useTimezone();

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["event-logs"] });
  };

  const filteredLogs = logs?.filter((log) => {
    // Level filter
    if (levelFilter !== "all" && log.level.toLowerCase() !== levelFilter) {
      return false;
    }
    // Category filter
    if (categoryFilter !== "all") {
      const category = getEventCategory(log.event_id);
      if (category !== categoryFilter) {
        return false;
      }
    }
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesHostname = log.endpoints?.hostname?.toLowerCase().includes(query);
      const matchesMessage = log.message?.toLowerCase().includes(query);
      const matchesEventId = log.event_id.toString().includes(query);
      if (!matchesHostname && !matchesMessage && !matchesEventId) {
        return false;
      }
    }
    return true;
  });

  const categories = ["Threat Detection", "Scan", "Update", "Protection Status", "ASR / Exploit Guard", "Other"];

  return (
    <MainLayout>
      <div className="animate-fade-in space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Event Logs</h1>
            <p className="text-sm text-muted-foreground">
              Windows Defender events from your endpoints
            </p>
          </div>
          <div className="flex items-center gap-3">
            <TimezoneSelector value={timezone} onChange={setTimezone} />
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isLoading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Filters:</span>
          </div>
          
          <Select value={levelFilter} onValueChange={setLevelFilter}>
            <SelectTrigger className="w-[140px] h-8 text-xs">
              <SelectValue placeholder="All Levels" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Levels</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="information">Information</SelectItem>
            </SelectContent>
          </Select>

          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            placeholder="Search hostname, message, event ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-[280px] h-8 text-xs"
          />

          {(levelFilter !== "all" || categoryFilter !== "all" || searchQuery) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setLevelFilter("all");
                setCategoryFilter("all");
                setSearchQuery("");
              }}
              className="h-8 text-xs"
            >
              Clear filters
            </Button>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-2xl font-bold">{logs?.length ?? 0}</div>
            <div className="text-xs text-muted-foreground">Total Events</div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-2xl font-bold text-destructive">
              {logs?.filter(l => l.level.toLowerCase() === "error" || l.level.toLowerCase() === "critical").length ?? 0}
            </div>
            <div className="text-xs text-muted-foreground">Errors/Critical</div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-2xl font-bold text-yellow-500">
              {logs?.filter(l => l.level.toLowerCase() === "warning").length ?? 0}
            </div>
            <div className="text-xs text-muted-foreground">Warnings</div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-2xl font-bold text-primary">
              {logs?.filter(l => getEventCategory(l.event_id) === "Threat Detection").length ?? 0}
            </div>
            <div className="text-xs text-muted-foreground">Threat Events</div>
          </div>
        </div>

        {/* Logs Table */}
        <div className="rounded-xl border border-border bg-card shadow-card">
          <div className="flex items-center justify-between border-b border-border p-4">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <h3 className="font-semibold text-foreground">
                Event Log ({filteredLogs?.length ?? 0} events)
              </h3>
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="p-8 text-center text-muted-foreground">
              Failed to load event logs
            </div>
          ) : filteredLogs?.length === 0 ? (
            <div className="p-8 text-center">
              <FileText className="mx-auto h-12 w-12 text-muted-foreground/50 mb-3" />
              <p className="text-muted-foreground">No event logs found</p>
              <p className="text-xs text-muted-foreground mt-1">
                Logs will appear here when endpoints report Defender events
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-secondary/50">
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Time
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Level
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Endpoint
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Event ID
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Category
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Message
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredLogs?.map((log) => (
                    <tr 
                      key={log.id} 
                      className="group transition-colors hover:bg-secondary/30 cursor-pointer"
                      onClick={() => setSelectedLog(log)}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-sm text-foreground">
                          {formatDatetime(log.event_time)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(log.event_time), { addSuffix: true })}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {getLevelIcon(log.level)}
                          <Badge variant={getLevelBadgeVariant(log.level) as any} className="text-xs">
                            {log.level}
                          </Badge>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-medium text-foreground">
                          {log.endpoints?.hostname ?? "Unknown"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <code className="rounded bg-secondary px-2 py-1 text-xs text-muted-foreground">
                          {log.event_id}
                        </code>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="text-xs">
                          {getEventCategory(log.event_id)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 max-w-md">
                        <div className="flex items-center gap-2">
                          <p className="text-sm text-foreground truncate flex-1" title={log.message}>
                            {log.message?.slice(0, 80) || "No message"}
                            {log.message && log.message.length > 80 && "..."}
                          </p>
                          <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <EventLogDetailSheet 
          log={selectedLog} 
          open={!!selectedLog} 
          onOpenChange={(open) => !open && setSelectedLog(null)}
          timezone={timezone}
        />
      </div>
    </MainLayout>
  );
};

export default EventLogs;
