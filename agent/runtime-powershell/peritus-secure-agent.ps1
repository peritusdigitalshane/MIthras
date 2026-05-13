# peritus-secure-agent.ps1 — Phase 2a service main loop.
# Runs as NT AUTHORITY\SYSTEM under NSSM. No interactive prompts.
#
# Behaviour:
#   1. Read DPAPI-encrypted config (agent_id, agent_secret, api_base_url) from $ConfigFile.
#   2. Loop:
#       a. Heartbeat — POST /agent-heartbeat with current OS / Defender / agent version metadata.
#       b. Every 10 heartbeats, GET /agent-version-check.
#       c. Sleep HEARTBEAT_INTERVAL_SECONDS.
#   3. If config is missing, log critical event and exit 1 — NSSM restarts via exponential backoff.

[CmdletBinding()]
param(
    [int]$HeartbeatIntervalSeconds = 60
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

# Paths
$script:AgentRoot   = 'C:\ProgramData\PeritusSecure'
$script:ConfigFile  = Join-Path $script:AgentRoot 'config.dat'
$script:LogDir      = Join-Path $script:AgentRoot 'logs'
$script:InstallRoot = Join-Path $script:AgentRoot 'install'
$script:AgentVersion = (Get-Content (Join-Path $PSScriptRoot 'agent.version') -Raw).Trim()

# Modules
Import-Module (Join-Path $PSScriptRoot 'lib/HmacAuth.psm1')    -Force
Import-Module (Join-Path $PSScriptRoot 'lib/SecureConfig.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'lib/ApiClient.psm1')    -Force

# Logging — file + Windows Event Log
$script:EventSource = 'Peritus Secure Agent'
function Write-AgentLog {
    param(
        [Parameter(Mandatory)][string]$Message,
        [ValidateSet('Info','Warn','Error','Critical')][string]$Level = 'Info'
    )
    $ts = (Get-Date).ToString('o')
    $line = "[$ts] [$Level] $Message"
    Write-Host $line

    if (-not (Test-Path $script:LogDir)) {
        New-Item -ItemType Directory -Path $script:LogDir -Force | Out-Null
    }
    $logFile = Join-Path $script:LogDir ("agent-" + (Get-Date -Format 'yyyy-MM-dd') + ".log")
    Add-Content -Path $logFile -Value $line -Encoding UTF8

    # Event Log — best-effort
    try {
        if (-not [System.Diagnostics.EventLog]::SourceExists($script:EventSource)) {
            [System.Diagnostics.EventLog]::CreateEventSource($script:EventSource, 'Application')
        }
        $entryType = switch ($Level) { 'Info' { 'Information' } 'Warn' { 'Warning' } default { 'Error' } }
        [System.Diagnostics.EventLog]::WriteEntry($script:EventSource, $Message, $entryType)
    } catch {
        # If event source creation fails (non-admin context), fall back silently to file logging only.
    }
}

# --------------------------------------------------------------------------
# Startup
# --------------------------------------------------------------------------

Write-AgentLog "Peritus Secure Agent v$script:AgentVersion starting"

if (-not (Test-SecureConfigExists -Path $script:ConfigFile)) {
    Write-AgentLog -Level Critical "Config file not found at $script:ConfigFile — agent has not been enrolled. Exiting."
    exit 1
}

try {
    $cfg = Read-SecureConfig -Path $script:ConfigFile
} catch {
    Write-AgentLog -Level Critical "Failed to read config: $_. Exiting."
    exit 1
}

foreach ($k in @('agent_id','agent_secret','api_base_url')) {
    if (-not $cfg.ContainsKey($k) -or [string]::IsNullOrWhiteSpace($cfg[$k])) {
        Write-AgentLog -Level Critical "Config is missing required key '$k'. Exiting."
        exit 1
    }
}

$script:AgentId    = $cfg['agent_id']
$script:AgentSecret = $cfg['agent_secret']
$script:ApiBaseUrl = $cfg['api_base_url'].TrimEnd('/')

Write-AgentLog "Enrolled agent_id=$script:AgentId api=$script:ApiBaseUrl"

# --------------------------------------------------------------------------
# Main loop
# --------------------------------------------------------------------------

$iteration = 0
$versionCheckEvery = 10

while ($true) {
    $iteration++

    # Heartbeat
    try {
        $defenderStatus = $null
        try { $defenderStatus = Get-MpComputerStatus -ErrorAction Stop } catch {}
        $payload = @{
            agent_version    = $script:AgentVersion
            os_version       = (Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction SilentlyContinue).Caption
            os_build         = [string](Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction SilentlyContinue).BuildNumber
            defender_version = if ($defenderStatus) { [string]$defenderStatus.AMEngineVersion } else { $null }
        }
        $resp = Invoke-AgentHeartbeat -ApiBaseUrl $script:ApiBaseUrl -AgentId $script:AgentId -AgentSecret $script:AgentSecret -Payload $payload
        Write-AgentLog "Heartbeat OK — next_check_in=$($resp.next_check_in)s, commands=$($resp.commands.Count)"
    } catch {
        Write-AgentLog -Level Warn "Heartbeat failed: $_"
    }

    # Periodic version check
    if (($iteration % $versionCheckEvery) -eq 0) {
        try {
            $latest = Invoke-AgentVersionCheck -ApiBaseUrl $script:ApiBaseUrl -AgentId $script:AgentId -AgentSecret $script:AgentSecret -CurrentVersion $script:AgentVersion
            if ($latest -and $latest.update_available) {
                Write-AgentLog "Update available: $($latest.latest) (current $script:AgentVersion). Auto-update not yet implemented."
                # Phase 2a does NOT auto-install updates. Phase 2b (or a follow-up task) handles signed-binary download + verify + swap.
            }
        } catch {
            Write-AgentLog -Level Warn "Version check failed: $_"
        }
    }

    Start-Sleep -Seconds $HeartbeatIntervalSeconds
}
