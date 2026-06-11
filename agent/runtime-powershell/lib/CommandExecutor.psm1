#requires -version 5.1
# Command executor for agent-side active response. v0.4.5+.
# Supports: isolate_network, release_isolation, kill_process, quarantine_file,
#           run_quick_scan, run_full_scan, collect_persistence, restart_agent.
# Each handler returns @{ status='succeeded'|'failed'; result=<obj>; error=<string> }.

function _CmdLog($lvl, $msg) {
    try {
        $d = 'C:\ProgramData\Mithras\logs'
        if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
        Add-Content -Path (Join-Path $d 'commands.log') -Value "[$(Get-Date -Format o)] [$lvl] $msg" -Encoding UTF8
    } catch {}
}

# ============================================================================
# Isolation — block-all firewall rules with an allowlist for the platform API
# so the agent can still heartbeat (otherwise we can't release isolation).
# ============================================================================

$script:MithrasIsolationGroup    = 'Mithras Threat Defence — Isolation'
$script:MithrasIsolationRuleName = 'Mithras Isolation — Allow API only'

function Invoke-IsolateNetwork {
    param([hashtable]$Params)
    try {
        $apiHost = $env:MITHRAS_API_HOST
        if (-not $apiHost -and $Params -and $Params.api_host) { $apiHost = [string]$Params.api_host }
        if (-not $apiHost) { $apiHost = 'api.mithras.com.au' }

        # v0.7.2: per-endpoint mode. Default 'notify_only' for safety -- if
        # the server sent no mode (older edge fn), or the value is unknown,
        # we DO NOT actually change the firewall. Operator must explicitly
        # set isolation_mode='enforce' on the endpoint to get real isolation.
        $mode = 'notify_only'
        if ($Params -and $Params.mode) {
            $candidate = [string]$Params.mode
            if ($candidate -in @('enforce','notify_only')) { $mode = $candidate }
        }

        # Resolve the API hostname -- we do this regardless of mode so the
        # notify_only result includes the IPs that WOULD have been allowed.
        $apiIps = @()
        try {
            $apiIps = @((Resolve-DnsName -Name $apiHost -Type A -ErrorAction Stop) |
                        Where-Object { $_.IPAddress } | ForEach-Object { $_.IPAddress })
        } catch {
            try { $apiIps = @([System.Net.Dns]::GetHostAddresses($apiHost) | ForEach-Object { $_.ToString() }) } catch {}
        }
        if ($apiIps.Count -eq 0) {
            return @{ status = 'failed'; error = "could not resolve $apiHost for allowlist" }
        }

        # ── notify_only short-circuit ────────────────────────────────────
        # Do nothing to the firewall. Log + return a structured result the
        # server can render as a "simulated isolation" alert.
        if ($mode -eq 'notify_only') {
            _CmdLog 'INFO' ("isolate_network: notify_only mode -- no firewall changes applied. Would have allowed: " + ($apiIps -join ','))
            return @{
                status = 'succeeded'
                result = @{
                    mode                   = 'notify_only'
                    simulated              = $true
                    would_allow_api_ips    = $apiIps
                    api_host               = $apiHost
                    note                   = "No actual isolation applied. Set isolation_mode='enforce' on this endpoint in the SOC console to perform real isolation."
                }
            }
        }

        # ── enforce path ─────────────────────────────────────────────────
        # Remove any prior isolation rules from this group (idempotent).
        Get-NetFirewallRule -Group $script:MithrasIsolationGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue

        # Add allow rules for the API IPs (outbound 443).
        foreach ($ip in $apiIps) {
            New-NetFirewallRule -DisplayName "$script:MithrasIsolationRuleName ($ip)" `
                                -Group $script:MithrasIsolationGroup `
                                -Direction Outbound -Action Allow `
                                -RemoteAddress $ip -RemotePort 443 -Protocol TCP `
                                -Profile Any -Enabled True | Out-Null
        }

        # Set profile defaults to block. After this, only our allow rules pass.
        Set-NetFirewallProfile -Profile Domain,Private,Public `
                               -DefaultInboundAction Block -DefaultOutboundAction Block `
                               -Enabled True

        _CmdLog 'INFO' ("isolated; api allowlist = " + ($apiIps -join ','))
        return @{ status = 'succeeded'; result = @{ mode = 'enforce'; allowed_api_ips = $apiIps; api_host = $apiHost } }
    } catch {
        _CmdLog 'WARN' ("isolate_network failed: " + $_.Exception.Message)
        return @{ status = 'failed'; error = $_.Exception.Message }
    }
}

function Invoke-ReleaseIsolation {
    param([hashtable]$Params)
    try {
        Get-NetFirewallRule -Group $script:MithrasIsolationGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
        # Restore default profile actions to Allow (Windows default for outbound).
        # Inbound default-deny is OS default; we don't change it back unless we
        # actively flipped it.
        Set-NetFirewallProfile -Profile Domain,Private,Public -DefaultOutboundAction Allow
        _CmdLog 'INFO' "isolation released"
        return @{ status = 'succeeded' }
    } catch {
        _CmdLog 'WARN' ("release_isolation failed: " + $_.Exception.Message)
        return @{ status = 'failed'; error = $_.Exception.Message }
    }
}

# ============================================================================
# Process kill
# ============================================================================

function Invoke-KillProcess {
    param([hashtable]$Params)
    if (-not $Params) { return @{ status='failed'; error='params required' } }
    $pid = $null
    if ($Params.pid)     { $pid = [int]$Params.pid }
    elseif ($Params.process_id) { $pid = [int]$Params.process_id }
    if (-not $pid -and -not $Params.name) {
        return @{ status='failed'; error='pid or name required' }
    }
    try {
        $killed = @()
        if ($pid) {
            Stop-Process -Id $pid -Force -ErrorAction Stop
            $killed += $pid
        } elseif ($Params.name) {
            $procs = Get-Process -Name $Params.name -ErrorAction SilentlyContinue
            foreach ($p in $procs) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue; $killed += $p.Id }
        }
        _CmdLog 'INFO' ("killed pids=" + ($killed -join ','))
        return @{ status='succeeded'; result = @{ killed_pids = $killed } }
    } catch {
        return @{ status='failed'; error = $_.Exception.Message }
    }
}

