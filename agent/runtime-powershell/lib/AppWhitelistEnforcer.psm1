# AppWhitelistEnforcer.psm1 -- v0.5.8
#
# Application whitelisting collector + enforcer.
#
# Mode is fetched from /agent-api/app-whitelist-policy:
#   idle       -- do nothing
#   auditing   -- observe every process launch, ship as action='observed'
#   enforcing  -- observe + check against rules. If no rule matches:
#                  Stop-Process, ship as action='blocked'. If matches:
#                  ship as action='allowed'.
#
# Process discovery uses a polling Win32_Process snapshot per pass keyed by
# CreationDate so we catch new launches without needing Register-WmiEvent
# (which is fragile inside a long-running PowerShell service). The PID-tracking
# hashtable is module-scoped to dedup across passes.
#
# Identity hierarchy for whitelist matching (any one match = allow):
#   1. SHA-256 of the executable image
#   2. Authenticode publisher (CompanyName from FileVersionInfo)
#   3. Path glob (case-insensitive, * wildcards)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

# Per-process-launch cache, keyed by "$PID|$creationDate". Bounded LRU not
# needed -- PIDs roll over and the cache resets between agent restarts.
$script:AwlSeen = @{}

# A bounded queue of pending events to ship; drained on each pass.
$script:AwlPending = New-Object System.Collections.Generic.List[hashtable]

function _AwlLog($lvl, $msg) {
    try {
        $d = 'C:\ProgramData\Mithras\logs'
        if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
        Add-Content -Path (Join-Path $d 'collectors.log') -Value "[$(Get-Date -Format o)] [$lvl] app-whitelist: $msg" -Encoding UTF8
    } catch {}
}

function _AwlFileVersionInfo {
    param([string]$Path)
    if (-not $Path -or -not (Test-Path -LiteralPath $Path -ErrorAction SilentlyContinue)) { return $null }
    try { return [Diagnostics.FileVersionInfo]::GetVersionInfo($Path) } catch { return $null }
}

function _AwlHashFile {
    param([string]$Path)
    if (-not $Path -or -not (Test-Path -LiteralPath $Path -ErrorAction SilentlyContinue)) { return $null }
    try {
        # Get-FileHash is the fastest path; SHA256 by default.
        $h = Get-FileHash -LiteralPath $Path -Algorithm SHA256 -ErrorAction Stop
        return $h.Hash.ToLowerInvariant()
    } catch { return $null }
}

