import { useCallback, useEffect, useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, Copy, CheckCircle, Shield, Terminal, Clock, Zap, AlertCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useTenant } from "@/contexts/TenantContext";
import ServiceInstallTab from "@/components/agent/ServiceInstallTab";

const AGENT_SCRIPT_BASE_URL = "https://njdcyjxgtckgtzgzoctw.supabase.co/functions/v1/agent-script";

const REMOVAL_SCRIPT = String.raw`#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Removes the Peritus Threat Defence Agent from this machine.
.DESCRIPTION
    Stops running agent processes, removes scheduled tasks,
    cleans up configuration files, and removes startup entries.
#>

$ErrorActionPreference = "SilentlyContinue"
$TaskName = "PeritusSecureAgent"
$TrayTaskName = "PeritusSecureTray"
$ConfigPath = "$env:ProgramData\PeritusSecure"

Write-Host "=== Peritus Agent Removal ===" -ForegroundColor Cyan

# 1. Stop any running agent and tray processes
Write-Host "[1/5] Stopping agent processes..." -ForegroundColor Yellow
try {
    $myPid = $PID
    Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object {
        $_.ProcessId -ne $myPid -and $_.CommandLine -like "*PeritusSecure*"
    } | ForEach-Object {
        Write-Host "  Stopping process $($_.ProcessId)..." -ForegroundColor Gray
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
} catch {
    Write-Host "  Could not enumerate processes: $_" -ForegroundColor Gray
}
Write-Host "  Done." -ForegroundColor Green

# 2. Remove scheduled tasks
Write-Host "[2/5] Removing scheduled tasks..." -ForegroundColor Yellow
$mainTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($mainTask) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "  Removed task: $TaskName" -ForegroundColor Green
} else {
    Write-Host "  Task '$TaskName' not found (already removed)" -ForegroundColor Gray
}
$trayTask = Get-ScheduledTask -TaskName $TrayTaskName -ErrorAction SilentlyContinue
if ($trayTask) {
    Unregister-ScheduledTask -TaskName $TrayTaskName -Confirm:$false
    Write-Host "  Removed task: $TrayTaskName" -ForegroundColor Green
} else {
    Write-Host "  Task '$TrayTaskName' not found (already removed)" -ForegroundColor Gray
}

# 3. Remove startup registry entry
Write-Host "[3/5] Cleaning registry entries..." -ForegroundColor Yellow
Remove-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" -Name "PeritusSecureTray" -ErrorAction SilentlyContinue
Write-Host "  Done." -ForegroundColor Green

# 4. Remove configuration directory
Write-Host "[4/5] Removing agent files..." -ForegroundColor Yellow
if (Test-Path $ConfigPath) {
    Remove-Item -Path $ConfigPath -Recurse -Force
    Write-Host "  Removed: $ConfigPath" -ForegroundColor Green
} else {
    Write-Host "  Directory not found (already removed)" -ForegroundColor Gray
}

# 5. Summary
Write-Host "[5/5] Cleanup complete." -ForegroundColor Yellow
Write-Host ""
Write-Host "Peritus Agent has been completely removed." -ForegroundColor Green
Write-Host "Note: The endpoint will remain visible in the dashboard until manually deleted." -ForegroundColor Gray`;

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

    return [
      `$agentUrl = "${agentScriptUrl}" + "&t=" + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()`,
      '$agentPath = Join-Path $env:TEMP "PeritusSecureAgent.ps1"',
      'Invoke-WebRequest -UseBasicParsing -Headers @{ "Cache-Control" = "no-cache" } -Uri $agentUrl -OutFile $agentPath',
      'powershell.exe -ExecutionPolicy Bypass -File $agentPath',
    ].join("; ");
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
      a.download = "PeritusSecureAgent.ps1";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Download started",
        description: "PeritusSecureAgent.ps1 is downloading.",
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
              Download and install the Peritus Threat Defence agent on your Windows endpoints
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
            Download and install the Peritus Threat Defence agent on your Windows endpoints
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
            <Tabs defaultValue="service" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="service">Modern (Service)</TabsTrigger>
                <TabsTrigger value="download">Download Script</TabsTrigger>
                <TabsTrigger value="oneliner">Legacy One-Liner</TabsTrigger>
              </TabsList>

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
                    Download PeritusSecureAgent.ps1
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
                    powershell.exe -ExecutionPolicy Bypass -File .\PeritusSecureAgent.ps1
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
                  This downloads the same live PeritusSecureAgent.ps1 file used by the button above.
                </p>
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
                Get-Content "$env:ProgramData\PeritusSecure\agent.log" -Tail 50
              </code>
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Uninstall agent:</p>
              <code className="text-xs bg-secondary/50 p-2 rounded block">
                powershell -File "$env:ProgramData\PeritusSecure\PeritusSecureAgent.ps1" -Uninstall
              </code>
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Check scheduled task status:</p>
              <code className="text-xs bg-secondary/50 p-2 rounded block">
                Get-ScheduledTask -TaskName "PeritusSecureAgent"
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
              Run this script as Administrator to completely remove the Peritus agent from an endpoint.
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
                powershell.exe -ExecutionPolicy Bypass -File .\RemovePeritusAgent.ps1
              </code>
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
};

export default AgentDownload;