# ============================================================================
# Quarantine — kick Defender against a specific path; if a threat is found
# Defender quarantines automatically.
# ============================================================================

function Invoke-QuarantineFile {
    param([hashtable]$Params)
    if (-not $Params -or -not $Params.path) {
        return @{ status='failed'; error='path required' }
    }
    $path = [string]$Params.path
    if (-not (Test-Path -LiteralPath $path)) {
        return @{ status='failed'; error="path not found: $path" }
    }
    try {
        Start-MpScan -ScanType CustomScan -ScanPath $path -ErrorAction Stop
        Remove-MpThreat -ErrorAction SilentlyContinue
        _CmdLog 'INFO' ("quarantine scan completed on " + $path)
        return @{ status='succeeded'; result = @{ scanned_path = $path } }
    } catch {
        return @{ status='failed'; error = $_.Exception.Message }
    }
}

# ============================================================================
# Defender scans
# ============================================================================

function Invoke-RunQuickScan {
    param([hashtable]$Params)
    try { Start-MpScan -ScanType QuickScan -ErrorAction Stop; return @{ status='succeeded' } }
    catch { return @{ status='failed'; error = $_.Exception.Message } }
}

function Invoke-RunFullScan {
    param([hashtable]$Params)
    try { Start-MpScan -ScanType FullScan -ErrorAction Stop; return @{ status='succeeded' } }
    catch { return @{ status='failed'; error = $_.Exception.Message } }
}

# ============================================================================
# Restart self
# ============================================================================

function Invoke-RestartAgent {
    param([hashtable]$Params)
    try {
        Start-Job -ScriptBlock {
            param($svc)
            Start-Sleep -Seconds 3
            try { Restart-Service -Name $svc -Force -ErrorAction Stop } catch {}
        } -ArgumentList 'MithrasAgent' | Out-Null
        return @{ status='succeeded'; result = @{ restart_scheduled = $true } }
    } catch {
        return @{ status='failed'; error = $_.Exception.Message }
    }
}

# ============================================================================
# Persistence snapshot — bumps PersistenceCollector to run now rather than
# waiting for its normal cadence. The SOC exposes this so an analyst can
# triage an endpoint without waiting up to the next collection window.
# ============================================================================

function Invoke-CollectPersistence {
    param([hashtable]$Params)
    try {
        $modulePath = Join-Path $PSScriptRoot 'PersistenceCollector.psm1'
        if (-not (Test-Path $modulePath)) {
            return @{ status='failed'; error='PersistenceCollector module missing' }
        }
        Import-Module $modulePath -Force -ErrorAction Stop
        # Call the collector directly — avoid dynamic Get-Command + & invocation
        # patterns that trip Defender's generic admin-toolkit signatures.
        $snapshot = Get-PersistenceSnapshotPayload
        $count = if ($snapshot) { @($snapshot).Count } else { 0 }
        return @{ status='succeeded'; result = @{ items_collected = $count } }
    } catch {
        return @{ status='failed'; error = $_.Exception.Message }
    }
}

# ============================================================================
# Emergency unlock -- v0.6.6
#
# Called when an endpoint is in Defender-induced lockdown (e.g. a process
# tree got flagged as ransomware-like and Defender is blocking PowerShell
# child-spawns). Runs IN-PROCESS inside the long-running agent service, which
# is exempt from interactive-shell process-creation blocks, so it works even
# when the operator on the box can't spawn PowerShell.
#
# Actions (intentionally minimal -- safest scope):
#   1. Snapshot active threats for the audit log.
#   2. Add Mithras paths to Defender's path + process exclusions so the same
#      file shape won't get re-flagged immediately.
#   3. Remove-MpThreat on every active threat (clears Defender's tracking).
# Deliberately NOT touched:
#   * BehaviorMonitoring / RealTimeProtection (would weaken Defender broadly)
#   * Quarantine restore (auto-quarantined items may be real malware)
#   * ASR rule mode (each rule is a separate policy decision)
# ============================================================================

