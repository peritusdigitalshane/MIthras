# FirewallAuditCollector.psm1 - v0.4.7
#
# Microsegmentation learning collector.
#
# Reads C:\Windows\System32\LogFiles\Firewall\pfirewall.log incrementally
# (state file tracks last byte offset), parses each new entry, maps it to a
# matching rule from the assigned firewall policy by (port, protocol), and
# returns a batch ready for POST to /agent-api/firewall-logs.
#
# Windows Firewall log format (W3C SP1):
#   #Fields: date time action protocol src-ip dst-ip src-port dst-port size tcpflags ... info path
#
# We ship both ALLOW and DROP events. The platform UI uses ALLOW events from
# audit-mode rules to show "what would have been blocked" so the operator can
# decide what to lock down.

function Enable-FirewallLogging {
    # All three profiles (Domain/Standard/Public) log both allowed and blocked
    # traffic to the standard log file. Idempotent; safe to call on every pass.
    foreach ($prof in 'Domain','Private','Public') {
        try {
            Set-NetFirewallProfile -Profile $prof `
                -LogAllowed True -LogBlocked True `
                -LogMaxSizeKilobytes 16384 `
                -LogFileName '%systemroot%\system32\LogFiles\Firewall\pfirewall.log' `
                -ErrorAction Stop | Out-Null
        } catch {
            # Fall back to netsh if NetSecurity module is absent (Server Core).
            try {
                & netsh advfirewall set $($prof.ToLower())profile logging allowedconnections enable 2>&1 | Out-Null
                & netsh advfirewall set $($prof.ToLower())profile logging droppedconnections enable 2>&1 | Out-Null
            } catch {}
        }
    }
}

function Get-FirewallLogPath {
    try {
        $p = (Get-NetFirewallProfile -Profile Domain -ErrorAction Stop).LogFileName
        return [Environment]::ExpandEnvironmentVariables($p)
    } catch {
        return [Environment]::ExpandEnvironmentVariables('%systemroot%\system32\LogFiles\Firewall\pfirewall.log')
    }
}

function Read-FirewallLogState {
    param([string]$StatePath)
    if (Test-Path $StatePath) {
        try { return (Get-Content $StatePath -Raw | ConvertFrom-Json) } catch {}
    }
    return [pscustomobject]@{ offset = 0; size_at_offset = 0 }
}

function Write-FirewallLogState {
    param([string]$StatePath, [long]$Offset, [long]$Size)
    $dir = Split-Path $StatePath -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    @{ offset = $Offset; size_at_offset = $Size } | ConvertTo-Json | Set-Content -Path $StatePath -Force
}

function Parse-FirewallLogLine {
    param([string]$Line)
    # Example:
    #   2026-05-30 13:25:48 DROP TCP 192.0.2.1 10.0.0.5 12345 22 60 S 0 0 65535 - - - RECEIVE
    if ([string]::IsNullOrWhiteSpace($Line)) { return $null }
    if ($Line.StartsWith('#')) { return $null }
    $f = $Line -split '\s+'
    if ($f.Count -lt 17) { return $null }
    $action   = $f[2]
    $proto    = $f[3]
    $srcIp    = $f[4]
    $dstIp    = $f[5]
    $srcPort  = $f[6]
    $dstPort  = $f[7]
    $path     = $f[16]
    # Skip the placeholder dashes that mean "no data".
    if ($srcIp -eq '-' -or $dstPort -eq '-' -or $dstPort -eq '0') { return $null }
    # Parse timestamp (local time per #Time Format: Local in the header).
    try { $ts = [datetime]::ParseExact($f[0] + ' ' + $f[1], 'yyyy-MM-dd HH:mm:ss', $null).ToUniversalTime().ToString('o') }
    catch { $ts = (Get-Date).ToUniversalTime().ToString('o') }

    # We care about INBOUND traffic for microsegmentation (what's hitting our
    # listening ports). For SEND we still report so the operator can see
    # outbound talkers but we mark direction='outbound'.
    $direction = switch ($path) {
        'RECEIVE' { 'inbound' }
        'SEND'    { 'outbound' }
        default   { 'unknown' }
    }
    return [pscustomobject]@{
        action         = $action
        protocol       = ($proto -as [string]).ToLower()
        src_ip         = $srcIp
        dst_ip         = $dstIp
        src_port       = [int]$srcPort
        dst_port       = [int]$dstPort
        direction      = $direction
        event_time     = $ts
    }
}

