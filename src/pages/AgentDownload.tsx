import { useCallback, useEffect, useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, Copy, CheckCircle, Shield, Terminal, Clock, Zap, AlertCircle, Loader2, MonitorSmartphone, Apple, Smartphone, Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useTenant } from "@/contexts/TenantContext";
import ServiceInstallTab from "@/components/agent/ServiceInstallTab";
import InstallerTab from "@/components/agent/InstallerTab";
import MacInstallTab from "@/components/agent/MacInstallTab";

// Always read the API base from the same env the supabase client uses, so
// the platform never accidentally hits the cloud project.
const AGENT_SCRIPT_BASE_URL = `${((import.meta.env.VITE_SUPABASE_URL as string) ?? "").replace(/\/$/, "")}/functions/v1/agent-script`;

const REMOVAL_SCRIPT = String.raw`#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Removes the Mithras Threat Defence Agent from this machine.
.DESCRIPTION
    Stops the MithrasAgent service (and any leftover PeritusSecureAgent), kills
    straggler agent + tray processes, removes scheduled tasks + Startup-folder
    launchers, deletes both C:\ProgramData\Mithras and C:\ProgramData\PeritusSecure.
#>

$ErrorActionPreference = "SilentlyContinue"

Write-Host "=== Mithras Threat Defence Agent Removal ===" -ForegroundColor Cyan

# 1. Stop + remove services (new MithrasAgent + legacy PeritusSecureAgent).
Write-Host "[1/6] Stopping services..." -ForegroundColor Yellow
foreach ($svc in 'MithrasAgent','PeritusSecureAgent') {
    if (Get-Service -Name $svc -ErrorAction SilentlyContinue) {
        Stop-Service -Name $svc -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
        foreach ($nssm in 'C:\ProgramData\Mithras\install\vendor\nssm.exe','C:\ProgramData\PeritusSecure\install\vendor\nssm.exe') {
            if (Test-Path $nssm) { & $nssm remove $svc confirm 2>&1 | Out-Null }
        }
        sc.exe delete $svc 2>&1 | Out-Null
        Write-Host "  Removed service: $svc" -ForegroundColor Green
    }
}

# 2. Kill straggler agent + tray PowerShell processes.
Write-Host "[2/6] Killing straggler processes..." -ForegroundColor Yellow
try {
    $myPid = $PID
    Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object {
        $_.ProcessId -ne $myPid -and $_.CommandLine -and (
            $_.CommandLine -like "*mithras-agent.ps1*"     -or
            $_.CommandLine -like "*mithras-tray.ps1*"      -or
            $_.CommandLine -like "*peritus-secure-agent*"  -or
            $_.CommandLine -like "*PeritusSecure\install*"
        )
    } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
} catch {}

# 3. Remove legacy scheduled tasks + Startup-folder launcher.
Write-Host "[3/6] Removing scheduled tasks + Startup entries..." -ForegroundColor Yellow
foreach ($task in 'PeritusSecureAgent','PeritusSecureTray','MithrasAgent','MithrasTray') {
    if (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $task -Confirm:$false
    }
}
$vbs = "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp\Mithras-Tray.vbs"
if (Test-Path $vbs) { Remove-Item $vbs -Force -ErrorAction SilentlyContinue }

# 4. Clean registry Run entries.
Write-Host "[4/6] Cleaning registry entries..." -ForegroundColor Yellow
Remove-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" -Name "PeritusSecureTray" -ErrorAction SilentlyContinue
Remove-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" -Name "MithrasTray"        -ErrorAction SilentlyContinue

# 5. Delete agent directories (new + legacy).
Write-Host "[5/6] Removing agent files..." -ForegroundColor Yellow
foreach ($path in 'C:\ProgramData\Mithras','C:\ProgramData\PeritusSecure') {
    if (Test-Path $path) {
        Remove-Item -Path $path -Recurse -Force -ErrorAction SilentlyContinue
        if (-not (Test-Path $path)) { Write-Host "  Removed: $path" -ForegroundColor Green }
        else { Write-Host "  Partial removal: $path (some files locked)" -ForegroundColor Gray }
    }
}

# 6. Summary.
Write-Host "[6/6] Cleanup complete." -ForegroundColor Yellow
Write-Host ""
Write-Host "Mithras Threat Defence Agent has been removed." -ForegroundColor Green
Write-Host "Note: the endpoint stays visible in the dashboard until you soft-delete it." -ForegroundColor Gray`;

const stripUtf8Bom = (value: string) => value.replace(/^\uFEFF/, "");