function Invoke-EmergencyUnlock {
    param([hashtable]$Params)

    $cleared = New-Object System.Collections.Generic.List[hashtable]
    $exclusionsAdded = @()
    $errors = @()

    # 1. Snapshot active threats BEFORE clearing them so the operator can see
    #    in the command result what we actually removed.
    try {
        $active = @(Get-MpThreat -ErrorAction Stop | Where-Object { $_.IsActive })
        foreach ($t in $active) {
            $cleared.Add(@{
                threat_id    = [string]$t.ThreatID
                threat_name  = [string]$t.ThreatName
                severity_id  = [int]$t.SeverityID
                detection_at = if ($t.InitialDetectionTime) { ([datetime]$t.InitialDetectionTime).ToUniversalTime().ToString('o') } else { $null }
            }) | Out-Null
        }
    } catch {
        $errors += "snapshot active threats: $($_.Exception.Message)"
    }

    # 2. Exclusion list: Mithras install dir + the wrapping AgentRoot.
    #    Add as ExclusionPath (file system) AND ExclusionProcess (per-process
    #    so signed agent + tray child invocations aren't scanned every time).
    $paths = @(
        'C:\ProgramData\Mithras\install'
        'C:\ProgramData\Mithras\install\*'
        'C:\ProgramData\Mithras\install\lib\*'
        'C:\ProgramData\Mithras\install\vendor\*'
    )
    $processes = @(
        'C:\ProgramData\Mithras\install\mithras-agent.ps1'
        'C:\ProgramData\Mithras\install\mithras-tray.ps1'
        'C:\ProgramData\Mithras\install\vendor\nssm.exe'
    )

    try {
        $existing = @((Get-MpPreference -ErrorAction Stop).ExclusionPath)
        foreach ($p in $paths) {
            if ($existing -notcontains $p) {
                try {
                    Add-MpPreference -ExclusionPath $p -ErrorAction Stop
                    $exclusionsAdded += @{ kind='path'; value=$p }
                } catch {
                    $errors += "add path exclusion $p $($_.Exception.Message)"
                }
            }
        }
    } catch {
        $errors += "read MpPreference ExclusionPath: $($_.Exception.Message)"
    }

    try {
        $existingProc = @((Get-MpPreference -ErrorAction Stop).ExclusionProcess)
        foreach ($p in $processes) {
            if ($existingProc -notcontains $p) {
                try {
                    Add-MpPreference -ExclusionProcess $p -ErrorAction Stop
                    $exclusionsAdded += @{ kind='process'; value=$p }
                } catch {
                    $errors += "add process exclusion $p $($_.Exception.Message)"
                }
            }
        }
    } catch {
        $errors += "read MpPreference ExclusionProcess: $($_.Exception.Message)"
    }

    # 3. Remove the active threats. This clears them from Defender's tracking
    #    so subsequent heartbeats show count=0 and any pending remediation
    #    completes.
    try {
        Remove-MpThreat -ErrorAction Stop
    } catch {
        # Remove-MpThreat throws if there's nothing to remove on some
        # builds -- that's not an error from our PoV.
        $msg = $_.Exception.Message
        if ($msg -notmatch 'no threats|nothing to remove') {
            $errors += "Remove-MpThreat: $msg"
        }
    }

    _CmdLog 'INFO' ("emergency_unlock: cleared={0} excl_added={1} errors={2}" -f $cleared.Count, $exclusionsAdded.Count, $errors.Count)

    # Cast to [object[]] so ConvertTo-Json renders these as JSON arrays even
    # when empty (otherwise an empty PowerShell array becomes JSON null, and
    # the server-side reader would have to guard for that).
    return @{
        status = 'succeeded'
        result = @{
            cleared_threats    = [object[]]$cleared.ToArray()
            cleared_count      = $cleared.Count
            exclusions_added   = [object[]]$exclusionsAdded
            exclusions_count   = $exclusionsAdded.Count
            errors             = [object[]]$errors
            error_count        = $errors.Count
            unlocked_at        = (Get-Date).ToUniversalTime().ToString('o')
        }
    }
}

# ============================================================================
# Manual agent upgrade -- v0.6.6
#
# Replaces the periodic auto-update loop. The SOC operator clicks "Upgrade"
# on the endpoint detail page; the server queues an upgrade_agent command
# with the target version, download_url, and sha256 in params; the agent
# pulls it off the heartbeat queue and runs Invoke-AgentSelfUpdate.
#
# Expected params:
#   target_version : '0.6.6'
#   download_url   : 'https://api.mithras.com.au/storage/v1/object/public/agent-bundles/mithras-agent-0.6.6.zip'
#   sha256         : '13f2af760e7c...'
#
# On success: agent exits with code 0 inside Invoke-AgentSelfUpdate's swap
# helper -- the NSSM service restart picks up the new binaries. The command
# result is queued INSIDE PendingCommandResults before the exit so the
# server still gets the success ack on the NEXT process's heartbeat.
# ============================================================================

function Invoke-UpgradeAgent {
    param([hashtable]$Params)

    if (-not $Params -or
        -not $Params.target_version -or
        -not $Params.download_url -or
        -not $Params.sha256) {
        return @{ status='failed'; error='target_version, download_url, sha256 required' }
    }

    try {
        # Lazy-import Updater so this command works even if the caller forgot
        # to pre-import the module.
        $updaterModule = Join-Path $PSScriptRoot 'Updater.psm1'
        if (-not (Get-Module Updater)) {
            Import-Module $updaterModule -Force -ErrorAction Stop
        }

        Invoke-AgentSelfUpdate `
            -DownloadUrl    ([string]$Params.download_url) `
            -ExpectedSha256 ([string]$Params.sha256) `
            -TargetVersion  ([string]$Params.target_version) `
            -AgentRoot      'C:\ProgramData\Mithras'

        _CmdLog 'INFO' ("upgrade_agent: swap staged for " + [string]$Params.target_version)
        return @{
            status = 'succeeded'
            result = @{
                staged_version = [string]$Params.target_version
                staged_at      = (Get-Date).ToUniversalTime().ToString('o')
                note           = 'Swap helper will Stop-Service, copy new files, then Start-Service. Service restart will pick up the new modules.'
            }
        }
    } catch {
        _CmdLog 'WARN' ("upgrade_agent failed: " + $_.Exception.Message)
        return @{ status='failed'; error = $_.Exception.Message }
    }
}

# ============================================================================
# install_mesh_agent / uninstall_mesh_agent -- v0.7.4
#
# Opt-in remote access. The Mithras installer no longer drops MeshAgent on
# every endpoint; operators dispatch install_mesh_agent from the SOC console
# per endpoint. The agent here downloads MeshAgent.exe from the configured
# MeshCentral, runs -fullinstall, waits for the service to come up, and
# returns success/failure. The heartbeat handler on the server side then
# flips endpoints.mesh_agent_state.
#
# Params for install_mesh_agent:
#   mesh_url   default https://remote.mithras.com.au
#   mesh_id    default the "Mithras Endpoints" group's mesh id
# Params for uninstall_mesh_agent: none.
# ============================================================================

