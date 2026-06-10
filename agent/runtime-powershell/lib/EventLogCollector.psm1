#requires -version 5.1
# Defender Operational event log collector. v0.4.3+.
# - Broader Get-WinEvent filter: drops the over-restrictive ProviderName clause.
# - First-run backfill: pull all matching events from the last $FirstRunBackfillDays
#   (default 7) instead of capping at $MaxEvents.
# - Fallback: if Microsoft-Windows-Windows Defender/Operational isn't enabled / empty,
#   also try Application log filtered to Defender-related sources.
# - Logs every collection attempt to collectors.log so failure modes are visible.

$script:DefenderEventIds = @(
    1006, 1007, 1009, 1011,                # threat detected / action taken / quarantined / restored
    1015, 1016,                            # behavior detected / suspicious behavior
    1116, 1117, 1118, 1119,                # threat-action lifecycle
    2000, 2001, 2002, 2003, 2010,          # signature update events
    5000, 5001, 5004, 5007,                # config / RTP / engine
    5010, 5012, 5013,                      # signature failure / real-time start/stop
    5100, 5101                             # tamper protection / network protection
)

function _ElLog($lvl, $msg) {
    try {
        $d = 'C:\ProgramData\Mithras\logs'
        if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
        Add-Content -Path (Join-Path $d 'collectors.log') -Value "[$(Get-Date -Format o)] [$lvl] eventlog: $msg" -Encoding UTF8
    } catch {}
}

function Get-EventLogStateOrDefault {
    param([Parameter(Mandatory)][string]$Path)
    $default = @{ last_record_id = 0 }
    if (-not (Test-Path $Path)) { return $default }
    try {
        $obj = Get-Content -Path $Path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
        if ($null -eq $obj.last_record_id) { return $default }
        return @{ last_record_id = [int64]$obj.last_record_id }
    } catch { return $default }
}

function Save-EventLogState {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][hashtable]$State)
    try { $State | ConvertTo-Json -Compress -Depth 4 | Out-File -FilePath $Path -Encoding UTF8 -Force } catch {}
}

function _NormalizeEvent {
    param([Parameter(Mandatory)]$Evt, [string]$LogSource)
    $level = switch ([int]$Evt.Level) {
        1 { 'Critical' } 2 { 'Error' } 3 { 'Warning' } 4 { 'Information' } 5 { 'Verbose' } default { 'Information' }
    }
    return @{
        log_source    = $LogSource
        event_id      = [int]$Evt.Id
        level         = $level
        message       = [string]$Evt.Message
        event_time    = $Evt.TimeCreated.ToString('o')
        provider_name = [string]$Evt.ProviderName
        task_category = $(try { [string]$Evt.TaskDisplayName } catch { $null })
        raw_data      = @{ record_id = [int64]$Evt.RecordId; machine_name = $Evt.MachineName }
    }
}

function Get-DefenderEventLogsPayload {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$StatePath,
        [int]$MaxEvents = 500,
        [int]$FirstRunBackfillDays = 7
    )

    $state    = Get-EventLogStateOrDefault -Path $StatePath
    $lastId   = [int64]$state.last_record_id
    $firstRun = ($lastId -le 0)

    # Primary filter — just the log itself. The log is already scoped to
    # Defender, every event in it is relevant. Earlier versions applied an
    # event-id allowlist on incremental runs, but that filtered out the most
    # common Defender events (1150/1151 hourly health-check) so live tail
    # appeared dead. Now we let everything in the log through and rely on the
    # incremental RecordId to keep volume bounded.
    $filter = @{ LogName = 'Microsoft-Windows-Windows Defender/Operational' }
    if ($firstRun) {
        $filter['StartTime'] = (Get-Date).AddDays(-$FirstRunBackfillDays)
    }

    $maxToFetch = $(if ($firstRun) { 5000 } else { 1000 })
    $events = @()
    try {
        $events = @(Get-WinEvent -FilterHashtable $filter -MaxEvents $maxToFetch -ErrorAction Stop)
        _ElLog 'INFO' ("Defender Operational fetched count=" + $events.Count + " firstRun=" + $firstRun)
    } catch {
        _ElLog 'WARN' ("Defender Operational query failed: " + $_.Exception.Message)
    }

    # Fallback: if nothing came back from the Defender Operational log, also probe
    # the System and Application logs for Defender-related entries. Some Server
    # configurations write here when the Operational log is suppressed.
    if ($events.Count -eq 0 -and $firstRun) {
        try {
            $fallback = @{ LogName = 'System'; StartTime = (Get-Date).AddDays(-$FirstRunBackfillDays); ProviderName = 'Microsoft-Windows-Windows Defender' }
            $events = @(Get-WinEvent -FilterHashtable $fallback -MaxEvents 1000 -ErrorAction Stop)
            _ElLog 'INFO' ("Defender System-log fallback count=" + $events.Count)
        } catch {
            _ElLog 'INFO' ("Defender System-log fallback empty: " + $_.Exception.Message)
        }
    }

    $payload = @()
    $maxSeenRecord = $lastId
    foreach ($e in $events) {
        try {
            if ([int64]$e.RecordId -le $lastId) { continue }
            if ([int64]$e.RecordId -gt $maxSeenRecord) { $maxSeenRecord = [int64]$e.RecordId }
            $payload += (_NormalizeEvent -Evt $e -LogSource 'Microsoft-Windows-Windows Defender/Operational')
            if ($payload.Count -ge $MaxEvents -and -not $firstRun) { break }
            if ($payload.Count -ge $maxToFetch) { break }
        } catch {
            _ElLog 'WARN' ("event normalize failed: " + $_.Exception.Message)
            continue
        }
    }

    if ($maxSeenRecord -gt $lastId) {
        Save-EventLogState -Path $StatePath -State @{ last_record_id = $maxSeenRecord }
    }

    _ElLog 'INFO' ("payload events to send=" + $payload.Count)
    return $payload
}

Export-ModuleMember -Function Get-DefenderEventLogsPayload, Get-EventLogStateOrDefault, Save-EventLogState