function Match-RuleForEntry {
    param($Entry, $Rules)
    # $Rules is the array from /agent-api/firewall-policy { rules: [...] }
    # Each rule has port, protocol, mode, AND v0.5.7+ direction. The matcher
    # honours direction so the same port can have separate inbound + outbound
    # rules. The "service port" is dst_port in both directions: the listening
    # port for inbound, the remote service port for outbound.
    if (-not $Rules -or $Rules.Count -eq 0) { return $null }
    $portToMatch = $Entry.dst_port
    foreach ($r in $Rules) {
        $rProto = ($r.protocol -as [string]).ToLower()
        if ($Entry.protocol -ne $rProto) { continue }
        $rDir = if ($r.direction) { ([string]$r.direction).ToLower() } else { 'inbound' }
        if ($rDir -ne $Entry.direction) { continue }
        # port field may be a comma-separated list
        $rPorts = ($r.port -split ',') | ForEach-Object { ($_.Trim()) -as [int] }
        if ($rPorts -contains $portToMatch) { return $r }
    }
    return $null
}

function Get-FirewallAuditPayload {
    param(
        [Parameter(Mandatory)][string]$StatePath,
        [object]$PolicyRules,
        [int]$MaxEvents = 500,
        # v0.5.6: Unmatched inbound traffic is now shipped too (with rule_id=null
        # and aggressive dedup by port+protocol+remote_ip), so the dashboard can
        # surface "you have stuff hitting port 8443 that no rule covers".
        [int]$MaxUnmatchedEvents = 200
    )
    Enable-FirewallLogging

    $logPath = Get-FirewallLogPath
    if (-not (Test-Path $logPath)) { return @() }

    $info  = Get-Item $logPath
    $state = Read-FirewallLogState -StatePath $StatePath
    $startOffset = $state.offset

    # File rotation: pfirewall.log gets rotated when LogMaxSizeKilobytes is hit.
    # If size shrank, start from 0.
    if ($info.Length -lt $startOffset) { $startOffset = 0 }
    if ($info.Length -eq $startOffset) { return @() }

    # Read the new range as bytes, then split into lines.
    $fs = [System.IO.File]::Open($logPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
        $fs.Seek($startOffset, [System.IO.SeekOrigin]::Begin) | Out-Null
        $buf = New-Object byte[] ($info.Length - $startOffset)
        [void]$fs.Read($buf, 0, $buf.Length)
    } finally { $fs.Dispose() }

    $text  = [System.Text.Encoding]::ASCII.GetString($buf)
    $lines = $text -split "`n"

    # Microsegmentation only cares about INBOUND traffic -- outbound is left to
    # the user's egress controls. Two output buckets:
    #   $matched  -- shipped as-is with rule_id set (already-tracked services)
    #   $unmatched -- deduped to one row per (port, protocol, remote_address)
    #                so a busy server doesn't drown the DB. rule_id is null.
    $matched   = New-Object System.Collections.ArrayList
    $unmatched = @{}    # key -> representative pscustomobject

    foreach ($line in $lines) {
        $e = Parse-FirewallLogLine -Line $line.Trim()
        if (-not $e) { continue }
        if ($e.direction -ne 'inbound' -and $e.direction -ne 'outbound') { continue }

        # v0.5.7: ship BOTH inbound and outbound. For both, dst_port is the
        # "service port" (listening port for inbound, remote service port for
        # outbound). remote_address is the other party either way.
        if ($e.direction -eq 'inbound') {
            $localPort  = $e.dst_port
            $remoteAddr = $e.src_ip
            $remotePort = $e.src_port
        } else {
            $localPort  = $e.dst_port   # the remote service port; we treat it
                                        # as the rule key for outbound too
            $remoteAddr = $e.dst_ip
            $remotePort = $e.src_port
        }

        $rule = Match-RuleForEntry -Entry $e -Rules $PolicyRules
        if ($rule) {
            if ($matched.Count -lt $MaxEvents) {
                [void]$matched.Add([pscustomobject]@{
                    rule_id        = $rule.id
                    service_name   = $rule.service_name
                    local_port     = $localPort
                    remote_address = $remoteAddr
                    remote_port    = $remotePort
                    protocol       = $e.protocol
                    direction      = $e.direction
                    event_time     = $e.event_time
                })
            }
        } else {
            # Unmatched -- shipped only as a "this port saw traffic" signal,
            # deduped within this batch so chatty ports don't blow past the cap.
            $key = ("{0}|{1}|{2}|{3}" -f $e.direction, $e.dst_port, $e.protocol, $remoteAddr)
            if (-not $unmatched.ContainsKey($key) -and $unmatched.Count -lt $MaxUnmatchedEvents) {
                # service_name surfaces in the UI even though there's no rule.
                # Common ports get a friendly label; everything else falls back
                # to "Port-NNNN" so the dashboard shows something readable.
                $svc = switch ($e.dst_port) {
                    21    { 'FTP' }
                    23    { 'Telnet' }
                    25    { 'SMTP' }
                    53    { 'DNS' }
                    110   { 'POP3' }
                    143   { 'IMAP' }
                    389   { 'LDAP' }
                    443   { 'HTTPS' }
                    465   { 'SMTPS' }
                    587   { 'SMTP-Sub' }
                    636   { 'LDAPS' }
                    993   { 'IMAPS' }
                    995   { 'POP3S' }
                    1433  { 'MSSQL' }
                    1521  { 'Oracle' }
                    3306  { 'MySQL' }
                    5432  { 'Postgres' }
                    5985  { 'WinRM' }
                    5986  { 'WinRM-HTTPS' }
                    6379  { 'Redis' }
                    8000  { 'HTTP-Alt' }
                    8080  { 'HTTP-Proxy' }
                    8443  { 'HTTPS-Alt' }
                    27017 { 'MongoDB' }
                    default { "Port-$($e.dst_port)" }
                }
                # Prefix outbound entries so the UI distinguishes them.
                if ($e.direction -eq 'outbound') { $svc = "Out-$svc" }
                $unmatched[$key] = [pscustomobject]@{
                    rule_id        = $null
                    service_name   = $svc
                    local_port     = $e.dst_port
                    remote_address = $remoteAddr
                    remote_port    = $remotePort
                    protocol       = $e.protocol
                    direction      = $e.direction
                    event_time     = $e.event_time
                }
            }
        }
    }

    Write-FirewallLogState -StatePath $StatePath -Offset $info.Length -Size $info.Length

    # Concatenate; preserve matched-first ordering for predictability.
    $combined = New-Object System.Collections.ArrayList
    foreach ($m in $matched) { [void]$combined.Add($m) }
    foreach ($u in $unmatched.Values) { [void]$combined.Add($u) }
    return ,$combined.ToArray()
}

function Send-FirewallAuditLogs {
    param(
        [Parameter(Mandatory)][string]$AgentToken,
        [Parameter(Mandatory)][string]$ApiBaseUrl,
        [Parameter(Mandatory)][object[]]$Logs
    )
    if (-not $Logs -or $Logs.Count -eq 0) { return @{ ok = $true; sent = 0 } }
    try {
        $headers = @{ 'Content-Type' = 'application/json'; 'x-agent-token' = $AgentToken }
        $body    = @{ logs = $Logs } | ConvertTo-Json -Depth 10 -Compress
        $resp    = Invoke-RestMethod -Uri "$ApiBaseUrl/firewall-logs" -Method POST -Headers $headers -Body $body -TimeoutSec 30 -ErrorAction Stop
        return @{ ok = $true; sent = $Logs.Count; resp_count = $resp.count }
    } catch {
        return @{ ok = $false; error = $_.Exception.Message; sent = 0 }
    }
}

Export-ModuleMember -Function Get-FirewallAuditPayload, Send-FirewallAuditLogs, Enable-FirewallLogging
