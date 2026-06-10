# SysmonInstaller.psm1 - v0.6.2
#
# Idempotently ensures Sysmon is installed with the Mithras baseline config.
# Called from the main agent loop on every policy pass.
#
# Behaviour:
#   - If Sysmon service is missing      -> download Sysmon.exe, install with config
#   - If Sysmon service is running OK   -> compare current config hash to ours;
#                                          re-apply with `Sysmon.exe -c` if drift
#   - If Sysmon service is stopped      -> Start-Service it
#
# Sysmon.exe is downloaded from the official Microsoft Sysinternals URL on
# first install only. Subsequent runs reuse the cached binary in
# C:\ProgramData\Mithras\sysmon\.

$SYSMON_DIR        = 'C:\ProgramData\Mithras\sysmon'
$SYSMON_BIN        = Join-Path $SYSMON_DIR 'Sysmon64.exe'
$SYSMON_CONFIG     = Join-Path $SYSMON_DIR 'sysmon-config.xml'
$SYSMON_CONFIG_HASH = Join-Path $SYSMON_DIR 'sysmon-config.hash'
$SYSMON_DOWNLOAD_URL = 'https://download.sysinternals.com/files/Sysmon.zip'

function Test-SysmonInstalled {
    $svc = Get-Service -Name 'Sysmon64' -ErrorAction SilentlyContinue
    if (-not $svc) { $svc = Get-Service -Name 'Sysmon' -ErrorAction SilentlyContinue }
    return [bool]$svc
}

function Get-SysmonServiceName {
    if (Get-Service -Name 'Sysmon64' -ErrorAction SilentlyContinue) { return 'Sysmon64' }
    if (Get-Service -Name 'Sysmon'   -ErrorAction SilentlyContinue) { return 'Sysmon'   }
    return $null
}

function Get-ConfigContentHash {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $null }
    return (Get-FileHash -Path $Path -Algorithm SHA256).Hash
}

function Ensure-SysmonBinary {
    param([string]$ConfigSourcePath)
    if (-not (Test-Path $SYSMON_DIR)) {
        New-Item -ItemType Directory -Path $SYSMON_DIR -Force | Out-Null
    }
    # Stash the baseline config we shipped with the agent so we can re-apply later.
    if ((Test-Path $ConfigSourcePath) -and ($ConfigSourcePath -ne $SYSMON_CONFIG)) {
        Copy-Item -Path $ConfigSourcePath -Destination $SYSMON_CONFIG -Force
    }

    if (Test-Path $SYSMON_BIN) { return $true }

    # Need to download. TLS 1.2 minimum (Windows 2012 R2 default is too old).
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        $zipPath = Join-Path $SYSMON_DIR 'Sysmon.zip'
        Invoke-WebRequest -Uri $SYSMON_DOWNLOAD_URL -OutFile $zipPath -UseBasicParsing -TimeoutSec 90
        $extractDir = Join-Path $SYSMON_DIR '_extract'
        if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
        Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
        $src = Join-Path $extractDir 'Sysmon64.exe'
        if (-not (Test-Path $src)) {
            # Sysinternals occasionally renames; fall back to 32-bit.
            $src = Join-Path $extractDir 'Sysmon.exe'
        }
        Copy-Item -Path $src -Destination $SYSMON_BIN -Force
        Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
        Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue
        return $true
    } catch {
        Write-PolicyLog "Sysmon download failed: $($_.Exception.Message)" 'Warn'
        return $false
    }
}

function Install-Sysmon {
    param([string]$ConfigSourcePath)
    if (-not (Ensure-SysmonBinary -ConfigSourcePath $ConfigSourcePath)) {
        return $false
    }
    try {
        # Sysmon accepts -i for install with config; -accepteula prevents an
        # interactive prompt on first run.
        $proc = Start-Process -FilePath $SYSMON_BIN `
                              -ArgumentList @('-accepteula', '-i', $SYSMON_CONFIG) `
                              -Wait -PassThru -NoNewWindow -ErrorAction Stop
        if ($proc.ExitCode -ne 0) {
            Write-PolicyLog "Sysmon -i returned exit code $($proc.ExitCode)" 'Warn'
            return $false
        }
        Set-Content -Path $SYSMON_CONFIG_HASH -Value (Get-ConfigContentHash $SYSMON_CONFIG) -Force
        return $true
    } catch {
        Write-PolicyLog "Sysmon install failed: $($_.Exception.Message)" 'Warn'
        return $false
    }
}

