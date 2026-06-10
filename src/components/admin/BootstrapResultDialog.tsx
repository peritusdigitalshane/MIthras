import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CheckCircle, Copy, Loader2, ShieldCheck, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { BootstrapResult, buildInstallOneLiner, fetchActiveAgentManifest } from "@/hooks/useBootstrapCustomer";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: BootstrapResult | null;
  customerName: string;
}

/**
 * Shows the post-bootstrap "ready to deploy" panel: token, install one-liner
 * for the customer's TRMM, expiry, capacity. Resolves the agent manifest from
 * the same endpoint the agent download UI uses so SHA + download URL match.
 */
export function BootstrapResultDialog({ open, onOpenChange, result, customerName }: Props) {
  const { toast } = useToast();
  const [oneLiner, setOneLiner] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !result) {
      setOneLiner("");
      setError(null);
      setCopied(false);
      return;
    }
    let aborted = false;
    setLoading(true);
    setError(null);
    fetchActiveAgentManifest(result.enrollment_token)
      .then((m) => {
        if (aborted) return;
        setOneLiner(buildInstallOneLiner({
          apiBase: m.api_base_url,
          downloadUrl: m.download_url,
          sha256: m.sha256,
          token: result.enrollment_token,
          version: m.version,
        }));
      })
      .catch((e: Error) => { if (!aborted) setError(e.message); })
      .finally(() => { if (!aborted) setLoading(false); });
    return () => { aborted = true; };
  }, [open, result]);

  const copy = async () => {
    if (!oneLiner) return;
    await navigator.clipboard.writeText(oneLiner);
    setCopied(true);
    toast({ title: "Install command copied" });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-status-healthy" />
            {customerName} is ready
          </DialogTitle>
          <DialogDescription>
            Baseline Defender, UAC, and Windows Update policies are applied via a default <strong>Standard</strong> endpoint group.
            Paste the command below into Tactical RMM (run as Local System) on every endpoint you want to onboard.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Alert>
            <Users className="h-4 w-4" />
            <AlertTitle>
              Enrolment token: {result?.token_max_uses ?? 50} installs, expires {result?.token_expires_at ? format(new Date(result.token_expires_at), "d MMM yyyy") : "(unknown)"}
            </AlertTitle>
            <AlertDescription>
              Each successful install consumes one slot. Generate a new token from Agent Download → Service Install if you need more.
            </AlertDescription>
          </Alert>

          <div>
            <Label className="mb-2 block">Install command (Tactical RMM script body)</Label>
            {loading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
                <Loader2 className="h-4 w-4 animate-spin" /> Resolving latest agent version…
              </div>
            )}
            {error && (
              <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
            )}
            {oneLiner && (
              <div className="relative">
                <pre className="rounded-lg bg-secondary/50 p-4 text-xs overflow-x-auto max-h-72"><code>{oneLiner}</code></pre>
                <Button size="sm" variant="outline" className="absolute top-2 right-2 gap-1.5" onClick={copy}>
                  {copied ? <CheckCircle className="h-3.5 w-3.5 text-status-healthy" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            )}
          </div>

          <Alert>
            <ShieldCheck className="h-4 w-4" />
            <AlertTitle>What was provisioned</AlertTitle>
            <AlertDescription>
              <ul className="list-disc list-inside text-sm space-y-1">
                <li>Default endpoint group <strong>Standard</strong> with baseline Defender, UAC and Windows Update policies</li>
                <li>You as <strong>owner</strong> of the tenant (full admin)</li>
                <li>50-use, 30-day enrolment token bound to this tenant</li>
              </ul>
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
