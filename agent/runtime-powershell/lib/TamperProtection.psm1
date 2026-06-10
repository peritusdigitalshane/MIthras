# TamperProtection.psm1 -- v0.6.4
#
# User-mode tamper resistance for the Mithras agent. We don't have a kernel
# driver (yet) so we can't match CrowdStrike's "unkillable from user space"
# guarantee, but we can substantially raise the bar for casual attackers and
# scripts:
#
#   1. Service DACL lockdown -- strip Administrators down to read-only.
#      SYSTEM keeps full control so swap.ps1 (Updater) and uninstall still work.
#      Result: `Stop-Service MithrasAgent` from an Administrator PowerShell
#      returns Access Denied. `sc stop` likewise.
#
#   2. Service recovery flags -- if the process exits for any reason,
#      Service Control Manager restarts it within 60s, up to 3 times in 24h.
#
#   3. Watchdog scheduled task -- SYSTEM-context, fires every 5 min, ensures
#      the service is running. Resilient to SCM-side disable.
#
#   4. Idempotent self-heal -- the agent calls Set-MithrasServiceHardening on
#      every startup, so even if the operator/attacker resets the DACL,
#      the next process restart re-applies it.
#
# Emergency unlock: invoke Reset-MithrasServiceHardening from a SYSTEM shell
# (e.g. via `psexec -s` or scheduled task) -- needed only for manual ops.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

# Hardened service security descriptor in SDDL form. See:
#   https://learn.microsoft.com/windows/win32/services/service-security-and-access-rights
#
# Service rights letters (CC=QueryConfig, LC=QueryStatus, SW=EnumDeps,
#   LO=Interrogate, RC=ReadControl, RP=Start, WP=Stop, DT=PauseContinue,
#   DC=ChangeConfig, SD=Delete, WD=WriteDAC, WO=WriteOwner)
#
#   SY (S-1-5-18  NT AUTHORITY\SYSTEM)       -> full operational + admin rights
#   BA (S-1-5-32-544 BUILTIN\Administrators) -> read-only (query config/status, interrogate)
#   IU, SU                                    -> query-only
$script:HARDENED_SDDL = "D:(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;SY)(A;;CCLCSWLOCRRC;;;BA)(A;;CCLCSWLOCRRC;;;IU)(A;;CCLCSWLOCRRC;;;SU)"

# Default Windows SDDL for a NSSM-installed service. Used by Reset to undo
# the lockdown when the uninstaller or an ops engineer needs back in.
$script:DEFAULT_SDDL  = "D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWLOCRRC;;;IU)(A;;CCLCSWLOCRRC;;;SU)"

$script:WATCHDOG_TASK_NAME = 'MithrasWatchdog'
$script:WATCHDOG_SCRIPT    = 'C:\ProgramData\Mithras\watchdog.ps1'

function _TpLog($lvl, $msg) {
    try {
        $d = 'C:\ProgramData\Mithras\logs'
        if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
        Add-Content -Path (Join-Path $d 'tamper.log') -Value "[$(Get-Date -Format o)] [$lvl] $msg" -Encoding UTF8
    } catch {}
}

function Get-MithrasServiceSddl {
    param([string]$ServiceName = 'MithrasAgent')
    try {
        $out = & sc.exe sdshow $ServiceName 2>&1
        if ($LASTEXITCODE -eq 0) {
            # sc.exe sdshow returns the SDDL on its own line; collapse whitespace.
            return ($out | Where-Object { $_ -match 'D:' } | Select-Object -First 1).Trim()
        }
    } catch {}
    return $null
}

function Set-MithrasServiceHardening {
    <#
    .SYNOPSIS
    Apply tamper-resistant DACL + recovery flags to the agent service.
    Idempotent: calling repeatedly is a no-op once the state matches.
    #>
    param([string]$ServiceName = 'MithrasAgent')

    $current = Get-MithrasServiceSddl -ServiceName $ServiceName
    if (-not $current) {
        _TpLog 'WARN' "service '$ServiceName' not found; cannot harden"
        return @{ ok = $false; reason = 'service_not_found' }
    }

    if ($current -ne $script:HARDENED_SDDL) {
        try {
            & sc.exe sdset $ServiceName $script:HARDENED_SDDL 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "sdset returned $LASTEXITCODE" }
            _TpLog 'INFO' "DACL hardened on $ServiceName"
        } catch {
            _TpLog 'WARN' "DACL hardening failed: $($_.Exception.Message)"
            return @{ ok = $false; reason = 'sdset_failed'; error = $_.Exception.Message }
        }
    }

    # Auto-restart on failure: reset failure count after 24h, restart after
    # 60s on 1st/2nd/3rd failure, then give up. After give-up the watchdog
    # task takes over.
    try {
        & sc.exe failure $ServiceName reset= 86400 actions= restart/60000/restart/60000/restart/60000 2>&1 | Out-Null
        & sc.exe failureflag $ServiceName 1 2>&1 | Out-Null  # restart on clean exit too
    } catch {
        _TpLog 'WARN' "failure-flag configure failed: $($_.Exception.Message)"
    }

    return @{ ok = $true; sddl_applied = $script:HARDENED_SDDL }
}