function _AwlPathMatchesGlob {
    # Case-insensitive glob match. Supports * (any chars), no other wildcards.
    param([string]$Path, [string]$Pattern)
    if (-not $Path -or -not $Pattern) { return $false }
    $rx = '^' + [Regex]::Escape($Pattern).Replace('\*', '.*') + '$'
    return [Regex]::IsMatch($Path, $rx, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
}

function _AwlMatchRule {
    # Returns the first matching rule (the agent doesn't need to know which
    # match-type allowed it -- the server stamps it again on insert).
    #
    # trusted_path (Airlock-style compound): the binary must be in match_value
    # AND signed by the rule's publisher. Closes the "drop unsigned payload
    # into a trusted folder" bypass class -- path alone is not enough.
    param(
        [string]$Sha256,
        [string]$Publisher,
        [string]$Path,
        $Rules
    )
    if (-not $Rules) { return $null }
    foreach ($r in $Rules) {
        $type = ([string]$r.match_type).ToLower()
        $val  = [string]$r.match_value
        if (-not $val) { continue }
        switch ($type) {
            'hash' {
                if ($Sha256 -and ($Sha256.ToLowerInvariant() -eq $val.ToLowerInvariant())) { return $r }
            }
            'publisher' {
                if ($Publisher -and ($Publisher.Trim() -ieq $val.Trim())) { return $r }
            }
            'path' {
                if ($Path -and (_AwlPathMatchesGlob -Path $Path -Pattern $val)) { return $r }
            }
            'trusted_path' {
                # AND condition: path glob AND publisher must both pass.
                $reqPub = [string]$r.publisher
                if (-not $reqPub) { continue }
                if ($Path -and (_AwlPathMatchesGlob -Path $Path -Pattern $val) -and
                    $Publisher -and ($Publisher.Trim() -ieq $reqPub.Trim())) {
                    return $r
                }
            }
        }
    }
    return $null
}

function Invoke-AppWhitelistPass {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Mode,
        [object]$Rules,
        [int]$MaxEventsPerPass = 200
    )
    # No-op when idle; the main loop should skip this pass entirely but we
    # also guard here so a transient call doesn't kill anything.
    if ($Mode -eq 'idle') { return @() }

    $enforcing = ($Mode -eq 'enforcing')

    $procs = $null
    try {
        $procs = Get-CimInstance -ClassName Win32_Process -ErrorAction Stop
    } catch {
        _AwlLog 'Warn' "Get-CimInstance Win32_Process failed: $_"
        return @()
    }

    $thisPid = $PID
    foreach ($p in $procs) {
        if (-not $p.ProcessId) { continue }
        if ($p.ProcessId -eq $thisPid) { continue }                  # never kill ourselves
        if (-not $p.CreationDate) { continue }

        $key = "{0}|{1}" -f $p.ProcessId, $p.CreationDate
        if ($script:AwlSeen.ContainsKey($key)) { continue }
        $script:AwlSeen[$key] = $true

        $path = $p.ExecutablePath
        if (-not $path) { continue }                                 # kernel/system bits

        # Skip our own service stack and PowerShell itself if it's running our
        # agent script -- belt-and-braces in case ProcessId-of-self check misses.
        if ($path -match '\\Mithras\\') { continue }

        # Skip if path doesn't exist (process has already exited).
        if (-not (Test-Path -LiteralPath $path -ErrorAction SilentlyContinue)) { continue }

        $vi        = _AwlFileVersionInfo -Path $path
        $publisher = if ($vi) { [string]$vi.CompanyName } else { $null }
        $product   = if ($vi) { [string]$vi.ProductName } else { $null }
        $version   = if ($vi) { [string]$vi.FileVersion } else { $null }
        $sha       = _AwlHashFile -Path $path

        $matched  = _AwlMatchRule -Sha256 $sha -Publisher $publisher -Path $path -Rules $Rules
        $action   = 'observed'
        $ruleId   = $null

        if ($enforcing) {
            if ($matched) {
                $action = 'allowed'
                $ruleId = $matched.id
            } else {
                # Block. We try to terminate the process; if the kill fails
                # (race -- already exited) the event still ships as blocked.
                $action = 'blocked'
                try {
                    Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
                } catch {
                    _AwlLog 'Warn' ("Stop-Process pid={0} path='{1}' failed: {2}" -f $p.ProcessId, $path, $_.Exception.Message)
                }
            }
        }

        $evt = @{
            file_name    = [IO.Path]::GetFileName($path)
            file_path    = $path
            sha256       = $sha
            publisher    = $publisher
            product_name = $product
            file_version = $version
            process_id   = [int]$p.ProcessId
            parent_path  = $null
            user_name    = $null
            command_line = if ($p.CommandLine) { [string]$p.CommandLine } else { $null }
            action       = $action
            rule_id      = $ruleId
            event_time   = (Get-Date).ToUniversalTime().ToString('o')
        }

        $script:AwlPending.Add($evt) | Out-Null
        if ($script:AwlPending.Count -ge $MaxEventsPerPass) { break }
    }

    # GC the seen cache periodically -- prevents unbounded growth on busy boxes.
    if ($script:AwlSeen.Count -gt 5000) {
        $script:AwlSeen.Clear()
        _AwlLog 'Info' 'seen-cache reset'
    }

    $out = @($script:AwlPending.ToArray())
    $script:AwlPending.Clear()
    # v0.7.6: was `return ,$out` which wrapped an already-array in another
    # array. $events.Count was always 1 on the caller side, so Send-AppAuditLogs
    # fired every 30s with a 1-element payload of inner-array, inserting a
    # garbage all-null row into app_audit_logs per pass.
    return $out
}

function Send-AppAuditLogs {
    param(
        [Parameter(Mandatory)][string]$AgentToken,
        [Parameter(Mandatory)][string]$ApiBaseUrl,
        [Parameter(Mandatory)][object[]]$Logs
    )
    if (-not $Logs -or $Logs.Count -eq 0) { return @{ ok = $true; sent = 0 } }
    try {
        $headers = @{ 'Content-Type' = 'application/json'; 'x-agent-token' = $AgentToken }
        $body    = @{ logs = $Logs } | ConvertTo-Json -Depth 10 -Compress
        $resp    = Invoke-RestMethod -Uri "$ApiBaseUrl/app-audit-logs" -Method POST -Headers $headers -Body $body -TimeoutSec 30 -ErrorAction Stop
        return @{ ok = $true; sent = $Logs.Count; resp_count = $resp.count }
    } catch {
        return @{ ok = $false; error = $_.Exception.Message; sent = 0 }
    }
}

function Get-AppWhitelistPolicy {
    param(
        [Parameter(Mandatory)][string]$AgentToken,
        [Parameter(Mandatory)][string]$ApiBaseUrl
    )
    try {
        $headers = @{ 'x-agent-token' = $AgentToken }
        $resp = Invoke-RestMethod -Uri "$ApiBaseUrl/app-whitelist-policy" -Method GET -Headers $headers -TimeoutSec 30 -ErrorAction Stop
        return @{ ok = $true; mode = $resp.mode; rules = $resp.rules }
    } catch {
        return @{ ok = $false; error = $_.Exception.Message; mode = 'idle'; rules = @() }
    }
}

Export-ModuleMember -Function Invoke-AppWhitelistPass, Send-AppAuditLogs, Get-AppWhitelistPolicy