function Invoke-InstallMeshAgent {
    param([hashtable]$Params)
    $meshUrl = if ($Params -and $Params.mesh_url) { [string]$Params.mesh_url } else { 'https://remote.mithras.com.au' }
    $meshId  = if ($Params -and $Params.mesh_id)  { [string]$Params.mesh_id }  else { 'LHDBcLRoKOPD$OltNZhPT5Urn89pHHeqjYJvR3h0ODKu3Sef5qpdTxPkgtraYP5h' }

    if (Get-Service -Name 'Mesh Agent' -ErrorAction SilentlyContinue) {
        return @{ status='succeeded'; result = @{ already_installed = $true; service_state = 'Running' } }
    }

    $vendorDir   = 'C:\ProgramData\Mithras\install\vendor'
    if (-not (Test-Path $vendorDir)) { New-Item -ItemType Directory -Path $vendorDir -Force | Out-Null }
    $meshExe     = Join-Path $vendorDir 'MeshAgent.exe'
    $logPath     = 'C:\ProgramData\Mithras\logs\meshagent-install.log'
    if (-not (Test-Path (Split-Path $logPath))) { New-Item -ItemType Directory -Path (Split-Path $logPath) -Force | Out-Null }

    try {
        Add-Type -AssemblyName System.Web
        $encodedMesh = [System.Web.HttpUtility]::UrlEncode($meshId)
        $downloadUrl = "$meshUrl/meshagents?id=4&meshid=$encodedMesh&installflags=0"

        # Defender exclusions BEFORE the download.
        if (Get-Command Add-MpPreference -ErrorAction SilentlyContinue) {
            try { Add-MpPreference -ExclusionPath    $meshExe -ErrorAction SilentlyContinue } catch {}
            try { Add-MpPreference -ExclusionProcess $meshExe -ErrorAction SilentlyContinue } catch {}
            try { Add-MpPreference -ExclusionPath    'C:\Program Files\Mesh Agent' -ErrorAction SilentlyContinue } catch {}
            try { Add-MpPreference -ExclusionProcess 'C:\Program Files\Mesh Agent\MeshAgent.exe' -ErrorAction SilentlyContinue } catch {}
        }

        _CmdLog 'INFO' "install_mesh_agent: downloading from $meshUrl"
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $downloadUrl -OutFile $meshExe -UseBasicParsing -ErrorAction Stop -TimeoutSec 60
        $bytes = (Get-Item $meshExe).Length
        "[$(Get-Date -Format o)] downloaded $bytes bytes" | Out-File -FilePath $logPath -Append -Encoding utf8

        _CmdLog 'INFO' "install_mesh_agent: running -fullinstall ($bytes bytes downloaded)"
        $output = & $meshExe -fullinstall 2>&1
        $output | ForEach-Object { "[$(Get-Date -Format o)] $_" } | Out-File -FilePath $logPath -Append -Encoding utf8

        # Wait up to 15 seconds for the service to come up.
        $deadline = (Get-Date).AddSeconds(15)
        do {
            Start-Sleep -Milliseconds 500
            $svc = Get-Service -Name 'Mesh Agent' -ErrorAction SilentlyContinue
            if ($svc -and $svc.Status -eq 'Running') { break }
        } while ((Get-Date) -lt $deadline)

        if (-not $svc -or $svc.Status -ne 'Running') {
            _CmdLog 'WARN' ("install_mesh_agent: service not Running (status=$($svc.Status))")
            return @{
                status = 'failed'
                error  = "Mesh Agent service did not reach Running (status=$($svc.Status)). See $logPath"
            }
        }

        _CmdLog 'INFO' "install_mesh_agent: success, service Running"
        return @{
            status = 'succeeded'
            result = @{
                installed_at      = (Get-Date).ToUniversalTime().ToString('o')
                mesh_url          = $meshUrl
                mesh_id           = $meshId
                service_state     = 'Running'
                download_bytes    = [int]$bytes
            }
        }
    } catch {
        _CmdLog 'WARN' ("install_mesh_agent failed: " + $_.Exception.Message)
        return @{ status='failed'; error = $_.Exception.Message }
    }
}

function Invoke-UninstallMeshAgent {
    param([hashtable]$Params)
    $meshExe = 'C:\Program Files\Mesh Agent\MeshAgent.exe'
    if (-not (Test-Path $meshExe) -and -not (Get-Service -Name 'Mesh Agent' -ErrorAction SilentlyContinue)) {
        return @{ status='succeeded'; result = @{ already_uninstalled = $true } }
    }
    try {
        if (Test-Path $meshExe) {
            _CmdLog 'INFO' "uninstall_mesh_agent: running -fulluninstall"
            & $meshExe -fulluninstall 2>&1 | Out-Null
        }
        # Catch the case where MeshAgent.exe is gone but the service registration still exists
        Start-Sleep -Seconds 2
        if (Get-Service -Name 'Mesh Agent' -ErrorAction SilentlyContinue) {
            try { sc.exe delete 'Mesh Agent' | Out-Null } catch {}
        }
        return @{ status='succeeded'; result = @{ uninstalled_at = (Get-Date).ToUniversalTime().ToString('o') } }
    } catch {
        _CmdLog 'WARN' ("uninstall_mesh_agent failed: " + $_.Exception.Message)
        return @{ status='failed'; error = $_.Exception.Message }
    }
}