const extractAgentVersion = (script: string) => {
  const variableVersion = script.match(/\$AgentVersion\s*=\s*"([^"]+)"/)?.[1];
  const notesVersion = script.match(/Version:\s*([^\r\n]+)/)?.[1]?.trim();
  return variableVersion || notesVersion || null;
};

const AgentDownload = () => {
  const { currentOrganization, isLoading } = useTenant();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [latestScript, setLatestScript] = useState("");
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [isFetchingLatestScript, setIsFetchingLatestScript] = useState(false);
  const [scriptLoadError, setScriptLoadError] = useState<string | null>(null);

  const orgId = currentOrganization?.id || null;
  const orgName = currentOrganization?.name || null;
  const error = !isLoading && !currentOrganization ? "No organization found. Please contact support." : null;

  const agentScriptUrl = useMemo(
    () => (orgId ? `${AGENT_SCRIPT_BASE_URL}?org=${encodeURIComponent(orgId)}` : ""),
    [orgId]
  );

  const oneLinerCommand = useMemo(() => {
    if (!agentScriptUrl) return "";
    // The agent-script edge function returns a self-contained bootstrap that
    // downloads the latest Mithras bundle, verifies SHA256, extracts, and runs
    // install-agent.ps1. iex executes it directly -- no temp file needed.
    return `iex (irm "${agentScriptUrl}")`;
  }, [agentScriptUrl]);

  const fetchLatestScript = useCallback(async () => {
    if (!agentScriptUrl) {
      throw new Error("No organization found.");
    }

    setIsFetchingLatestScript(true);
    setScriptLoadError(null);

    try {
      const response = await fetch(`${agentScriptUrl}&t=${Date.now()}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const scriptText = stripUtf8Bom(new TextDecoder("utf-8").decode(new Uint8Array(arrayBuffer)));

      setLatestScript(scriptText);
      setLatestVersion(extractAgentVersion(scriptText));
      setScriptLoadError(null);

      return { arrayBuffer, scriptText };
    } catch (fetchError) {
      const message = fetchError instanceof Error ? fetchError.message : "Unable to load the latest agent script.";
      setScriptLoadError(message);
      throw fetchError;
    } finally {
      setIsFetchingLatestScript(false);
    }
  }, [agentScriptUrl]);

  // Try to pre-fetch on mount, but don't block the UI if it fails
  useEffect(() => {
    if (!agentScriptUrl) {
      setLatestScript("");
      setLatestVersion(null);
      setScriptLoadError(null);
      return;
    }

    // Silently attempt to pre-load; errors are non-blocking
    void fetchLatestScript().catch(() => {
      // Clear error so user doesn't see it until they actually click
      setScriptLoadError(null);
    });
  }, [agentScriptUrl, fetchLatestScript]);

  const handleCopy = async () => {
    try {
      const { scriptText } = await fetchLatestScript();
      await navigator.clipboard.writeText(scriptText);
      setCopied(true);
      toast({
        title: "Copied to clipboard",
        description: "Latest PowerShell script has been copied.",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (copyError) {
      toast({
        title: "Copy failed",
        description: copyError instanceof Error ? copyError.message : "Unable to fetch the latest script.",
        variant: "destructive",
      });
    }
  };

  const handleDownload = async () => {
    try {
      const { arrayBuffer } = await fetchLatestScript();
      const blob = new Blob([arrayBuffer], { type: "text/plain; charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "MithrasInstaller.ps1";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Download started",
        description: "MithrasInstaller.ps1 is downloading.",
      });
    } catch (downloadError) {
      toast({
        title: "Download failed",
        description: downloadError instanceof Error ? downloadError.message : "Unable to download the latest agent script.",
        variant: "destructive",
      });
    }
  };

  const handleCopyRemovalScript = async () => {
    await navigator.clipboard.writeText(REMOVAL_SCRIPT);
    toast({ title: "Removal script copied to clipboard" });
  };

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  if (error || !orgId) {
    return (
      <MainLayout>
        <div className="space-y-6 max-w-4xl">
          <div>
            <h1 className="text-2xl font-bold">Deploy Agent</h1>
            <p className="text-muted-foreground">
              Install the Mithras agent across your fleet — Windows (production), Linux / macOS (coming soon), and iOS / Android via MDM integrations
            </p>
          </div>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Unable to Generate Deployment Script</AlertTitle>
            <AlertDescription>
              {error || "No organization found. Please ensure you're part of an organization."}
            </AlertDescription>
          </Alert>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6 max-w-4xl">
        <div>
          <h1 className="text-2xl font-bold">Deploy Agent</h1>
          <p className="text-muted-foreground">
            Download and install the Mithras Threat Defence agent on your Windows endpoints
          </p>
          {orgName && (
            <p className="text-sm text-muted-foreground mt-1">
              Organization: <span className="font-medium text-foreground">{orgName}</span>
            </p>
          )}
          {latestVersion && (
            <p className="text-sm text-muted-foreground mt-1">
              Live agent script version: <span className="font-medium text-foreground">{latestVersion}</span>
            </p>
          )}
        </div>

        <Card className="border-border/40">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              Requirements
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-start gap-3">
                <CheckCircle className="h-5 w-5 text-status-healthy mt-0.5" />
                <div>
                  <p className="font-medium">Windows 10/11</p>
                  <p className="text-sm text-muted-foreground">Build 1709 or later</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle className="h-5 w-5 text-status-healthy mt-0.5" />
                <div>
                  <p className="font-medium">PowerShell 5.1+</p>
                  <p className="text-sm text-muted-foreground">Included in Windows</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle className="h-5 w-5 text-status-healthy mt-0.5" />
                <div>
                  <p className="font-medium">Administrator</p>
                  <p className="text-sm text-muted-foreground">Run as admin required</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/40">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Terminal className="h-5 w-5 text-primary" />
              Installation
            </CardTitle>
            <CardDescription>
              All install options below pull from the same live agent-script endpoint.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="windows" className="w-full">
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="windows" className="gap-1.5"><MonitorSmartphone className="h-3.5 w-3.5" /> Windows</TabsTrigger>
                <TabsTrigger value="linux" className="gap-1.5"><Server className="h-3.5 w-3.5" /> Linux</TabsTrigger>
                <TabsTrigger value="macos" className="gap-1.5"><Apple className="h-3.5 w-3.5" /> macOS</TabsTrigger>
                <TabsTrigger value="ios" className="gap-1.5"><Smartphone className="h-3.5 w-3.5" /> iOS</TabsTrigger>
                <TabsTrigger value="android" className="gap-1.5"><Smartphone className="h-3.5 w-3.5" /> Android</TabsTrigger>
              </TabsList>

              {/* ─── Windows tab ─── */}
              <TabsContent value="windows" className="mt-4">
                <Tabs defaultValue="installer" className="w-full">
                  <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="installer">Installer (.exe)</TabsTrigger>
                    <TabsTrigger value="service">Service (PowerShell)</TabsTrigger>
                    <TabsTrigger value="download">Download Script</TabsTrigger>
                    <TabsTrigger value="oneliner">Legacy One-Liner</TabsTrigger>
                  </TabsList>

                  <TabsContent value="installer">
                    <InstallerTab organizationId={orgId} />
                  </TabsContent>

                  <TabsContent value="service">
                    <ServiceInstallTab organizationId={orgId} />
                  </TabsContent>

              <TabsContent value="download" className="space-y-4 mt-4">
                {scriptLoadError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Script load error</AlertTitle>
                    <AlertDescription>
                      {scriptLoadError} — Click Download or Copy to retry.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="flex gap-3">
                  <Button
                    onClick={handleDownload}
                    className="gap-2"
                    disabled={isFetchingLatestScript || !agentScriptUrl}
                  >
                    {isFetchingLatestScript ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    Download MithrasInstaller.ps1
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleCopy}
                    className="gap-2"
                    disabled={isFetchingLatestScript || !agentScriptUrl}
                  >
                    {copied ? (
                      <CheckCircle className="h-4 w-4 text-status-healthy" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    {copied ? "Copied!" : "Copy Script"}
                  </Button>
                </div>

                <div className="rounded-lg bg-secondary/50 p-4">
                  <p className="text-sm font-medium mb-2">Run the script as Administrator:</p>
                  <code className="text-xs text-muted-foreground">
                    powershell.exe -ExecutionPolicy Bypass -File .\MithrasInstaller.ps1
                  </code>
                </div>
              </TabsContent>

                  <TabsContent value="oneliner" className="space-y-4 mt-4">
                    <div className="space-y-2">
                      <Label>Run this command in an elevated PowerShell:</Label>
                      <div className="relative">
                        <pre className="rounded-lg bg-secondary/50 p-4 text-xs overflow-x-auto">
                          <code>{oneLinerCommand}</code>
                        </pre>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      This pulls the live Mithras bootstrap installer (the same one the Download button serves) and runs it in-memory via Invoke-Expression. Bootstrap downloads the latest agent bundle, verifies its SHA256, extracts it, and runs install-agent.ps1.
                    </p>
                  </TabsContent>
                </Tabs>
              </TabsContent>

              {/* ─── Linux tab ─── */}
              <TabsContent value="linux" className="mt-4 space-y-4">
                <Alert>
                  <Server className="h-4 w-4" />
                  <AlertTitle className="flex items-center gap-2">Linux agent <Badge variant="outline" className="text-[10px] uppercase tracking-wider bg-status-healthy/10 text-status-healthy border-status-healthy/30">v0.1 — beta</Badge></AlertTitle>
                  <AlertDescription className="text-xs space-y-1 mt-1">
                    <p>Single Go binary running as a systemd service. Same HMAC-signed channel as the Windows agent. Heartbeats every 60s, software inventory hourly, auth events streamed from <code>journalctl</code>.</p>
                    <p>Supported: Ubuntu 22.04+, Debian 12+, RHEL 9+, Rocky 9+, AlmaLinux 9+, Amazon Linux 2023. x86_64 + arm64.</p>
                  </AlertDescription>
                </Alert>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">One-line install</CardTitle>
                    <CardDescription className="text-xs">Run as root on the Linux box. Mint a fresh enrolment token below first.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <pre className="rounded-lg bg-secondary/50 p-3 text-[11px] overflow-x-auto">
                      <code>{`curl -fsSL https://api.mithras.com.au/agent/install-linux.sh | sudo bash -s -- --token=<ENROLMENT_TOKEN>`}</code>
                    </pre>
                    <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <div><strong className="text-foreground">Status:</strong> <code>systemctl status mithras-agent</code></div>
                      <div><strong className="text-foreground">Logs:</strong> <code>journalctl -u mithras-agent -f</code></div>
                      <div><strong className="text-foreground">Config:</strong> <code>/etc/peritus/config.json</code></div>
                      <div><strong className="text-foreground">Binary:</strong> <code>/usr/local/bin/mithras-agent</code></div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">What gets collected</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="text-xs space-y-1 list-disc pl-5">
                      <li>Hostname, OS pretty-name, kernel, uptime, /etc/os-release</li>
                      <li>Package inventory via <code>dpkg-query</code> or <code>rpm -qa</code> (hourly)</li>
                      <li>Auth events from <code>journalctl -u ssh -u sshd -u sudo</code> (sshd Accepted/Failed Password, sudo COMMAND, new user, invalid user)</li>
                      <li>Listening ports via <code>ss -Hlntu</code></li>
                      <li><code>auditd</code> service state</li>
                    </ul>
                  </CardContent>
                </Card>

                <Card className="border-dashed">
                  <CardContent className="p-4 space-y-2">
                    <div className="text-sm font-medium">Not yet on Linux (roadmap)</div>
                    <ul className="text-xs text-muted-foreground space-y-0.5 list-disc pl-5">
                      <li>Active response commands (isolate, kill, scan)</li>
                      <li>Policy enforcement (firewall via iptables/nftables, AppArmor/SELinux state)</li>
                      <li>WDAC-equivalent (AppArmor profile generation)</li>
                      <li>Self-update via signed releases</li>
                    </ul>
                    <p className="text-xs text-muted-foreground pt-1">
                      Email <a className="underline" href="mailto:support@mithras.com.au?subject=Linux%20agent%20feedback">support@mithras.com.au</a> with what would unblock you.
                    </p>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ─── macOS tab ─── */}
              <TabsContent value="macos" className="mt-4">
                <MacInstallTab organizationId={orgId} />
              </TabsContent>

              {/* ─── iOS tab ─── */}
              <TabsContent value="ios" className="mt-4 space-y-4">
                <Alert>
                  <Smartphone className="h-4 w-4" />
                  <AlertTitle className="flex items-center gap-2">iOS — MDM integration model <Badge variant="outline" className="text-[10px] uppercase tracking-wider">Coming soon</Badge></AlertTitle>
                  <AlertDescription className="text-xs space-y-2 mt-1">
                    <p>Apple doesn't allow general-purpose security agents on iOS. The right path is to integrate with an MDM that's already managing the device. Mithras will:</p>
                    <ul className="list-disc pl-5 space-y-0.5">
                      <li>Pull device posture (jailbreak, OS version, encryption, MDM-enrolment state) from your MDM's API</li>
                      <li>Surface lost-mode / wipe controls in the Mithras console alongside Windows endpoints</li>
                      <li>Correlate iOS sign-ins with your SSO provider's risk signals</li>
                      <li>Apply baseline restrictions via configuration profiles</li>
                    </ul>
                  </AlertDescription>
                </Alert>

                <Card className="border-dashed">
                  <CardContent className="p-4 space-y-2">
                    <div className="text-sm font-medium">Supported MDM connectors (roadmap)</div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {["Jamf Pro", "Microsoft Intune", "Kandji", "Mosyle", "Apple Business Manager", "Hexnode"].map(n => (
                        <Badge key={n} variant="outline" className="text-[10px]">{n}</Badge>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground pt-2">
                      Email <a className="underline" href="mailto:support@mithras.com.au?subject=iOS%20MDM%20connector">support@mithras.com.au</a> with your MDM of choice — we prioritise connectors by customer demand.
                    </p>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ─── Android tab ─── */}
              <TabsContent value="android" className="mt-4 space-y-4">
                <Alert>
                  <Smartphone className="h-4 w-4" />
                  <AlertTitle className="flex items-center gap-2">Android — MDM integration model <Badge variant="outline" className="text-[10px] uppercase tracking-wider">Coming soon</Badge></AlertTitle>
                  <AlertDescription className="text-xs space-y-2 mt-1">
                    <p>Android Enterprise (Google's official management framework) and Samsung Knox are the only credible paths for managing Android at the OS level. Mithras will integrate with these via their MDM partners:</p>
                    <ul className="list-disc pl-5 space-y-0.5">
                      <li>Device posture (OS version, security patch level, work profile state)</li>
                      <li>App inventory + compliance signals</li>
                      <li>Lost-mode / remote wipe</li>
                      <li>Knox attestation for high-security customers</li>
                    </ul>
                  </AlertDescription>
                </Alert>

                <Card className="border-dashed">
                  <CardContent className="p-4 space-y-2">
                    <div className="text-sm font-medium">Supported MDM connectors (roadmap)</div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {["Microsoft Intune", "Google Workspace MDM", "Samsung Knox Manage", "Jamf Pro", "Hexnode", "Scalefusion"].map(n => (
                        <Badge key={n} variant="outline" className="text-[10px]">{n}</Badge>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground pt-2">
                      Email <a className="underline" href="mailto:support@mithras.com.au?subject=Android%20MDM%20connector">support@mithras.com.au</a> to register interest in a specific connector.
                    </p>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <Card className="border-border/40">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              What Happens When You Run It
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                  1
                </div>
                <div>
                  <p className="font-medium">Agent Registers</p>
                  <p className="text-sm text-muted-foreground">
                    The agent registers this endpoint with your organization
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                  2
                </div>
                <div>
                  <p className="font-medium">Scheduled Task Created</p>
                  <p className="text-sm text-muted-foreground">
                    A Windows scheduled task is automatically created to run every 60 seconds
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                  3
                </div>
                <div>
                  <p className="font-medium">Runs Silently in Background</p>
                  <p className="text-sm text-muted-foreground">
                    No window stays open - the agent runs as a background service
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                  4
                </div>
                <div>
                  <p className="font-medium">Continuous Monitoring</p>
                  <p className="text-sm text-muted-foreground">
                    Defender status and threats are reported automatically, even after reboots
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/40">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              Agent Management
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium mb-2">View agent logs:</p>
              <code className="text-xs bg-secondary/50 p-2 rounded block">
                {`Get-Content (Get-ChildItem "$env:ProgramData\\Mithras\\logs\\agent-*.log" | Sort LastWriteTime -Descending | Select-Object -First 1) -Tail 50`}
              </code>
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Uninstall agent:</p>
              <code className="text-xs bg-secondary/50 p-2 rounded block">
                {`powershell -File "$env:ProgramData\\Mithras\\install\\uninstall-agent.ps1"`}
              </code>
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Check service status:</p>
              <code className="text-xs bg-secondary/50 p-2 rounded block">
                Get-Service MithrasAgent
              </code>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/40">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Terminal className="h-5 w-5 text-destructive" />
              Remove Agent (PowerShell Script)
            </CardTitle>
            <CardDescription>
              Run this script as Administrator to completely remove the Mithras agent (and any legacy PeritusSecure install) from an endpoint.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <pre className="rounded-lg bg-secondary/50 p-4 text-xs overflow-x-auto max-h-80">
                <code>{REMOVAL_SCRIPT}</code>
              </pre>
              <Button
                variant="outline"
                size="sm"
                className="absolute top-2 right-2 gap-1.5"
                onClick={handleCopyRemovalScript}
              >
                <Copy className="h-3.5 w-3.5" />
                Copy
              </Button>
            </div>
            <div className="rounded-lg bg-secondary/50 p-4">
              <p className="text-sm font-medium mb-2">Run as Administrator:</p>
              <code className="text-xs text-muted-foreground">
                powershell.exe -ExecutionPolicy Bypass -File .\RemoveMithrasAgent.ps1
              </code>
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
};

export default AgentDownload;
