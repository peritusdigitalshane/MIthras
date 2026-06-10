#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Install the Mithras Threat Defence Agent as a Windows service.
.DESCRIPTION
    1. Copies agent files to C:\ProgramData\Mithras\install
    2. Runs enrolment against the platform to obtain agent_id + agent_secret
    3. Saves credentials to DPAPI-encrypted config.dat
    4. Registers the Windows service "MithrasAgent" via NSSM (or via the
       MithrasAgent.exe launcher if present, so Task Manager shows the
       Mithras icon instead of the bare PowerShell terminal icon).
    5. Migrates any existing PeritusSecureAgent install in place - keeps the
       enrolled agent_id so the endpoint does not appear twice in the console.
    6. Starts the service.
.PARAMETER EnrollmentToken
    One-time token generated in the platform's Agent Download page. Optional
    when migrating an existing PeritusSecureAgent install - the agent_id and
    agent_secret are carried over from the old config.
.PARAMETER ApiBaseUrl
    Base URL of the Mithras platform, e.g. https://api.mithras.com.au
.PARAMETER ServiceName
    Optional override for the service name. Default: MithrasAgent
.PARAMETER Force
    Re-install over an existing service installation.
.NOTES
    Remote access (MeshAgent) is no longer installed by default in v0.7.4+.
    The operator opts in per-endpoint from the SOC console; the Mithras
    agent picks up an install_mesh_agent command on its next heartbeat and
    downloads + installs MeshAgent at that point.