function Reset-MithrasServiceHardening {
    <#
    .SYNOPSIS
    Undo the tamper-resistant DACL -- restores Windows default so the
    uninstaller or an ops engineer can stop/delete the service.
    Caller MUST run as SYSTEM (or have explicit WD on the service).
    #>
    param([string]$ServiceName = 'MithrasAgent')
    try {
        & sc.exe sdset $ServiceName $script:DEFAULT_SDDL 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            _TpLog 'INFO' "DACL reset on $ServiceName"
            return @{ ok = $true }
        }
        return @{ ok = $false; reason = "sdset_failed_$LASTEXITCODE" }
    } catch {
        return @{ ok = $false; reason = 'exception'; error = $_.Exception.Message }
    }
}

function Register-MithrasWatchdog {
    <#
    .SYNOPSIS
    Install a SYSTEM-context scheduled task that restarts the agent every 5
    minutes if it's not running. Resilient to SCM-side disable + manual stop.
    #>
    param([string]$ServiceName = 'MithrasAgent')

    # Write the watchdog script. Inline-compiled so the task always references
    # the current ServiceName.
    $body = @"
`$ErrorActionPreference = 'Continue'
function _WdLog(`$m) {
    try {
        `$d = 'C:\ProgramData\Mithras\logs'
        if (-not (Test-Path `$d)) { New-Item -ItemType Directory -Path `$d -Force | Out-Null }
        Add-Content -Path (Join-Path `$d 'watchdog.log') -Value ("[" + (Get-Date -Format o) + "] " + `$m) -Encoding UTF8
    } catch {}
}

`$svc = Get-Service -Name '$ServiceName' -ErrorAction SilentlyContinue
if (-not `$svc) {
    _WdLog "service '$ServiceName' not found"
    exit 0
}
if (`$svc.Status -ne 'Running') {
    _WdLog ("service was " + `$svc.Status + "; restarting")
    try {
        Start-Service -Name '$ServiceName' -ErrorAction Stop
        _WdLog "Start-Service succeeded"
    } catch {
        _WdLog ("Start-Service threw: " + `$_.Exception.Message + " -- falling back to sc")
        try { & sc.exe start '$ServiceName' | Out-Null } catch { _WdLog ("sc start failed: " + `$_.Exception.Message) }
    }
}
"@
    try {
        Set-Content -Path $script:WATCHDOG_SCRIPT -Value $body -Encoding utf8 -Force
    } catch {
        _TpLog 'WARN' "could not write watchdog script: $($_.Exception.Message)"
        return @{ ok = $false; reason = 'watchdog_write_failed' }
    }

    $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script:WATCHDOG_SCRIPT`""
    # Fire 1 min after install, then every 5 min for up to 9000 days (~24y).
    # Task Scheduler rejects durations beyond a (poorly documented) limit; this
    # range is safely accepted across Server 2016+ / Win10+.
    $trigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) `
        -RepetitionInterval (New-TimeSpan -Minutes 5) `
        -RepetitionDuration (New-TimeSpan -Days 9000)
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew

    try {
        Unregister-ScheduledTask -TaskName $script:WATCHDOG_TASK_NAME -Confirm:$false -ErrorAction SilentlyContinue
        Register-ScheduledTask -TaskName $script:WATCHDOG_TASK_NAME `
            -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force -ErrorAction Stop | Out-Null
        _TpLog 'INFO' 'watchdog scheduled task registered'
        return @{ ok = $true }
    } catch {
        _TpLog 'WARN' "watchdog register failed: $($_.Exception.Message)"
        return @{ ok = $false; reason = 'register_failed'; error = $_.Exception.Message }
    }
}

function Unregister-MithrasWatchdog {
    try {
        Unregister-ScheduledTask -TaskName $script:WATCHDOG_TASK_NAME -Confirm:$false -ErrorAction SilentlyContinue
        Remove-Item -Path $script:WATCHDOG_SCRIPT -Force -ErrorAction SilentlyContinue
        _TpLog 'INFO' 'watchdog unregistered'
        return @{ ok = $true }
    } catch {
        return @{ ok = $false; error = $_.Exception.Message }
    }
}

function Test-TamperState {
    <#
    .SYNOPSIS
    Snapshot the current tamper protection state for diagnostics / heartbeat.
    .OUTPUTS
    Hashtable: @{ service_hardened, watchdog_registered, current_sddl }
    #>
    param([string]$ServiceName = 'MithrasAgent')

    $sddl    = Get-MithrasServiceSddl -ServiceName $ServiceName
    $hardened = ($sddl -eq $script:HARDENED_SDDL)

    $task = $null
    try { $task = Get-ScheduledTask -TaskName $script:WATCHDOG_TASK_NAME -ErrorAction SilentlyContinue } catch {}

    return @{
        service_hardened    = $hardened
        watchdog_registered = ($null -ne $task)
        current_sddl        = $sddl
    }
}

# --------------------------------------------------------------------------
# Phase 2: Filesystem hardening
# --------------------------------------------------------------------------

# Paths we lock down. Logs intentionally NOT included -- they must stay
# writable by the agent process. Tray and watchdog scripts live outside
# install/ so they keep working when install/ is fully locked.
$script:HARDEN_PATHS = @(
    'C:\ProgramData\Mithras\install',     # agent code (modules, entry script, vendor)
    'C:\ProgramData\Mithras\sysmon',      # Sysmon binary + config + hash
    'C:\ProgramData\Mithras\config.dat'   # HMAC creds (DPAPI-encrypted but still)
)

function _SetHardenedAcl {
    param([string]$Path, [string[]]$AdminRights = @('ReadAndExecute'))

    if (-not (Test-Path $Path)) { return @{ ok = $false; reason = 'not_found' } }
    try {
        # Take ownership as SYSTEM first so we can rewrite the DACL.
        $isFile = (Get-Item -Path $Path -Force).PSIsContainer -eq $false
        $acl = if ($isFile) { Get-Acl -Path $Path -ErrorAction Stop }
               else        { Get-Acl -Path $Path -ErrorAction Stop }

        # Set owner to SYSTEM
        $sid = New-Object System.Security.Principal.SecurityIdentifier 'S-1-5-18'
        $acl.SetOwner($sid)

        # Strip inheritance + clear existing ACEs.
        $acl.SetAccessRuleProtection($true, $false)
        @($acl.Access) | ForEach-Object { $acl.RemoveAccessRuleSpecific($_) | Out-Null }

        $inheritance = if ($isFile) { 'None' } else { 'ContainerInherit,ObjectInherit' }

        # SYSTEM: FullControl
        $sysAce = New-Object System.Security.AccessControl.FileSystemAccessRule(
            'NT AUTHORITY\SYSTEM', 'FullControl', $inheritance, 'None', 'Allow')
        $acl.AddAccessRule($sysAce)

        # Administrators: configurable. Default ReadAndExecute -- can read for
        # troubleshooting but cannot delete or modify.
        if ($AdminRights.Count -gt 0) {
            $adminAce = New-Object System.Security.AccessControl.FileSystemAccessRule(
                'BUILTIN\Administrators', ($AdminRights -join ','), $inheritance, 'None', 'Allow')
            $acl.AddAccessRule($adminAce)
        }

        # Users + AuthenticatedUsers get NOTHING -- read-only for admin only is enough.

        Set-Acl -Path $Path -AclObject $acl -ErrorAction Stop
        return @{ ok = $true }
    } catch {
        return @{ ok = $false; reason = 'set_acl_failed'; error = $_.Exception.Message }
    }
}

function _RestoreDefaultAcl {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return }
    try {
        $acl = Get-Acl -Path $Path -ErrorAction Stop
        $acl.SetAccessRuleProtection($false, $true)  # re-enable inheritance, copy current rules
        Set-Acl -Path $Path -AclObject $acl -ErrorAction Stop
    } catch { }
}

function Set-MithrasFilesystemHardening {
    <#
    .SYNOPSIS
    Lock down the agent's install/, sysmon/, and config.dat so non-SYSTEM
    accounts can read but cannot modify or delete. Idempotent.
    #>
    $results = @{}
    foreach ($p in $script:HARDEN_PATHS) {
        $r = _SetHardenedAcl -Path $p -AdminRights @('ReadAndExecute')
        $results[$p] = $r
        if ($r.ok) { _TpLog 'INFO' "FS hardened: $p" }
        elseif ($r.reason -ne 'not_found') { _TpLog 'WARN' "FS hardening failed for ${p}: $($r.error)" }
    }
    return @{ ok = $true; paths = $results }
}

function Reset-MithrasFilesystemHardening {
    <#
    .SYNOPSIS
    Restore default (inherited) ACLs so uninstaller can delete the install
    tree. Must run as SYSTEM (or with explicit WD on the paths).
    #>
    foreach ($p in $script:HARDEN_PATHS) {
        _RestoreDefaultAcl -Path $p
    }
    _TpLog 'INFO' 'FS hardening reset'
    return @{ ok = $true }
}

Export-ModuleMember -Function `
    Set-MithrasServiceHardening, `
    Reset-MithrasServiceHardening, `
    Set-MithrasFilesystemHardening, `
    Reset-MithrasFilesystemHardening, `
    Register-MithrasWatchdog, `
    Unregister-MithrasWatchdog, `
    Test-TamperState, `
    Get-MithrasServiceSddl
