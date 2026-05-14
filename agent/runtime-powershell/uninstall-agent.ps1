#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Remove the Peritus Secure Agent from this machine.
.DESCRIPTION
    Stops and removes the Windows service, deletes installed files, removes the DPAPI config.
    Optionally also removes the legacy scheduled task "PeritusSecureAgent" if present.
.PARAMETER KeepLogs
    Preserve log files at C:\ProgramData\PeritusSecure\logs\ for forensics.
.PARAMETER ServiceName
    Optional override for the service name. Default: PeritusSecureAgent
#>
[CmdletBinding()]
param(
    [string]$ServiceName = 'PeritusSecureAgent',
    [switch]$KeepLogs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$AgentRoot   = 'C:\ProgramData\PeritusSecure'
$InstallRoot = Join-Path $AgentRoot 'install'
$LogDir      = Join-Path $AgentRoot 'logs'
$NssmExe     = Join-Path $InstallRoot 'vendor\nssm.exe'

function Write-Step { param([string]$Msg) Write-Host "[uninstall] $Msg" }

# 1. Stop and remove the service via NSSM (preferred) or sc.exe (fallback)
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
    Write-Step "Stopping service '$ServiceName'"
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue

    if (Test-Path $NssmExe) {
        Write-Step "Removing service via NSSM"
        & $NssmExe remove $ServiceName confirm | Out-Null
    } else {
        Write-Step "Removing service via sc.exe"
        & sc.exe delete $ServiceName | Out-Null
    }
} else {
    Write-Step "Service '$ServiceName' not present, skipping"
}

# 2. Remove legacy scheduled task if it exists
$legacyTask = Get-ScheduledTask -TaskName 'PeritusSecureAgent' -ErrorAction SilentlyContinue
if ($legacyTask) {
    Write-Step "Removing legacy scheduled task"
    Unregister-ScheduledTask -TaskName 'PeritusSecureAgent' -Confirm:$false
}

# 3. Remove files
if (Test-Path $InstallRoot) {
    Write-Step "Removing $InstallRoot"
    Remove-Item -Path $InstallRoot -Recurse -Force -ErrorAction SilentlyContinue
}

$configFile = Join-Path $AgentRoot 'config.dat'
if (Test-Path $configFile) {
    Write-Step "Removing DPAPI config"
    Remove-Item -Path $configFile -Force -ErrorAction SilentlyContinue
}

if (-not $KeepLogs -and (Test-Path $LogDir)) {
    Write-Step "Removing logs"
    Remove-Item -Path $LogDir -Recurse -Force -ErrorAction SilentlyContinue
}

# Remove the AgentRoot directory if it's now empty
if ((Test-Path $AgentRoot) -and -not (Get-ChildItem $AgentRoot -Force)) {
    Remove-Item -Path $AgentRoot -Force -ErrorAction SilentlyContinue
}

Write-Step "Done."