function Update-SysmonConfig {
    try {
        $proc = Start-Process -FilePath $SYSMON_BIN `
                              -ArgumentList @('-c', $SYSMON_CONFIG) `
                              -Wait -PassThru -NoNewWindow -ErrorAction Stop
        if ($proc.ExitCode -ne 0) {
            Write-PolicyLog "Sysmon -c returned exit code $($proc.ExitCode)" 'Warn'
            return $false
        }
        Set-Content -Path $SYSMON_CONFIG_HASH -Value (Get-ConfigContentHash $SYSMON_CONFIG) -Force
        return $true
    } catch {
        Write-PolicyLog "Sysmon config update failed: $($_.Exception.Message)" 'Warn'
        return $false
    }
}

function Ensure-Sysmon {
    <#
    .SYNOPSIS
    Idempotently bring Sysmon to the desired state. Safe to call on every policy pass.
    .PARAMETER ConfigSourcePath
    Path to the Mithras baseline Sysmon config XML (ships in the agent's install dir).
    .OUTPUTS
    Hashtable: @{ ok=bool; action='installed'|'updated'|'started'|'noop'|'failed'; reason=string }
    #>
    param(
        [Parameter(Mandatory)][string]$ConfigSourcePath
    )

    # Always copy the latest config so we know what to compare against.
    if (-not (Test-Path $SYSMON_DIR)) {
        New-Item -ItemType Directory -Path $SYSMON_DIR -Force | Out-Null
    }
    if (Test-Path $ConfigSourcePath) {
        Copy-Item -Path $ConfigSourcePath -Destination $SYSMON_CONFIG -Force
    }

    $svcName = Get-SysmonServiceName
    if (-not $svcName) {
        # Cold install
        $ok = Install-Sysmon -ConfigSourcePath $ConfigSourcePath
        return @{ ok = $ok; action = $(if ($ok) { 'installed' } else { 'failed' }); reason = $(if ($ok) { 'cold install' } else { 'install_failed' }) }
    }

    # Service exists - ensure it's running
    $svc = Get-Service -Name $svcName
    if ($svc.Status -ne 'Running') {
        try {
            Start-Service -Name $svcName -ErrorAction Stop
            return @{ ok = $true; action = 'started'; reason = "was $($svc.Status)" }
        } catch {
            return @{ ok = $false; action = 'failed'; reason = "start failed: $($_.Exception.Message)" }
        }
    }

    # Service running - compare config hash; re-apply if drifted
    $currentHash = Get-ConfigContentHash $SYSMON_CONFIG
    $appliedHash = if (Test-Path $SYSMON_CONFIG_HASH) {
        (Get-Content $SYSMON_CONFIG_HASH -Raw).Trim()
    } else { $null }

    # v0.6.2 fix #1: self-heal the binary stash. The service can be running
    # even though Sysmon64.exe is gone (e.g. cleaned by an over-eager script,
    # or wiped by a prior install path). Without the binary present, every
    # Update-SysmonConfig call below silently fails -- creating the eternal
    # "config drift" loop the PoC review caught. Re-download on demand.
    if (-not (Test-Path $SYSMON_BIN)) {
        Write-PolicyLog "Sysmon binary missing at $SYSMON_BIN -- re-downloading" 'Warn'
        if (-not (Ensure-SysmonBinary -ConfigSourcePath $SYSMON_CONFIG)) {
            return @{ ok = $false; action = 'failed'; reason = 'binary_missing_and_redownload_failed' }
        }
    }

    # v0.6.2 fix #2: hash bootstrap. If the service is already running and we
    # have no recorded hash, we have no way to know what config the loaded
    # service is running. Two choices:
    #   * Trust it: record current hash, noop -- breaks the drift loop, may
    #     miss a real drift on the very first pass after upgrade
    #   * Force re-apply: Sysmon -c, then write hash
    # We force-apply once. It's idempotent (Sysmon -c is a no-op if the loaded
    # config equals the file) and guarantees the operator's intended config is
    # active. Future passes hit the fast hash-equal path.
    if (-not $appliedHash) {
        $ok = Update-SysmonConfig
        return @{ ok = $ok; action = $(if ($ok) { 'bootstrapped' } else { 'failed' }); reason = 'first-run hash bootstrap' }
    }

    if ($currentHash -and $appliedHash -ne $currentHash) {
        $ok = Update-SysmonConfig
        return @{ ok = $ok; action = $(if ($ok) { 'updated' } else { 'failed' }); reason = 'config drift' }
    }

    return @{ ok = $true; action = 'noop'; reason = 'already current' }
}

# Polyfill in case caller didn't import the policy-logger.
if (-not (Get-Command -Name Write-PolicyLog -ErrorAction SilentlyContinue)) {
    function Write-PolicyLog { param([string]$Message, [string]$Level = 'Info') Write-Host "[$Level] [Sysmon] $Message" }
}

Export-ModuleMember -Function Ensure-Sysmon, Test-SysmonInstalled, Get-SysmonServiceName
