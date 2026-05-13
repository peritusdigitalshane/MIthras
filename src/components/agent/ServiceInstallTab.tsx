import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, Copy, CheckCircle, Loader2, RefreshCw, Shield } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface ServiceInstallTabProps {
  organizationId: string | null;
}

interface InstallerManifest {
  token: string;
  runtime: "powershell" | "dotnet";
  latest_version: string;
  download_url: string;
  sha256: string;
  ed25519_sig: string;
  api_base_url: string;
}

const ServiceInstallTab = ({ organizationId }: ServiceInstallTabProps) => {
  const { toast } = useToast();
  const [manifest, setManifest] = useState<InstallerManifest | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generateInstallCommand = async () => {
    if (!organizationId) {
      setError("No organization selected.");
      return;
    }

    setIsGenerating(true);
    setError(null);
    setManifest(null);

    try {
      // 1. Mint an enrolment token via the SECURITY DEFINER RPC.
      const { data: tokenRows, error: rpcError } = await supabase.rpc("create_enrollment_token", {
        p_org_id: organizationId,
        p_runtime_hint: "powershell",
        p_channel: "stable",
        p_hostname_hint: null,
      });

      if (rpcError) throw new Error(rpcError.message ?? "Token creation failed");
      const token = Array.isArray(tokenRows) ? tokenRows[0]?.token : (tokenRows as { token?: string } | null)?.token;
      if (!token) throw new Error("Token creation returned no token");

      // 2. Resolve the latest release manifest for { runtime, channel } via agent-installer.
      //    The function uses query-string params; supabase.functions.invoke doesn't expose those
      //    cleanly for GET, so we call it directly.
      const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "");
      const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const installerUrl = new URL(`${supabaseUrl}/functions/v1/agent-installer`);
      installerUrl.searchParams.set("token", token);
      installerUrl.searchParams.set("runtime", "powershell");
      const installerResp = await fetch(installerUrl.toString(), { headers: { apikey: anon } });
      if (!installerResp.ok) {
        const errBody = await installerResp.text();
        throw new Error(`agent-installer ${installerResp.status}: ${errBody}`);
      }
      const installerData = (await installerResp.json()) as InstallerManifest;

      setManifest(installerData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate install command");
    } finally {
      setIsGenerating(false);
    }
  };

  const oneLiner = manifest
    ? [
        "$ErrorActionPreference='Stop'",
        `$zip = Join-Path $env:TEMP "peritus-agent-${manifest.latest_version}.zip"`,
        '$dir = Join-Path $env:TEMP "peritus-agent-install"',
        `Invoke-WebRequest -Uri "${manifest.download_url}" -OutFile $zip -UseBasicParsing`,
        `if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne "${manifest.sha256}") { throw "SHA256 mismatch — refusing to install." }`,
        "if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }",
        "Expand-Archive -Path $zip -DestinationPath $dir -Force",
        `& (Join-Path $dir "install-agent.ps1") -EnrollmentToken "${manifest.token}" -ApiBaseUrl "${manifest.api_base_url}"`,
      ].join("; ")
    : "";

  const handleCopy = async () => {
    await navigator.clipboard.writeText(oneLiner);
    setCopied(true);
    toast({ title: "Install command copied to clipboard" });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4 mt-4">
      <Alert>
        <Shield className="h-4 w-4" />
        <AlertTitle>Phase 2 — runs as a Windows service via NSSM</AlertTitle>
        <AlertDescription>
          The modern agent installs as the <code>PeritusSecureAgent</code> Windows service. It signs every API call
          with a per-endpoint HMAC secret stored under DPAPI (LocalMachine scope). Each install command is single-use
          and expires in 7 days.
        </AlertDescription>
      </Alert>

      {!manifest && (
        <Button onClick={generateInstallCommand} disabled={isGenerating || !organizationId} className="gap-2">
          {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
          Generate install command
        </Button>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Failed to generate command</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {manifest && (
        <>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <Label className="text-muted-foreground">Agent version</Label>
              <p className="font-mono">{manifest.latest_version}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Runtime</Label>
              <p className="font-mono">{manifest.runtime}</p>
            </div>
            <div className="col-span-2">
              <Label className="text-muted-foreground">SHA-256 (verified by installer)</Label>
              <p className="font-mono text-xs break-all">{manifest.sha256}</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Run this in an elevated PowerShell on the target endpoint:</Label>
            <div className="relative">
              <pre className="rounded-lg bg-secondary/50 p-4 text-xs overflow-x-auto max-h-72">
                <code>{oneLiner}</code>
              </pre>
              <Button variant="outline" size="sm" className="absolute top-2 right-2 gap-1.5" onClick={handleCopy}>
                {copied ? <CheckCircle className="h-3.5 w-3.5 text-status-healthy" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" onClick={generateInstallCommand} disabled={isGenerating} className="gap-2">
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Regenerate (new token)
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            The enrolment token above expires 7 days after generation and is single-use — once an endpoint installs
            with it, it can't be reused.
          </p>
        </>
      )}
    </div>
  );
};

export default ServiceInstallTab;
