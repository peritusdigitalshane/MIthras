import { MainLayout } from "@/components/layout/MainLayout";
import { useActivityLogs } from "@/hooks/useActivityLogs";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Activity as ActivityIcon,
  RefreshCw,
  User,
  Monitor,
  FileText,
  Shield,
  Settings,
  AlertTriangle,
  LogIn,
  LogOut,
  Plus,
  Trash2,
  Edit,
  Download,
  Search,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const getActionIcon = (action: string) => {
  const iconClass = "h-4 w-4";
  switch (action.toLowerCase()) {
    case "login":
      return <LogIn className={iconClass} />;
    case "logout":
      return <LogOut className={iconClass} />;
    case "create":
      return <Plus className={iconClass} />;
    case "update":
    case "edit":
      return <Edit className={iconClass} />;
    case "delete":
      return <Trash2 className={iconClass} />;
    case "download":
      return <Download className={iconClass} />;
    case "policy_applied":
      return <Shield className={iconClass} />;
    case "threat_detected":
      return <AlertTriangle className={iconClass} />;
    default:
      return <ActivityIcon className={iconClass} />;
  }
};

const getResourceIcon = (resourceType: string) => {
  const iconClass = "h-4 w-4 text-muted-foreground";
  switch (resourceType.toLowerCase()) {
    case "user":
      return <User className={iconClass} />;
    case "endpoint":
      return <Monitor className={iconClass} />;
    case "policy":
      return <FileText className={iconClass} />;
    case "threat":
      return <AlertTriangle className={iconClass} />;
    case "settings":
      return <Settings className={iconClass} />;
    default:
      return <ActivityIcon className={iconClass} />;
  }
};

const getActionBadgeVariant = (action: string) => {
  switch (action.toLowerCase()) {
    case "create":
    case "login":
      return "default";
    case "update":
    case "edit":
    case "policy_applied":
      return "secondary";
    case "delete":
    case "threat_detected":
      return "destructive";
    default:
      return "outline";
  }
};

export default function Activity() {
  const { data: logs, isLoading, error } = useActivityLogs();
  const queryClient = useQueryClient();
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [resourceFilter, setResourceFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
  };

  const filteredLogs = logs?.filter((log) => {
    const matchesAction = actionFilter === "all" || log.action.toLowerCase() === actionFilter;
    const matchesResource = resourceFilter === "all" || log.resource_type.toLowerCase() === resourceFilter;
    const matchesSearch =
      searchQuery === "" ||
      log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.resource_type.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.profiles?.display_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.profiles?.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.endpoints?.hostname.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesAction && matchesResource && matchesSearch;
  });

  const uniqueActions = [...new Set(logs?.map((l) => l.action.toLowerCase()) || [])];
  const uniqueResources = [...new Set(logs?.map((l) => l.resource_type.toLowerCase()) || [])];

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Activity Log</h1>
            <p className="text-muted-foreground">
              Audit trail of all actions and system events
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search activities..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  {uniqueActions.map((action) => (
                    <SelectItem key={action} value={action}>
                      {action.charAt(0).toUpperCase() + action.slice(1).replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={resourceFilter} onValueChange={setResourceFilter}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Resource" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Resources</SelectItem>
                  {uniqueResources.map((resource) => (
                    <SelectItem key={resource} value={resource}>
                      {resource.charAt(0).toUpperCase() + resource.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Activity Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="flex items-center justify-center py-12 text-destructive">
                Failed to load activity logs
              </div>
            ) : filteredLogs?.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <ActivityIcon className="h-12 w-12 mb-4 opacity-50" />
                <p>No activity logs found</p>
                <p className="text-sm">Activity will appear here as actions are performed</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[180px]">Time</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Resource</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Endpoint</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLogs?.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(log.created_at), "MMM d, HH:mm:ss")}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getActionIcon(log.action)}
                          <Badge variant={getActionBadgeVariant(log.action)}>
                            {log.action.replace(/_/g, " ")}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getResourceIcon(log.resource_type)}
                          <span className="capitalize">{log.resource_type}</span>
                          {log.resource_id && (
                            <span className="text-xs text-muted-foreground truncate max-w-[100px]">
                              ({log.resource_id.slice(0, 8)}...)
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {log.profiles ? (
                          <span className="text-sm">
                            {log.profiles.display_name || log.profiles.email}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-sm">System</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {log.endpoints ? (
                          <span className="text-sm font-mono">{log.endpoints.hostname}</span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {log.details ? (
                          <span className="text-xs text-muted-foreground truncate max-w-[200px] block">
                            {JSON.stringify(log.details).slice(0, 50)}...
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
