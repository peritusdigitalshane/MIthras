import { ArrowLeft, CheckCircle, Circle, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useHuntMatches, type HuntJob } from "@/hooks/useThreatHunting";
import { format } from "date-fns";

interface HuntResultsViewProps {
  job: HuntJob;
  onBack: () => void;
}

const sourceLabels: Record<string, string> = {
  discovered_apps: "Discovered Apps",
  threats: "Threats",
  event_logs: "Event Logs",
};

export function HuntResultsView({ job, onBack }: HuntResultsViewProps) {
  const { matches, isLoading, markReviewed } = useHuntMatches(job.id);

  const reviewedCount = matches.filter(m => m.reviewed).length;
  const unreviewedCount = matches.length - reviewedCount;
  const uniqueEndpoints = new Set(matches.map(m => m.endpoint_id)).size;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h2 className="text-xl font-semibold">{job.name}</h2>
          <p className="text-sm text-muted-foreground">
            {job.started_at && format(new Date(job.started_at), "PPp")}
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Matches
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{matches.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Endpoints Affected
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{uniqueEndpoints}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Reviewed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">{reviewedCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pending Review
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-500">{unreviewedCount}</div>
          </CardContent>
        </Card>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]">Status</TableHead>
              <TableHead>Endpoint</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Matched Value</TableHead>
              <TableHead>Context</TableHead>
              <TableHead className="w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  Loading matches...
                </TableCell>
              </TableRow>
            ) : matches.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No matches found. Your endpoints appear clean for these IOCs.
                </TableCell>
              </TableRow>
            ) : (
              matches.map((match) => (
                <TableRow key={match.id} className={match.reviewed ? "opacity-60" : ""}>
                  <TableCell>
                    {match.reviewed ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : (
                      <Circle className="h-4 w-4 text-yellow-500" />
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Monitor className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">
                        {match.endpoint?.hostname ?? "Unknown"}
                      </span>
                      {match.endpoint?.is_online && (
                        <span className="h-2 w-2 rounded-full bg-green-500" />
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {sourceLabels[match.match_source]}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm max-w-[200px] truncate">
                    {match.matched_value}
                  </TableCell>
                  <TableCell className="max-w-[300px]">
                    {match.context.file_path && (
                      <p className="text-sm text-muted-foreground truncate">
                        {match.context.file_path as string}
                      </p>
                    )}
                    {match.context.message && (
                      <p className="text-sm text-muted-foreground truncate">
                        {(match.context.message as string).substring(0, 100)}...
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => markReviewed.mutate({ id: match.id, reviewed: !match.reviewed })}
                    >
                      {match.reviewed ? "Unreview" : "Mark Reviewed"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