#>
[CmdletBinding()]
param(
    [string]$EnrollmentToken,
    [Parameter(Mandatory)][string]$ApiBaseUrl,
    [string]$ServiceName = 'MithrasAgent',
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Customers occasionally paste the full edge-functions URL by accident
# (e.g. https://api.mithras.com.au/functions/v1). The agent code appends
# '/functions/v1/<endpoint>' itself, so the trailing path must be stripped or
# every request 404s through Kong as service_name='functions'.
$ApiBaseUrl = $ApiBaseUrl.TrimEnd('/')
if ($ApiBaseUrl -match '/functions/v[0-9]+$') {
    $ApiBaseUrl = $ApiBaseUrl -replace '/functions/v[0-9]+$',''
    Write-Host "[install] Stripped /functions/vN suffix from ApiBaseUrl -> $ApiBaseUrl"
}

$AgentRoot      = 'C:\ProgramData\Mithras'
$InstallRoot    = Join-Path $AgentRoot 'install'
$ConfigFile     = Join-Path $AgentRoot 'config.dat'
$NssmExe        = Join-Path $InstallRoot 'vendor\nssm.exe'
$LauncherExe    = Join-Path $InstallRoot 'MithrasAgent.exe'

$LegacyAgentRoot   = 'C:\ProgramData\PeritusSecure'
$LegacyServiceName = 'PeritusSecureAgent'
$LegacyConfigFile  = Join-Path $LegacyAgentRoot 'config.dat'

function Write-Step { param([string]$Msg) Write-Host "[install] $Msg" }

# 1. Refuse to clobber an existing install unless -Force
if ((Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) -and -not $Force) {
    throw "Service '$ServiceName' already exists. Re-run with -Force to reinstall."
}

# 2. Detect a legacy PeritusSecure install - covers BOTH the modular agent
#    (DPAPI config.dat) AND the v2.19.0 monolith (agent.json with bearer
#    token, no config.dat). Either way we'll preserve the endpoint identity.
$migrate = $false
if ((Test-Path $LegacyConfigFile) -or (Test-Path (Join-Path $LegacyAgentRoot 'agent.json'))) {
    Write-Step "Detected legacy PeritusSecure install at $LegacyAgentRoot - will migrate"
    $migrate = $true
}

# 3. Aggressively tear down any legacy install: stop the service, remove it via
#    BOTH NSSM (if disk metadata still exists) AND sc.exe, kill any straggler
#    PeritusSecure agent processes that NSSM lost track of, force-delete the
#    legacy install dir. State files (agent.json, config.dat, *.json) are
#    preserved so the migration step below can still read them.
if (Get-Service -Name $LegacyServiceName -ErrorAction SilentlyContinue) {
    Write-Step "Stopping legacy service '$LegacyServiceName'"
    Stop-Service -Name $LegacyServiceName -Force -ErrorAction SilentlyContinue
    for ($i = 0; $i -lt 10; $i++) {
        $s = Get-Service -Name $LegacyServiceName -ErrorAction SilentlyContinue
        if (-not $s -or $s.Status -ne 'Running') { break }
        Start-Sleep -Milliseconds 500
    }
}

# Try NSSM removal first (cleans up NSSM metadata too).
$legacyNssm = Join-Path $LegacyAgentRoot 'install\vendor\nssm.exe'
if (Test-Path $legacyNssm) {
    Write-Step "Removing legacy '$LegacyServiceName' via NSSM"
    try { & $legacyNssm remove $LegacyServiceName confirm 2>&1 | Out-Null } catch {}
}
# Belt-and-braces: also run sc.exe delete -- harmless if NSSM already removed
# it, but catches the case where NSSM lost its disk metadata and silently
# failed. Errors are expected when the service is already gone.
Write-Step "Belt-and-braces: sc.exe delete '$LegacyServiceName'"
try { & sc.exe delete $LegacyServiceName 2>&1 | Out-Null } catch {}

# Wait for SCM to actually clear the registration.
for ($i = 0; $i -lt 20; $i++) {
    if (-not (Get-Service -Name $LegacyServiceName -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 500
}

# Kill any straggler PeritusSecure agent powershell processes that NSSM no
# longer owns. The Phase 2a heartbeat-only agent has been observed to keep
# running even after its NSSM service is gone if a prior failed install
# orphaned it.
try {
    Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
        Where-Object {
            $_.CommandLine -and (
                $_.CommandLine -like '*peritus-secure-agent.ps1*' -or
                $_.CommandLine -like '*PeritusSecureAgent.ps1*'   -or
                $_.CommandLine -like '*\PeritusSecure\install*'
            )
        } |
        ForEach-Object {
            Write-Step "Killing straggler legacy agent PID $($_.ProcessId)"
            try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
        }
} catch {}

# Force-delete the legacy install dir so no stale NSSM binary or scripts get
# resurrected by an auto-update or scheduled task. State files in the parent
# (agent.json, config.dat) stay -- they're how we migrate identity.
if (Test-Path (Join-Path $LegacyAgentRoot 'install')) {
    Write-Step "Force-deleting legacy install dir $LegacyAgentRoot\install"
    try { Remove-Item -Path (Join-Path $LegacyAgentRoot 'install') -Recurse -Force -ErrorAction Stop }
    catch { Write-Step "(legacy install dir not fully removed: $($_.Exception.Message))" }
}

# 4. Stop AND remove an existing MithrasAgent install if -Force was given.
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Write-Step "Stopping existing service"
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    for ($i = 0; $i -lt 10; $i++) {
        $s = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if (-not $s -or $s.Status -ne 'Running') { break }
        Start-Sleep -Milliseconds 500
    }
    $existingNssm = Join-Path $InstallRoot 'vendor\nssm.exe'
    if (Test-Path $existingNssm) {
        Write-Step "Removing existing service registration via NSSM"
        & $existingNssm remove $ServiceName confirm | Out-Null
    } else {
        Write-Step "Removing existing service registration via sc.exe"
        & sc.exe delete $ServiceName | Out-Null
    }
    for ($i = 0; $i -lt 10; $i++) {
        if (-not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Milliseconds 500
    }
}

# 5. Copy files
Write-Step "Staging files at $InstallRoot"
if (Test-Path $InstallRoot) { Remove-Item $InstallRoot -Recurse -Force }
New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
Copy-Item -Path (Join-Path $PSScriptRoot '*') -Destination $InstallRoot -Recurse -Force -Exclude 'install-agent.ps1','uninstall-agent.ps1','tests'

# Self-copy the installer so we can call uninstall from the install dir
Copy-Item -Path (Join-Path $PSScriptRoot 'uninstall-agent.ps1') -Destination $InstallRoot -Force -ErrorAction SilentlyContinue

if (-not (Test-Path $NssmExe)) { throw "Bundle is missing nssm.exe at $NssmExe" }

# 6. Import modules from the staged location for enrolment
Import-Module (Join-Path $InstallRoot 'lib/HmacAuth.psm1')    -Force
Import-Module (Join-Path $InstallRoot 'lib/SecureConfig.psm1') -Force
Import-Module (Join-Path $InstallRoot 'lib/ApiClient.psm1')    -Force

# 7. Migrate state files (agent.json, firewall offsets, etc.) from legacy
#    location BEFORE provisioning creds. The legacy agent_token in agent.json
#    is what feeds the upgrade RPC.
if (Test-Path $LegacyAgentRoot) {
    foreach ($name in 'agent.json','firewall-audit-state.json','event-log-state.json','process-event-state.json','persistence-state.json','sysmon-collector-state.json','wu_policy_hash.txt','gpo_policy_hash.txt','policy_hash.txt') {
        $src = Join-Path $LegacyAgentRoot $name
        $dst = Join-Path $AgentRoot      $name
        if (Test-Path $src) { Copy-Item -Path $src -Destination $dst -Force -ErrorAction SilentlyContinue }
    }
}

# 8. Provision HMAC credentials in priority order:
#    a. config.dat already at the new location -> nothing to do.
#    b. Legacy DPAPI config.dat at the PeritusSecure path -> copy across.
#    c. Legacy agent.json with bearer token -> call /agent-legacy-upgrade to
#       get HMAC creds without creating a duplicate endpoint.
#    d. Fresh install -> require -EnrollmentToken and call /agent-enroll.
$agentJsonNew = Join-Path $AgentRoot 'agent.json'

if (Test-Path $ConfigFile) {
    Write-Step "config.dat already present at $ConfigFile - keeping existing HMAC creds"
} elseif (Test-Path $LegacyConfigFile) {
    Write-Step "Migrating DPAPI config from $LegacyConfigFile -> $ConfigFile"
    Copy-Item -Path $LegacyConfigFile -Destination $ConfigFile -Force
} elseif (Test-Path $agentJsonNew) {
    # Legacy bearer-token install path. Read the agent_token, exchange it for
    # HMAC creds via /agent-legacy-upgrade. Returns existing creds if already
    # upgraded (idempotent).
    Write-Step "Detected legacy agent.json - upgrading to HMAC via /agent-legacy-upgrade"
    try {
        $legacy = Get-Content -Path $agentJsonNew -Raw | ConvertFrom-Json
    } catch {
        throw "Failed to parse legacy agent.json at $agentJsonNew : $($_.Exception.Message)"
    }
    if (-not $legacy.agent_token) {
        throw "Legacy agent.json has no agent_token field - cannot upgrade."
    }
    try {
        $upgradeResp = Invoke-RestMethod `
            -Uri "$ApiBaseUrl/functions/v1/agent-legacy-upgrade" `
            -Method POST `
            -Headers @{ 'x-agent-token' = $legacy.agent_token; 'Content-Type' = 'application/json' } `
            -Body '{}' -TimeoutSec 30 -ErrorAction Stop
    } catch {
        throw "Legacy upgrade failed: $($_.Exception.Message). If the endpoint is new, re-run with -EnrollmentToken instead."
    }
    if (-not $upgradeResp.agent_id -or -not $upgradeResp.agent_secret) {
        throw "Legacy upgrade response missing agent_id or agent_secret"
    }
    $verb = if ($upgradeResp.already_upgraded) { 'reusing existing' } else { 'newly issued' }
    Write-Step "Upgrade OK ($verb HMAC) - agent_id=$($upgradeResp.agent_id)"
    $cfg = @{
        agent_id     = $upgradeResp.agent_id
        agent_secret = $upgradeResp.agent_secret
        api_base_url = $upgradeResp.api_base_url
    }
    Save-SecureConfig -Path $ConfigFile -Config $cfg
    Write-Step "Wrote DPAPI-encrypted config at $ConfigFile"
} else {
    if (-not $EnrollmentToken) {
        throw "EnrollmentToken is required for a fresh install (no legacy config.dat or agent.json found at $LegacyAgentRoot)."
    }
    Write-Step "Enrolling at $ApiBaseUrl"
    $os = Get-CimInstance -ClassName Win32_OperatingSystem
    $enrollResp = Invoke-AgentEnroll `
        -ApiBaseUrl $ApiBaseUrl `
        -EnrollmentToken $EnrollmentToken `
        -Hostname $env:COMPUTERNAME `
        -OsVersion $os.Caption `
        -OsBuild $os.BuildNumber `
        -Runtime 'powershell'

    if (-not $enrollResp.agent_id -or -not $enrollResp.agent_secret) {
        throw "Enrolment response missing agent_id or agent_secret"
    }
    Write-Step "Enrolled - agent_id=$($enrollResp.agent_id)"

    $cfg = @{
        agent_id      = $enrollResp.agent_id
        agent_secret  = $enrollResp.agent_secret
        api_base_url  = $enrollResp.api_base_url
    }
    Save-SecureConfig -Path $ConfigFile -Config $cfg
    Write-Step "Wrote DPAPI-encrypted config at $ConfigFile"
}

# 8. Register the NSSM service. Prefer the C# launcher if it's in the bundle -
#    Task Manager and Services console then show the Mithras icon + friendly name.
$pwsh   = (Get-Command powershell.exe -ErrorAction Stop).Path
$script = Join-Path $InstallRoot 'mithras-agent.ps1'

if (Test-Path $LauncherExe) {
    Write-Step "Registering service '$ServiceName' via NSSM -> MithrasAgent.exe (branded launcher)"
    & $NssmExe install $ServiceName $LauncherExe | Out-Null
} else {
    Write-Step "Registering service '$ServiceName' via NSSM -> powershell.exe (no launcher bundled)"
    & $NssmExe install $ServiceName $pwsh '-NoProfile' '-NonInteractive' '-ExecutionPolicy' 'Bypass' '-File' $script | Out-Null
}
& $NssmExe set $ServiceName DisplayName 'Mithras Threat Defence Agent' | Out-Null
& $NssmExe set $ServiceName Description 'Mithras Threat Defence Agent - endpoint security telemetry, threat detection, and policy enforcement.' | Out-Null
& $NssmExe set $ServiceName Start SERVICE_AUTO_START | Out-Null
& $NssmExe set $ServiceName ObjectName 'LocalSystem' | Out-Null
& $NssmExe set $ServiceName AppStdout (Join-Path $AgentRoot 'logs\nssm-stdout.log') | Out-Null
& $NssmExe set $ServiceName AppStderr (Join-Path $AgentRoot 'logs\nssm-stderr.log') | Out-Null
& $NssmExe set $ServiceName AppRotateFiles 1 | Out-Null
& $NssmExe set $ServiceName AppRotateBytes 10485760 | Out-Null
& $NssmExe set $ServiceName AppExit Default Restart | Out-Null
& $NssmExe set $ServiceName AppRestartDelay 5000 | Out-Null

# 8.5. v0.6.7: register the agent's install paths and processes with Defender
# BEFORE the service starts. Otherwise the first time the agent does anything
# Defender's behaviour monitor finds odd (e.g. SYSTEM-context PS writing files
# in user-document locations, hash-comparing decoys, swap.ps1 stop-then-start
# cycles) it can quarantine the agent itself. This proactive registration is
# the same set of paths the operator's "Emergency unlock" command adds
# reactively -- doing it on install means we never need the reactive path.
#
# Idempotent: Add-MpPreference -ExclusionPath silently no-ops if the path is
# already listed. Fails open on Server Core / older SKUs without the cmdlet.
try {
    if (Get-Command Add-MpPreference -ErrorAction SilentlyContinue) {
        $exclPaths = @(
            $InstallRoot,
            "$InstallRoot\*",
            "$InstallRoot\lib\*",
            "$InstallRoot\vendor\*",
            (Join-Path $AgentRoot 'sysmon')        # sysmon binary + config -- Defender behaviour monitor often flags Sysmon's signature-injection event
        )
        $exclProcs = @(
            (Join-Path $InstallRoot 'mithras-agent.ps1'),
            (Join-Path $InstallRoot 'mithras-tray.ps1'),
            $NssmExe
        )
        if (Test-Path $LauncherExe) { $exclProcs += $LauncherExe }

        foreach ($p in $exclPaths) {
            try { Add-MpPreference -ExclusionPath    $p -ErrorAction Stop } catch { Write-Warning "Defender ExclusionPath '$p' failed: $($_.Exception.Message)" }
        }
        foreach ($p in $exclProcs) {
            try { Add-MpPreference -ExclusionProcess $p -ErrorAction Stop } catch { Write-Warning "Defender ExclusionProcess '$p' failed: $($_.Exception.Message)" }
        }
        Write-Step "Defender exclusions registered ($($exclPaths.Count) paths + $($exclProcs.Count) processes)"
    } else {
        Write-Step "Defender Add-MpPreference cmdlet not available -- skipping exclusion registration"
    }
} catch {
    Write-Warning "Defender exclusion setup threw: $_ (continuing install)"
}

# 9. Start it
Write-Step "Starting service"
Start-Service -Name $ServiceName

Start-Sleep -Seconds 2
$svc = Get-Service -Name $ServiceName
if ($svc.Status -ne 'Running') {
    throw "Service did not reach Running state (got $($svc.Status)). Check $AgentRoot\logs\nssm-stderr.log"
}

# 9a. v0.6.4: Apply tamper protection -- DACL lockdown + recovery flags +
# watchdog scheduled task. The agent will self-heal these on every restart
# but applying them now means the first window of vulnerability is closed.
try {
    Import-Module (Join-Path $InstallRoot 'lib/TamperProtection.psm1') -Force
    $tpResult = Set-MithrasServiceHardening -ServiceName $ServiceName
    if ($tpResult.ok) {
        Write-Step "Tamper protection: service DACL hardened (Administrators stripped to read-only)"
    } else {
        Write-Warning "Tamper protection: hardening returned $($tpResult.reason)"
    }
    $wdResult = Register-MithrasWatchdog -ServiceName $ServiceName
    if ($wdResult.ok) {
        Write-Step "Tamper protection: watchdog scheduled task installed (5-min restart loop)"
    } else {
        Write-Warning "Tamper protection: watchdog register failed: $($wdResult.error)"
    }

    # v0.6.5: filesystem hardening on install/, sysmon/, and config.dat. Read
    # by Administrators, full control for SYSTEM only. The service runs as
    # LocalSystem so auto-update (which writes into install/) still works.
    $fsResult = Set-MithrasFilesystemHardening
    if ($fsResult.ok) {
        $hardenedCount = ($fsResult.paths.Keys | Where-Object { $fsResult.paths[$_].ok }).Count
        Write-Step "Tamper protection: filesystem hardened ($hardenedCount paths)"
    } else {
        Write-Warning "Tamper protection: filesystem hardening incomplete"
    }
} catch {
    Write-Warning "Tamper protection setup threw: $_"
}

# 9b. Tray icon. Installs a VBS launcher in the all-users Startup folder so the
#     Mithras logo shows in the notification area on every user logon. The tray
#     itself runs in the logged-in user's session (a SYSTEM service cannot show
#     a taskbar icon).
$trayScript = Join-Path $InstallRoot 'mithras-tray.ps1'
$trayIcon   = Join-Path $InstallRoot 'mithras.ico'
if ((Test-Path $trayScript) -and (Test-Path $trayIcon)) {
    Write-Step "Installing tray launcher in all-users Startup folder"
    $startupDir = "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp"
    if (-not (Test-Path $startupDir)) { New-Item -ItemType Directory -Path $startupDir -Force | Out-Null }
    $vbsPath = Join-Path $startupDir 'Mithras-Tray.vbs'
    @"
' Mithras Threat Defence Agent - tray launcher
' Runs the tray PowerShell script with no visible console window.
Set Shell = CreateObject("WScript.Shell")
Shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""$trayScript""", 0, False
"@ | Set-Content -Path $vbsPath -Encoding ascii -Force

    # Kill any existing tray instances first so a re-run REPLACES them rather
    # than stacking up another icon in the notification area.
    try {
        Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -and $_.CommandLine -like '*mithras-tray.ps1*' } |
            ForEach-Object {
                Write-Step "Stopping existing tray PID $($_.ProcessId)"
                try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
            }
    } catch {}

    # Launch a single fresh tray for the interactive Administrator session (if any).
    try { Start-Process 'wscript.exe' -ArgumentList "`"$vbsPath`"" -WindowStyle Hidden -ErrorAction SilentlyContinue } catch {}
} else {
    Write-Step "(tray script/icon missing in bundle - skipping tray install)"
}

# 10. Optional: clean up the legacy folder if migration was successful and
#     the new service is healthy. Keep the legacy logs for forensics.
if ($migrate) {
    Write-Step "Removing legacy install dir $LegacyAgentRoot\install"
    Remove-Item -Path (Join-Path $LegacyAgentRoot 'install') -Recurse -Force -ErrorAction SilentlyContinue
    Write-Step "Legacy state preserved at $LegacyAgentRoot (logs + backups) - delete manually once happy"
}

Write-Step "Done. Service '$ServiceName' is Running."
Write-Step "Logs: $AgentRoot\logs"
Write-Step "Remote access (MeshAgent) is OPT-IN - enable it for this endpoint from the SOC console when needed."
