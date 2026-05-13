#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Install the Peritus Secure Agent as a Windows service.
.DESCRIPTION
    1. Copies agent files to C:\ProgramData\PeritusSecure\install
    2. Runs enrolment against the platform to obtain agent_id + agent_secret
    3. Saves credentials to DPAPI-encrypted config.dat
    4. Registers the Windows service "PeritusSecureAgent" via NSSM
    5. Starts the service
.PARAMETER EnrollmentToken
    One-time token generated in the platform's Agent Download page.
.PARAMETER ApiBaseUrl
    Base URL of the Peritus platform, e.g. https://api.cmwcollective.com.au
.PARAMETER ServiceName
    Optional override for the service name. Default: PeritusSecureAgent
.PARAMETER Force
    Re-install over an existing service installation.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$EnrollmentToken,
    [Parameter(Mandatory)][string]$ApiBaseUrl,
    [string]$ServiceName = 'PeritusSecureAgent',
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$AgentRoot   = 'C:\ProgramData\PeritusSecure'
$InstallRoot = Join-Path $AgentRoot 'install'
$ConfigFile  = Join-Path $AgentRoot 'config.dat'
$NssmExe     = Join-Path $InstallRoot 'vendor\nssm.exe'

function Write-Step { param([string]$Msg) Write-Host "[install] $Msg" }

# 1. Refuse to clobber an existing install unless -Force
if ((Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) -and -not $Force) {
    throw "Service '$ServiceName' already exists. Re-run with -Force to reinstall."
}

# 2. Stop / remove old service if present
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Write-Step "Stopping existing service"
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
}

# 3. Copy files
Write-Step "Staging files at $InstallRoot"
if (Test-Path $InstallRoot) { Remove-Item $InstallRoot -Recurse -Force }
New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
Copy-Item -Path (Join-Path $PSScriptRoot '*') -Destination $InstallRoot -Recurse -Force -Exclude 'install-agent.ps1','uninstall-agent.ps1','tests'

# Self-copy the installer so we can call uninstall from the install dir
Copy-Item -Path (Join-Path $PSScriptRoot 'uninstall-agent.ps1') -Destination $InstallRoot -Force -ErrorAction SilentlyContinue

if (-not (Test-Path $NssmExe)) { throw "Bundle is missing nssm.exe at $NssmExe" }

# 4. Import modules from the staged location for enrolment
Import-Module (Join-Path $InstallRoot 'lib/HmacAuth.psm1')    -Force
Import-Module (Join-Path $InstallRoot 'lib/SecureConfig.psm1') -Force
Import-Module (Join-Path $InstallRoot 'lib/ApiClient.psm1')    -Force

# 5. Enrol — exchange the one-time token for { agent_id, agent_secret }
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
Write-Step "Enrolled — agent_id=$($enrollResp.agent_id)"

# 6. Persist config via DPAPI
$cfg = @{
    agent_id      = $enrollResp.agent_id
    agent_secret  = $enrollResp.agent_secret
    api_base_url  = $enrollResp.api_base_url
}
Save-SecureConfig -Path $ConfigFile -Config $cfg
Write-Step "Wrote DPAPI-encrypted config at $ConfigFile"

# 7. Register the NSSM service
$pwsh   = (Get-Command powershell.exe -ErrorAction Stop).Path
$script = Join-Path $InstallRoot 'peritus-secure-agent.ps1'

Write-Step "Registering service '$ServiceName' via NSSM"
& $NssmExe install $ServiceName $pwsh '-NoProfile' '-NonInteractive' '-ExecutionPolicy' 'Bypass' '-File' $script | Out-Null
& $NssmExe set $ServiceName Description 'Peritus Secure Agent — endpoint security telemetry' | Out-Null
& $NssmExe set $ServiceName Start SERVICE_AUTO_START | Out-Null
& $NssmExe set $ServiceName ObjectName 'LocalSystem' | Out-Null
& $NssmExe set $ServiceName AppStdout (Join-Path $AgentRoot 'logs\nssm-stdout.log') | Out-Null
& $NssmExe set $ServiceName AppStderr (Join-Path $AgentRoot 'logs\nssm-stderr.log') | Out-Null
& $NssmExe set $ServiceName AppRotateFiles 1 | Out-Null
& $NssmExe set $ServiceName AppRotateBytes 10485760 | Out-Null
& $NssmExe set $ServiceName AppExit Default Restart | Out-Null
& $NssmExe set $ServiceName AppRestartDelay 5000 | Out-Null

# 8. Start it
Write-Step "Starting service"
Start-Service -Name $ServiceName

Start-Sleep -Seconds 2
$svc = Get-Service -Name $ServiceName
if ($svc.Status -ne 'Running') {
    throw "Service did not reach Running state (got $($svc.Status)). Check $AgentRoot\logs\nssm-stderr.log"
}

Write-Step "Done. Service '$ServiceName' is Running."
Write-Step "Logs: $AgentRoot\logs\"
