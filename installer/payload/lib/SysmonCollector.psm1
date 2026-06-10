# SysmonCollector.psm1 - v0.4.7
#
# Reads Microsoft-Windows-Sysmon/Operational incrementally and ships parsed
# events to /agent-api/sysmon-events. State file tracks the highest RecordId
# we've already shipped so we never duplicate or miss events.
#
# Currently parses event IDs 1 (ProcessCreate), 3 (NetworkConnect), 11
# (FileCreate). DNS (22) is captured by the config but not yet plumbed.

$STATE_FILE = 'C:\ProgramData\Mithras\sysmon-collector-state.json'

function Read-SysmonState {
    if (Test-Path $STATE_FILE) {
        try { return (Get-Content $STATE_FILE -Raw | ConvertFrom-Json) } catch {}
    }
    return [pscustomobject]@{ last_record_id = 0 }
}

function Write-SysmonState {
    param([long]$LastRecordId)
    $dir = Split-Path $STATE_FILE -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    @{ last_record_id = $LastRecordId } | ConvertTo-Json -Compress | Set-Content -Path $STATE_FILE -Force
}

# Sysmon stores event-data fields in a flat XML <Data Name="X">value</Data>
# structure. Parse them into a hashtable for easy lookup.
function ConvertFrom-SysmonEvent {
    param([System.Diagnostics.Eventing.Reader.EventLogRecord]$Record)

    try {
        $xml = [xml]$Record.ToXml()
    } catch {
        return $null
    }

    $data = @{}
    foreach ($d in $xml.Event.EventData.Data) {
        if ($d.Name) { $data[$d.Name] = ($d.'#text' -as [string]) }
    }

    $eventId   = [int]$xml.Event.System.EventID.'#text'
    if (-not $eventId) { $eventId = [int]$xml.Event.System.EventID }
    $timeRaw   = $xml.Event.System.TimeCreated.SystemTime
    try { $timeIso = ([datetime]$timeRaw).ToUniversalTime().ToString('o') } catch { $timeIso = (Get-Date).ToUniversalTime().ToString('o') }

    # Hashes string format: "SHA256=abcdef,IMPHASH=12345"
    $hashesObj = $null
    if ($data['Hashes']) {
        $hashesObj = @{}
        foreach ($pair in ($data['Hashes'] -split ',')) {
            $kv = $pair -split '=', 2
            if ($kv.Count -eq 2) { $hashesObj[$kv[0]] = $kv[1] }
        }
    }

    $out = [ordered]@{
        record_id    = [int64]$Record.RecordId
        event_id     = $eventId
        event_time   = $timeIso
        user_name    = $data['User']
    }

    switch ($eventId) {
        1 {
            # ProcessCreate
            $out['process_guid']        = ($data['ProcessGuid'] -replace '[{}]', '')
            $out['process_id']          = if ($data['ProcessId'])       { [int64]$data['ProcessId']       } else { $null }
            $out['parent_process_guid'] = ($data['ParentProcessGuid'] -replace '[{}]', '')
            $out['parent_process_id']   = if ($data['ParentProcessId']) { [int64]$data['ParentProcessId'] } else { $null }
            $out['image']               = $data['Image']
            $out['parent_image']        = $data['ParentImage']
            $out['command_line']        = $data['CommandLine']
            $out['parent_command_line'] = $data['ParentCommandLine']
            $out['current_directory']   = $data['CurrentDirectory']
            $out['hashes']              = $hashesObj
            $out['integrity_level']     = $data['IntegrityLevel']
        }
        3 {
            # NetworkConnect
            $out['process_guid']        = ($data['ProcessGuid'] -replace '[{}]', '')
            $out['process_id']          = if ($data['ProcessId']) { [int64]$data['ProcessId'] } else { $null }
            $out['image']               = $data['Image']
            $out['protocol']            = $data['Protocol']
            $out['initiated']           = if ($data['Initiated']) { ($data['Initiated'] -eq 'true') } else { $null }
            $out['source_ip']           = $data['SourceIp']
            $out['source_port']         = if ($data['SourcePort'])      { [int]$data['SourcePort']      } else { $null }
            $out['source_hostname']     = $data['SourceHostname']
            $out['destination_ip']      = $data['DestinationIp']
            $out['destination_port']    = if ($data['DestinationPort']) { [int]$data['DestinationPort'] } else { $null }
            $out['destination_hostname']= $data['DestinationHostname']
        }
        11 {
            # FileCreate
            $out['process_guid']        = ($data['ProcessGuid'] -replace '[{}]', '')
            $out['process_id']          = if ($data['ProcessId']) { [int64]$data['ProcessId'] } else { $null }
            $out['image']               = $data['Image']
            $out['target_filename']     = $data['TargetFilename']
        }
        default {
            # Not one we care about right now — caller will drop.
            $out['skip'] = $true
        }
    }
    return [pscustomobject]$out
}

