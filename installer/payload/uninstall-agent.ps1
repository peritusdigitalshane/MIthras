#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Remove the Mithras Threat Defence Agent from this machine.
.DESCRIPTION
    Stops and removes the Windows service, deletes installed files, removes the DPAPI config.
    Also cleans up any legacy PeritusSecure install left behind from before the rebrand.
.PARAMETER KeepLogs
    Preserve log files at C:\ProgramData\Mithras\logs\ for forensics.
.PARAMETER ServiceName
    Optional override for the service name. Default: MithrasAgent
#>
[CmdletBinding()]
param(
    [string]$ServiceName = 'MithrasAgent',
    [switch]$KeepLogs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$AgentRoot   = 'C:\ProgramData\Mithras'
$InstallRoot = Join-Path $AgentRoot 'install'
$LogDir      = Join-Path $AgentRoot 'logs'
$NssmExe     = Join-Path $InstallRoot 'vendor\nssm.exe'

# Legacy locations from the pre-rebrand agent
$LegacyAgentRoot   = 'C:\ProgramData\PeritusSecure'
$LegacyInstallRoot = Join-Path $LegacyAgentRoot 'install'
$LegacyNssmExe     = Join-Path $LegacyInstallRoot 'vendor\nssm.exe'

function Write-Step { param([string]$Msg) Write-Host "[uninstall] $Msg" }

function Remove-AgentService {
    param([string]$Name, [string]$NssmPath)
    $svc = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if (-not $svc) {
        Write-Step "Service '$Name' not present, skipping"
        return
    }

    # v0.6.4: reset tamper-protection DACL + remove watchdog before stop so
    # an admin uninstaller (running as SYSTEM via the installer's elevation)
    # can actually shut down the service. Otherwise hardened DACL blocks even
    # admin-context stop attempts.
    try {
        $tpModule = Join-Path 'C:\ProgramData\Mithras\install\lib' 'TamperProtection.psm1'
        if (Test-Path $tpModule) {
            Import-Module $tpModule -Force
            Reset-MithrasServiceHardening -ServiceName $Name | Out-Null
            Unregister-MithrasWatchdog | Out-Null
            # v0.6.5: also restore default filesystem ACLs so the Remove-Item
            # passes below actually delete install/ + sysmon/ + config.dat.
            try { Reset-MithrasFilesystemHardening | Out-Null } catch {}
            Write-Step "Tamper protection: DACLs reset + watchdog removed"
        }
    } catch {
        Write-Warning "Tamper protection teardown threw: $_ (will try stop anyway)"
    }

    Write-Step "Stopping service '$Name'"
    Stop-Service -Name $Name -Force -ErrorAction SilentlyContinue
    if ($NssmPath -and (Test-Path $NssmPath)) {
        Write-Step "Removing service '$Name' via NSSM"
        & $NssmPath remove $Name confirm | Out-Null
    } else {
        Write-Step "Removing service '$Name' via sc.exe"
        & sc.exe delete $Name | Out-Null
    }
}

# 0. Tear down the tray icon (running in user sessions) + its Startup launcher.
foreach ($vbs in (Join-Path "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp" 'Mithras-Tray.vbs')) {
    if (Test-Path $vbs) {
        Write-Step "Removing tray launcher $vbs"
        Remove-Item -Path $vbs -Force -ErrorAction SilentlyContinue
    }
}
# Kill any running tray instance (powershell.exe -File ...mithras-tray.ps1) in
# every interactive session. Best-effort -- a logged-on user may have to log
# out for full cleanup if the kill is denied.
try {
    Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
        Where-Object { $_.CommandLine -and $_.CommandLine -like '*mithras-tray.ps1*' } |
        ForEach-Object {
            try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
        }
} catch {}

# 1. Remove the Mithras service + any legacy PeritusSecureAgent service.
Remove-AgentService -Name $ServiceName        -NssmPath $NssmExe
Remove-AgentService -Name 'PeritusSecureAgent' -NssmPath $LegacyNssmExe

# 2. Remove any legacy scheduled tasks (the pre-NSSM monolith agent used these).
foreach ($task in 'PeritusSecureAgent','PeritusSecureTray','MithrasAgent') {
    $t = Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
    if ($t) {
        Write-Step "Removing scheduled task '$task'"
        Unregister-ScheduledTask -TaskName $task -Confirm:$false
    }
}

# 3. Remove install dirs (new and legacy)
foreach ($dir in $InstallRoot, $LegacyInstallRoot) {
    if (Test-Path $dir) {
        Write-Step "Removing $dir"
        Remove-Item -Path $dir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# 4. Remove DPAPI configs (new and legacy)
foreach ($cfg in (Join-Path $AgentRoot 'config.dat'), (Join-Path $LegacyAgentRoot 'config.dat')) {
    if (Test-Path $cfg) {
        Write-Step "Removing DPAPI config: $cfg"
        Remove-Item -Path $cfg -Force -ErrorAction SilentlyContinue
    }
}

# 5. Remove logs unless -KeepLogs
if (-not $KeepLogs) {
    foreach ($d in $LogDir, (Join-Path $LegacyAgentRoot 'logs')) {
        if (Test-Path $d) {
            Write-Step "Removing logs at $d"
            Remove-Item -Path $d -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

# 6. Remove the AgentRoot directories if now empty
foreach ($root in $AgentRoot, $LegacyAgentRoot) {
    if ((Test-Path $root) -and -not (Get-ChildItem $root -Force)) {
        Remove-Item -Path $root -Force -ErrorAction SilentlyContinue
    }
}

Write-Step "Done."
