<#
.SYNOPSIS
    Hot-swap a Mithras (Peritus) agent install to a target version with NO re-enrollment.
.DESCRIPTION
    Run from an elevated PowerShell (or via RMM as SYSTEM). The script:
      1. Reads the existing DPAPI config (preserves agent_id + agent_secret).
      2. Downloads the target version's zip from /agent/, verifies SHA256.
      3. Stops the PeritusSecureAgent service.
      4. Backs up the install dir.
      5. Extracts the new bundle to install/, preserves vendor/nssm.exe via merge.
      6. Starts the service.
      7. Writes a verbose transcript to C:\ProgramData\PeritusSecure\logs\force-update.log so
         any failure is captured.

    Idempotent: if the agent is already on the target version, exits successfully without changes.

    Usage:
        iwr https://api.mithras.com.au/agent/force-update-agent.ps1 -UseBasicParsing | iex
#>
[CmdletBinding()]
param(
    [string]$TargetVersion   = '0.4.2',
    [string]$ApiBase         = 'https://api.mithras.com.au',
    [string]$ServiceName     = 'PeritusSecureAgent',
    [string]$AgentRoot       = 'C:\ProgramData\PeritusSecure'
)

$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$LogDir   = Join-Path $AgentRoot 'logs'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
$LogFile  = Join-Path $LogDir 'force-update.log'

function Say($msg) {
    $line = "[$(Get-Date -Format o)] $msg"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

Say "force-update-agent.ps1 starting; target=$TargetVersion api=$ApiBase host=$env:COMPUTERNAME"

# Refuse to run unless elevated.
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Say "ABORT: not elevated. Run as Administrator or via RMM as SYSTEM."
    throw "Not elevated."
}

$installRoot = Join-Path $AgentRoot 'install'
$configFile  = Join-Path $AgentRoot 'config.dat'

if (-not (Test-Path $configFile)) {
    Say "ABORT: $configFile not found - this machine is not enrolled. Run install-agent.ps1 instead."
    throw "No DPAPI config present."
}

# Check installed version - bail out if already on target.
$installedVersionFile = Join-Path $installRoot 'agent.version'
if (Test-Path $installedVersionFile) {
    $installed = (Get-Content $installedVersionFile -Raw).Trim()
    Say "currently installed: $installed"
    if ($installed -eq $TargetVersion) {
        Say "already on $TargetVersion - nothing to do. exiting clean."
        return
    }
}

# Download
$stage  = Join-Path $AgentRoot 'update'
if (Test-Path $stage) { try { Remove-Item -Path $stage -Recurse -Force -ErrorAction Stop } catch { } }
New-Item -ItemType Directory -Path $stage -Force | Out-Null

$zipUrl = "$ApiBase/agent/peritus-secure-agent-$TargetVersion.zip"
$zip    = Join-Path $stage "peritus-secure-agent-$TargetVersion.zip"
Say "downloading $zipUrl"
try {
    Invoke-WebRequest -Uri $zipUrl -OutFile $zip -UseBasicParsing -TimeoutSec 120 -ErrorAction Stop
    $sz = (Get-Item $zip).Length
    Say "downloaded $sz bytes"
} catch {
    Say "ABORT: download failed: $($_.Exception.Message)"
    throw
}

# Fetch the expected SHA from a manifest endpoint OR a sidecar file.
$shaUrl = "$ApiBase/agent/peritus-secure-agent-$TargetVersion.zip.sha256"
$expected = $null
try {
    $expected = (Invoke-WebRequest -Uri $shaUrl -UseBasicParsing -TimeoutSec 15 -ErrorAction Stop).Content.Trim()
    Say "expected sha (sidecar): $expected"
} catch {
    Say "no .sha256 sidecar at $shaUrl - skipping strict verification, trusting HTTPS"
}
$actual = (Get-FileHash -Path $zip -Algorithm SHA256).Hash.ToLower()
Say "downloaded sha: $actual"
if ($expected -and ($actual -ne $expected.ToLower())) {
    Say "ABORT: sha mismatch (expected $expected, got $actual)"
    Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
    throw "SHA mismatch"
}

# Extract
$unpacked = Join-Path $stage 'unpacked'
Say "extracting to $unpacked"
try {
    Expand-Archive -Path $zip -DestinationPath $unpacked -Force -ErrorAction Stop
} catch {
    Say "ABORT: Expand-Archive failed: $($_.Exception.Message)"
    throw
}

