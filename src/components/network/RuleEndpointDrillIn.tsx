import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useMicrosegRuleEndpoints } from "@/hooks/useMicrosegmentation";
import { formatDistanceToNow } from "date-fns";
import { Link } from "react-router-dom";
import { Monitor, ExternalLink, Eye } from "lucide-react";

interface RuleEndpointDrillInProps {
  open: boolean;
  onClose: () => void;
  rule: {
    rule_id: string;
    service_name: string;
    port: string;
    protocol: string;
    mode: "audit" | "enforce";
    group_name: string;
  } | null;
}

export function RuleEndpointDrillIn({ open, onClose, rule }: RuleEndpointDrillInProps) {
  const { data: endpoints, isLoading } = useMicrosegRuleEndpoints(rule?.rule_id || null);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Traffic per endpoint: {rule?.service_name}
            {rule && (
              <Badge variant="outline" className="font-mono text-[10px]">
                {rule.protocol.toUpperCase()}/{rule.port}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Last 7 days of observed connections, broken down by endpoint in{" "}
            <strong>{rule?.group_name}</strong>.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : !endpoints?.length ? (
          <div className="py-12 text-center text-muted-foreground">
            <Monitor className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
            <p className="text-sm">No endpoint traffic recorded for this rule in the last 7 days.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {endpoints.map((ep) => (
              <div
                key={ep.endpoint_id}
                className="border rounded-lg p-3 hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Monitor className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{ep.hostname}</p>
                      <p className="text-xs text-muted-foreground">
                        {ep.hits_7d.toLocaleString()} hits · {ep.unique_sources} unique
                        source{ep.unique_sources === 1 ? "" : "s"} · Last seen{" "}
                        {formatDistanceToNow(new Date(ep.last_seen), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                  <Button asChild variant="ghost" size="sm" className="shrink-0">
                    <Link to={`/endpoints/${ep.endpoint_id}`}>
                      View endpoint
                      <ExternalLink className="h-3 w-3 ml-1" />
                    </Link>
                  </Button>
                </div>
                {ep.top_sources.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {ep.top_sources.map((src) => (
                      <Badge key={src.ip} variant="secondary" className="font-mono text-xs">
                        {src.ip}
                        <span className="ml-1.5 text-muted-foreground">× {src.count}</span>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
