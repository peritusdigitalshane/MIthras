#requires -version 5.1
# Self-updater for the Mithras Threat Defence Agent. v0.4.2+.
#
# Improvements over v0.4.0:
#   - Uses a one-shot scheduled task (SYSTEM, Highest) to run the swap script
#     instead of Start-Process detached. Scheduled tasks survive parent exit
#     reliably even from session-0 NSSM service context.
#   - Verbose log of every step to C:\ProgramData\Mithras\logs\update.log
#     so any failure has a discoverable cause.
#   - Self-deletes the scheduled task after swap completes.

function _UpLog($msg) {
    $logDir = 'C:\ProgramData\Mithras\logs'
    if (-not (Test-Path $logDir)) { try { New-Item -ItemType Directory -Path $logDir -Force | Out-Null } catch {} }
    try {
        Add-Content -Path (Join-Path $logDir 'update.log') -Value "[$(Get-Date -Format o)] $msg" -Encoding UTF8
    } catch {}
}

function Invoke-AgentSelfUpdate {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$DownloadUrl,
        [Parameter(Mandatory)][string]$ExpectedSha256,
        [Parameter(Mandatory)][string]$TargetVersion,
        [Parameter(Mandatory)][string]$AgentRoot,
        [string]$ServiceName = 'MithrasAgent'
    )

    _UpLog "Invoke-AgentSelfUpdate v=$TargetVersion url=$DownloadUrl"

    $stage     = Join-Path $AgentRoot 'update'
    $installed = Join-Path $AgentRoot 'install'

    if (Test-Path $stage) {
        try { Remove-Item -Path $stage -Recurse -Force -ErrorAction Stop } catch { _UpLog "could not clean prior stage: $($_.Exception.Message)" }
    }
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    _UpLog "stage dir: $stage"

    $zipPath = Join-Path $stage "agent-$TargetVersion.zip"
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $DownloadUrl -OutFile $zipPath -UseBasicParsing -TimeoutSec 120 -ErrorAction Stop
        $sz = (Get-Item $zipPath).Length
        _UpLog "downloaded $sz bytes"
    } catch {
        _UpLog "download failed: $($_.Exception.Message)"
        throw "Self-update: download failed - $($_.Exception.Message)"
    }

    $actualSha = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash.ToLower()
    _UpLog "sha actual=$actualSha expected=$($ExpectedSha256.ToLower())"
    if ($actualSha -ne $ExpectedSha256.ToLower()) {
        _UpLog "SHA MISMATCH"
        try { Remove-Item -Path $stage -Recurse -Force -ErrorAction SilentlyContinue } catch { }
        throw "Self-update: SHA256 mismatch"
    }

    $unpacked = Join-Path $stage 'unpacked'
    try {
        Expand-Archive -Path $zipPath -DestinationPath $unpacked -Force -ErrorAction Stop
        _UpLog "extracted to $unpacked"
    } catch {
        _UpLog "extract failed: $($_.Exception.Message)"
        throw "Self-update: extract failed - $($_.Exception.Message)"
    }

    $children = Get-ChildItem -Path $unpacked -Force
    if ($children.Count -eq 1 -and $children[0].PSIsContainer) { $srcRoot = $children[0].FullName } else { $srcRoot = $unpacked }
    _UpLog "src root: $srcRoot"

    # Accept either the new entry-script name or the legacy one so an in-flight
    # 0.4.x -> 0.5.x upgrade still completes successfully.
    if (-not (Test-Path (Join-Path $srcRoot 'mithras-agent.ps1')) -and
        -not (Test-Path (Join-Path $srcRoot 'peritus-secure-agent.ps1'))) {
        _UpLog "new bundle missing entry script"
        try { Remove-Item -Path $stage -Recurse -Force -ErrorAction SilentlyContinue } catch { }
        throw "Self-update: new bundle missing mithras-agent.ps1"
    }

    # The swap script — runs OUT-OF-PROCESS via the scheduled task we register below.
    # Writes verbose progress to update.log so we can see what happened.
    $taskName = "MithrasAgentSwap_$TargetVersion"
    $swapPath = Join-Path $stage 'swap.ps1'
    $swap = @"
`$ErrorActionPreference = 'Continue'
function _SwapLog(`$m) {
    `$d = 'C:\ProgramData\Mithras\logs'
    if (-not (Test-Path `$d)) { try { New-Item -ItemType Directory -Path `$d -Force | Out-Null } catch {} }
    try { Add-Content -Path (Join-Path `$d 'update.log') -Value ("[" + (Get-Date -Format o) + "] [swap] " + `$m) -Encoding UTF8 } catch {}
}

_SwapLog "swap start: target=$TargetVersion"
Start-Sleep -Seconds 4

try {
    Stop-Service -Name '$ServiceName' -Force -ErrorAction SilentlyContinue
    _SwapLog "Stop-Service issued"
} catch {
    _SwapLog ("Stop-Service threw: " + `$_.Exception.Message)
}

# Wait for SCM to reflect stopped state (or timeout).
for (`$i = 0; `$i -lt 20; `$i++) {
    `$svc = Get-Service -Name '$ServiceName' -ErrorAction SilentlyContinue
    if (-not `$svc -or `$svc.Status -ne 'Running') { break }
    Start-Sleep -Milliseconds 500
}
_SwapLog ("post-stop status: " + (Get-Service -Name '$ServiceName' -ErrorAction SilentlyContinue).Status)

