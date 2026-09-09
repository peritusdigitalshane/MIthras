import { useState } from "react";
import { Play, Eye, Trash2, Clock, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useHuntJobs, type HuntJob } from "@/hooks/useThreatHunting";
import { HuntResultsView } from "./HuntResultsView";
import { CreateHuntDialog } from "./CreateHuntDialog";
import { formatDistanceToNow, format } from "date-fns";

const statusConfig: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string; label: string }> = {
  pending: { icon: Clock, color: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20", label: "Pending" },
  running: { icon: Loader2, color: "bg-blue-500/10 text-blue-500 border-blue-500/20", label: "Running" },
  completed: { icon: CheckCircle2, color: "bg-green-500/10 text-green-500 border-green-500/20", label: "Completed" },
  failed: { icon: XCircle, color: "bg-red-500/10 text-red-500 border-red-500/20", label: "Failed" },
};

export function HuntJobsList() {
  const { huntJobs, isLoading, deleteHuntJob } = useHuntJobs();
  const [selectedJob, setSelectedJob] = useState<HuntJob | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  if (selectedJob) {
    return (
      <HuntResultsView 
        job={selectedJob} 
        onBack={() => setSelectedJob(null)} 
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Hunt History</h3>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Play className="h-4 w-4 mr-2" />
          New Hunt
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Endpoints</TableHead>
              <TableHead>Matches</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead className="w-[100px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  Loading hunt jobs...
                </TableCell>
              </TableRow>
            ) : huntJobs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  No hunt jobs yet. Start your first threat hunt.
                </TableCell>
              </TableRow>
            ) : (
              huntJobs.map((job) => {
                const status = statusConfig[job.status];
                const StatusIcon = status.icon;
                const duration = job.started_at && job.completed_at
                  ? Math.round((new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 1000)
                  : null;

                return (
                  <TableRow key={job.id}>
                    <TableCell className="font-medium">{job.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={status.color}>
                        <StatusIcon className={`h-3 w-3 mr-1 ${job.status === "running" ? "animate-spin" : ""}`} />
                        {status.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="capitalize">{job.hunt_type.replace("_", " ")}</TableCell>
                    <TableCell>{job.total_endpoints}</TableCell>
                    <TableCell>
                      {job.matches_found > 0 ? (
                        <Badge variant="destructive">{job.matches_found}</Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {job.started_at 
                        ? formatDistanceToNow(new Date(job.started_at), { addSuffix: true })
                        : "-"
                      }
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {duration !== null ? `${duration}s` : "-"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setSelectedJob(job)}
                          disabled={job.status === "pending" || job.status === "running"}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteHuntJob.mutate(job.id)}
                          disabled={job.status === "running"}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <CreateHuntDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} />
    </div>
  );
}