# Resolve src root (zip may have a wrapper dir or not)
$children = Get-ChildItem -Path $unpacked -Force
if ($children.Count -eq 1 -and $children[0].PSIsContainer) {
    $srcRoot = $children[0].FullName
} else {
    $srcRoot = $unpacked
}
Say "src root: $srcRoot"

if (-not (Test-Path (Join-Path $srcRoot 'peritus-secure-agent.ps1'))) {
    Say "ABORT: new bundle missing peritus-secure-agent.ps1"
    Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
    throw "Bad bundle"
}
$newVer = (Get-Content (Join-Path $srcRoot 'agent.version') -Raw).Trim()
Say "new bundle version: $newVer"
if ($newVer -ne $TargetVersion) {
    Say "WARN: bundle says $newVer but we requested $TargetVersion. continuing anyway."
}

# Stop service (try gracefully then force)
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
    Say "stopping service $ServiceName (status was $($svc.Status))"
    try {
        Stop-Service -Name $ServiceName -Force -ErrorAction Stop
    } catch {
        Say "Stop-Service failed: $($_.Exception.Message). trying sc stop."
        & sc.exe stop $ServiceName | Out-Null
    }
    # Wait for stop to settle.
    for ($i = 0; $i -lt 15; $i++) {
        $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if (-not $svc -or $svc.Status -ne 'Running') { break }
        Start-Sleep -Seconds 1
    }
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    Say "post-stop status: $($svc.Status)"
} else {
    Say "service not present yet - skipping stop"
}

# Backup the existing install dir before mutating it.
$backup = "$installRoot.bak.$(Get-Date -Format yyyyMMdd-HHmmss)"
if (Test-Path $installRoot) {
    Say "backing up $installRoot -> $backup"
    try {
        Rename-Item -Path $installRoot -NewName (Split-Path $backup -Leaf) -ErrorAction Stop
    } catch {
        Say "rename failed: $($_.Exception.Message). trying Copy-Item fallback."
        Copy-Item -Path $installRoot -Destination $backup -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item -Path $installRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# Copy new files into place. Preserve vendor/nssm.exe from the backup if the new bundle
# happens to be missing it (defensive — our v0.4.x bundles include it).
Say "creating $installRoot and copying new bundle"
New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
Copy-Item -Path (Join-Path $srcRoot '*') -Destination $installRoot -Recurse -Force -ErrorAction Stop

$newNssm = Join-Path $installRoot 'vendor\nssm.exe'
if (-not (Test-Path $newNssm) -and (Test-Path (Join-Path $backup 'vendor\nssm.exe'))) {
    Say "new bundle missing nssm.exe; restoring from backup"
    if (-not (Test-Path (Join-Path $installRoot 'vendor'))) { New-Item -ItemType Directory -Path (Join-Path $installRoot 'vendor') -Force | Out-Null }
    Copy-Item -Path (Join-Path $backup 'vendor\nssm.exe') -Destination $newNssm -Force
}

# Start the service.
Say "starting service $ServiceName"
try {
    Start-Service -Name $ServiceName -ErrorAction Stop
    Start-Sleep -Seconds 3
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    Say "post-start status: $($svc.Status)"
} catch {
    Say "Start-Service failed: $($_.Exception.Message). attempting nssm start."
    $nssm = Join-Path $installRoot 'vendor\nssm.exe'
    if (Test-Path $nssm) { & $nssm start $ServiceName | Out-Null } else { & sc.exe start $ServiceName | Out-Null }
    Start-Sleep -Seconds 3
}

# Final check + clean up stage if successful.
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
$installedNow = if (Test-Path $installedVersionFile) { (Get-Content $installedVersionFile -Raw).Trim() } else { 'unknown' }
Say "FINAL: service=$($svc.Status) installed_version=$installedNow"

if ($svc -and $svc.Status -eq 'Running' -and $installedNow -eq $TargetVersion) {
    Say "SUCCESS - removing stage + backup ($backup)"
    Remove-Item -Path $stage  -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -Path $backup -Recurse -Force -ErrorAction SilentlyContinue
} else {
    Say "WARNING: final check did not match target ($TargetVersion) or service not running. backup retained at $backup."
}
