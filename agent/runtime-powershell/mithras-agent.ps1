# mithras-agent.ps1 -- Mithras Threat Defence Agent main loop.
# Runs as NT AUTHORITY\SYSTEM under NSSM (optionally fronted by MithrasAgent.exe
# C# launcher so Task Manager shows the Mithras icon). No interactive prompts.
#
# Behaviour:
#   1. Read DPAPI-encrypted config (agent_id, agent_secret, api_base_url) from $ConfigFile.
#   2. Loop:
#       a. Heartbeat -- POST /agent-heartbeat with current OS / Defender / agent version metadata.
#       b. Every 10 heartbeats, GET /agent-version-check.
#       c. Sleep HEARTBEAT_INTERVAL_SECONDS.
#   3. If config is missing, log critical event and exit 1 -- NSSM restarts via exponential backoff.

[CmdletBinding()]
param(
    # v0.7.6: default fast-start cadence. The server-pushed `next_check_in`
    # value on every heartbeat overrides this within a few seconds anyway,
    # but a fresh-install agent uses this until it makes its first round-
    # trip. 30s gives the SOC operator a near-immediate connection signal
    # after install without measurable load.
    [int]$HeartbeatIntervalSeconds = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

# Paths
$script:AgentRoot   = 'C:\ProgramData\Mithras'
$script:ConfigFile  = Join-Path $script:AgentRoot 'config.dat'
$script:LogDir      = Join-Path $script:AgentRoot 'logs'
$script:InstallRoot = Join-Path $script:AgentRoot 'install'
$script:WdacStateFile = Join-Path $script:AgentRoot 'wdac-state.json'
$script:AgentVersion = (Get-Content (Join-Path $PSScriptRoot 'agent.version') -Raw).Trim()

# Modules
Import-Module (Join-Path $PSScriptRoot 'lib/HmacAuth.psm1')           -Force
Import-Module (Join-Path $PSScriptRoot 'lib/SecureConfig.psm1')        -Force
Import-Module (Join-Path $PSScriptRoot 'lib/ApiClient.psm1')           -Force
Import-Module (Join-Path $PSScriptRoot 'lib/WdacControl.psm1')         -Force
Import-Module (Join-Path $PSScriptRoot 'lib/DefenderCollector.psm1')    -Force
Import-Module (Join-Path $PSScriptRoot 'lib/SoftwareCollector.psm1')    -Force
Import-Module (Join-Path $PSScriptRoot 'lib/EventLogCollector.psm1')    -Force
Import-Module (Join-Path $PSScriptRoot 'lib/ProcessEventCollector.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'lib/PersistenceCollector.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'lib/CommandExecutor.psm1')      -Force
Import-Module (Join-Path $PSScriptRoot 'lib/CodeSigning.psm1')          -Force
Import-Module (Join-Path $PSScriptRoot 'lib/Updater.psm1')              -Force
Import-Module (Join-Path $PSScriptRoot 'lib/PolicyEnforcer.psm1')       -Force
Import-Module (Join-Path $PSScriptRoot 'lib/FirewallAuditCollector.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'lib/SysmonInstaller.psm1')       -Force
Import-Module (Join-Path $PSScriptRoot 'lib/SysmonCollector.psm1')       -Force
Import-Module (Join-Path $PSScriptRoot 'lib/DnsPolicyEnforcer.psm1')     -Force
Import-Module (Join-Path $PSScriptRoot 'lib/AppDiscoveryCollector.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'lib/AppWhitelistEnforcer.psm1')  -Force
Import-Module (Join-Path $PSScriptRoot 'lib/WdacEnforcer.psm1')          -Force
Import-Module (Join-Path $PSScriptRoot 'lib/TamperProtection.psm1')      -Force
Import-Module (Join-Path $PSScriptRoot 'lib/TamperDetector.psm1')        -Force
Import-Module (Join-Path $PSScriptRoot 'lib/DefenderStateCollector.psm1') -Force

$script:EventLogStateFile        = Join-Path $script:AgentRoot 'event-log-state.json'
$script:ProcessEventStateFile    = Join-Path $script:AgentRoot 'process-event-state.json'
$script:PersistenceStateFile     = Join-Path $script:AgentRoot 'persistence-state.json'
$script:LastSoftwarePushAt       = [datetime]::MinValue
$script:SoftwarePushEvery        = [timespan]::FromHours(1)
$script:LastPersistencePushAt    = [datetime]::MinValue
$script:PersistencePushEvery     = [timespan]::FromHours(4)
$script:LastPolicyPassAt         = [datetime]::MinValue
$script:PolicyPassEvery          = [timespan]::FromMinutes(15)
$script:LastFirewallAuditAt      = [datetime]::MinValue
$script:FirewallAuditEvery       = [timespan]::FromMinutes(5)
$script:FirewallAuditStateFile   = Join-Path $script:AgentRoot 'firewall-audit-state.json'
$script:LastFirewallPolicyRules  = $null

# Sysmon EDR telemetry (v0.4.7)
$script:LastSysmonEnsureAt       = [datetime]::MinValue
$script:SysmonEnsureEvery        = [timespan]::FromHours(1)
$script:SysmonConfigPath         = Join-Path $PSScriptRoot 'sysmon-config.xml'
$script:LastSysmonShipAt         = [datetime]::MinValue
$script:SysmonShipEvery          = [timespan]::FromMinutes(5)

# DNS module (v0.4.7)
$script:LastDnsPolicyAt          = [datetime]::MinValue
$script:DnsPolicyEvery           = [timespan]::FromMinutes(15)

# App discovery (v0.5.4) -- populates the App Control UI with discovered
# apps even when no WDAC rule_set is assigned to the endpoint.
$script:LastAppDiscoveryAt       = [datetime]::MinValue
$script:AppDiscoveryEvery        = [timespan]::FromHours(1)

# App whitelisting (v0.5.8) -- per-endpoint state machine: idle | auditing | enforcing.
# Polls policy on the same cadence as the firewall policy, and runs an
# observe/enforce pass every 30 seconds when mode != idle.
$script:LastAppWhitelistPolicyAt = [datetime]::MinValue
$script:AppWhitelistPolicyEvery  = [timespan]::FromMinutes(2)
$script:LastAppWhitelistPassAt   = [datetime]::MinValue
$script:AppWhitelistPassEvery    = [timespan]::FromSeconds(30)
$script:AppWhitelistMode         = 'idle'
$script:AppWhitelistRules        = @()

# WDAC (v0.6.0) -- kernel CI policy for Win10/11 Enterprise + Server 2016+.
# Polls /wdac-policy hourly. Applies only when there are rules AND the
# explicit mode in those rules is 'audit' or 'enforce'. The agent caches the
# last applied rules_hash so re-apply only fires on a real change.
$script:LastWdacPollAt           = [datetime]::MinValue
$script:WdacPollEvery            = [timespan]::FromHours(1)
$script:LastAppliedWdacHash      = $null
$script:PendingCommandResults    = New-Object System.Collections.ArrayList
$script:PendingWdacBlocks        = New-Object System.Collections.ArrayList

# Logging -- file + Windows Event Log
$script:EventSource = 'Mithras Threat Defence Agent'
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

    # Event Log -- best-effort
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

Write-AgentLog "Mithras Threat Defence Agent v$script:AgentVersion starting"

if (-not (Test-SecureConfigExists -Path $script:ConfigFile)) {
    Write-AgentLog -Level Critical "Config file not found at $script:ConfigFile -- agent has not been enrolled. Exiting."
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

# v0.6.4: tamper protection self-heal. Idempotent -- re-applies the hardened
# service DACL + recovery flags + watchdog every time the agent starts so
# that any attempt to revert them is bounded by the next restart cycle.
# All steps no-op silently if already in the desired state.
try {
    $tp = Set-MithrasServiceHardening -ServiceName 'MithrasAgent'
    if ($tp.ok) {
        Write-AgentLog "Tamper protection: service DACL hardened"
    } else {
        Write-AgentLog -Level Warn "Tamper protection: hardening returned $($tp.reason)"
    }
    $wd = Register-MithrasWatchdog -ServiceName 'MithrasAgent'
    if ($wd.ok) {
        Write-AgentLog "Tamper protection: watchdog scheduled task ensured"
    } else {
        Write-AgentLog -Level Warn "Tamper protection: watchdog register failed: $($wd.error)"
    }

    # v0.6.5 (Phase 2): filesystem hardening on install/, sysmon/, config.dat.
    # Idempotent; non-fatal if it fails (we still want the agent running).
    $fs = Set-MithrasFilesystemHardening
    if ($fs.ok) {
        $count = ($fs.paths.Keys | Where-Object { $fs.paths[$_].ok }).Count
        Write-AgentLog "Tamper protection: filesystem hardened ($count paths)"
    }
} catch {
    Write-AgentLog -Level Warn "Tamper protection setup failed: $_"
}

# v0.6.7: register Defender exclusions for the agent's own paths every
# service start. Idempotent (Add-MpPreference silently no-ops on a duplicate).
# Without this, fresh installs OR endpoints that had exclusions removed will
# get Defender behaviour-monitor blocks on otherwise-legitimate SYSTEM-context
# PS activity (file hash compares, swap.ps1 stop/start cycles, sysmon's
# signature-injection event). Belt-and-braces -- install-agent.ps1 also adds
# these on install.
try {
    if (Get-Command Add-MpPreference -ErrorAction SilentlyContinue) {
        $exclPaths = @(
            $script:InstallRoot,
            "$($script:InstallRoot)\*",
            "$($script:InstallRoot)\lib\*",
            "$($script:InstallRoot)\vendor\*",
            (Join-Path $script:AgentRoot 'sysmon')
        )
        $exclProcs = @(
            (Join-Path $script:InstallRoot 'mithras-agent.ps1'),
            (Join-Path $script:InstallRoot 'mithras-tray.ps1'),
            (Join-Path $script:InstallRoot 'vendor\nssm.exe')
        )
        $existingP = @((Get-MpPreference -ErrorAction Stop).ExclusionPath)
        $existingX = @((Get-MpPreference -ErrorAction Stop).ExclusionProcess)
        $addedP = 0; $addedX = 0
        foreach ($p in $exclPaths) {
            if ($existingP -notcontains $p) { try { Add-MpPreference -ExclusionPath $p -ErrorAction Stop; $addedP++ } catch {} }
        }
        foreach ($p in $exclProcs) {
            if ($existingX -notcontains $p) { try { Add-MpPreference -ExclusionProcess $p -ErrorAction Stop; $addedX++ } catch {} }
        }
        if ($addedP -gt 0 -or $addedX -gt 0) {
            Write-AgentLog "Defender exclusions self-heal: added=$addedP paths, $addedX processes"
        }
    }
} catch {
    Write-AgentLog -Level Warn "Defender exclusion self-heal failed: $_"
}

# NOTE: ransomware canaries (RansomwareCanary.psm1) are held until we add
# Defender exclusions for the agent. Without them, Defender's behavior
# monitor flags the canary-write pattern as ransomware and quarantines our
# own agent. See backlog item "Ransomware canaries -- requires Defender
# exclusion design first".

# v0.6.8: Recover any pending command results that were saved to disk before
# the previous process exited due to an upgrade swap. The swap task stops the
# service ~5s after Invoke-AgentSelfUpdate returns, skipping the next
# heartbeat. Read-PendingCommandResults (Updater.psm1) loads the file and
# deletes it; the results then ship in the first heartbeat of this process.
try {
    $recovered = Read-PendingCommandResults
    if ($recovered -and $recovered.Count -gt 0) {
        foreach ($r in $recovered) { [void]$script:PendingCommandResults.Add($r) }
        Write-AgentLog "Recovered $($recovered.Count) pending command result(s) from prior upgrade swap"
    }
} catch {
    Write-AgentLog -Level Warn "Failed to recover pending command results: $_"
}

# --------------------------------------------------------------------------
# Main loop
# --------------------------------------------------------------------------

$iteration = 0
# v0.6.3: tighter version check cadence (~5 min instead of ~20 with the
# previous setting). The heartbeat response now also carries `latest_version`
# with `upgrade_available` so we can short-circuit even sooner if a release
# drops between polls -- see $forceVersionCheck below.
$versionCheckEvery = 5
$script:NextSleepSeconds = $HeartbeatIntervalSeconds   # server-honoured cadence
$script:ForceVersionCheck = $false                      # set true by heartbeat hint

# v0.7.8: pre-loop heartbeat. The 6 subsystems that rely on the legacy
# bearer token cache (firewall audit shipping, app whitelist policy fetch
# + pass, WDAC fetch, DNS policy fetch, Sysmon ship, policy enforcement
# pass) all run BEFORE the in-loop heartbeat populates the cache. On a
# fresh HMAC-only enrolment that meant a full no-op cycle (up to 60s) for
# all six before they had a token to use. A tiny preflight POST against
# /agent-heartbeat with no body populates the cache so subsystem-pass #1
# already has it.
try {
    $prelimResp = Invoke-AgentHeartbeat -ApiBaseUrl $script:ApiBaseUrl -AgentId $script:AgentId -AgentSecret $script:AgentSecret -Payload @{ preflight = $true }
    if ($prelimResp -and $prelimResp.PSObject.Properties['legacy_agent_token'] -and $prelimResp.legacy_agent_token) {
        Set-CachedLegacyAgentToken -Token ([string]$prelimResp.legacy_agent_token)
        Write-AgentLog "Preflight heartbeat: legacy bearer cache populated for first-pass subsystems"
    } else {
        Write-AgentLog -Level Warn "Preflight heartbeat returned no legacy_agent_token - first subsystem pass will no-op"
    }
} catch {
    # Non-fatal - we just lose the head start. Main loop's first heartbeat
    # will populate the cache for iteration 2 and onwards.
    Write-AgentLog -Level Warn "Preflight heartbeat failed (non-fatal): $($_.Exception.Message)"
}

while ($true) {
    $iteration++
    $loopStart = Get-Date

    # Heartbeat -- Phase 2 enriched payload.
    try {
        $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction SilentlyContinue

        $defenderStatus = $null
        try { $defenderStatus = Get-MpComputerStatus -ErrorAction Stop } catch {}

        $payload = @{
            agent_version    = $script:AgentVersion
            # v0.7.9: ship the current Windows ComputerName so the platform
            # reflects renames. Previously the hostname column was frozen
            # at enrolment, so operators investigating an endpoint via the
            # current name had no Mithras row pointing at it.
            hostname         = $env:COMPUTERNAME
            os_version       = if ($os) { $os.Caption } else { $null }
            os_build         = if ($os) { [string]$os.BuildNumber } else { $null }
            defender_version = if ($defenderStatus) { [string]$defenderStatus.AMEngineVersion } else { $null }
        }

        # Defender posture snapshot -- every heartbeat (cheap, single CIM call).
        try {
            $ds = Get-DefenderStatusPayload
            if ($ds) { $payload['defender_status'] = $ds }
        } catch { Write-AgentLog -Level Warn "defender_status collect failed: $_" }

        # Defender threats -- every heartbeat.
        try {
            $threats = Get-DefenderThreatsPayload
            if ($threats -and $threats.Count -gt 0) { $payload['threats'] = $threats }
        } catch { Write-AgentLog -Level Warn "threats collect failed: $_" }

        # v0.6.5: pull any new tamper-protection events for our service since
        # the last heartbeat. Stateful via tamper-events-state.json. Empty
        # most of the time -- when populated, the server escalates each to an
        # alert (tamper_attempt) for the SOC console.
        try {
            $tamper = Get-MithrasTamperEvents -MaxEvents 50
            if ($tamper -and $tamper.Count -gt 0) {
                $payload['tamper_events'] = $tamper
                Write-AgentLog "tamper_events: produced=$($tamper.Count)"
            }
        } catch { Write-AgentLog -Level Warn "tamper_events collect failed: $_" }

        # v0.6.6: Defender state snapshot. Cheap (1-2KB JSON), shipped every
        # heartbeat so the SOC can render a triage card without round-trip
        # commands. Empty arrays serialise as [] for safe server reading.
        try {
            $defState = Get-DefenderStatePayload
            if ($defState) { $payload['defender_state'] = $defState }
        } catch { Write-AgentLog -Level Warn "defender_state collect failed: $_" }

        # Defender event log -- only NEW records since last poll.
        try {
            $events = Get-DefenderEventLogsPayload -StatePath $script:EventLogStateFile
            if ($events -and $events.Count -gt 0) { $payload['event_logs'] = $events }
        } catch { Write-AgentLog -Level Warn "event_logs collect failed: $_" }

        # Software inventory -- every $SoftwarePushEvery (default 1h) or on first heartbeat.
        if ((Get-Date) - $script:LastSoftwarePushAt -ge $script:SoftwarePushEvery) {
            try {
                $sw = Get-SoftwareInventoryPayload
                if ($sw) {
                    $payload['software_inventory']          = $sw
                    $payload['software_inventory_complete'] = $true
                    $script:LastSoftwarePushAt = Get-Date
                }
            } catch { Write-AgentLog -Level Warn "software_inventory collect failed: $_" }
        }

        # v0.7.19: ProcessEventCollector retired. No server-side destination
        # exists for process_events — Sysmon EID 1 in `sysmon_events` covers
        # the same signal and is actively consumed by the AI hunt pipeline.
        # Module remains in the bundle for backwards compatibility with the
        # next install but is no longer invoked from the main loop.

        # v0.4.5: Persistence snapshot -- diff-only, every $PersistencePushEvery.
        if ((Get-Date) - $script:LastPersistencePushAt -ge $script:PersistencePushEvery) {
            try {
                $persist = Get-PersistenceSnapshotPayload -StatePath $script:PersistenceStateFile
                if ($persist) { $payload['persistence_snapshot'] = $persist }
                $script:LastPersistencePushAt = Get-Date
            } catch { Write-AgentLog -Level Warn "persistence collect failed: $_" }
        }

        # v0.4.6: UAC + Windows Update posture in every heartbeat.
        try {
            $posture = Get-EndpointPostureSummary
            if ($posture) {
                foreach ($k in $posture.Keys) { $payload[$k] = $posture[$k] }
            }
        } catch { Write-AgentLog -Level Warn "posture collect failed: $_" }

        # v0.4.6: Policy enforcement pass every $PolicyPassEvery (default 15min)
        # -- fetches Defender / UAC / Firewall / WU / GPO policies from agent-api
        # and applies them locally.
        if ((Get-Date) - $script:LastPolicyPassAt -ge $script:PolicyPassEvery) {
            try {
                $polRes = Invoke-PolicyEnforcementPass
                if ($polRes) {
                    Write-AgentLog ("Policy pass: def={0} uac={1} fw={2} wu={3} gpo={4}" -f $polRes.defender, $polRes.uac, $polRes.firewall, $polRes.wu, $polRes.gpo)
                    if ($polRes.firewall_rules) { $script:LastFirewallPolicyRules = $polRes.firewall_rules }
                }
                $script:LastPolicyPassAt = Get-Date
            } catch { Write-AgentLog -Level Warn "policy pass failed: $_" }
        }

        # v0.4.7: Firewall audit log collection -- ships pfirewall.log deltas so
        # the platform can show traffic patterns. Both ALLOW and DROP entries
        # are sent; audit-mode rules use them to show "what would be blocked".
        #
        # v0.6.8: removed the `if ($script:LastFirewallPolicyRules)` gate.
        # `$script:LastFirewallPolicyRules` only got set when the policy
        # orchestrator actually RE-APPLIED the firewall policy. After every
        # service restart the orchestrator sees the cached policy hash matches
        # and skips re-application, so the variable stayed $null and audit
        # shipping was silently disabled until something changed the policy
        # (often never). The collector handles a null PolicyRules cleanly --
        # it just returns every audited 5156/5157 event without enriching
        # with rule_id matches, which is still the data we want.
        if ((Get-Date) - $script:LastFirewallAuditAt -ge $script:FirewallAuditEvery) {
            try {
                $token = Get-LegacyAgentToken
                if ($token) {
                    $api  = 'https://api.mithras.com.au/functions/v1/agent-api'
                    $rules = if ($script:LastFirewallPolicyRules) { $script:LastFirewallPolicyRules } else { @() }
                    $logs = Get-FirewallAuditPayload -StatePath $script:FirewallAuditStateFile -PolicyRules $rules -MaxEvents 500
                    if ($logs -and $logs.Count -gt 0) {
                        $r = Send-FirewallAuditLogs -AgentToken $token -ApiBaseUrl $api -Logs $logs
                        if ($r.ok) { Write-AgentLog ("Firewall audit shipped: {0} logs" -f $r.sent) }
                        else       { Write-AgentLog -Level Warn ("Firewall audit ship failed: {0}" -f $r.error) }
                    }
                }
                $script:LastFirewallAuditAt = Get-Date
            } catch { Write-AgentLog -Level Warn "firewall audit pass failed: $_" }
        }

        # v0.5.8: Application whitelisting. Two cadences:
        #   * policy fetch every 2 min -- pulls mode + rules from the server
        #   * pass every 30 sec when mode != idle -- WMI snapshot, hash, match,
        #     and (in enforcing mode) Stop-Process anything unmatched
        if ((Get-Date) - $script:LastAppWhitelistPolicyAt -ge $script:AppWhitelistPolicyEvery) {
            try {
                $token = Get-LegacyAgentToken
                if ($token) {
                    $api = 'https://api.mithras.com.au/functions/v1/agent-api'
                    $pol = Get-AppWhitelistPolicy -AgentToken $token -ApiBaseUrl $api
                    if ($pol.ok) {
                        if ($pol.mode -and $pol.mode -ne $script:AppWhitelistMode) {
                            Write-AgentLog ("AppWhitelist mode: {0} -> {1}" -f $script:AppWhitelistMode, $pol.mode)
                        }
                        $script:AppWhitelistMode  = $pol.mode
                        $script:AppWhitelistRules = $pol.rules
                    }
                }
                $script:LastAppWhitelistPolicyAt = Get-Date
            } catch { Write-AgentLog -Level Warn "AppWhitelist policy fetch failed: $_" }
        }

        if ($script:AppWhitelistMode -ne 'idle' -and
            ((Get-Date) - $script:LastAppWhitelistPassAt -ge $script:AppWhitelistPassEvery)) {
            try {
                $events = Invoke-AppWhitelistPass -Mode $script:AppWhitelistMode -Rules $script:AppWhitelistRules -MaxEventsPerPass 200
                if ($events -and $events.Count -gt 0) {
                    $token = Get-LegacyAgentToken
                    if ($token) {
                        $api = 'https://api.mithras.com.au/functions/v1/agent-api'
                        $r = Send-AppAuditLogs -AgentToken $token -ApiBaseUrl $api -Logs $events
                        if ($r.ok) { Write-AgentLog ("AppWhitelist shipped: {0} events (mode={1})" -f $r.sent, $script:AppWhitelistMode) }
                        else       { Write-AgentLog -Level Warn ("AppWhitelist ship failed: {0}" -f $r.error) }
                    }
                }
                $script:LastAppWhitelistPassAt = Get-Date
            } catch { Write-AgentLog -Level Warn "AppWhitelist pass failed: $_" }
        }

        # v0.6.0: WDAC (kernel-level Application Control). Fetched hourly. Only
        # applies if rules exist AND the rules_hash changed since last apply.
        # Mode is taken from the rules' embedded `mode` field; audit is the
        # safe default. SKUs without ConvertFrom-CIPolicy report back an
        # explanatory error and continue.
        if ((Get-Date) - $script:LastWdacPollAt -ge $script:WdacPollEvery) {
            try {
                $token = Get-LegacyAgentToken
                if ($token) {
                    $api = 'https://api.mithras.com.au/functions/v1/agent-api'
                    $pol = Get-WdacPolicy -AgentToken $token -ApiBaseUrl $api
                    if ($pol.ok -and $pol.rules_count -gt 0) {
                        if ($pol.rules_hash -and $pol.rules_hash -eq $script:LastAppliedWdacHash) {
                            # No change since last apply -- skip.
                        } elseif (-not (Test-WdacSupported)) {
                            Send-WdacApplied -AgentToken $token -ApiBaseUrl $api `
                                -RulesHash $pol.rules_hash -Mode 'audit' `
                                -ErrorMessage 'wdac_unsupported_on_this_sku' | Out-Null
                            Write-AgentLog -Level Warn 'WDAC: ConvertFrom-CIPolicy unavailable; reported back and skipping apply'
                        } else {
                            # Derive overall mode from the rules' mode field
                            # (every row carries the assigned rule_set's mode).
                            $mode = 'audit'
                            $modes = @($pol.rules | ForEach-Object { ([string]$_.mode).ToLower() } | Where-Object { $_ })
                            if ($modes -contains 'enforce' -and ($modes -notcontains 'audit')) { $mode = 'enforce' }
                            $xml = ConvertTo-WdacPolicyXml -Rules $pol.rules -Mode $mode
                            $ap  = Apply-WdacPolicy -PolicyXml $xml
                            if ($ap.ok) {
                                $script:LastAppliedWdacHash = $pol.rules_hash
                                Send-WdacApplied -AgentToken $token -ApiBaseUrl $api `
                                    -RulesHash $pol.rules_hash -Mode $mode | Out-Null
                                Write-AgentLog ("WDAC: applied {0} rules in {1} mode" -f $pol.rules_count, $mode)
                            } else {
                                Send-WdacApplied -AgentToken $token -ApiBaseUrl $api `
                                    -RulesHash $pol.rules_hash -Mode $mode `
                                    -ErrorMessage $ap.error | Out-Null
                                Write-AgentLog -Level Warn ("WDAC: apply failed -- {0}" -f $ap.error)
                            }
                        }
                    }
                }
                $script:LastWdacPollAt = Get-Date
            } catch { Write-AgentLog -Level Warn "WDAC pass failed: $_" }
        }

        # v0.4.7: Sysmon EDR telemetry. Ensure Sysmon is installed (hourly check
        # is enough since the install is idempotent), then ship new events from
        # Microsoft-Windows-Sysmon/Operational on the same 5-min cadence.
        if ((Get-Date) - $script:LastSysmonEnsureAt -ge $script:SysmonEnsureEvery) {
            try {
                $r = Ensure-Sysmon -ConfigSourcePath $script:SysmonConfigPath
                if ($r.action -ne 'noop') {
                    Write-AgentLog ("Sysmon: action={0} reason={1}" -f $r.action, $r.reason)
                }
                $script:LastSysmonEnsureAt = Get-Date
            } catch { Write-AgentLog -Level Warn "Sysmon ensure failed: $_" }
        }

        if ((Get-Date) - $script:LastSysmonShipAt -ge $script:SysmonShipEvery) {
            try {
                $token = Get-LegacyAgentToken
                if ($token) {
                    $api    = 'https://api.mithras.com.au/functions/v1/agent-api'
                    $events = Get-SysmonEventPayload -MaxEvents 500
                    if ($events -and $events.Count -gt 0) {
                        $r = Send-SysmonEvents -AgentToken $token -ApiBaseUrl $api -Events $events
                        if ($r.ok) { Write-AgentLog ("Sysmon shipped: {0} events" -f $r.sent) }
                        else       { Write-AgentLog -Level Warn ("Sysmon ship failed: {0}" -f $r.error) }
                    }
                }
                $script:LastSysmonShipAt = Get-Date
            } catch { Write-AgentLog -Level Warn "Sysmon ship pass failed: $_" }
        }

        # v0.4.7: DNS policy enforcement. Fetches the assigned DNS policy
        # (split-DNS scopes + Mithras DoH default) and applies NRPT rules.
        if ((Get-Date) - $script:LastDnsPolicyAt -ge $script:DnsPolicyEvery) {
            try {
                $token = Get-LegacyAgentToken
                if ($token) {
                    $api = 'https://api.mithras.com.au/functions/v1/agent-api'
                    $resp = Invoke-RestMethod -Uri "$api/dns-policy" -Method GET `
                            -Headers @{ 'x-agent-token' = $token } -TimeoutSec 30 -ErrorAction Stop
                    if ($resp.enabled -and $resp.policy) {
                        $null = Apply-DnsPolicy -Policy $resp.policy
                    } elseif (-not $resp.enabled) {
                        # Module disabled for org - clean up any Mithras NRPT rules left behind.
                        Clear-MithrasDnsPolicy
                    }
                }
                $script:LastDnsPolicyAt = Get-Date
            } catch { Write-AgentLog -Level Warn "DNS policy pass failed: $_" }
        }

        # v0.5.4: App discovery pass. Ships a snapshot of installed-app exes +
        # currently-running processes to /agent-app-control/observed so the
        # platform's Application Control UI has data even before a WDAC rule_set
        # is assigned. Runs every $AppDiscoveryEvery (default 1h).
        if ((Get-Date) - $script:LastAppDiscoveryAt -ge $script:AppDiscoveryEvery) {
            try {
                $apps = Get-AppDiscoveryPayload -MaxItems 250
                if ($apps -and $apps.Count -gt 0) {
                    $null = Invoke-AgentAppControlObserved `
                        -ApiBaseUrl $script:ApiBaseUrl `
                        -AgentId    $script:AgentId `
                        -AgentSecret $script:AgentSecret `
                        -Apps       $apps
                    Write-AgentLog ("App discovery shipped: {0} apps" -f $apps.Count)
                }
                $script:LastAppDiscoveryAt = Get-Date
            } catch { Write-AgentLog -Level Warn "app discovery pass failed: $_" }
        }

        # v0.4.5: Pending WDAC block events (collected by OnBlockedBatch).
        if ($script:PendingWdacBlocks -and $script:PendingWdacBlocks.Count -gt 0) {
            $payload['wdac_blocks'] = @($script:PendingWdacBlocks)
            $script:PendingWdacBlocks.Clear()
        }

        # v0.7.12: Harvest any background install_updates jobs that completed
        # since the last heartbeat. WUA installs can take 5-30 minutes, so they
        # run in a Start-Job and we collect their results here instead of
        # blocking the main loop.
        try {
            if (Get-Command Get-CompletedInstallUpdates -ErrorAction SilentlyContinue) {
                $harvested = Get-CompletedInstallUpdates
                foreach ($r in $harvested) {
                    [void]$script:PendingCommandResults.Add($r)
                    Write-AgentLog "install_updates harvested: id=$($r.id) status=$($r.status)"
                }
            }
        } catch {
            Write-AgentLog -Level Warn "install_updates harvest failed: $_"
        }

        # v0.4.5: Pending command results from previously executed commands.
        if ($script:PendingCommandResults -and $script:PendingCommandResults.Count -gt 0) {
            $payload['command_results'] = @($script:PendingCommandResults)
            $script:PendingCommandResults.Clear()
        }

        $resp = Invoke-AgentHeartbeat -ApiBaseUrl $script:ApiBaseUrl -AgentId $script:AgentId -AgentSecret $script:AgentSecret -Payload $payload
        Write-AgentLog "Heartbeat OK - next_check_in=$($resp.next_check_in)s, commands=$($resp.commands.Count), sections=$($payload.Keys -join ',')"

        # v0.6.3: honour server-suggested next_check_in. v0.7.0: floor dropped
        # to 5s so the server can push down-cadence when commands are pending
        # (sends operator-triggered actions a fast feedback path).
        if ($resp -and $resp.PSObject.Properties['next_check_in'] -and $resp.next_check_in) {
            $proposed = [int]$resp.next_check_in
            if ($proposed -ge 5 -and $proposed -le 900) { $script:NextSleepSeconds = $proposed }
        }

        # v0.7.5: cache the legacy bearer token from the heartbeat response.
        # 6 subsystems (firewall audit ship, app whitelist policy + pass, WDAC
        # fetch, DNS policy fetch, Sysmon ship, policy enforcement pass) rely
        # on agent-api which only accepts x-agent-token. Fresh HMAC-only
        # enrolments don't write agent.json so they would silently no-op
        # until first restart from a legacy migration. The cache plugs
        # this gap on every endpoint, on every heartbeat.
        if ($resp -and $resp.PSObject.Properties['legacy_agent_token'] -and $resp.legacy_agent_token) {
            Set-CachedLegacyAgentToken -Token ([string]$resp.legacy_agent_token)
        }

        # v0.6.6: agent no longer auto-acts on `latest_version.upgrade_available`.
        # The server includes this field for the SOC console UI ("upgrade
        # available" badge), but the agent only upgrades when explicitly told
        # via an `upgrade_agent` command queued from the console. This makes
        # version rollouts an operator decision -- a bad release can't
        # cascade across the fleet.

        # v0.4.5: Execute commands the server returned in this heartbeat.
        if ($resp.commands -and $resp.commands.Count -gt 0) {
            $hadUpgrade = $false
            foreach ($cmd in $resp.commands) {
                try {
                    $params = @{}
                    if ($cmd.params) {
                        foreach ($p in $cmd.params.PSObject.Properties) { $params[$p.Name] = $p.Value }
                    }
                    $cmdResult = Invoke-AgentCommand -CommandId $cmd.id -CommandType $cmd.command_type -Params $params
                    # v0.7.12: install_updates (and any future long-running
                    # command) returns status='__deferred__' as a marker that
                    # the work was spawned into a background job. Don't ship a
                    # result yet — the harvester at the top of the next
                    # heartbeat loop will pick up the real result when the
                    # job completes.
                    if ($cmdResult.status -ne '__deferred__') {
                        [void]$script:PendingCommandResults.Add($cmdResult)
                    }
                    Write-AgentLog "Command $($cmd.command_type) id=$($cmd.id) -> $($cmdResult.status)"
                    if ($cmd.command_type -eq 'upgrade_agent') { $hadUpgrade = $true }
                } catch {
                    [void]$script:PendingCommandResults.Add(@{ id = $cmd.id; status = 'failed'; error = $_.Exception.Message })
                    Write-AgentLog -Level Warn "Command $($cmd.command_type) threw: $_"
                }
            }
            # v0.6.8: if an upgrade_agent command was just processed, flush
            # PendingCommandResults to disk now. The swap scheduled task will
            # Stop-Service within ~5s -- before the next heartbeat can ship
            # the result. The new agent process reads the file on startup and
            # ships the ack in its first heartbeat.
            if ($hadUpgrade) {
                try {
                    Save-PendingCommandResults -Results $script:PendingCommandResults
                    Write-AgentLog "upgrade_agent: flushed $($script:PendingCommandResults.Count) pending result(s) to disk before service swap"
                } catch {
                    Write-AgentLog -Level Warn "upgrade_agent: failed to persist pending results: $_"
                }
            }

            # v0.7.0: commands were just processed. Queue an immediate-ish
            # next heartbeat (2s) so the result lands at the server fast --
            # instead of waiting up to a full cadence (~60s) + the time the
            # heavy collectors take. The operator clicks "Release Isolation"
            # and sees succeeded in the UI within ~5s instead of 2-4 minutes.
            # Heavy collectors are time-gated so they won't re-trigger in 2s.
            $script:NextSleepSeconds = 2
        }

        # App-control sync.
        try {
            $appControlState = $null
            if ($resp.PSObject.Properties.Name -contains 'app_control') { $appControlState = $resp.app_control }

            $apiBase = $script:ApiBaseUrl
            $agentId = $script:AgentId
            $secret  = $script:AgentSecret
            $r = Invoke-WdacControlSync `
                -State $appControlState `
                -StatePath $script:WdacStateFile `
                -OnObservedBatch ({
                    param($batch)
                    try {
                        Invoke-AgentAppControlObserved -ApiBaseUrl $apiBase -AgentId $agentId -AgentSecret $secret -Apps $batch | Out-Null
                        return $true
                    } catch {
                        Write-AgentLog -Level Warn "agent-app-control/observed push failed: $_"
                        return $false
                    }
                }) `
                -OnBlockedBatch ({
                    param($batch)
                    # Enforce-mode block events are queued into the next heartbeat's
                    # wdac_blocks section rather than a separate HTTP call -- keeps
                    # network chatter down.
                    foreach ($b in $batch) { [void]$script:PendingWdacBlocks.Add($b) }
                    return $true
                })

            if ($r.applied) {
                if ($r.pending_reboot) {
                    Write-AgentLog "WDAC policy queued (version=$($appControlState.policy_version)) -- CiTool.exe absent; will activate at next boot"
                } else {
                    Write-AgentLog "WDAC policy applied (version=$($appControlState.policy_version))"
                }
            }
            if ($r.observed) { Write-AgentLog "WDAC observed $($r.observed) new app(s)" }
            if ($r.error)    { Write-AgentLog -Level Warn "WDAC sync error: $($r.error)" }
        } catch {
            Write-AgentLog -Level Warn "WDAC sync failed: $_"
        }
    } catch {
        Write-AgentLog -Level Warn "Heartbeat failed: $_"
    }

    # v0.6.6: REMOVED -- agent no longer polls /agent-version-check or self-
    # updates on its own. Upgrades are now strictly operator-driven via an
    # `upgrade_agent` command queued from the SOC console (handled in
    # CommandExecutor.psm1 → Invoke-UpgradeAgent). The cadence gate and
    # eager-check hint are dead code that we keep deliberately removed.

    # v0.6.3: deduct loop-body elapsed time from the configured cadence so
    # actual heartbeat cadence converges on the target instead of silently
    # drifting (e.g. 30s param + 5s loop body would otherwise give 35s).
    # Honours the server's next_check_in (5-900s window, default 30s as of
    # v0.7.6).
    $elapsed = (Get-Date) - $loopStart
    $target  = if ($script:NextSleepSeconds -gt 0) { $script:NextSleepSeconds } else { $HeartbeatIntervalSeconds }
    $sleep   = [int]([Math]::Max(5, $target - [Math]::Floor($elapsed.TotalSeconds)))
    Start-Sleep -Seconds $sleep
}