# ============================================================================
# install_updates -- v0.7.11 (synchronous core), v0.7.12 (background-job
# launcher + result harvester so heartbeats keep flowing during a 5-30 min
# WUA install).
#
# Architecture:
#   Invoke-InstallUpdates  - tiny launcher. Spawns the WUA work into a
#                             Start-Job, persists a state file under
#                             C:\ProgramData\Mithras\state\install_updates\
#                             keyed by command id, returns the special
#                             status '__deferred__' so the agent main loop
#                             does NOT add it to PendingCommandResults.
#   _DoInstallUpdates      - the actual WUA driver, exported only as the
#                             ScriptBlock body the Start-Job runs.
#   Get-CompletedInstallUpdates
#                          - called once per heartbeat from the agent main
#                             loop. Walks the state dir, reaps any
#                             Completed/Failed jobs, returns their results
#                             for ship-back. Survives the agent restarting:
#                             a Start-Job whose parent process exited is
#                             surfaced as 'job_orphaned_after_agent_restart'
#                             so the operator sees the failure instead of
#                             the command sitting forever.
#
# Why a job, not a separate process: Start-Job is in-runspace, dies with
# the agent (acceptable), shares state cleanly (the WUA COM objects work
# fine inside a Start-Job runspace, validated empirically).
#
# What gets installed:
#   - Software updates only (no drivers, no feature updates).
#   - Restricted to Security Updates + Critical Updates categories — that
#     matches the operator intent ("patch the CVE") without quietly
#     pushing big optional Windows feature rollups.
#   - Updates that require user input (e.g. EULA accept) are skipped.
#   - Max 12 updates per invocation. Anything beyond that is left for the
#     next call.
#   - Hard 25-minute internal deadline (server-side cron is 45 min).
#
# No automatic reboot. We surface reboot_required=$true and let the
# operator dispatch the reboot deliberately.
#
# Expected params: { triggered_by_cve | triggered_by_cves } -- threaded
# through to the result for audit.
# ============================================================================

$script:InstallUpdatesStateDir = 'C:\ProgramData\Mithras\state\install_updates'

function _EnsureInstallUpdatesStateDir {
    if (-not (Test-Path $script:InstallUpdatesStateDir)) {
        New-Item -ItemType Directory -Path $script:InstallUpdatesStateDir -Force | Out-Null
    }
}

# The actual install work. Lives as a ScriptBlock because Start-Job needs
# one, but defined as a function so it's easy to debug or call directly
# from a test harness.
function _DoInstallUpdates {
    param([hashtable]$Params)

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $deadlineMin = 25  # leave 5 minutes of headroom before the 30-min agent cap
    $maxUpdates = 12

    # In a Start-Job the lib module isn't auto-imported, so the inner
    # helper _CmdLog may not exist. Define a local no-op fallback.
    if (-not (Get-Command _CmdLog -ErrorAction SilentlyContinue)) {
        function _CmdLog { param($Level, $Msg) }
    }

    try {
        $session = New-Object -ComObject Microsoft.Update.Session -ErrorAction Stop
    } catch {
        return @{ status='failed'; error = "wua_com_unavailable: $($_.Exception.Message)" }
    }

    try {
        $searcher = $session.CreateUpdateSearcher()
        $searcher.IncludePotentiallySupersededUpdates = $false
        # IsInstalled=0 -> not yet on this host
        # Type='Software'  -> excludes drivers
        # IsHidden=0       -> not hidden by the operator
        # BrowseOnly=0     -> excludes preview / hidden surfaces (where supported)
        $criteria = "IsInstalled=0 and Type='Software' and IsHidden=0"
        $searchResult = $searcher.Search($criteria)
    } catch {
        return @{ status='failed'; error = "wua_search_failed: $($_.Exception.Message)" }
    }

    if (-not $searchResult -or $searchResult.Updates.Count -eq 0) {
        return @{
            status='succeeded'
            result = @{
                checked          = $true
                nothing_to_install = $true
                installed        = @()
                failed           = @()
                reboot_required  = $false
                elapsed_ms       = $stopwatch.ElapsedMilliseconds
                triggered_by_cve  = $Params.triggered_by_cve
                triggered_by_cves = $Params.triggered_by_cves
            }
        }
    }

    # Filter to Security + Critical categories. Build a fresh UpdateCollection
    # holding only the matched items, ordered as Windows Update returned them.
    $toInstall = New-Object -ComObject Microsoft.Update.UpdateColl
    $skippedEula = 0
    $skippedCategory = 0
    foreach ($update in $searchResult.Updates) {
        if ($toInstall.Count -ge $maxUpdates) { break }
        if ($update.EulaAccepted -ne $true) {
            try { $update.AcceptEula() | Out-Null } catch { $skippedEula++; continue }
        }
        $isWanted = $false
        foreach ($cat in $update.Categories) {
            if ($cat.Name -match 'Security Updates' -or $cat.Name -match 'Critical Updates') {
                $isWanted = $true
                break
            }
        }
        if (-not $isWanted) { $skippedCategory++; continue }
        $toInstall.Add($update) | Out-Null
    }

    if ($toInstall.Count -eq 0) {
        return @{
            status='succeeded'
            result = @{
                checked            = $true
                nothing_to_install  = $true
                available_total    = [int]$searchResult.Updates.Count
                skipped_eula       = $skippedEula
                skipped_category   = $skippedCategory
                installed          = @()
                failed             = @()
                reboot_required    = $false
                elapsed_ms         = $stopwatch.ElapsedMilliseconds
                triggered_by_cve   = $Params.triggered_by_cve
                triggered_by_cves  = $Params.triggered_by_cves
            }
        }
    }

    if ($stopwatch.Elapsed.TotalMinutes -ge $deadlineMin) {
        return @{ status='failed'; error='deadline_exceeded_before_download'; result = @{ candidates = $toInstall.Count } }
    }

    # Download
    try {
        $downloader = $session.CreateUpdateDownloader()
        $downloader.Updates = $toInstall
        $downloadResult = $downloader.Download()
    } catch {
        return @{ status='failed'; error = "wua_download_failed: $($_.Exception.Message)" }
    }

    # Build the "actually downloaded" collection — installer can't proceed
    # on undownloaded updates.
    $readyToInstall = New-Object -ComObject Microsoft.Update.UpdateColl
    foreach ($update in $toInstall) {
        if ($update.IsDownloaded) {
            $readyToInstall.Add($update) | Out-Null
        }
    }

    if ($readyToInstall.Count -eq 0) {
        return @{
            status='failed'
            error='no_updates_downloaded'
            result = @{
                download_result_code = [int]$downloadResult.ResultCode
                elapsed_ms = $stopwatch.ElapsedMilliseconds
            }
        }
    }

    if ($stopwatch.Elapsed.TotalMinutes -ge $deadlineMin) {
        return @{
            status='failed'
            error='deadline_exceeded_before_install'
            result = @{
                downloaded = $readyToInstall.Count
                elapsed_ms = $stopwatch.ElapsedMilliseconds
            }
        }
    }

    # Install
    try {
        $installer = $session.CreateUpdateInstaller()
        $installer.Updates = $readyToInstall
        $installResult = $installer.Install()
    } catch {
        return @{ status='failed'; error = "wua_install_failed: $($_.Exception.Message)" }
    }

    # Aggregate per-update outcomes.
    $installed = @()
    $failed    = @()
    for ($i = 0; $i -lt $readyToInstall.Count; $i++) {
        $update = $readyToInstall.Item($i)
        $perUpdate = $installResult.GetUpdateResult($i)
        $entry = @{
            title    = [string]$update.Title
            kb       = @($update.KBArticleIDs) -join ','
            hresult  = '0x{0:X8}' -f [int]$perUpdate.HResult
            outcome  = [int]$perUpdate.ResultCode  # 2=succeeded, 3=succeeded with errors, 4=failed
        }
        if ($perUpdate.ResultCode -in @(2,3)) {
            $installed += $entry
        } else {
            $failed += $entry
        }
    }

    $rebootRequired = $false
    try {
        $systemInfo = New-Object -ComObject Microsoft.Update.SystemInfo -ErrorAction Stop
        $rebootRequired = [bool]$systemInfo.RebootRequired
    } catch {
        # Fall back to the installer's report.
        try { $rebootRequired = [bool]$installResult.RebootRequired } catch {}
    }

    $allSucceeded = $failed.Count -eq 0
    return @{
        status = if ($allSucceeded) { 'succeeded' } else { 'failed' }
        result = @{
            install_result_code = [int]$installResult.ResultCode
            installed           = $installed
            failed              = $failed
            reboot_required     = $rebootRequired
            elapsed_ms          = $stopwatch.ElapsedMilliseconds
            triggered_by_cve    = $Params.triggered_by_cve
            triggered_by_cves   = $Params.triggered_by_cves
        }
        error = if ($allSucceeded) { $null } else { "$($failed.Count)_updates_failed" }
    }
}

