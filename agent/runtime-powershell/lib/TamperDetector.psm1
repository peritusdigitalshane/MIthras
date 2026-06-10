# TamperDetector.psm1 -- v0.6.5
#
# Reads recent Windows event log entries for our service and ships any
# "interesting" events back to the platform as tamper attempts.
#
# What's "interesting":
#   * Event ID 7036 -- service state change (we ship Stopped + Stop Pending)
#   * Event ID 7034 -- service terminated unexpectedly (crash or kill)
#   * Event ID 7040 -- service start type changed (someone tried to disable us)
#   * Event ID 7045 -- service installed (our own install, but also tracks
#                      attempts to install a hostile replacement)
#
# A successful stop attempt blocked by the hardened DACL produces NO event
# (the SCM didn't change state). So an actual 7036/Stopped is either:
#   a. The legitimate Updater.swap.ps1 stop+start cycle (paired event ~30s apart)
#   b. A SYSTEM-context attacker who got past our DACL (kernel exploit, etc.)
#   c. The watchdog's own restart loop after a process crash
#
# State across heartbeats: tamper-events-state.json stores the last RecordId
# we shipped, so we never double-ship the same event.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$script:TAMPER_STATE_FILE = 'C:\ProgramData\Mithras\tamper-events-state.json'
$script:OUR_SERVICE       = 'MithrasAgent'

function _TdLog($lvl, $msg) {
    try {
        $d = 'C:\ProgramData\Mithras\logs'
        if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
        Add-Content -Path (Join-Path $d 'tamper.log') -Value "[$(Get-Date -Format o)] [$lvl] detector: $msg" -Encoding UTF8
    } catch {}
}

function _ReadState {
    if (Test-Path $script:TAMPER_STATE_FILE) {
        try { return (Get-Content $script:TAMPER_STATE_FILE -Raw | ConvertFrom-Json) } catch {}
    }
    return [pscustomobject]@{ last_record_id = 0 }
}

function _WriteState {
    param([long]$LastRecordId)
    try {
        @{ last_record_id = $LastRecordId } | ConvertTo-Json | Set-Content -Path $script:TAMPER_STATE_FILE -Force -Encoding utf8
    } catch {}
}

function Get-MithrasTamperEvents {
    <#
    .SYNOPSIS
    Pull any new SCM events for MithrasAgent since last call. Stateful via
    tamper-events-state.json. Returns @() if nothing new.
    #>
    param([int]$MaxEvents = 50)

    $state    = _ReadState
    $sinceRid = if ($state -and $state.last_record_id) { [long]$state.last_record_id } else { 0 }
    $events   = New-Object System.Collections.Generic.List[hashtable]
    $maxSeen  = $sinceRid

    # Use a broad filter then refine -- WinEvent filter hashtables can't OR
    # multiple IDs cleanly across all PowerShell versions.
    $scmEvents = @()
    try {
        $scmEvents = Get-WinEvent -FilterHashtable @{
            LogName      = 'System'
            ProviderName = 'Service Control Manager'
            Id           = @(7034, 7036, 7040, 7045)
            StartTime    = (Get-Date).AddHours(-2)
        } -ErrorAction SilentlyContinue
    } catch {}

    foreach ($e in ($scmEvents | Sort-Object RecordId)) {
        if (-not $e.RecordId -or $e.RecordId -le $sinceRid) { continue }
        if ($events.Count -ge $MaxEvents) { break }

        # Properties layout differs per event ID:
        # 7036: [0]=service display name, [1]=new state (Running/Stopped/etc.)
        # 7034: [0]=service display name, [1]=restart count
        # 7040: [0]=service display name, [1]=new start type, [2]=old start type
        # 7045: [0]=service name, [1]=image path, [2]=service type, [3]=start type, [4]=account
        $displayName = $null
        try { $displayName = [string]$e.Properties[0].Value } catch {}

        # Quick relevance gate -- skip events for other services.
        if ($displayName -and $displayName -notmatch '(?i)mithras') {
            if ($e.RecordId -gt $maxSeen) { $maxSeen = $e.RecordId }
            continue
        }

        $eventType = switch ($e.Id) {
            7034 { 'crashed_unexpectedly' }
            7036 {
                $newState = $null
                try { $newState = [string]$e.Properties[1].Value } catch {}
                if ($newState -in @('stopped','Stopped'))                { 'service_stopped' }
                elseif ($newState -in @('start pending','running'))      { 'service_started' }
                elseif ($newState -in @('stop pending'))                 { 'service_stopping' }
                else                                                      { "service_state_$newState" }
            }
            7040 { 'start_type_changed' }
            7045 { 'service_installed' }
            default { "event_$($e.Id)" }
        }

        # Severity guidance:
        $sev = switch ($eventType) {
            'service_stopped'      { 'High' }
            'service_stopping'     { 'Moderate' }
            'crashed_unexpectedly' { 'High' }
            'start_type_changed'   { 'Severe' }    # someone tried to disable us
            'service_installed'    { 'Low' }       # noisy -- usually self
            default                { 'Low' }
        }

        $events.Add(@{
            event_id     = [int]$e.Id
            event_type   = $eventType
            severity     = $sev
            event_time   = $e.TimeCreated.ToUniversalTime().ToString('o')
            service_name = $displayName
            record_id    = [int64]$e.RecordId
            message      = ($e.Message -replace "`r`n", ' ').Substring(0, [Math]::Min(500, $e.Message.Length))
        }) | Out-Null

        if ($e.RecordId -gt $maxSeen) { $maxSeen = $e.RecordId }
    }

    # Update state to the max RecordId we considered, even if we skipped most
    # of them, so we don't re-scan stale events forever.
    if ($maxSeen -gt $sinceRid) { _WriteState -LastRecordId $maxSeen }

    return ,@($events.ToArray())
}

Export-ModuleMember -Function Get-MithrasTamperEvents