try {
    Get-ChildItem -Path '$installed' -Force | ForEach-Object {
        try { Remove-Item -Path `$_.FullName -Recurse -Force -ErrorAction Stop } catch { _SwapLog ("could not remove " + `$_.Name + ": " + `$_.Exception.Message) }
    }
    _SwapLog "old install contents cleared"
    Copy-Item -Path (Join-Path '$srcRoot' '*') -Destination '$installed' -Recurse -Force -ErrorAction Stop
    _SwapLog "new bundle copied"
} catch {
    _SwapLog ("swap copy failed: " + `$_.Exception.Message)
    Start-Service -Name '$ServiceName' -ErrorAction SilentlyContinue
    return
}

try {
    Start-Service -Name '$ServiceName' -ErrorAction Stop
    Start-Sleep -Seconds 3
    _SwapLog ("post-start status: " + (Get-Service -Name '$ServiceName' -ErrorAction SilentlyContinue).Status + " version=$TargetVersion")
} catch {
    _SwapLog ("Start-Service failed: " + `$_.Exception.Message + " - falling back to nssm/sc")
    `$nssm = Join-Path '$installed' 'vendor\nssm.exe'
    if (Test-Path `$nssm) { & `$nssm start '$ServiceName' | Out-Null } else { & sc.exe start '$ServiceName' | Out-Null }
}

# Clean up: remove the stage dir and the scheduled task that ran us.
try { Remove-Item -Path '$stage' -Recurse -Force -ErrorAction SilentlyContinue } catch {}
try { Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false -ErrorAction SilentlyContinue } catch {}
_SwapLog "swap done"
"@
    $swap | Out-File -FilePath $swapPath -Encoding UTF8 -Force
    _UpLog "swap.ps1 written to $swapPath"

    # Drop any prior task with the same name (defensive — should not exist).
    try { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue } catch { }

    # Register a one-shot scheduled task running as SYSTEM, set to fire ~5 seconds out.
    $action    = New-ScheduledTaskAction    -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$swapPath`""
    $trigger   = New-ScheduledTaskTrigger   -Once -At ((Get-Date).AddSeconds(5))
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

    try {
        Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
        _UpLog "scheduled-task '$taskName' registered to fire in 5s"
        # Belt-and-braces: explicitly start it too, in case the trigger time was missed.
        Start-Sleep -Milliseconds 500
        try { Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue; _UpLog "scheduled-task started manually" } catch { _UpLog "manual start failed: $($_.Exception.Message)" }
    } catch {
        _UpLog "scheduled-task register FAILED: $($_.Exception.Message)"
        throw "Self-update: scheduled task registration failed - $($_.Exception.Message)"
    }
}

# ==============================================================================
# Pending command result persistence -- v0.6.8
#
# Bridges the upgrade swap gap: the scheduled task stops the service ~5s after
# Invoke-AgentSelfUpdate returns. Any results already added to
# $script:PendingCommandResults in mithras-agent.ps1 won't reach the server
# because no further heartbeat fires before the process exits.
#
# Save-PendingCommandResults writes the list to disk.
# Read-PendingCommandResults loads it at startup and deletes the file so the
# first heartbeat of the new process ships the ack.
# ==============================================================================

$script:PendingResultsPath = 'C:\ProgramData\Mithras\pending-command-results.json'

function Save-PendingCommandResults {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][System.Collections.ArrayList]$Results
    )
    if (-not $Results -or $Results.Count -eq 0) { return }
    $dir = Split-Path $script:PendingResultsPath -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    try {
        # Force array serialisation so ConvertFrom-Json always returns a
        # collection even when there is a single result object.
        $json = ConvertTo-Json -InputObject ([object[]]$Results.ToArray()) -Depth 10 -Compress
        $json | Out-File -FilePath $script:PendingResultsPath -Encoding UTF8 -Force
        _UpLog ("Save-PendingCommandResults: wrote {0} result(s) to {1}" -f $Results.Count, $script:PendingResultsPath)
    } catch {
        _UpLog ("Save-PendingCommandResults: FAILED -- " + $_.Exception.Message)
        throw
    }
}

function Read-PendingCommandResults {
    [CmdletBinding()]
    param()
    $path = $script:PendingResultsPath
    if (-not (Test-Path $path)) { return @() }
    try {
        $raw = Get-Content -Path $path -Raw -Encoding UTF8 -ErrorAction Stop
        # Delete before parsing: a corrupt file must not permanently block
        # startup. Worst case we lose one result ack.
        Remove-Item -Path $path -Force -ErrorAction SilentlyContinue
        if ([string]::IsNullOrWhiteSpace($raw)) { return @() }
        $parsed = $raw | ConvertFrom-Json
        # ConvertFrom-Json returns a PSCustomObject for single items -- normalise.
        if ($parsed -is [System.Array]) { return $parsed }
        return @($parsed)
    } catch {
        _UpLog ("Read-PendingCommandResults: parse error -- " + $_.Exception.Message + " -- file deleted, continuing")
        try { Remove-Item -Path $path -Force -ErrorAction SilentlyContinue } catch {}
        return @()
    }
}

Export-ModuleMember -Function Invoke-AgentSelfUpdate, Save-PendingCommandResults, Read-PendingCommandResults