function Get-SysmonEventPayload {
    <#
    .SYNOPSIS
    Read new Sysmon events since last shipment and return a batch ready for POST.
    .PARAMETER MaxEvents
    Cap on events returned per call. Default 500. Bigger batches are kinder to
    the platform but increase memory pressure on the agent.
    .OUTPUTS
    PSObject array. Empty array if no new events. Updates state file on success.
    #>
    param(
        [int]$MaxEvents = 500
    )

    $state = Read-SysmonState
    $lastRecord = [int64]$state.last_record_id

    # Filter by RecordId > last + EventID in our supported set. This is a fast
    # XPath query against the EVTX index — won't scan the whole log.
    $xpath = "*[System[(EventID=1 or EventID=3 or EventID=11) and (EventRecordID > $lastRecord)]]"

    $events = @()
    try {
        $events = Get-WinEvent -LogName 'Microsoft-Windows-Sysmon/Operational' `
                               -FilterXPath $xpath -MaxEvents $MaxEvents -ErrorAction Stop |
                  Sort-Object RecordId
    } catch [System.Diagnostics.Eventing.Reader.EventLogNotFoundException] {
        # Sysmon not installed yet; harmless.
        return @()
    } catch {
        if ($_.Exception.Message -match 'No events were found') {
            return @()
        }
        Write-PolicyLog "Sysmon EVTX read failed: $($_.Exception.Message)" 'Warn'
        return @()
    }

    if (-not $events -or $events.Count -eq 0) { return @() }

    $out = New-Object System.Collections.ArrayList
    $maxRecordSeen = $lastRecord
    foreach ($e in $events) {
        if ($e.RecordId -gt $maxRecordSeen) { $maxRecordSeen = [int64]$e.RecordId }
        $parsed = ConvertFrom-SysmonEvent -Record $e
        if (-not $parsed) { continue }
        if ($parsed.PSObject.Properties.Match('skip').Count -gt 0 -and $parsed.skip) { continue }
        [void]$out.Add($parsed)
    }

    # Persist progress even if we ship 0 (which can happen if every record
    # in this batch was a skipped event type). Otherwise we'd re-process them.
    Write-SysmonState -LastRecordId $maxRecordSeen
    return ,$out.ToArray()
}

function Send-SysmonEvents {
    <#
    .SYNOPSIS
    Ship a batch of parsed Sysmon events to /agent-api/sysmon-events.
    .OUTPUTS
    @{ ok=bool; sent=int; resp_count=int; error=string? }
    #>
    param(
        [Parameter(Mandatory)][string]$AgentToken,
        [Parameter(Mandatory)][string]$ApiBaseUrl,
        [Parameter(Mandatory)][object[]]$Events
    )
    if (-not $Events -or $Events.Count -eq 0) { return @{ ok = $true; sent = 0 } }

    try {
        $headers = @{ 'Content-Type' = 'application/json'; 'x-agent-token' = $AgentToken }
        $body    = @{ events = $Events } | ConvertTo-Json -Depth 10 -Compress
        $resp    = Invoke-RestMethod -Uri "$ApiBaseUrl/sysmon-events" -Method POST -Headers $headers -Body $body -TimeoutSec 60 -ErrorAction Stop
        return @{ ok = $true; sent = $Events.Count; resp_count = $resp.count }
    } catch {
        return @{ ok = $false; error = $_.Exception.Message; sent = 0 }
    }
}

# Polyfill if PolicyEnforcer's logger isn't loaded.
if (-not (Get-Command -Name Write-PolicyLog -ErrorAction SilentlyContinue)) {
    function Write-PolicyLog { param([string]$Message, [string]$Level = 'Info') Write-Host "[$Level] [Sysmon] $Message" }
}

Export-ModuleMember -Function Get-SysmonEventPayload, Send-SysmonEvents
