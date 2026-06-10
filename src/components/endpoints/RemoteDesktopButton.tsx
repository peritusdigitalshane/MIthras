import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Monitor, Loader2, AlertTriangle, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Props {
  endpointId: string;
  hostname: string;
  meshAgentState?: "not_installed" | "installing" | "installed" | "failed" | "uninstalling";
}

/**
 * SOC operator clicks "Remote Desktop" -> reason capture -> mesh-session-start
 * mints a deep-link URL -> we open a full-screen Mithras-branded dialog with
 * MeshCentral embedded in an iframe (chrome stripped via ?hide=63). The
 * operator never leaves Mithras.
 *
 * First time per browser session the iframe will show MeshCentral's login;
 * the cookie persists from there on. Phase B will mint a single-use login
 * token server-side so this is invisible.
 */
export function RemoteDesktopButton({ endpointId, hostname, meshAgentState = "not_installed" }: Props) {
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sessionUrl, setSessionUrl] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const installed = meshAgentState === "installed";

  const handleStart = async () => {
    if (!reason.trim()) {
      toast({ title: "Reason required", description: "Please enter the reason for this remote session.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("mesh-session-start", {
        body: { endpoint_id: endpointId, reason, view_mode: "desktop" },
      });
      if (error) throw error;
      const url = (data as { url?: string })?.url;
      if (!url) throw new Error("server did not return a session URL");
      setSessionUrl(url);
      setConfirmOpen(false);
      setReason("");
    } catch (e) {
      toast({
        title: "Failed to start remote session",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Dialog open={confirmOpen} onOpenChange={(o) => installed && setConfirmOpen(o)}>
        <DialogTrigger asChild>
          <Button
            variant="default"
            className="gap-1.5"
            disabled={!installed}
            title={installed ? undefined : `Install Remote Access on ${hostname} first (state: ${meshAgentState}).`}
          >
            <Monitor className="h-4 w-4" />
            Remote Desktop
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Monitor className="h-5 w-5" />
              Open Remote Desktop session
            </DialogTitle>
            <DialogDescription>
              Opens an embedded remote-desktop session to <b>{hostname}</b>.
              The session runs inside Mithras and is fully audited.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                First session per browser asks you to log in to the embedded
                transport once; subsequent clicks open directly onto the
                device.
              </AlertDescription>
            </Alert>

            <div className="space-y-1.5">
              <Label htmlFor="rd-reason">Reason for session (required, logged)</Label>
              <Input
                id="rd-reason"
                placeholder="e.g. Incident #4521 — assist user with file recovery"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={submitting}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleStart} disabled={submitting || !reason.trim()} className="gap-1.5">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Monitor className="h-4 w-4" />}
              Start session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Full-screen embed dialog — the actual remote-desktop pane lives here */}
      {sessionUrl && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-background outline-none"
          tabIndex={-1}
          autoFocus
          onKeyDown={(e) => {
            // Keyboard escape route. The iframe inside captures most key
            // events once it has focus, but the header div retains focus
            // long enough on initial mount that Escape closes the session.
            // Operators with muscle memory expect Esc on a modal/overlay.
            if (e.key === "Escape") {
              e.stopPropagation();
              setSessionUrl(null);
            }
          }}>
          <div className="flex items-center justify-between gap-3 border-b bg-card px-4 py-2">
            <div className="flex items-center gap-2">
              <Monitor className="h-5 w-5 text-primary" />
              <div>
                <div className="text-sm font-semibold">Remote Desktop · {hostname}</div>
                <div className="text-xs text-muted-foreground">
                  Session is audited. Close this window to end it.
                </div>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSessionUrl(null)}
              className="gap-1.5"
            >
              <X className="h-4 w-4" />
              End session
            </Button>
          </div>
          <iframe
            src={sessionUrl}
            className="flex-1 w-full border-0"
            allow="fullscreen; clipboard-read; clipboard-write"
            title={`Remote desktop session for ${hostname}`}
          />
        </div>
      )}
    </>
  );
}
