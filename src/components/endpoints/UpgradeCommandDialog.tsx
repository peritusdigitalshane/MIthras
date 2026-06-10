import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Copy, Check, ArrowUpCircle, Loader2 } from "lucide-react";
import { useLatestAgentVersion } from "@/hooks/useDashboardData";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

interface UpgradeCommandDialogProps {
  hostname: string;
  currentVersion: string | null | undefined;
  /** trigger style: "icon" = small pill next to a badge; "button" = full button on a card. */
  variant?: "icon" | "button";
}

/**
 * Click-to-copy upgrade command for outdated agents.
 *
 * Why this exists: legacy bearer-token agents (<=0.4.5) have no Updater
 * module so they can't self-update. Modern agents do self-update via
 * /agent-version-check but stuck endpoints (offline at the time, or with a
 * stuck swap) need an operator nudge. This dialog gives the operator a
 * one-liner they can RDP/RMM-push to the box.
 *
 * The one-liner pulls the latest manifest, downloads the bundle, verifies
 * sha256, extracts, and runs install-agent.ps1 -- which auto-detects the
 * existing config and migrates legacy bearer-token agents to HMAC without
 * creating a duplicate endpoint.
 */
export function UpgradeCommandDialog({ hostname, currentVersion, variant = "icon" }: UpgradeCommandDialogProps) {
  const { data: latestVersion } = useLatestAgentVersion();
  const [copied, setCopied] = useState(false);

  // Pull the full manifest -- need download_url + sha256, not just version.
  const { data: manifest, isLoading } = useQuery({
    queryKey: ["agent-version-manifest", latestVersion],
    enabled: !!latestVersion,
    queryFn: async () => {
      const { data } = await supabase
        .from("agent_versions")
        .select("version, download_url, sha256")
        .eq("runtime", "powershell")
        .eq("channel", "stable")
        .eq("is_active", true)
        .order("published_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const isLegacy = currentVersion ? compareSemver(currentVersion, "0.5.0") < 0 : false;

  const oneliner = manifest
    ? buildOneLiner(manifest.download_url, manifest.sha256)
    : null;

  const copyToClipboard = async () => {
    if (!oneliner) return;
    try {
      await navigator.clipboard.writeText(oneliner);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* no-op */
    }
  };

  const trigger =
    variant === "button" ? (
      <Button size="sm" variant="outline" className="gap-1.5">
        <ArrowUpCircle className="h-4 w-4" />
        Show upgrade command
      </Button>
    ) : (
      <button
        type="button"
        className="inline-flex h-4 items-center rounded-sm px-1 text-[10px] font-medium uppercase tracking-wide text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
        aria-label="Show upgrade command"
      >
        Upgrade
      </button>
    );

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowUpCircle className="h-5 w-5 text-amber-500" />
            Upgrade agent on {hostname}
          </DialogTitle>
          <DialogDescription>
            {isLegacy ? (
              <>
                This endpoint is on agent <code>v{currentVersion ?? "?"}</code> which predates the
                self-updater. Run this command on the endpoint as <b>Administrator</b> to upgrade
                to <code>v{manifest?.version ?? "?"}</code>. The installer auto-detects the
                existing config and migrates the legacy token to HMAC — your endpoint_id is preserved.
              </>
            ) : (
              <>
                This endpoint reports <code>v{currentVersion ?? "?"}</code>; current stable is{" "}
                <code>v{manifest?.version ?? "?"}</code>. The agent normally self-updates within
                ~20 min — if it's stuck (offline at the time, or swap failed), paste this command
                on the endpoint as <b>Administrator</b> to force the upgrade.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase text-muted-foreground">
                PowerShell one-liner
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 gap-1.5 px-2 text-xs"
                onClick={copyToClipboard}
                disabled={!oneliner}
              >
                {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            {isLoading ? (
              <div className="flex h-24 items-center justify-center rounded-md border bg-muted/30">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : oneliner ? (
              <pre className="overflow-x-auto rounded-md border bg-muted/30 p-3 text-xs leading-relaxed">
                <code>{oneliner}</code>
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground">No latest version registered yet.</p>
            )}
          </div>

          <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground space-y-1.5">
            <p className="font-medium text-foreground">What this does</p>
            <ol className="list-decimal pl-4 space-y-0.5">
              <li>Downloads <code>{manifest?.version ?? "?"}.zip</code> from Mithras storage</li>
              <li>Verifies SHA-256 (<code>{manifest?.sha256?.slice(0, 12) ?? "…"}…</code>) — refuses to install if mismatch</li>
              <li>Extracts to <code>$env:TEMP\mithras-install</code></li>
              <li>Runs <code>install-agent.ps1</code> — preserves the existing token, replaces the service binary, restarts</li>
              <li>Cleans up the temp folder</li>
            </ol>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={copyToClipboard} disabled={!oneliner} className="gap-1.5">
            {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied to clipboard" : "Copy command"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function buildOneLiner(downloadUrl: string, expectedSha256: string): string {
  // Single line so the operator can paste straight into PowerShell. Each
  // statement uses ; so it stays one block. We verify SHA, extract, run.
  return [
    `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12`,
    `$d = "$env:TEMP\\mithras-install"`,
    `if (Test-Path $d) { Remove-Item $d -Recurse -Force }`,
    `New-Item -ItemType Directory -Path $d -Force | Out-Null`,
    `$z = "$d\\bundle.zip"`,
    `Invoke-WebRequest -Uri "${downloadUrl}" -OutFile $z -UseBasicParsing`,
    `$h = (Get-FileHash -Path $z -Algorithm SHA256).Hash.ToLower()`,
    `if ($h -ne "${expectedSha256.toLowerCase()}") { throw "SHA256 mismatch: got $h" }`,
    `Expand-Archive -Path $z -DestinationPath $d -Force`,
    `& "$d\\install-agent.ps1"`,
    `Remove-Item $d -Recurse -Force -ErrorAction SilentlyContinue`,
  ].join("; ");
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}
