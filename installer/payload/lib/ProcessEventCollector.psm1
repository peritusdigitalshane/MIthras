#requires -version 5.1
# Security event 4688 (process creation) collector. v0.4.5+.
# Requires: gpedit / GPO "Audit Process Creation" enabled (Success), and
#   "Include command line in process creation events" enabled. Without those
#   the Security log will not contain 4688 entries.

function _PeLog($lvl, $msg) {
    try {
        $d = 'C:\ProgramData\Mithras\logs'
        if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
        Add-Content -Path (Join-Path $d 'collectors.log') -Value "[$(Get-Date -Format o)] [$lvl] process: $msg" -Encoding UTF8
    } catch {}
}

function Get-ProcessEventStateOrDefault {
    param([Parameter(Mandatory)][string]$Path)
    $default = @{ last_record_id = 0 }
    if (-not (Test-Path $Path)) { return $default }
    try {
        $obj = Get-Content -Path $Path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
        if ($null -eq $obj.last_record_id) { return $default }
        return @{ last_record_id = [int64]$obj.last_record_id }
    } catch { return $default }
}

function Save-ProcessEventState {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][hashtable]$State)
    try { $State | ConvertTo-Json -Compress -Depth 4 | Out-File -FilePath $Path -Encoding UTF8 -Force } catch {}
}

function _Get4688Field {
    param([Parameter(Mandatory)][xml]$Xml, [Parameter(Mandatory)][string]$Name)
    foreach ($d in $Xml.Event.EventData.Data) {
        if ($d.Name -eq $Name) { return [string]$d.'#text' }
    }
    return $null
}

function Get-ProcessCreationEventsPayload {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$StatePath,
        [int]$MaxEvents = 500,
        [int]$FirstRunBackfillDays = 1
    )

    $state    = Get-ProcessEventStateOrDefault -Path $StatePath
    $lastId   = [int64]$state.last_record_id
    $firstRun = ($lastId -le 0)

    $filter = @{
        LogName = 'Security'
        Id      = 4688
    }
    if ($firstRun) { $filter['StartTime'] = (Get-Date).AddDays(-$FirstRunBackfillDays) }
    $maxToFetch = $(if ($firstRun) { 2000 } else { 1000 })

    $events = @()
    try {
        $events = @(Get-WinEvent -FilterHashtable $filter -MaxEvents $maxToFetch -ErrorAction Stop)
        _PeLog 'INFO' ("4688 fetched count=" + $events.Count + " firstRun=" + $firstRun)
    } catch [System.Diagnostics.Eventing.Reader.EventLogNotFoundException] {
        _PeLog 'WARN' "Security log inaccessible (need 'Manage auditing and security log' privilege - service runs as SYSTEM so should be fine)"
        return @()
    } catch {
        if ($_.Exception.Message -match 'No events were found') { return @() }
        _PeLog 'WARN' ("4688 query failed: " + $_.Exception.Message)
        return @()
    }

    $payload = @()
    $maxSeenRecord = $lastId
    foreach ($e in $events) {
        try {
            if ([int64]$e.RecordId -le $lastId) { continue }
            if ([int64]$e.RecordId -gt $maxSeenRecord) { $maxSeenRecord = [int64]$e.RecordId }

            $xml = [xml]$e.ToXml()
            $payload += @{
                event_time     = $e.TimeCreated.ToString('o')
                pid            = (_Get4688Field -Xml $xml -Name 'NewProcessId')
                parent_pid     = (_Get4688Field -Xml $xml -Name 'ProcessId')
                exe_path       = (_Get4688Field -Xml $xml -Name 'NewProcessName')
                parent_path    = (_Get4688Field -Xml $xml -Name 'ParentProcessName')
                command_line   = (_Get4688Field -Xml $xml -Name 'CommandLine')
                user           = (_Get4688Field -Xml $xml -Name 'SubjectUserName')
                token_level    = (_Get4688Field -Xml $xml -Name 'TokenElevationType')
                record_id      = [int64]$e.RecordId
            }
            if ($payload.Count -ge $MaxEvents) { break }
        } catch { continue }
    }

    if ($maxSeenRecord -gt $lastId) {
        Save-ProcessEventState -Path $StatePath -State @{ last_record_id = $maxSeenRecord }
    }
    _PeLog 'INFO' ("4688 payload to send=" + $payload.Count)
    return $payload
}

Export-ModuleMember -Function Get-ProcessCreationEventsPayload, Get-ProcessEventStateOrDefault, Save-ProcessEventState