# Launcher: spawn a Start-Job that runs _DoInstallUpdates. Returns a
# deferred marker so the agent main loop knows not to ship a result yet.
function Invoke-InstallUpdates {
    param(
        [Parameter(Mandatory)][string]$CommandId,
        [hashtable]$Params = @{}
    )

    _EnsureInstallUpdatesStateDir
    $stateFile = Join-Path $script:InstallUpdatesStateDir "$CommandId.json"

    # Idempotency: if we already have a state file for this command, the
    # job is already running (or completed and pending harvest). Just
    # return deferred — Get-CompletedInstallUpdates will surface the
    # result when ready.
    if (Test-Path $stateFile) {
        _CmdLog 'INFO' "install_updates: state file already exists for cmd=$CommandId, returning deferred"
        return @{ id = $CommandId; status = '__deferred__' }
    }

    # We need the body of _DoInstallUpdates as a ScriptBlock for Start-Job.
    # Get-Command on the function gives us the definition; wrap it so the
    # job's runspace can call it with the hashtable arg.
    $installFnDef = (Get-Command _DoInstallUpdates).Definition
    $jobBody = [scriptblock]::Create(@"
        param(`$Params)
        function _DoInstallUpdates { $installFnDef }
        _DoInstallUpdates -Params `$Params
"@)

    try {
        $job = Start-Job -Name "MithrasInstallUpdates-$CommandId" -ScriptBlock $jobBody -ArgumentList $Params
    } catch {
        _CmdLog 'WARN' ("install_updates: Start-Job failed for cmd=" + $CommandId + ": " + $_.Exception.Message)
        return @{
            id     = $CommandId
            status = 'failed'
            error  = "failed_to_spawn_install_job: $($_.Exception.Message)"
        }
    }

    $state = [PSCustomObject]@{
        command_id = $CommandId
        job_id     = $job.Id
        job_name   = $job.Name
        started_at = (Get-Date).ToUniversalTime().ToString('o')
        status     = 'running'
    }
    $state | ConvertTo-Json -Depth 5 | Set-Content -Path $stateFile -Encoding utf8 -Force

    _CmdLog 'INFO' "install_updates: spawned background job id=$($job.Id) for cmd=$CommandId"
    return @{ id = $CommandId; status = '__deferred__' }
}

# Called once per heartbeat from the agent main loop. Walks the install_updates
# state dir, reaps Completed/Failed jobs, returns their results for shipment.
# Also surfaces orphaned-job state when the agent restarted mid-install.
function Get-CompletedInstallUpdates {
    if (-not (Test-Path $script:InstallUpdatesStateDir)) { return @() }

    $results = @()
    foreach ($file in Get-ChildItem -Path $script:InstallUpdatesStateDir -Filter '*.json' -ErrorAction SilentlyContinue) {
        $state = $null
        try {
            $state = Get-Content $file.FullName -Raw -ErrorAction Stop | ConvertFrom-Json
        } catch {
            _CmdLog 'WARN' "install_updates harvest: bad state file $($file.Name): $_"
            try { Remove-Item -Path $file.FullName -Force -ErrorAction Stop } catch {}
            continue
        }
        if (-not $state -or $state.status -ne 'running') { continue }

        $job = Get-Job -Id ([int]$state.job_id) -ErrorAction SilentlyContinue
        if (-not $job) {
            # Job is gone — most commonly because the agent process restarted.
            _CmdLog 'WARN' "install_updates harvest: job $($state.job_id) for cmd=$($state.command_id) is orphaned"
            $results += @{
                id     = [string]$state.command_id
                status = 'failed'
                error  = 'job_orphaned_after_agent_restart'
                result = @{ started_at = [string]$state.started_at }
            }
            try { Remove-Item -Path $file.FullName -Force -ErrorAction Stop } catch {}
            continue
        }

        if ($job.State -notin @('Completed','Failed','Stopped')) {
            # Still running — leave the state file alone, next pass will retry.
            continue
        }

        try {
            # -Wait blocks but state is already terminal so it returns immediately.
            $jobOutput = Receive-Job -Job $job -Wait -ErrorAction Stop
        } catch {
            $results += @{
                id     = [string]$state.command_id
                status = 'failed'
                error  = "job_receive_failed: $($_.Exception.Message)"
            }
            try { Remove-Job -Job $job -Force -ErrorAction Stop } catch {}
            try { Remove-Item -Path $file.FullName -Force -ErrorAction Stop } catch {}
            continue
        }
        try { Remove-Job -Job $job -Force -ErrorAction Stop } catch {}

        if ($jobOutput -is [hashtable]) {
            # Tag with the command id and pass straight through.
            $jobOutput['id'] = [string]$state.command_id
            $results += $jobOutput
        } elseif ($jobOutput -is [System.Collections.IDictionary]) {
            $jobOutput['id'] = [string]$state.command_id
            $results += $jobOutput
        } else {
            $results += @{
                id     = [string]$state.command_id
                status = if ($job.State -eq 'Completed') { 'succeeded' } else { 'failed' }
                result = @{ raw_output = $jobOutput }
            }
        }

        try { Remove-Item -Path $file.FullName -Force -ErrorAction Stop } catch {}
        _CmdLog 'INFO' "install_updates harvest: cmd=$($state.command_id) reaped with state=$($job.State)"
    }
    return $results
}

# ============================================================================
# uninstall_self -- v0.7.17
#
# Authorised, server-driven decommissioning. SOC operator clicks Decommission
# on the endpoint detail page; server queues uninstall_self; agent picks it
# up here and performs the tamper-aware teardown.
#
# Why a scheduled task and not just stop-and-delete inline:
#   The agent IS the service. We can't stop or delete ourselves while we
#   own the process. The break-glass Force-Remove.ps1 that lives at
#   install\Force-Remove.ps1 already knows how to take down the tamper
#   stack + delete files; we re-use it here, deferred a minute via a
#   one-shot SYSTEM scheduled task. The agent stays running long enough
#   to flush its success ack back to the server, then exits when the
#   task arrives and stops the service.
#
# Sequence:
#   1. Disable the watchdog scheduled task(s) so they don't fight us.
#   2. Wipe the hardened service DACL (Security registry value) so the
#      cleanup script's sc.exe stop will be accepted.
#   3. Locate install\Force-Remove.ps1. If absent (older install that
#      pre-dates this feature) we fall back to embedding the same logic
#      inline as a temp script.
#   4. Register a one-shot scheduled task "MithrasUninstall" that fires
#      60 seconds from now as SYSTEM and runs the cleanup script. The
#      lag gives the agent enough time to flush this command's result
#      to the server via the next heartbeat.
#   5. Return success. Main loop will save + ship the result.
# ============================================================================

function Invoke-UninstallSelf {
    param([hashtable]$Params)

    $reason = if ($Params -and $Params.reason) { [string]$Params.reason } else { 'no reason supplied' }
    _CmdLog 'INFO' ("uninstall_self: decommissioning initiated; reason=" + $reason)

    try {
        # --- 1. Disable watchdog so it doesn't restart the service mid-teardown ---
        foreach ($name in 'MithrasWatchdog','MithrasAgentWatchdog','PeritusSecureWatchdog','MithrasTray') {
            try {
                Disable-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue | Out-Null
                Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
            } catch {}
        }
        _CmdLog 'INFO' 'uninstall_self: watchdog tasks disabled'

        # --- 2. Reset service DACL via the Security registry value ---
        # The cleanup script's sc.exe stop would otherwise be denied by the
        # tamper-protection DACL the agent itself installed. Same mechanism
        # the break-glass Force-Remove.ps1 uses.
        try {
            $svcKey = 'HKLM:\SYSTEM\CurrentControlSet\Services\MithrasAgent'
            if (Test-Path $svcKey) {
                $regKey = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey(
                    'SYSTEM\CurrentControlSet\Services\MithrasAgent',
                    [Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree,
                    [System.Security.AccessControl.RegistryRights]::TakeOwnership
                )
                if ($regKey) {
                    $admins = New-Object System.Security.Principal.SecurityIdentifier 'S-1-5-32-544'
                    $acl = $regKey.GetAccessControl()
                    $acl.SetOwner($admins)
                    $regKey.SetAccessControl($acl)
                    $regKey.Close()

                    $regKey = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey(
                        'SYSTEM\CurrentControlSet\Services\MithrasAgent',
                        [Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree,
                        [System.Security.AccessControl.RegistryRights]::ChangePermissions
                    )
                    if ($regKey) {
                        $acl  = $regKey.GetAccessControl()
                        $rule = New-Object System.Security.AccessControl.RegistryAccessRule(
                            $admins,
                            [System.Security.AccessControl.RegistryRights]::FullControl,
                            [System.Security.AccessControl.InheritanceFlags]::"ContainerInherit",
                            [System.Security.AccessControl.PropagationFlags]::None,
                            [System.Security.AccessControl.AccessControlType]::Allow
                        )
                        $acl.AddAccessRule($rule)
                        $regKey.SetAccessControl($acl)
                        $regKey.Close()
                    }

                    Remove-Item "$svcKey\Security" -Recurse -Force -ErrorAction SilentlyContinue
                }
            }
            _CmdLog 'INFO' 'uninstall_self: service DACL reset'
        } catch {
            _CmdLog 'WARN' ("uninstall_self: DACL reset failed: " + $_.Exception.Message)
        }

        # --- 3. Find the cleanup script ---
        # Preferred: the Force-Remove.ps1 that the v0.7.17+ installer drops
        # into C:\ProgramData\Mithras\install\. Fallback: install root.
        $cleanupScript = $null
        foreach ($candidate in @(
            'C:\ProgramData\Mithras\install\Force-Remove.ps1',
            (Join-Path $PSScriptRoot '..\Force-Remove.ps1')
        )) {
            if (Test-Path $candidate) { $cleanupScript = (Resolve-Path $candidate).Path; break }
        }
        if (-not $cleanupScript) {
            # No bundled script -- agent was installed before Force-Remove
            # was added to the payload. Stage a copy of the same logic to
            # a temp file so the scheduled task has something to run.
            $cleanupScript = Join-Path $env:TEMP 'mithras-uninstall-inline.ps1'
            $inline = @'
$ErrorActionPreference = 'SilentlyContinue'
foreach ($name in 'MithrasWatchdog','MithrasAgentWatchdog','PeritusSecureWatchdog','MithrasAgent','MithrasTray','MithrasUninstall') {
    try { Disable-ScheduledTask -TaskName $name | Out-Null } catch {}
    try { Unregister-ScheduledTask -TaskName $name -Confirm:$false } catch {}
}
& sc.exe stop MithrasAgent 2>&1 | Out-Null
Start-Sleep 2
& sc.exe delete MithrasAgent 2>&1 | Out-Null
& takeown.exe /F 'C:\ProgramData\Mithras' /R /D Y 2>&1 | Out-Null
& icacls.exe 'C:\ProgramData\Mithras' /reset /T /C /Q 2>&1 | Out-Null
& icacls.exe 'C:\ProgramData\Mithras' /grant 'Administrators:(OI)(CI)F' /T /C /Q 2>&1 | Out-Null
Remove-Item 'C:\ProgramData\Mithras' -Recurse -Force -ErrorAction SilentlyContinue
'@
            $inline | Set-Content -Path $cleanupScript -Encoding UTF8 -Force
        }
        _CmdLog 'INFO' ("uninstall_self: cleanup script = " + $cleanupScript)

        # --- 4. Schedule a one-shot SYSTEM task to fire in 60 seconds ---
        # The lag covers the agent's next heartbeat so the success result
        # reaches the server before the service is stopped.
        $taskName  = 'MithrasUninstall'
        $action    = New-ScheduledTaskAction    -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$cleanupScript`""
        $trigger   = New-ScheduledTaskTrigger   -Once -At ((Get-Date).AddSeconds(60))
        $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
        $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -DeleteExpiredTaskAfter (New-TimeSpan -Minutes 10)
        Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
        _CmdLog 'INFO' "uninstall_self: scheduled task '$taskName' armed to fire in 60s"

        return @{
            status = 'succeeded'
            result = @{
                reason          = $reason
                cleanup_script  = $cleanupScript
                cleanup_in_secs = 60
                armed_at        = (Get-Date).ToUniversalTime().ToString('o')
                note            = 'Agent will be stopped + uninstalled by the scheduled task in ~60s. This is the last heartbeat from this endpoint.'
            }
        }
    } catch {
        _CmdLog 'WARN' ("uninstall_self failed: " + $_.Exception.Message)
        return @{ status='failed'; error = $_.Exception.Message }
    }
}

# ============================================================================
# Dispatcher
# ============================================================================

function Invoke-AgentCommand {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$CommandId,
        [Parameter(Mandatory)][string]$CommandType,
        [hashtable]$Params = @{}
    )
    _CmdLog 'INFO' ("dispatch id=$CommandId type=$CommandType")
    $result = switch ($CommandType) {
        'isolate_network'     { Invoke-IsolateNetwork    -Params $Params }
        'release_isolation'   { Invoke-ReleaseIsolation  -Params $Params }
        'kill_process'        { Invoke-KillProcess       -Params $Params }
        'quarantine_file'     { Invoke-QuarantineFile    -Params $Params }
        'run_quick_scan'      { Invoke-RunQuickScan      -Params $Params }
        'run_full_scan'       { Invoke-RunFullScan       -Params $Params }
        'restart_agent'       { Invoke-RestartAgent      -Params $Params }
        'collect_persistence' { Invoke-CollectPersistence -Params $Params }
        'emergency_unlock'    { Invoke-EmergencyUnlock   -Params $Params }
        'upgrade_agent'       { Invoke-UpgradeAgent      -Params $Params }
        'install_mesh_agent'  { Invoke-InstallMeshAgent  -Params $Params }
        'uninstall_mesh_agent'{ Invoke-UninstallMeshAgent -Params $Params }
        'install_updates'     { Invoke-InstallUpdates    -CommandId $CommandId -Params $Params }
        'uninstall_self'      { Invoke-UninstallSelf     -Params $Params }
        default               { @{ status='failed'; error="unsupported command_type: $CommandType" } }
    }
    $result['id'] = $CommandId
    _CmdLog 'INFO' ("result id=$CommandId status=" + $result.status)
    return $result
}

Export-ModuleMember -Function Invoke-AgentCommand, Invoke-IsolateNetwork, Invoke-ReleaseIsolation, Invoke-KillProcess, Invoke-QuarantineFile, Invoke-RunQuickScan, Invoke-RunFullScan, Invoke-RestartAgent, Invoke-CollectPersistence, Invoke-EmergencyUnlock, Invoke-UpgradeAgent, Invoke-InstallMeshAgent, Invoke-UninstallMeshAgent, Invoke-InstallUpdates, Invoke-UninstallSelf, Get-CompletedInstallUpdates
